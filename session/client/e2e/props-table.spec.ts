import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
// `.ts` because these specs run under Playwright's Node loader, not Vite: @dnd/core has no
// `exports` map, so the subpath is resolved on the filesystem and needs its real extension.
import { migrateRooms } from '@dnd/core/src/store/roomMigration.ts'
import { interiorPoint, pointInRing } from '@dnd/core/src/shared/roomUtils.ts'
import type { AnyChild } from '@dnd/core/src/shared/types'
import type { DungeonLayer, SerializedMapData } from '@dnd/core/src/store/types'
import { createCampaign, openSession, uploadMap, type DmSession } from './library'
import { assertMapLoaded, joinTable, openPanel, type MapUnderTest } from './table'

/**
 * @props: overhead props at the table, which no tester can drive by hand: publishing asks for
 * the server's admin pass. Here the game server is the harness's own (booted on a clean data
 * directory by `global-setup.ts`, which reads its first-run pass off stdout), the map goes up
 * over REST exactly as the editor's Publish sends it, and two real browser seats sit at the
 * table: the DM's and one player's.
 *
 *   pnpm exec playwright test -c e2e/playwright.props.config.ts
 *
 * The map is the goblin warren with one more prop: a tinted spider web over Warren Hall,
 * marked overhead and turned off the grid.
 *
 * 1. The table draws the canopy with its tint, in the world under the lighting multiply (the
 *    Lighting pass: overhead art takes the night like everything else), never lifted into a
 *    screen layer, on either seat.
 * 2. A token moved under the canopy fades it below 0.4 within 500 ms of the move reaching the
 *    seat, and moved away restores it to 1, on both seats.
 *
 * Read through `window.__overheadProbe` (OverheadLayer.ts): `__pixiApp` is dev-only and this
 * runs the production build.
 */

const VIEWPORT = { width: 1280, height: 720 }

// ── The map ────────────────────────────────────────────────────────────────

const WARREN_FILE = join(import.meta.dirname, '../../testdata/goblin-warren.mapbuilder')
const RAW = JSON.parse(readFileSync(WARREN_FILE, 'utf8')) as SerializedMapData
const HALL = 'room-e2lkoy' // Warren Hall

const dungeonOf = (doc: SerializedMapData): DungeonLayer =>
  doc.layers.find((l): l is DungeonLayer => l.type === 'dungeon')!

const HALL_RING = dungeonOf(RAW).rooms!.find((r) => r.id === HALL)!.boundary as [number, number][]

const CANOPY_ID = 'prop-canopy'
const TINT = '#c04040'
const [CX, CY] = interiorPoint(HALL_RING)
/** 4 × 3 cells, turned 0.3 rad: a token on its centre cell is under it whatever the snap. */
const CANOPY_BOX = { cx: CX, cy: CY, hw: 2, hh: 1.5, rot: 0.3 }

const CANOPY = {
  id: CANOPY_ID,
  name: 'spider web',
  childType: 'asset',
  visible: true,
  objectType: 'asset',
  assetId: 'gg-demo:spider_web_3x2_object_A',
  position: { x: CX, y: CY },
  rotation: CANOPY_BOX.rot,
  scale: 1,
  width: 2 * CANOPY_BOX.hw,
  height: 2 * CANOPY_BOX.hh,
  tint: TINT,
  flipX: false,
  flipY: false,
  overhead: true,
} as AnyChild

/** What the editor would send: rooms anchored, levels, `roomsVersion: 2`, and the canopy. */
function canopyWarren(): SerializedMapData {
  const doc = migrateRooms(structuredClone(RAW))
  dungeonOf(doc).children.push(structuredClone(CANOPY))
  return doc
}

const MAP: MapUnderTest = { doc: canopyWarren() as unknown as Record<string, unknown>, name: RAW.mapSettings.name }

/** A medium token snaps to a cell centre (D13); every point below is one already. */
const cellCentre = (v: number): number => Math.floor(v) + 0.5

function underCanopy(x: number, y: number): boolean {
  const dx = x - CANOPY_BOX.cx
  const dy = y - CANOPY_BOX.cy
  const c = Math.cos(CANOPY_BOX.rot)
  const s = Math.sin(CANOPY_BOX.rot)
  return Math.abs(dx * c + dy * s) <= CANOPY_BOX.hw && Math.abs(-dx * s + dy * c) <= CANOPY_BOX.hh
}

const UNDER = { x: cellCentre(CX), y: cellCentre(CY) }

/** A cell centre in the hall, well clear of the canopy and of the hall's walls. */
const AWAY = (() => {
  for (let r = 5; r < 20; r++) {
    for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]] as const) {
      const p = { x: UNDER.x + dx, y: UNDER.y + dy }
      const clear = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([ox, oy]) => pointInRing(p.x + ox, p.y + oy, HALL_RING))
      if (clear) return p
    }
  }
  throw new Error('no clear cell in Warren Hall away from the canopy')
})()

// ── Instruments ─────────────────────────────────────────────────────────────

const admin = (): string => {
  const pass = process.env.E2E_ADMIN_PASS
  if (!pass) throw new Error('E2E_ADMIN_PASS is not set — did global-setup.ts run?')
  return pass
}

interface Probe {
  stack: string[]
  mask: string | null
  lifted: boolean
  props: { childId: string; alpha: number; tint: number }[]
}

interface Tab {
  __overheadProbe?: () => Probe
  __sessionStore: {
    getState(): {
      session: { activeSceneId?: string | null; modules?: Record<string, unknown> } | null
      connect(t: string): void
      sendCommand(module: string, action: string, payload: unknown): void
    }
  }
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

const probe = (page: Page): Promise<Probe | null> =>
  page.evaluate(() => (window as unknown as Tab).__overheadProbe?.() ?? null)

async function canopyOf(page: Page): Promise<Probe['props'][number] | undefined> {
  return (await probe(page))?.props.find((p) => p.childId === CANOPY_ID)
}

function sceneTokens(page: Page): Promise<Record<string, { name?: string; x: number; y: number }>> {
  return page.evaluate(() => {
    const session = (window as unknown as Tab).__sessionStore.getState().session
    const tokens = session?.modules?.tokens as { byScene?: Record<string, Record<string, { x: number; y: number }>> } | undefined
    return tokens?.byScene?.[session?.activeSceneId ?? ''] ?? {}
  })
}

/**
 * Starts watching a seat for a token reaching `at` and the canopy's alpha then meeting `done`;
 * resolves with how long that took after the move landed in this seat's store, measured
 * frame by frame in the page. Null when it never happened within 5 s.
 */
function watchFade(
  page: Page,
  tokenId: string,
  at: { x: number; y: number },
  done: 'below' | 'restored',
): Promise<{ ms: number; alpha: number } | null> {
  return page.evaluate(
    ({ tokenId, at, done, canopyId }) =>
      new Promise<{ ms: number; alpha: number } | null>((resolve) => {
        const w = window as unknown as Tab
        const start = performance.now()
        let landed: number | null = null
        const step = () => {
          const session = w.__sessionStore.getState().session
          const tokens = session?.modules?.tokens as { byScene?: Record<string, Record<string, { x: number; y: number }>> } | undefined
          const t = tokens?.byScene?.[session?.activeSceneId ?? '']?.[tokenId]
          if (landed === null && t && t.x === at.x && t.y === at.y) landed = performance.now()
          const alpha = w.__overheadProbe?.().props.find((p) => p.childId === canopyId)?.alpha ?? NaN
          const met = done === 'below' ? alpha < 0.4 : alpha === 1
          if (landed !== null && met) return resolve({ ms: performance.now() - landed, alpha })
          if (performance.now() - start > 5000) return resolve(null)
          requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      }),
    { tokenId, at, done, canopyId: CANOPY_ID },
  )
}

// ── The table ──────────────────────────────────────────────────────────────

test.describe.serial('@props at the table', () => {
  let dmContext: BrowserContext
  let playerContext: BrowserContext
  let dm: Page
  let player: Page
  let session: DmSession
  let tokenId: string
  const pageErrors: string[] = []

  test.beforeAll(async ({ browser }) => {
    session = await createCampaign(admin(), `Props at the table ${Date.now()}`)
    const uploaded = await uploadMap(session.token, session.campaignId, MAP.doc)
    const opened = await openSession(session.token, session.campaignId, uploaded.sceneId)

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

    // The player holds the hall, its canopy and whoever stands in it once the DM lights it.
    await openPanel(dm, 'fog')
    const row = dm.getByTestId('fog-rooms').locator(`[data-room-id="${HALL}"]`)
    if ((await row.getAttribute('data-fog-status')) !== 'revealed') await row.click()
    await expect(row).toHaveAttribute('data-fog-status', 'revealed', { timeout: 20_000 })
  })

  test.afterAll(async () => {
    await playerContext?.close()
    await dmContext?.close()
    if (pageErrors.length) {
      console.log(`[finding] ${pageErrors.length} uncaught page error(s) on the props table flow:`)
      for (const message of [...new Set(pageErrors)]) console.log(`  ${message}`)
    }
  })

  test('the canopy is drawn with its tint, graded with the world, on both seats', async () => {
    for (const page of [dm, player]) {
      await expect.poll(async () => (await canopyOf(page))?.tint, { timeout: 30_000 }).toBe(parseInt(TINT.slice(1), 16))
      const seen = (await probe(page))!
      expect(seen.lifted).toBe(false)
      expect(seen.stack).not.toContain('overheadProps')
      expect(seen.mask).toBeNull()
      expect((await canopyOf(page))!.alpha).toBe(1)
    }
  })

  test('a token under the canopy fades it within 500 ms; walking away restores it', async () => {
    expect(underCanopy(UNDER.x, UNDER.y)).toBe(true)
    expect(underCanopy(AWAY.x, AWAY.y)).toBe(false)

    const before = Object.keys(await sceneTokens(dm))
    await dm.evaluate((at) => {
      ;(window as unknown as Tab).__sessionStore.getState().sendCommand('tokens', 'place', { name: 'Scout', ...at })
    }, AWAY)
    await expect.poll(async () => Object.keys(await sceneTokens(dm)).filter((id) => !before.includes(id)).length, { timeout: 20_000 }).toBe(1)
    tokenId = Object.keys(await sceneTokens(dm)).find((id) => !before.includes(id))!
    // The player holds it too: it stands in a room they can see.
    await expect.poll(async () => Object.keys(await sceneTokens(player)), { timeout: 20_000 }).toContain(tokenId)
    expect((await canopyOf(dm))!.alpha).toBe(1)
    expect((await canopyOf(player))!.alpha).toBe(1)

    const move = (at: { x: number; y: number }) =>
      dm.evaluate(
        ({ id, at }) => (window as unknown as Tab).__sessionStore.getState().sendCommand('tokens', 'move', { id, ...at }),
        { id: tokenId, at },
      )

    const fadeDm = watchFade(dm, tokenId, UNDER, 'below')
    const fadePlayer = watchFade(player, tokenId, UNDER, 'below')
    await move(UNDER)
    const [inDm, inPlayer] = await Promise.all([fadeDm, fadePlayer])
    console.log(`[measure] canopy below 0.4 after the move landed: dm ${inDm?.ms.toFixed(0)} ms, player ${inPlayer?.ms.toFixed(0)} ms`)
    expect(inDm).not.toBeNull()
    expect(inPlayer).not.toBeNull()
    expect(inDm!.ms).toBeLessThan(500)
    expect(inPlayer!.ms).toBeLessThan(500)
    await dm.screenshot({ path: test.info().outputPath('dm-under-canopy.png') })
    await player.screenshot({ path: test.info().outputPath('player-under-canopy.png') })

    const backDm = watchFade(dm, tokenId, AWAY, 'restored')
    const backPlayer = watchFade(player, tokenId, AWAY, 'restored')
    await move(AWAY)
    const [outDm, outPlayer] = await Promise.all([backDm, backPlayer])
    console.log(`[measure] canopy back to 1 after the move landed: dm ${outDm?.ms.toFixed(0)} ms, player ${outPlayer?.ms.toFixed(0)} ms`)
    expect(outDm).not.toBeNull()
    expect(outPlayer).not.toBeNull()
  })
})
