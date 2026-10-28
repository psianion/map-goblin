import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
// `.ts` because these specs run under Playwright's Node loader, not Vite: @dnd/core has no
// `exports` map, so the subpath is resolved on the filesystem and needs its real extension.
import { migrateRooms } from '@dnd/core/src/store/roomMigration.ts'
import { pointInRing } from '@dnd/core/src/shared/roomUtils.ts'
import type { AnyChild } from '@dnd/core/src/shared/types'
import type { DungeonLayer, SerializedMapData } from '@dnd/core/src/store/types'
import { createCampaign, openSession, uploadMap, type DmSession } from './library'
import { assertMapLoaded, joinTable, type MapUnderTest } from './table'

/**
 * @lighting at the table (the Lighting pass, plan §12.2): a DM and two players on the goblin
 * warren, published over REST, the game server the harness's own (`global-setup.ts`).
 *
 *   pnpm exec playwright test -c e2e/playwright.lighting.config.ts
 *
 * Rows: the darkness slider's 2 s fade; the slider at 1 darkening a player's canvas and taking
 * their sight down to the light; All lights; weather in the table sky; a room set Dark hiding
 * from a normal eye and showing grey to a darkvision one; a darkness source blocking sight but
 * not darkvision it lets through; a glow that pulses; and levels per seat.
 *
 * Sight is read through `__fogProbe.liveAt` (the live tier), the table sky through `__ggSky`
 * (worldSync.ts) and pixels off canvas screenshots. Individual share, so each seat's mask is
 * its own eyes and not the party's.
 */

const VIEWPORT = { width: 1280, height: 720 }

// ── The map ────────────────────────────────────────────────────────────────

const WARREN_FILE = join(import.meta.dirname, '../../testdata/goblin-warren.mapbuilder')
const RAW = JSON.parse(readFileSync(WARREN_FILE, 'utf8')) as SerializedMapData
const HALL = 'room-e2lkoy' // Warren Hall
const FIRE = 'light-hall-fire'
const VOID = 'light-void'
const GLOW = 'prop-glow'
const UPSTAIRS = 'level-upstairs'

const dungeonOf = (doc: SerializedMapData): DungeonLayer =>
  doc.layers.find((l): l is DungeonLayer => l.type === 'dungeon')!
const HALL_RING = dungeonOf(RAW).rooms!.find((r) => r.id === HALL)!.boundary as [number, number][]

/** One row of the hall that is open floor from x 9.5 to 27.5 (checked below). */
const ROW = 25.5
const A_AT = { x: 11.5, y: ROW }
const B_AT = { x: 11.5, y: ROW + 1 }
const VOID_AT = { x: 15.5, y: ROW }
const BEYOND = { x: 19.5, y: ROW }
const GLOW_AT = { x: 24.5, y: ROW + 3 }

function lightingWarren(): SerializedMapData {
  const doc = migrateRooms(structuredClone(RAW))
  const layer = dungeonOf(doc)
  layer.children.push(
    // A darkness source, off until the row that needs it switches it on.
    {
      id: VOID,
      name: 'Darkness',
      childType: 'light',
      visible: false,
      color: '#000000',
      radius: 1.4,
      featherRadius: 1.4,
      intensity: 1,
      falloff: 'quadratic',
      position: VOID_AT,
      darkness: true,
    } as AnyChild,
    // A glowing prop that pulses.
    {
      id: GLOW,
      name: 'brazier glow',
      childType: 'asset',
      visible: true,
      objectType: 'asset',
      assetId: 'gg-demo:spider_web_3x2_object_A',
      position: GLOW_AT,
      rotation: 0,
      scale: 1,
      width: 3,
      height: 2,
      tint: '#ffffff',
      flipX: false,
      flipY: false,
      glows: true,
      glow: { strength: 1, animation: { kind: 'pulse', speed: 2 } },
    } as AnyChild,
  )
  // A second level with one empty layer: the levels rows move seats onto it.
  doc.levels = [...(doc.levels ?? []), { id: UPSTAIRS, name: 'Upstairs' }]
  doc.layers.push({
    ...structuredClone(layer),
    id: 'dungeon-upstairs',
    name: 'Upstairs',
    levelId: UPSTAIRS,
    children: [],
    standaloneWalls: [],
    rooms: [],
    areas: [],
  } as DungeonLayer)
  return doc
}

const MAP: MapUnderTest = { doc: lightingWarren() as unknown as Record<string, unknown>, name: RAW.mapSettings.name }

// ── Instruments ─────────────────────────────────────────────────────────────

const admin = (): string => {
  const pass = process.env.E2E_ADMIN_PASS
  if (!pass) throw new Error('E2E_ADMIN_PASS is not set — did global-setup.ts run?')
  return pass
}

interface Sky {
  darkness: number
  weather: string
  penumbraScale: number
}

interface Tab {
  __ggSky?: () => Sky | null
  __fogProbe?: {
    liveAt(x: number, y: number): boolean | null
    screenOf(x: number, y: number): { x: number; y: number }
    greyTier(): boolean
  }
  __STORE__?: { getState(): { ui: { activeLevelId: string } } }
  __sessionStore: {
    getState(): {
      you: { identityId: string } | null
      session: { activeSceneId?: string | null; modules?: Record<string, unknown> } | null
      connect(t: string): void
      sendCommand(module: string, action: string, payload: unknown): void
    }
  }
}

const command = (page: Page, module: string, action: string, payload: unknown): Promise<void> =>
  page.evaluate(
    ({ module, action, payload }) => (window as unknown as Tab).__sessionStore.getState().sendCommand(module, action, payload),
    { module, action, payload },
  )

async function seatDm(page: Page, token: string): Promise<void> {
  await page.goto('/?e2e=1')
  await page.evaluate((t) => {
    ;(window as unknown as Tab).__sessionStore.getState().connect(t)
    window.history.pushState(null, '', '/table' + window.location.search)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, token)
  await expect(page.locator('[data-page="table"]')).toBeVisible()
}

const sky = (page: Page): Promise<Sky | null> => page.evaluate(() => (window as unknown as Tab).__ggSky?.() ?? null)

const identityOf = (page: Page): Promise<string> =>
  page.evaluate(() => (window as unknown as Tab).__sessionStore.getState().you!.identityId)

const activeLevel = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => (window as unknown as Tab).__STORE__?.getState().ui.activeLevelId)

function sceneTokens(page: Page): Promise<Record<string, { x: number; y: number }>> {
  return page.evaluate(() => {
    const session = (window as unknown as Tab).__sessionStore.getState().session
    const tokens = session?.modules?.tokens as { byScene?: Record<string, Record<string, { x: number; y: number }>> } | undefined
    return tokens?.byScene?.[session?.activeSceneId ?? ''] ?? {}
  })
}

/** Whether this seat sees the world point live right now (the live tier covers it). */
function live(page: Page, at: { x: number; y: number }): Promise<boolean> {
  return page.evaluate(({ x, y }) => (window as unknown as Tab).__fogProbe?.liveAt(x, y) === true, at)
}

/** Mean luminance (0..255) of the canvas, or of a small box around a world point. */
async function luminance(page: Page, at?: { x: number; y: number }, half = 12): Promise<number> {
  const canvas = page.locator('[data-testid="game-canvas"] canvas')
  const box = (await canvas.boundingBox())!
  let clip = { x: box.x, y: box.y, width: box.width, height: box.height }
  if (at) {
    const s = await page.evaluate(({ x, y }) => (window as unknown as Tab).__fogProbe!.screenOf(x, y), at)
    clip = { x: box.x + s.x - half, y: box.y + s.y - half, width: half * 2, height: half * 2 }
  }
  const shot = await page.screenshot({ clip })
  return page.evaluate(async (url: string) => {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob())
    const surface = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = surface.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
    let sum = 0
    for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!
    return sum / (data.length / 4)
  }, `data:image/png;base64,${shot.toString('base64')}`)
}

/** Sets the slider and waits out the 2 s ease (plus a frame or two). */
async function darkness(dm: Page, value: number | null, ...seats: Page[]): Promise<void> {
  await command(dm, 'triggers', 'set-world', { darkness: value })
  for (const page of [dm, ...seats]) {
    await expect.poll(async () => (await sky(page))?.darkness ?? -1, { timeout: 20_000 }).toBeCloseTo(value ?? 0, 2)
  }
  await dm.waitForTimeout(300)
}

// ── The table ──────────────────────────────────────────────────────────────

test.describe.serial('@lighting at the table', () => {
  let contexts: BrowserContext[] = []
  let dm: Page
  let a: Page
  let b: Page
  let session: DmSession
  let tokenA = ''
  let tokenB = ''
  const pageErrors: string[] = []

  test.beforeAll(async ({ browser }) => {
    // The row the darkness test walks along is open floor in the hall.
    for (let x = 9.5; x <= 27.5; x += 1) expect(pointInRing(x, ROW, HALL_RING)).toBe(true)

    session = await createCampaign(admin(), `Lighting at the table ${Date.now()}`)
    const uploaded = await uploadMap(session.token, session.campaignId, MAP.doc)
    const opened = await openSession(session.token, session.campaignId, uploaded.sceneId)

    const page = async (): Promise<Page> => {
      const ctx = await browser.newContext({ viewport: VIEWPORT })
      contexts.push(ctx)
      const p = await ctx.newPage()
      p.on('pageerror', (e) => pageErrors.push(e.message))
      return p
    }
    dm = await page()
    await seatDm(dm, session.token)
    await assertMapLoaded(dm, MAP)
    // The hall is revealed before anyone joins, so each seat's first document already carries
    // the hall and its hearth light. Revealed after a join, the light rides a reveal delta that
    // can land before the join's own document and be overwritten by it (seen 1 run in 2: a
    // player document with no lights at all, so nothing ever lit their sight).
    await command(dm, 'fog', 'set-mode', { mode: 'vision' })
    await command(dm, 'fog', 'set-share', { visionShare: 'individual' })
    await command(dm, 'fog', 'reveal', { roomId: HALL })
    a = await page()
    await joinTable(a, opened.inviteCode, 'Borin')
    await assertMapLoaded(a, MAP)
    b = await page()
    await joinTable(b, opened.inviteCode, 'Cass')
    await assertMapLoaded(b, MAP)

    const place = async (name: string, at: { x: number; y: number }, sight: unknown): Promise<string> => {
      const before = Object.keys(await sceneTokens(dm))
      await command(dm, 'tokens', 'place', { name, ...at, sight, disposition: 'friendly' })
      await expect.poll(async () => Object.keys(await sceneTokens(dm)).length, { timeout: 20_000 }).toBe(before.length + 1)
      return Object.keys(await sceneTokens(dm)).find((id) => !before.includes(id))!
    }
    tokenA = await place('Borin', A_AT, { range: 0, angle: 360, visionMode: 'normal' })
    tokenB = await place('Cass', B_AT, { range: 6, angle: 360, visionMode: 'darkvision' })
    await command(dm, 'tokens', 'assign', { id: tokenA, identityId: await identityOf(a) })
    await command(dm, 'tokens', 'assign', { id: tokenB, identityId: await identityOf(b) })
    await expect.poll(async () => live(a, A_AT), { timeout: 30_000 }).toBe(true)
    await expect.poll(async () => live(b, B_AT), { timeout: 30_000 }).toBe(true)
  })

  test.afterAll(async () => {
    for (const ctx of contexts) await ctx.close()
    contexts = []
    if (pageErrors.length) {
      console.log(`[finding] ${pageErrors.length} uncaught page error(s) on the lighting table flow:`)
      for (const message of [...new Set(pageErrors)]) console.log(`  ${message}`)
    }
  })

  test('the slider fades over 2 s: two samples 500 ms apart differ, settled by 2.5 s', async () => {
    await darkness(dm, 0)
    const started = Date.now()
    await command(dm, 'triggers', 'set-world', { darkness: 1 })
    await expect.poll(async () => (await sky(dm))!.darkness, { timeout: 10_000 }).toBeGreaterThan(0.02)
    const s1 = await sky(dm)
    const m1 = await luminance(dm)
    await dm.waitForTimeout(500)
    const s2 = await sky(dm)
    const m2 = await luminance(dm)
    expect(s2!.darkness).toBeGreaterThan(s1!.darkness)
    expect(Math.abs(m2 - m1)).toBeGreaterThan(0.5)
    await dm.waitForTimeout(Math.max(0, 2500 - (Date.now() - started)))
    expect((await sky(dm))!.darkness).toBe(1)
    const settled = await luminance(dm)
    await dm.waitForTimeout(400)
    expect(Math.abs((await luminance(dm)) - settled)).toBeLessThan(3)
  })

  test('the slider at 1 darkens a player’s canvas and takes their sight down to the light', async () => {
    await command(dm, 'triggers', 'set-light', { lightId: FIRE, patch: { visible: false } })
    await darkness(dm, 0, a)
    const near = { x: A_AT.x + 3, y: ROW }
    await expect.poll(async () => live(a, near), { timeout: 20_000 }).toBe(true)
    const before = await luminance(a)
    await darkness(dm, 1, a)
    await expect.poll(async () => live(a, near), { timeout: 20_000 }).toBe(false)
    expect(await luminance(a)).toBeLessThan(before)
  })

  test('All lights off darkens the torch on both seats; on brings it back', async () => {
    await command(dm, 'triggers', 'reset-light', { lightId: FIRE })
    await darkness(dm, 1, a)
    const fire = { x: 18.5, y: ROW + 2 }
    await expect.poll(async () => live(a, fire), { timeout: 20_000 }).toBe(true)
    const onDm = await luminance(dm, fire)
    await command(dm, 'triggers', 'set-lights-all', { on: false })
    await expect.poll(async () => luminance(dm, fire), { timeout: 20_000 }).toBeLessThan(onDm * 0.8)
    // A player's dark is the fog: with the torch out the hearth leaves their sight, and the pixel
    // there is the living-fog cloud over remembered floor, which reads paler than a torch-lit night.
    await expect.poll(async () => live(a, fire), { timeout: 20_000 }).toBe(false)
    await command(dm, 'triggers', 'set-lights-all', { on: true })
    await expect.poll(async () => live(a, fire), { timeout: 20_000 }).toBe(true)
  })

  test('a storm reaches the table sky: softer shadows, every seat', async () => {
    await command(dm, 'triggers', 'set-world', { weather: 'storm' })
    for (const page of [dm, a, b]) {
      await expect.poll(async () => (await sky(page))?.weather, { timeout: 20_000 }).toBe('storm')
      // Eased in over the same 2 s as the darkness.
      await expect.poll(async () => (await sky(page))?.penumbraScale, { timeout: 10_000 }).toBe(2.5)
    }
    await command(dm, 'triggers', 'set-world', { weather: 'clear' })
  })

  test('a room set Dark hides from a normal eye and shows grey to a darkvision one', async () => {
    await command(dm, 'triggers', 'set-light', { lightId: FIRE, patch: { visible: false } })
    await darkness(dm, null, a, b)
    const nearA = { x: A_AT.x + 3, y: ROW }
    const nearB = { x: B_AT.x + 3, y: B_AT.y }
    await expect.poll(async () => live(a, nearA), { timeout: 20_000 }).toBe(true)
    await command(dm, 'triggers', 'set-room', { roomId: HALL, patch: { mood: 'dark' } })
    await expect.poll(async () => live(a, nearA), { timeout: 20_000 }).toBe(false)
    await expect.poll(async () => live(b, nearB), { timeout: 20_000 }).toBe(true)
    await expect.poll(() => b.evaluate(() => (window as unknown as Tab).__fogProbe!.greyTier()), { timeout: 20_000 }).toBe(true)
    await command(dm, 'triggers', 'set-room', { roomId: HALL, patch: { mood: null } })
    await expect.poll(async () => live(a, nearA), { timeout: 20_000 }).toBe(true)
  })

  test('a darkness source blocks sight; darkvision it lets through sees past it', async () => {
    await command(dm, 'triggers', 'reset-light', { lightId: FIRE })
    // The fire lights the hall: both seats see the far end of the row before the darkness…
    await expect.poll(async () => live(a, BEYOND), { timeout: 20_000 }).toBe(true)
    await expect.poll(async () => live(b, BEYOND), { timeout: 20_000 }).toBe(true)
    await command(dm, 'triggers', 'set-light', { lightId: VOID, patch: { visible: true } })
    // …and only the darkness's edge can hide it after.
    await expect.poll(async () => live(a, BEYOND), { timeout: 20_000 }).toBe(false)
    await expect.poll(async () => live(b, BEYOND), { timeout: 20_000 }).toBe(false)
    await command(dm, 'triggers', 'set-light', { lightId: VOID, patch: { darkvisionSees: true } })
    await expect.poll(async () => live(b, BEYOND), { timeout: 20_000 }).toBe(true)
    expect(await live(a, BEYOND)).toBe(false)
    await command(dm, 'triggers', 'set-light', { lightId: VOID, patch: { visible: false } })
  })

  test('a glow with a pulse breathes: two samples apart differ', async () => {
    // Night, and every light out: what is left burning on the prop is its own glow alone.
    await darkness(dm, 1)
    await command(dm, 'triggers', 'set-lights-all', { on: false })
    await dm.waitForTimeout(500)
    const samples: number[] = []
    for (let i = 0; i < 8; i++) {
      samples.push(await luminance(dm, GLOW_AT, 4))
      await dm.waitForTimeout(200)
    }
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(3)
    await command(dm, 'triggers', 'set-lights-all', { on: true })
    await darkness(dm, null)
  })

  test('levels: a seat sees its token’s level; the DM moves one up; a pin beats the token', async () => {
    const first = await activeLevel(a)
    expect(await activeLevel(b)).toBe(first)
    await command(dm, 'tokens', 'set-token-level', { tokenId: tokenB, levelId: UPSTAIRS })
    await expect.poll(() => activeLevel(b), { timeout: 20_000 }).toBe(UPSTAIRS)
    // Upstairs, B is no longer sent A's token; A, still downstairs, is.
    await expect.poll(async () => Object.keys(await sceneTokens(b)), { timeout: 20_000 }).not.toContain(tokenA)
    expect(await activeLevel(a)).toBe(first)
    expect(Object.keys(await sceneTokens(a))).toContain(tokenA)
    await command(dm, 'triggers', 'set-seat-level', { identity: await identityOf(a), levelId: UPSTAIRS })
    await expect.poll(() => activeLevel(a), { timeout: 20_000 }).toBe(UPSTAIRS)
    await command(dm, 'triggers', 'set-seat-level', { identity: await identityOf(a), levelId: null })
    await expect.poll(() => activeLevel(a), { timeout: 20_000 }).toBe(first)
  })
})
