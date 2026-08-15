import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
// `.ts` because these specs run under Playwright's Node loader, not Vite: @dnd/core has no
// `exports` map, so the subpath is resolved on the filesystem and needs its real extension.
import type { DoorChild, Room } from '@dnd/core/src/shared/types'
import type { DungeonLayer, SerializedMapData } from '@dnd/core/src/store/types'
import {
  assertMapLoaded,
  assertMapRendered,
  hostTable,
  joinTable,
  measureFps,
  type MapUnderTest,
} from './table'

/**
 * @sprint3-vision — token vision (S3 P2) at the table, which is the only place the two halves
 * of it meet: the referee's sweep decides what a player is *sent*, and this canvas decides
 * what they can *see* of what they hold. The unit rows pin each half on its own
 * (`session/server/src/fog/vision-mode.test.ts`, `src/modules/fog/visionSight.test.ts`); what
 * only a browser can answer is whether the two agree with a real socket between them.
 *
 * The map is two halls either side of one wall with a two-cell door in it
 * (`session/testdata/vision-two-rooms.mapbuilder`) — small enough that every reading below is
 * about the door being shut or open, and not about a dressed dungeon's own texture.
 *
 * No fog UI exists for any of this yet (that is P4), so the DM's commands go through the
 * session store the way the socket carries them. That is deliberate rather than a shortcut:
 * these rows are about the server's truth reaching a canvas, and a panel in between would
 * only add a second thing to be broken.
 *
 *   pnpm exec playwright test -c e2e/playwright.sprint3.config.ts
 */

const VIEWPORT = { width: 1280, height: 720 }

/** D10's reveal fade, copied for the reason sprint3-fog copies it: this is a Node process. */
const REVEAL_MS = 300

// ── The map, read the way the server reads it ───────────────────────────────
// By shape, never by spelled-out id: a re-authored fixture has to fail here loudly.

const FILE = join(import.meta.dirname, '../../testdata/vision-two-rooms.mapbuilder')
const doc = JSON.parse(readFileSync(FILE, 'utf8')) as SerializedMapData
const VISION: MapUnderTest = { file: FILE, name: doc.mapSettings.name }

const layer = doc.layers.find((l): l is DungeonLayer => l.type === 'dungeon')!
/** West first, east second — the party starts in the near one and the far one is the secret. */
const [NEAR, FAR] = [...(layer.rooms ?? [])].sort((a, b) => a.centroid[0] - b.centroid[0])
/** The ordinary door between them. The other one on this wall is secret and stays the DM's. */
const DOOR = layer.children.find(
  (child): child is DoorChild => child.childType === 'door' && !child.isSecret,
)!

/** Where the scout stands to see through the doorway, and where it cannot. */
const AT_DOOR = { x: NEAR.centroid[0] + 0.5, y: NEAR.centroid[1] + 0.5 }
const AWAY = { x: 1.5, y: 1.5 }
const SIGHT = { range: 8, angle: 360, visionMode: 'normal' }

// ── Instruments ────────────────────────────────────────────────────────────

interface SessionHandle {
  getState(): {
    sendCommand(module: string, action: string, payload: unknown): void
    mapData: unknown
  }
}

/** A DM (or player) command, straight down the socket the panels would use. */
function command(page: Page, module: string, action: string, payload: unknown): Promise<void> {
  return page.evaluate(
    (sent: { module: string; action: string; payload: unknown }) => {
      const store = (window as unknown as { __sessionStore?: SessionHandle }).__sessionStore
      if (!store) throw new Error('this build is not exposing the session store — rebuild')
      store.getState().sendCommand(sent.module, sent.action, sent.payload)
    },
    { module, action, payload },
  )
}

interface ProbeRead {
  mode: string
  sources: number
  cells: number
  rebuilds: number
  lastMs: number
}

/** `__fogProbe`'s vision half (§4). The four fields sprint3-fog reads are untouched. */
function probe(page: Page): Promise<ProbeRead | null> {
  return page.evaluate(() => {
    const p = (
      window as Window & {
        __fogProbe?: {
          mode: string
          sweepSources(): number
          memoryCells(): number
          rebuilds: number
          lastRebuildMs: number
        }
      }
    ).__fogProbe
    return p
      ? {
          mode: p.mode,
          sources: p.sweepSources(),
          cells: p.memoryCells(),
          rebuilds: p.rebuilds,
          lastMs: p.lastRebuildMs,
        }
      : null
  })
}

const read = async (page: Page): Promise<ProbeRead> => {
  const now = await probe(page)
  expect(now, 'the fog probe is not mounted on this seat').not.toBeNull()
  return now as ProbeRead
}

/**
 * Which rooms this tab was actually handed, off the referee's own document.
 *
 * Not off core's store, which is where `serverRooms` will not read either: core re-detects
 * rooms from the geometry *this tab* holds a beat after every load and overwrites
 * `layer.rooms` with ids of its own invention (measured here: the west hall came back as
 * `room-dk42s3`), so a row asserting on those is racing the backfill.
 */
function heldRooms(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (window as unknown as { __sessionStore?: SessionHandle }).__sessionStore
    const held = store?.getState().mapData as { layers?: { rooms?: { id: string }[] }[] } | null
    return (held?.layers ?? []).flatMap((l) => (l.rooms ?? []).map((r) => r.id)).sort()
  })
}

/**
 * What this tab's own fog slice says about a room — null for one it was never sent.
 *
 * The wire half of the cell tier: a room the party *swept* is latched (`re_hidden`), so its
 * geometry ships and the cells they reached are what shows; `revealed` is the DM's own act and
 * is the only thing that washes a room whole.
 */
function fogStatus(page: Page, roomId: string): Promise<string | null> {
  return page.evaluate((id: string) => {
    const store = (
      window as unknown as {
        __sessionStore?: {
          getState(): { session?: { activeSceneId?: string; modules?: Record<string, unknown> } }
        }
      }
    ).__sessionStore
    const state = store?.getState()
    const scene = state?.session?.activeSceneId
    const fog = state?.session?.modules?.fog as
      | { byScene?: Record<string, { rooms?: Record<string, { status?: string }> }> }
      | undefined
    return (scene ? fog?.byScene?.[scene]?.rooms?.[id]?.status : null) ?? null
  }, roomId)
}

/** The cells of one room, in the region record's own coordinates. */
async function cellsOf(page: Page, room: Room): Promise<[number, number][]> {
  const frame = await page.evaluate(() => {
    const store = (window as unknown as { __sessionStore?: SessionHandle }).__sessionStore
    return (store?.getState().mapData as { frame?: Record<string, number> } | null)?.frame ?? null
  })
  expect(frame, 'the document carries no frame to count cells against').not.toBeNull()
  const { minX, minY, maxX, maxY } = frame as Record<string, number>
  const [cols, rows] = [Math.round(maxX - minX), Math.round(maxY - minY)]
  const xs = room.boundary.map((p) => p[0])
  const ys = room.boundary.map((p) => p[1])
  const cells: [number, number][] = []
  for (let x = Math.floor(Math.min(...xs)); x < Math.ceil(Math.max(...xs)); x++) {
    for (let y = Math.floor(Math.min(...ys)); y < Math.ceil(Math.max(...ys)); y++) {
      const [col, row] = [Math.round(x - minX), Math.round(y - minY)]
      if (col >= 0 && row >= 0 && col < cols && row < rows) cells.push([col, row])
    }
  }
  expect(cells.length).toBeGreaterThan(0)
  return cells
}

/** sprint3-fog's shutter and its reasons — chrome hidden so the status bar is not in frame. */
const OVERLAY_CHROME =
  '[data-testid="table-status-bar"],[aria-label="Fit to screen"],[data-testid="active-tool"],[data-testid="toast"],[data-testid="reconnecting-banner"]{display:none}'
const shoot = (page: Page): Promise<Buffer> =>
  page.locator('[data-testid="game-canvas"] canvas').screenshot({ style: OVERLAY_CHROME })

interface Look {
  /** Mean luminance over the whole canvas, 0–255. */
  mean: number
  /** Fraction of pixels above the black floor — how much of the map is drawn at all. */
  lit: number
}

function develop(page: Page, shot: Buffer): Promise<Look> {
  return page.evaluate(async (url: string) => {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob())
    const surface = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = surface.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
    let sum = 0
    let lit = 0
    for (let i = 0; i < data.length; i += 4) {
      const luminance = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      sum += luminance
      // This map's floor is the editor default (#F1ECDF, luminance ~236) and its void is the
      // background's own #2d2d2d at ~45, so the floor is the only thing that clears 120.
      if (luminance > 120) lit++
    }
    return { mean: sum / (data.length / 4), lit: lit / (data.length / 4) }
  }, `data:image/png;base64,${shot.toString('base64')}`)
}

const look = async (page: Page): Promise<Look> => develop(page, await shoot(page))
const show = (l: Look) => `mean ${l.mean.toFixed(1)}/255, ${(l.lit * 100).toFixed(1)}% floor`

/**
 * One camera for every reading in a segment.
 *
 * The renderer frames a scene exactly once — a reveal must never yank the camera — so a fit
 * taken while the party held one room is a different transform from one taken after a reload
 * with two. Every shot below is taken through a fit performed with the same geometry held,
 * which is what makes two means comparable at all.
 */
async function frameUp(page: Page): Promise<void> {
  await page.getByLabel('Fit to screen').click()
  await page.waitForTimeout(REVEAL_MS * 3)
}

/** What fraction of the canvas moved between two shots. sprint3-fog's, for its reasons. */
function changed(page: Page, before: Buffer, after: Buffer): Promise<number> {
  return page.evaluate(
    async ([a, b]: string[]) => {
      const pixels = async (url: string) => {
        const bitmap = await createImageBitmap(await (await fetch(url)).blob())
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
    [
      `data:image/png;base64,${before.toString('base64')}`,
      `data:image/png;base64,${after.toString('base64')}`,
    ],
  )
}

/** Every measurement lands in the run log in the same grep-able shape as the other specs. */
function record(name: string, measured: string, target: string): void {
  console.log(`[metric] ${name}: ${measured} (target: ${target})`)
}

const doorRow = (page: Page, doorId: string) =>
  page.getByTestId('door-list').locator(`[data-door-id="${doorId}"]`)

// ── The table ──────────────────────────────────────────────────────────────

test.describe.serial('@sprint3-vision', () => {
  let dmContext: BrowserContext
  let playerContext: BrowserContext
  let dm: Page
  let player: Page
  let scout: string
  /** The honest "nothing earned" reading, taken before any token is claimed. */
  let dark: Look
  const pageErrors: string[] = []

  test.beforeAll(async ({ browser }) => {
    dmContext = await browser.newContext({ viewport: VIEWPORT })
    dm = await dmContext.newPage()
    dm.on('pageerror', (e) => pageErrors.push(`[dm] ${e.message}`))

    const code = await hostTable(dm, VISION)
    await dm.getByRole('button', { name: 'Enter table' }).click()
    await expect(dm.locator('[data-page="table"]')).toBeVisible()
    await assertMapRendered(dm, VISION)

    playerContext = await browser.newContext({ viewport: VIEWPORT })
    player = await playerContext.newPage()
    player.on('pageerror', (e) => pageErrors.push(`[player] ${e.message}`))
    await joinTable(player, code, 'Borin')
    // Not `assertMapRendered`: this player holds no room of the map until their own token
    // earns one, so there is no floor for them to union.
    await assertMapLoaded(player, VISION)

    await command(dm, 'fog', 'set-mode', { mode: 'vision' })
    await expect.poll(async () => (await probe(player))?.mode).toBe('vision')
    await player.waitForTimeout(REVEAL_MS * 4)
    dark = await look(player)

    // A sighted scout in the near hall, and the seat that claims it is the one being masked.
    await command(dm, 'tokens', 'place', { name: 'Scout', ...AT_DOOR, sight: SIGHT })
    await expect
      .poll(() => dm.getByTestId('token-layer').locator('[data-token-id]').count())
      .toBe(1)
    scout = (await dm
      .getByTestId('token-layer')
      .locator('[data-token-id]')
      .first()
      .getAttribute('data-token-id')) as string
    await command(player, 'tokens', 'claim', { id: scout })
    await expect.poll(async () => (await read(player)).sources).toBe(1)
  })

  test.afterAll(async () => {
    await playerContext?.close()
    await dmContext?.close()
    if (pageErrors.length) {
      console.log(`[finding] ${pageErrors.length} uncaught page error(s) on the vision map:`)
      for (const message of [...new Set(pageErrors)]) console.log(`  ${message}`)
    }
  })

  /**
   * §1 — the first frame a claimed pair of eyes buys.
   *
   * Nothing was revealed by hand: the party's own sweep auto-explored the hall it is standing
   * in, and that is the only room the referee has sent. The far hall is not dark on this
   * canvas because a mask covers it — it is dark because the tab does not have it (principle
   * 2), which is what the memory half of the row asks about.
   */
  test('a claimed token’s sweep is the first thing on the player’s canvas', async () => {
    const now = await read(player)
    expect(now.mode).toBe('vision')
    expect(now.sources, 'the mask was drawn through no eyes at all').toBe(1)
    expect(now.cells, 'the party swept nothing into the region record').toBeGreaterThan(0)

    // Exactly the hall they are standing in, and not the one through the shut door.
    await expect.poll(() => heldRooms(player)).toEqual([NEAR.id])
    const page = await player.content()
    expect(page, 'the far hall reached a tab that never saw into it').not.toContain(FAR.name)

    const lit = await look(player)
    record(
      'sweep-gated first frame (claim → auto-explore → mask)',
      `${NEAR.name} drawn through ${now.sources} token('s) sight over ${now.cells} swept ` +
        `cell(s): ${show(dark)} at join → ${show(lit)} once claimed`,
      'the hall the party can see, and nothing through the shut door',
    )
    // The floor of one hall is now on a canvas that was pure void a moment ago.
    expect(dark.lit, `the player's canvas drew ${show(dark)} before anyone claimed a token`)
      .toBeLessThan(0.01)
    expect(lit.lit, `the sweep drew ${show(lit)}`).toBeGreaterThan(0.02)
  })

  /**
   * §1 — a door is a wall until it is not, on both seats at once.
   *
   * One toggle is one command: the DM's tab and the player's both learn the new state from
   * the server, and the player's *mask* learns it too — the sweep runs through the gap, the
   * far hall auto-explores through it, and its geometry arrives in the same beat (D5).
   */
  test('opening the door grows the clear area, live on two contexts', async () => {
    await expect(doorRow(player, DOOR.id)).toHaveAttribute('data-open', 'false')
    const shut = await shoot(player)
    const shutAgain = await shoot(player)
    const noise = await changed(player, shut, shutAgain)

    await command(dm, 'doors', 'toggle', { id: DOOR.id })
    await expect(doorRow(dm, DOOR.id)).toHaveAttribute('data-open', 'true')
    await expect(doorRow(player, DOOR.id)).toHaveAttribute('data-open', 'true')

    // The sweep reached through the gap, so the far hall is the party's now — geometry and
    // all, off the same fog write the sweep earned.
    await expect.poll(() => heldRooms(player)).toEqual([FAR.id, NEAR.id].sort())
    await player.waitForTimeout(REVEAL_MS * 4)

    const open = await shoot(player)
    const moved = await changed(player, shutAgain, open)
    const after = await develop(player, open)

    record(
      'door → sweep on the player canvas',
      `${DOOR.id}: ${(moved * 100).toFixed(2)}% of the canvas moved on opening (still frame ` +
        `to still frame: ${(noise * 100).toFixed(2)}%), ${show(after)}`,
      'the clear area grows through the doorway on both seats',
    )
    expect(moved, 'opening the door changed nothing on the player canvas').toBeGreaterThan(
      noise + 0.0002,
    )
    // …and it grew rather than merely moved: there is more map drawn than there was.
    expect(after.lit).toBeGreaterThan((await develop(player, shutAgain)).lit)
  })

  /**
   * §1 — the memory tier: what the party swept stays legible when they stop looking at it,
   * survives a reload, and is still not the same thing as ground they have earned.
   *
   * Four readings through one camera, which is the whole reason `frameUp` exists. The DM's
   * last act is the P4 pairing the spec names — a room re-hidden *and* its cells rubbed out
   * — because it is the only thing that takes memory away, and it is what makes "wash" a
   * measurable claim instead of a hopeful one.
   */
  test('what the party swept is a memory: dimmer than live, brighter than void', async () => {
    await frameUp(player)
    const lookingShot = await shoot(player)
    const looking = await develop(player, lookingShot)

    // Out of sight of the doorway — the far hall is remembered now, not seen.
    await command(dm, 'tokens', 'move', { id: scout, ...AWAY })
    await expect.poll(async () => (await read(player)).rebuilds).toBeGreaterThan(0)
    await player.waitForTimeout(REVEAL_MS * 4)
    const awayShot = await shoot(player)
    const away = await develop(player, awayShot)
    const remembered = await read(player)

    await player.reload()
    await assertMapLoaded(player, VISION)
    await expect.poll(async () => (await probe(player))?.mode).toBe('vision')
    await frameUp(player)
    const reloaded = await look(player)

    // The one thing that takes a memory back (P4's brush, driven here as commands): the room
    // goes under *and* the cells the party earned are rubbed out. Only then is it void again.
    //
    // Both halls, not just the far one. A swept room is latched rather than lit (the sweep
    // never says `revealed`), so what is actually on the canvas is cells — and taking one
    // room's back while the party's own memory of the room they walked through still covers
    // a fifth of the frame would leave this reading measuring almost nothing.
    for (const room of [NEAR, FAR]) {
      await command(dm, 'fog', 'hide', { roomId: room.id })
      await command(dm, 'fog', 'region-set', { op: 'hide', cells: await cellsOf(player, room) })
    }
    await expect.poll(async () => (await read(player)).cells).toBeLessThan(remembered.cells)
    await player.waitForTimeout(REVEAL_MS * 4)
    const blanked = await look(player)

    record(
      'the memory tier across a look-away, a reload and a region-hide',
      `looking ${show(looking)} → looked away ${show(away)} → reloaded ${show(reloaded)} → ` +
        `room hidden and cells rubbed out ${show(blanked)} (${remembered.cells} swept cell(s))`,
      'live > memory ≈ memory after a reload > void',
    )

    // Dimmer than live: the party's own sight is the only thing that makes anything current.
    expect(away.lit, `looked away read ${show(away)} against live ${show(looking)}`).toBeLessThan(
      looking.lit,
    )
    // …and brighter than void: what they swept is still on the canvas. On `mean` alone, not
    // on `lit`: the wash puts the far hall's floor at ~78/255 (EXPLORED_TINT over a 236 floor
    // at its 0.7 alpha), which is on the same side of the 120 threshold as the void — the
    // whole point of the tier is that it is neither of the other two, so counting floor
    // pixels cannot see it and the mean is what the ordering has to be read off.
    expect(away.mean, 'the memory came back as void').toBeGreaterThan(blanked.mean)
    // The reload keeps it — the record is the server's and the mask rebuilds from it.
    expect(Math.abs(reloaded.mean - away.mean)).toBeLessThan(away.mean * 0.1)
    // Region memory only ever ORs: walking away takes no ground back.
    expect(remembered.cells).toBeGreaterThan(0)
  })

  /**
   * §1 — what walking earns is *cells*, not rooms, and this is the row that can tell.
   *
   * The far hall is entered through a two-cell doorway from most of a room away, so the party's
   * sightline reaches a sliver of it and no more. A mask that washed every explored room whole
   * would put the entire hall under the memory tint on that sliver's strength — which is
   * exactly what the two readings below separate: the same room, same camera, remembered from
   * a partial sweep and then revealed by the DM's own hand, which is the one act that *is* a
   * whole-room wash.
   */
  test('a swept room remembers the cells it swept; only a DM reveal washes it whole', async () => {
    const farRoomCells = await cellsOf(player, FAR)
    const before = await read(player)

    // Look through the doorway again — the row above rubbed both halls' cells out, so what
    // comes back now is exactly what this one sightline reaches.
    await command(dm, 'tokens', 'move', { id: scout, ...AT_DOOR })
    await expect.poll(async () => (await read(player)).cells).toBeGreaterThan(before.cells)

    // …then stop looking at it, so the far hall is memory alone with nothing live in it.
    await command(dm, 'tokens', 'move', { id: scout, ...AWAY })
    await expect.poll(async () => (await read(player)).rebuilds).toBeGreaterThan(before.rebuilds)
    await player.waitForTimeout(REVEAL_MS * 4)
    await frameUp(player)
    const partial = await look(player)

    // The wire says what the canvas says: a sweep latches a room, it does not light it.
    expect(await fogStatus(player, FAR.id)).toBe('re_hidden')

    // The DM's own reveal — the whole-room wash, and the only thing that is one.
    await command(dm, 'fog', 'reveal', { roomId: FAR.id })
    await expect.poll(() => fogStatus(player, FAR.id)).toBe('revealed')
    await player.waitForTimeout(REVEAL_MS * 4)
    const washed = await look(player)

    // How much of the far hall that sightline actually earned, counted the only way the probe
    // can: rub exactly its cells out and read what the total dropped by.
    const held = (await read(player)).cells
    await command(dm, 'fog', 'region-set', { op: 'hide', cells: farRoomCells })
    await expect.poll(async () => (await read(player)).cells).toBeLessThan(held)
    const swept = held - (await read(player)).cells

    record(
      'cell-granular memory against a whole-room wash',
      `${FAR.name}: ${swept} of ${farRoomCells.length} cell(s) swept through the doorway reads ` +
        `${show(partial)}; the DM's reveal of the same room reads ${show(washed)}`,
      'a sweep shows its cells; only the DM’s reveal washes the room whole',
    )

    // The sightline earned a sliver, never the room — the sweep is what the record holds.
    expect(
      swept,
      `the doorway sweep recorded ${swept} of the hall’s ${farRoomCells.length} cells`,
    ).toBeLessThan(farRoomCells.length / 2)
    // …and the canvas agrees: revealing the room by hand is visibly more map than the sliver.
    expect(
      washed.mean,
      `the swept sliver read ${show(partial)} and the DM's whole-room reveal ${show(washed)} — ` +
        'a mask washing every explored room whole reads them the same',
    ).toBeGreaterThan(partial.mean + 1)
  })

  /** §2.6's standing gate condition, on this map too: zero uncaught errors. */
  test('the vision map draws with no page errors', () => {
    expect(pageErrors, pageErrors.join('\n')).toEqual([])
  })

  /**
   * §4 — the mask is built on mutation and then only drawn, and this is the number that says
   * so: one token move, one rebuild, and the sweep plus the whole Clipper pass inside it.
   *
   * The bound is a frame, not the phase's real budget. P6 pins < 2ms for eight tokens on the
   * dressed gate map; what this row defends is the discipline — a build that ever crept into
   * the draw loop would blow a 16ms bound on a map this size long before a dressed one.
   *
   * The fps half is sprint3-fog's ratio, for its reasons: four runs of that row on identical
   * code read 26.6 through 12.3fps as the box's load moved, so the guard is the player's seat
   * against the DM's unmasked canvas at the same moment, never an absolute floor.
   */
  test('a sweep-driven rebuild costs less than a frame, and the seat keeps up', async () => {
    await player.bringToFront()
    const before = await read(player)

    await command(dm, 'tokens', 'move', { id: scout, ...AT_DOOR })
    await expect.poll(async () => (await read(player)).rebuilds).toBeGreaterThan(before.rebuilds)
    const built = await read(player)

    // Discarded: the first sample after a tab switch measures the tab switch.
    await measureFps(player, 500)
    const seat = await measureFps(player)
    const dmSeat = await measureFps(dm)

    record(
      'vision mask rebuild after a token move',
      `${built.lastMs.toFixed(2)}ms to build (${built.rebuilds - before.rebuilds} rebuild(s), ` +
        `${built.sources} sight source(s), ${built.cells} swept cell(s)); ${seat.toFixed(1)}fps ` +
        `on the masked player seat against ${dmSeat.toFixed(1)}fps on the DM's unmasked canvas`,
      '< 16ms per build (P6 pins < 2ms on the gate map) and no gap against the DM control',
    )

    expect(built.lastMs, 'the mask took longer than a frame to build').toBeLessThan(16)
    expect(built.lastMs, 'the probe never timed a build at all').toBeGreaterThan(0)
    expect(
      seat / dmSeat,
      'the vision mask opened a gap against the unmasked DM control',
    ).toBeGreaterThanOrEqual(0.6)
  })
})
