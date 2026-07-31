import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
// `.ts` because these specs run under Playwright's Node loader, not Vite: @dnd/core has no
// `exports` map, so the subpath is resolved on the filesystem and needs its real extension.
import { pointInPolygon } from '@dnd/core/src/engine/hitTest.ts'
import type { DoorChild, Room } from '@dnd/core/src/shared/types'
import type { DungeonLayer, SerializedMapData } from '@dnd/core/src/store/types'
import type { AuthoredDoor, DoorLiveState } from '@dnd/mechanics/doors'
import { effectiveFog, roomFogOf, visibleRooms, type SceneFog } from '@dnd/mechanics/fog'
import { assertMapLoaded, assertMapRendered, hostTable, joinTable, type MapUnderTest } from './table'
import { canvasPoint, createDef, placeToken, tokenPositions } from './tokens'

/**
 * @doors — THE flagship flow, the one row the contract doc (§3) has carried as "never
 * executed end-to-end": a player claims a token, a shut door holds both their sight and
 * their feet out of the next room, the door opens, the token walks through, and the room
 * behind them drops to memory.
 *
 *   pnpm exec playwright test -c e2e/playwright.doors.config.ts
 *
 * Named `doors-*` so it rides the door lane's config (production build, `vite preview`,
 * ANGLE) — the flow is door-gated from end to end and a fourth config would be a fourth
 * thing to keep in step.
 *
 * What the flow is *not*, and why: vision here is room-granular (D3). A room the DM has
 * never revealed does not become visible because a door opened — it is simply not in play
 * yet. So the DM reveals both rooms up front and the shut door is what conceals: that is
 * D3 layer 2, and it is the whole of "a closed door stops sight" until per-player LOS (V3).
 */

const VIEWPORT = { width: 1280, height: 720 }

const FLOOR_DOORS: MapUnderTest = {
  file: join(import.meta.dirname, '../../testdata/emberhold-crypt-floor-doors.mapbuilder'),
  name: 'Emberhold Crypt (floor doors)',
}

// ── What the map says, read the way the server reads it ────────────────────

const map = JSON.parse(readFileSync(FLOOR_DOORS.file, 'utf8')) as SerializedMapData
const layer = map.layers.find((l): l is DungeonLayer => l.type === 'dungeon')!
const roomOf = (id: string): Room => layer.rooms!.find((r) => r.id === id)!

/** The party's room: the map's largest non-corridor, so it is also the fog's default room. */
const CHAMBER = roomOf('room-1pihv60') // Torchlit Chamber — the four torches are in here
/** The room beyond: a corridor with no light of its own, lit only through the doorway. */
const GALLERY = roomOf('room-1wj1dx1') // East Gallery
/** The door between them. `door-gallery-hatch` joins the same pair and stays shut. */
const DOOR = layer.children.find((c): c is DoorChild => c.id === 'door-gallery-chamber')!

/** Where the token stands, and the step through the doorway it is refused and then allowed. */
const START = { x: 23.5, y: 13.5 }
const BEYOND = { x: 18.5, y: 13.5 }

// ── Instruments ────────────────────────────────────────────────────────────

const doorRow = (page: Page, id: string) =>
  page.getByTestId('door-list').locator(`[data-door-id="${id}"]`)

const shoot = (page: Page) => page.locator('[data-testid="game-canvas"] canvas').screenshot()

/** What fraction of the canvas moved between two shots — the doors/fog specs' instrument. */
function changed(page: Page, before: Buffer, after: Buffer): Promise<number> {
  return page.evaluate(
    async ([a, b]: string[]) => {
      const pixels = async (base64: string) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const surface = new OffscreenCanvas(bitmap.width, bitmap.height)
        const ctx = surface.getContext('2d')!
        ctx.drawImage(bitmap, 0, 0)
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
      }
      const [x, y] = await Promise.all([pixels(a), pixels(b)])
      let moved = 0
      for (let i = 0; i < x.length; i += 4) {
        const d =
          Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2])
        if (d > 8) moved++
      }
      return moved / (x.length / 4)
    },
    [before.toString('base64'), after.toString('base64')],
  )
}

/** Everything this tab's fog mask is built from, straight off its own two stores. */
interface Held {
  rooms: Room[]
  doors: AuthoredDoor[]
  live: Record<string, DoorLiveState>
  fog: SceneFog
  party: { x: number; y: number }[]
}

function heldFog(page: Page): Promise<Held> {
  return page.evaluate(() => {
    interface Child {
      id: string
      childType: string
      state: string
      isSecret: boolean
      style?: string
      roomA?: string | null
      roomB?: string | null
    }
    interface Tab {
      __sessionStore?: {
        getState(): {
          session?: { activeSceneId?: string | null; modules?: Record<string, unknown> } | null
          mapData?: { layers?: { type: string; rooms?: unknown[]; children?: Child[] }[] } | null
        }
      }
    }
    const state = (window as unknown as Tab).__sessionStore!.getState()
    const sceneId = state.session?.activeSceneId ?? ''
    const modules = (state.session?.modules ?? {}) as Record<string, Record<string, never>>
    const dungeon = (state.mapData?.layers ?? []).filter((l) => l.type === 'dungeon')
    const tokens = Object.values(
      (modules.tokens as unknown as { byScene?: Record<string, Record<string, unknown>> })
        ?.byScene?.[sceneId] ?? {},
    ) as { x: number; y: number; ownerId: string | null; hidden: boolean }[]
    return {
      rooms: dungeon.flatMap((l) => l.rooms ?? []),
      doors: (dungeon.flatMap((l) => l.children ?? []) as Child[]).filter(
        (c) => c.childType === 'door',
      ),
      live:
        (modules.doors as unknown as { byScene?: Record<string, unknown> })?.byScene?.[sceneId] ??
        {},
      fog: (modules.fog as unknown as { byScene?: Record<string, unknown> })?.byScene?.[
        sceneId
      ] ?? { rooms: {}, concealBehindDoors: true },
      // A claimed, unhidden token is a player at the table (`partyRoomIds`).
      party: tokens.filter((t) => t.ownerId && !t.hidden).map((t) => ({ x: t.x, y: t.y })),
    } as unknown as Held
  })
}

/** `withheld` is the fourth state the renderer never sees: no geometry for it at all. */
type RoomView = 'visible' | 'explored' | 'dark' | 'withheld'

/**
 * What this tab's mask says about each room — `FogRenderer.roomViews` re-run outside the
 * page, on the page's own inputs and through the same two mechanics functions the renderer
 * and the referee both call. Reading it out of the renderer instead would mean a debug
 * handle in production code for the sake of a fixture; recomputing it from what the tab
 * holds asserts the same thing about the same state.
 */
async function roomViews(page: Page): Promise<Record<string, RoomView>> {
  const held = await heldFog(page)
  const party: string[] = []
  for (const at of held.party) {
    const room = held.rooms.find((r) => pointInPolygon([at.x, at.y], r.boundary))
    // The client has a sentinel for a token it cannot place; this flow never produces one,
    // and a silent `[]` here would flip concealment off and light the whole map up.
    if (!room) throw new Error(`a claimed token at ${at.x},${at.y} is in no room this tab holds`)
    if (!party.includes(room.id)) party.push(room.id)
  }
  // No rooms handed to `effectiveFog`, exactly as `FogRenderer` calls it: the default-room
  // fallback is off on both sides of the wire, and passing rooms here would light a room the
  // renderer under test leaves dark.
  const fog = effectiveFog(held.fog, [], party)
  const visible = visibleRooms(fog, held.live, held.doors, party)
  return Object.fromEntries(
    held.rooms.map((room) => [
      room.id,
      visible.has(room.id) ? 'visible' : roomFogOf(fog, room.id).wasEverRevealed ? 'explored' : 'dark',
    ]),
  )
}

const viewOf = async (page: Page, room: Room): Promise<RoomView> =>
  (await roomViews(page))[room.id] ?? 'withheld'

/** The fog tool is a mode: arming it is what puts the room list on screen. */
async function armFog(dm: Page): Promise<void> {
  if ((await dm.getByTestId('fog-bar').count()) === 0) {
    await dm.getByTestId('fog-tool-toggle').click()
    await expect(dm.getByTestId('fog-bar')).toBeVisible()
  }
}

async function revealRoom(dm: Page, roomId: string): Promise<void> {
  await armFog(dm)
  const row = dm.getByTestId('fog-rooms').locator(`[data-room-id="${roomId}"]`)
  if ((await row.getAttribute('data-fog-status')) !== 'revealed') {
    await row.getByRole('button').click()
  }
  await expect(row).toHaveAttribute('data-fog-status', 'revealed')
}

/** Select the door row, then swing it with the control beside it (D10: two gestures). */
async function toggleDoor(page: Page, id: string): Promise<void> {
  await doorRow(page, id).getByRole('button').click()
  await page.getByTestId('door-toggle').click()
}

/**
 * The drop message a drag sends, sent without the drag.
 *
 * ponytail: the production build exposes no camera transform (`__pixiApp` is DEV-only), so
 * a pointer drag cannot be *aimed* at a world cell — and this flow is entirely about which
 * cell the token lands in. The pointer path itself is covered by `sprint2-tokens.spec.ts`'s
 * `dragToken` rows; what is under test here is the move that path emits and the answer it
 * gets. Aim a real drag the day the build hands out a world→screen mapping.
 */
const sendMove = (page: Page, id: string, at: { x: number; y: number }): Promise<void> =>
  page.evaluate(
    ([tokenId, x, y]) => {
      interface Tab {
        __sessionStore?: {
          getState(): { sendCommand(module: string, action: string, payload: unknown): void }
        }
      }
      ;(window as unknown as Tab).__sessionStore!.getState().sendCommand('tokens', 'move', {
        id: tokenId,
        x,
        y,
      })
    },
    [id, at.x, at.y] as [string, number, number],
  )

// ── The table ──────────────────────────────────────────────────────────────

test.describe.serial('@doors flagship', () => {
  let dmContext: BrowserContext
  let playerContext: BrowserContext
  let dm: Page
  let player: Page
  let tokenId: string
  const pageErrors: string[] = []

  test.beforeAll(async ({ browser }) => {
    // The two cells this whole spec is about have to be in the rooms it names.
    expect(pointInPolygon([START.x, START.y], CHAMBER.boundary)).toBe(true)
    expect(pointInPolygon([BEYOND.x, BEYOND.y], GALLERY.boundary)).toBe(true)
    expect([DOOR.roomA, DOOR.roomB].sort()).toEqual([CHAMBER.id, GALLERY.id].sort())

    // Reduced motion on both seats: the reveal fade cuts instantly instead of running for
    // 300ms, so a screenshot taken after a door swing is of a settled canvas.
    dmContext = await browser.newContext({ viewport: VIEWPORT, reducedMotion: 'reduce' })
    dm = await dmContext.newPage()
    dm.on('pageerror', (e) => pageErrors.push(`[dm] ${e.message}`))

    const code = await hostTable(dm, FLOOR_DOORS)
    await dm.getByRole('button', { name: 'Enter table' }).click()
    await expect(dm.locator('[data-page="table"]')).toBeVisible()
    await assertMapRendered(dm, FLOOR_DOORS)

    playerContext = await browser.newContext({ viewport: VIEWPORT, reducedMotion: 'reduce' })
    player = await playerContext.newPage()
    player.on('pageerror', (e) => pageErrors.push(`[player] ${e.message}`))
    await joinTable(player, code, 'Borin')
    // A player holds no room of this map until the DM reveals one, so there is no floor for
    // them to draw — `assertMapRendered` would be asking fog to have failed.
    await assertMapLoaded(player, FLOOR_DOORS)

    // The DM puts a token on the map, then stands it on the cell this flow starts from.
    await createDef(dm, 'Torchbearer')
    await placeToken(dm, 'Torchbearer', await canvasPoint(dm, 0.5, 0.5))
    tokenId = Object.keys(await tokenPositions(dm))[0]
    await sendMove(dm, tokenId, START)
    await expect.poll(() => tokenPositions(dm).then((p) => p[tokenId])).toEqual(START)
  })

  test.afterAll(async () => {
    await playerContext?.close()
    await dmContext?.close()
    if (pageErrors.length) {
      console.log(`[finding] ${pageErrors.length} uncaught page error(s) on the flagship flow:`)
      for (const message of [...new Set(pageErrors)]) console.log(`  ${message}`)
    }
  })

  test('the player claims a token, and the room behind the shut door is memory, not sight', async () => {
    // The party's own room first. Nothing is lent to a player at join, so until the DM
    // reveals the chamber the token standing in it is redacted off the player's seat
    // altogether (D4/D7) — that is the fog working, not a token gone missing.
    await expect(player.getByTestId('token-layer').locator('[data-token-id]')).toHaveCount(0)
    await revealRoom(dm, CHAMBER.id)

    const row = player.getByTestId('token-layer').locator(`[data-token-id="${tokenId}"]`)
    await expect(row).toHaveCount(1, { timeout: 20_000 })
    await row.getByRole('button').click()
    await player.getByTestId('claim-button').click()
    await expect(row).toHaveAttribute('data-owner', /.+/, { timeout: 20_000 })

    // The room beyond is the DM's to hand over too; the door is what holds the party out.
    await revealRoom(dm, GALLERY.id)

    await expect.poll(() => viewOf(player, GALLERY), { timeout: 20_000 }).toBe('explored')
    expect(await viewOf(player, CHAMBER)).toBe('visible')
    await expect(doorRow(player, DOOR.id)).toHaveAttribute('data-open', 'false')
  })

  test('a step through the shut door is refused, and the refusal says so', async () => {
    await sendMove(player, tokenId, BEYOND)

    await expect(player.getByTestId('toast')).toContainText("You can't move there.")
    // The refusal is the server's: the token is still where it stood, on both seats.
    await expect.poll(() => tokenPositions(player).then((p) => p[tokenId])).toEqual(START)
    expect((await tokenPositions(dm))[tokenId]).toEqual(START)

    // …and it stays there however often it is asked. The browser gate measured a token
    // creeping about a cell forward per refused drag (x: 406→429→455→451px over four), so
    // "refused" has to mean the same cell every time and not merely "not all the way".
    for (let i = 0; i < 3; i++) await sendMove(player, tokenId, BEYOND)
    await expect.poll(() => tokenPositions(player).then((p) => p[tokenId])).toEqual(START)
    expect((await tokenPositions(dm))[tokenId]).toEqual(START)
  })

  test('the player opens the door and their sight runs into the gallery', async () => {
    const before = await shoot(player)
    const settled = await shoot(player)
    const noise = await changed(player, before, settled)

    await toggleDoor(player, DOOR.id)
    await expect(doorRow(dm, DOOR.id)).toHaveAttribute('data-open', 'true')
    await expect.poll(() => viewOf(player, GALLERY), { timeout: 20_000 }).toBe('visible')

    await player.waitForTimeout(1500)
    const moved = await changed(player, settled, await shoot(player))
    console.log(
      `[metric] gallery entered sight: player canvas moved ${(moved * 100).toFixed(3)}% ` +
        `(noise ${(noise * 100).toFixed(3)}%)`,
    )
    // The corridor stops being a memory and starts being a room — the explored wash comes
    // off it and the chamber's torchlight reaches through the doorway.
    expect(moved).toBeGreaterThan(Math.max(noise * 4, 0.0002))
  })

  test('the token walks through the doorway', async () => {
    // The refusal has had its say and gone; an accepted move must add nothing.
    await expect(player.getByTestId('toast')).toHaveCount(0, { timeout: 15_000 })

    await sendMove(player, tokenId, BEYOND)
    await expect.poll(() => tokenPositions(player).then((p) => p[tokenId])).toEqual(BEYOND)
    expect((await tokenPositions(dm))[tokenId]).toEqual(BEYOND)
    await expect(player.getByTestId('toast')).toHaveCount(0)
  })

  test('the door shut behind them leaves the chamber explored, not black', async () => {
    const before = await shoot(player)
    const settled = await shoot(player)
    const noise = await changed(player, before, settled)

    await toggleDoor(player, DOOR.id)
    await expect(doorRow(dm, DOOR.id)).toHaveAttribute('data-open', 'false')

    // The room they walked out of is no longer live — and is still theirs: `explored` is
    // only reachable for a room this tab still holds the geometry of, which is the
    // difference between a dimmed room and a black one (the wash itself is pinned by
    // `sprint3-fog.spec.ts`'s "explored memory renders dimmed, not black").
    await expect.poll(() => viewOf(player, CHAMBER), { timeout: 20_000 }).toBe('explored')
    expect(await viewOf(player, GALLERY)).toBe('visible')

    await player.waitForTimeout(1500)
    const moved = await changed(player, settled, await shoot(player))
    console.log(
      `[metric] chamber dropped to memory: player canvas moved ${(moved * 100).toFixed(3)}% ` +
        `(noise ${(noise * 100).toFixed(3)}%)`,
    )
    expect(moved).toBeGreaterThan(Math.max(noise * 4, 0.0002))
  })
})
