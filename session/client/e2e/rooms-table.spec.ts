import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
// `.ts` because these specs run under Playwright's Node loader, not Vite: @dnd/core has no
// `exports` map, so the subpath is resolved on the filesystem and needs its real extension.
import { migrateRooms } from '@dnd/core/src/store/roomMigration.ts'
import { interiorPoint, pointInRing } from '@dnd/core/src/shared/roomUtils.ts'
import type { RoomKey, ScenePrep } from '@dnd/core/src/shared/prep'
import type { Room } from '@dnd/core/src/shared/types'
import type { DungeonLayer, SerializedMapData } from '@dnd/core/src/store/types'
import { createCampaign, openSession, republishScene, uploadMap, type DmSession } from './library'
import { SERVER_URL, assertMapLoaded, joinTable, openPanel, type MapUnderTest } from './table'

/**
 * @rooms — the table half of the rooms rebuild, which no tester can drive by hand: publishing
 * asks for the server's admin pass. Here the game server is the harness's own (booted on a
 * clean data directory by `global-setup.ts`, which reads its first-run pass off stdout), the
 * campaign and the map go up over REST exactly as the editor's Publish sends them, and two
 * real browser seats sit at the table: the DM's and one player's.
 *
 *   pnpm exec playwright test -c e2e/playwright.rooms.config.ts
 *
 * 1. A room split in the editor (a threshold across Warren Hall, the cut-off half carrying
 *    `derivedFrom`) is republished over a scene where the hall was already explored: both
 *    halves are explored at the table, for the DM and in the player's copy of the map.
 * 2. A room key (read-aloud + "Goblin x2"): revealing its room pops the DM's toast with the
 *    read-aloud preview; Share puts exactly the read-aloud in the player's Journal, and it is
 *    never in the player's map document; Spawn puts two goblins inside the room's face.
 */

const VIEWPORT = { width: 1280, height: 720 }

// ── The map: the goblin warren fixture, in the shape the editor publishes ────────

const WARREN_FILE = join(import.meta.dirname, '../../testdata/goblin-warren.mapbuilder')
const RAW = JSON.parse(readFileSync(WARREN_FILE, 'utf8')) as SerializedMapData
/** What the editor would send: rooms anchored, levels, `roomsVersion: 2`. */
const BASE = migrateRooms(structuredClone(RAW))
const LAYER_ID = BASE.layers.find((l) => l.type === 'dungeon')!.id

const HALL = 'room-e2lkoy' // Warren Hall
const DEN = 'room-1xurv04' // Chief's Den, the keyed room
const HALF = 'room-warren-hall-west'

const READ_ALOUD = 'Smoke hangs under a ceiling of roots. Behind a hide curtain, something big is snoring.'
const DM_NOTES = 'The chief sleeps off a feast: -5 to his Perception until woken.'

const KEY: RoomKey = {
  roomId: DEN,
  readAloud: READ_ALOUD,
  notes: DM_NOTES,
  encounter: { name: 'Goblin patrol', monsters: [{ id: 'm-goblin', name: 'Goblin', count: 2, size: 'small' }] },
  treasure: '',
  traps: [],
  checks: [],
}
const PREP: ScenePrep = { version: 3, triggers: [], notes: [], rooms: [KEY] }

function dungeonOf(doc: SerializedMapData): DungeonLayer {
  return doc.layers.find((l): l is DungeonLayer => l.type === 'dungeon')!
}

/** The published warren with its prep: no split yet. */
function keyedWarren(): SerializedMapData {
  return { ...structuredClone(BASE), prep: structuredClone(PREP) } as SerializedMapData
}

/** Where a ring crosses the line `axis = at`, sorted: pairs of these are the spans inside it. */
function crossings(ring: [number, number][], axis: 0 | 1, at: number): number[] {
  const other = axis === 0 ? 1 : 0
  const out: number[] = []
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j]
    const b = ring[i]
    if (a[axis] > at !== b[axis] > at) out.push(a[other] + ((at - a[axis]) * (b[other] - a[other])) / (b[axis] - a[axis]))
  }
  return out.sort((p, q) => p - q)
}

/** The span of a sorted crossing list that holds `v`. */
function spanAround(xs: number[], v: number): [number, number] {
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i] <= v && v <= xs[i + 1]) return [xs[i], xs[i + 1]]
  throw new Error(`no span around ${v} in ${xs.join(', ')}`)
}

/**
 * The warren with Warren Hall split down the middle, as the editor's Split (fog: copy) writes
 * it: a threshold across the hall, the hall keeping its id with its anchor moved into the east
 * half, and the west half a new room that records `derivedFrom` the hall.
 */
function splitWarren(): SerializedMapData {
  const doc = keyedWarren()
  const layer = dungeonOf(doc)
  const old = (RAW.layers.find((l) => l.type === 'dungeon') as DungeonLayer).rooms!.find((r) => r.id === HALL)!
  const ring = old.boundary as [number, number][]
  const [cx, cy] = interiorPoint(ring)
  const [x0, x1] = spanAround(crossings(ring, 1, cy), cx)
  const [y0, y1] = spanAround(crossings(ring, 0, cx), cy)
  layer.thresholds = [
    {
      id: 'threshold-hall',
      points: [
        [cx, y0 - 0.6],
        [cx, y1 + 0.6],
      ],
    },
  ]
  const hall = layer.rooms!.find((r) => r.id === HALL)!
  hall.anchor = [(cx + x1) / 2, cy]
  const half: Room = { id: HALF, name: 'Warren Hall, west', number: 8, anchor: [(x0 + cx) / 2, cy], derivedFrom: HALL }
  layer.rooms!.push(half)
  return doc
}

const MAP: MapUnderTest = { doc: keyedWarren() as unknown as Record<string, unknown>, name: RAW.mapSettings.name }

// ── Instruments ─────────────────────────────────────────────────────────────

const admin = (): string => {
  const pass = process.env.E2E_ADMIN_PASS
  if (!pass) throw new Error('E2E_ADMIN_PASS is not set — did global-setup.ts run?')
  return pass
}

interface Tab {
  __sessionStore: {
    getState(): {
      token: string | null
      mapData: unknown
      session: { activeSceneId?: string | null; modules?: Record<string, unknown> } | null
      connect(t: string): void
    }
  }
  __STORE__?: { getState(): { layers: { type: string; rooms?: Room[] }[] } }
}

/** Seat the DM with a token minted over REST, the way HostSetup's last step does. */
async function seatDm(page: Page, token: string): Promise<void> {
  await page.goto('/?e2e=1')
  await page.evaluate((t) => {
    ;(window as unknown as Tab).__sessionStore.getState().connect(t)
    window.history.pushState(null, '', '/table' + window.location.search)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, token)
  await expect(page.locator('[data-page="table"]')).toBeVisible()
}

/** The rooms this tab's engine holds, with the faces core derived for them. */
function storeRooms(page: Page): Promise<Room[]> {
  return page.evaluate(() => {
    const layers = (window as unknown as Tab).__STORE__?.getState().layers ?? []
    return layers.flatMap((l) => (l.type === 'dungeon' ? (l.rooms ?? []) : []))
  })
}

function fogStatus(dm: Page, roomId: string) {
  return dm.getByTestId('fog-rooms').locator(`[data-room-id="${roomId}"]`)
}

async function revealRoom(dm: Page, roomId: string): Promise<void> {
  await openPanel(dm, 'fog')
  const row = fogStatus(dm, roomId)
  if ((await row.getAttribute('data-fog-status')) !== 'revealed') await row.click()
  await expect(row).toHaveAttribute('data-fog-status', 'revealed', { timeout: 20_000 })
}

/** The player's copy of the scene's map, fetched with their own seat's token, as their table does. */
async function playerMapDoc(player: Page, sceneId: string): Promise<string> {
  const token = await player.evaluate(() => (window as unknown as Tab).__sessionStore.getState().token)
  expect(token).toBeTruthy()
  const res = await fetch(`${SERVER_URL}/api/maps/${encodeURIComponent(sceneId)}?images=external&rooms=derived`, {
    headers: { authorization: `Bearer ${token}` },
  })
  expect(res.ok).toBe(true)
  return res.text()
}

interface SceneTokens {
  [id: string]: { name?: string; x: number; y: number }
}

function sceneTokens(page: Page, sceneId: string): Promise<SceneTokens> {
  return page.evaluate((id) => {
    const modules = (window as unknown as Tab).__sessionStore.getState().session?.modules ?? {}
    const tokens = modules.tokens as { byScene?: Record<string, SceneTokens> } | undefined
    return tokens?.byScene?.[id] ?? {}
  }, sceneId)
}

function journalBodies(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const modules = (window as unknown as Tab).__sessionStore.getState().session?.modules ?? {}
    const triggers = modules.triggers as { journal?: { body: string }[] } | undefined
    return (triggers?.journal ?? []).map((e) => e.body)
  })
}

// ── The table ──────────────────────────────────────────────────────────────

test.describe.serial('@rooms at the table', () => {
  let dmContext: BrowserContext
  let playerContext: BrowserContext
  let dm: Page
  let player: Page
  let session: DmSession
  let sceneId: string
  const pageErrors: string[] = []

  test.beforeAll(async ({ browser }) => {
    session = await createCampaign(admin(), `Rooms at the table ${Date.now()}`)
    const uploaded = await uploadMap(session.token, session.campaignId, MAP.doc)
    sceneId = uploaded.sceneId
    const opened = await openSession(session.token, session.campaignId, sceneId)

    dmContext = await browser.newContext({ viewport: VIEWPORT, reducedMotion: 'reduce' })
    dm = await dmContext.newPage()
    dm.on('pageerror', (e) => pageErrors.push(`[dm] ${e.message}`))
    await seatDm(dm, session.token)
    await assertMapLoaded(dm, MAP)

    playerContext = await browser.newContext({ viewport: VIEWPORT, reducedMotion: 'reduce' })
    player = await playerContext.newPage()
    player.on('pageerror', (e) => pageErrors.push(`[player] ${e.message}`))
    await joinTable(player, opened.inviteCode, 'Borin')
    await assertMapLoaded(player, MAP)
  })

  test.afterAll(async () => {
    await playerContext?.close()
    await dmContext?.close()
    if (pageErrors.length) {
      console.log(`[finding] ${pageErrors.length} uncaught page error(s) on the rooms table flow:`)
      for (const message of [...new Set(pageErrors)]) console.log(`  ${message}`)
    }
  })

  test('a room split after it was explored is explored in both halves at the table', async () => {
    await revealRoom(dm, HALL)
    await expect.poll(async () => (await storeRooms(player)).some((r) => r.id === HALL), { timeout: 20_000 }).toBe(true)
    const before = (await storeRooms(dm)).find((r) => r.id === HALL)!
    expect(before.area).toBeGreaterThan(0)

    // The editor's Split, published over the live scene.
    await republishScene(session.token, sceneId, splitWarren())

    // The DM's table reloads the scene: the new half is there, explored like its parent.
    await openPanel(dm, 'fog')
    await expect(fogStatus(dm, HALF)).toHaveAttribute('data-fog-status', 'revealed', { timeout: 30_000 })
    await expect(fogStatus(dm, HALL)).toHaveAttribute('data-fog-status', 'revealed')

    // Two faces now, each a part of the old hall.
    await expect.poll(async () => (await storeRooms(dm)).filter((r) => r.id === HALL || r.id === HALF).length, { timeout: 30_000 }).toBe(2)
    const halves = (await storeRooms(dm)).filter((r) => r.id === HALL || r.id === HALF)
    for (const h of halves) {
      expect(h.orphaned ?? false).toBe(false)
      expect(h.area!).toBeGreaterThan(0)
      expect(h.area!).toBeLessThan(before.area! * 0.9)
    }

    // The player's copy holds both: a room they never explored is redacted out of it.
    await expect
      .poll(async () => (await storeRooms(player)).filter((r) => r.id === HALL || r.id === HALF).length, { timeout: 30_000 })
      .toBe(2)
    const doc = await playerMapDoc(player, sceneId)
    expect(doc).toContain(HALF)
    expect(doc).not.toContain('derivedFrom')
  })

  test('revealing a keyed room toasts the DM its read-aloud; Share sends exactly that to the Journal', async () => {
    const preview = READ_ALOUD.slice(0, 40)
    await revealRoom(dm, DEN)

    const toast = dm.getByTestId('toast')
    await expect(toast).toContainText(preview, { timeout: 20_000 })
    const share = dm.getByTestId('toast-action')
    await expect(share).toHaveText('Share')

    // Nothing of the key has reached the player: not as a toast, not in their map, not in the page.
    await player.waitForTimeout(1500)
    await expect(player.getByTestId('toast').filter({ hasText: preview })).toHaveCount(0)
    expect(await player.content()).not.toContain(preview)
    for (const text of [READ_ALOUD, DM_NOTES, 'Goblin patrol']) {
      expect(JSON.stringify(await player.evaluate(() => (window as unknown as Tab).__sessionStore.getState().mapData))).not.toContain(text)
      expect(await playerMapDoc(player, sceneId)).not.toContain(text)
    }
    expect(await journalBodies(player)).toEqual([])

    await share.click()

    // Exactly the read-aloud, and only it, lands in the player's Journal.
    await expect.poll(() => journalBodies(player), { timeout: 20_000 }).toEqual([READ_ALOUD])
    await player.getByTestId('sidebar-edge-toggle').click()
    const card = player.getByTestId('journal-card')
    await expect(card).toHaveCount(1)
    await expect(card).toContainText(READ_ALOUD)
    await expect(card).not.toContainText(DM_NOTES)
    await player.screenshot({ path: test.info().outputPath('player-journal.png') })

    // Sharing it does not put the key into the player's map document.
    const doc = await playerMapDoc(player, sceneId)
    expect(doc).not.toContain(READ_ALOUD)
    expect(doc).not.toContain(DM_NOTES)
  })

  test('Spawn on the room key places the two goblins inside the room', async () => {
    const before = Object.keys(await sceneTokens(dm, sceneId))
    await dm.getByTestId('sidebar-edge-toggle').click()
    const card = dm.locator(`[data-testid="room-key-card"][data-room-id="${DEN}"]`)
    await expect(card).toBeVisible({ timeout: 20_000 })
    await card.getByRole('button', { expanded: false }).click()
    await card.getByRole('button', { name: /^Spawn encounter/ }).click()

    await expect
      .poll(async () => Object.keys(await sceneTokens(dm, sceneId)).length - before.length, { timeout: 20_000 })
      .toBe(2)
    const tokens = await sceneTokens(dm, sceneId)
    const spawned = Object.entries(tokens).filter(([id]) => !before.includes(id)).map(([, t]) => t)
    expect(spawned.map((t) => t.name).sort()).toEqual(['Goblin 1', 'Goblin 2'])

    const den = (await storeRooms(dm)).find((r) => r.id === DEN)!
    const face = (den.face ?? den.boundary)!
    expect(face.length).toBeGreaterThan(2)
    for (const t of spawned) expect([t.name, pointInRing(t.x, t.y, face)]).toEqual([t.name, true])
    await dm.screenshot({ path: test.info().outputPath('dm-spawned.png') })
  })
})

// Keep the layer id honest: the fixture has one dungeon layer, and every builder above uses it.
test('the warren fixture still has the rooms this spec names', () => {
  const layer = dungeonOf(BASE)
  expect(layer.id).toBe(LAYER_ID)
  expect(layer.rooms!.map((r) => r.id)).toEqual(expect.arrayContaining([HALL, DEN]))
  const split = dungeonOf(splitWarren())
  const hall = split.rooms!.find((r) => r.id === HALL)!
  const half = split.rooms!.find((r) => r.id === HALF)!
  const old = (RAW.layers.find((l) => l.type === 'dungeon') as DungeonLayer).rooms!.find((r) => r.id === HALL)!
  expect(pointInRing(...hall.anchor, old.boundary as [number, number][])).toBe(true)
  expect(pointInRing(...half.anchor, old.boundary as [number, number][])).toBe(true)
  expect(half.anchor[0]).toBeLessThan(hall.anchor[0])
})
