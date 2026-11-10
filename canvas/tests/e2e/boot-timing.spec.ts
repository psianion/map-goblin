import { fileURLToPath } from 'node:url'
import { test, expect, type Page, type Response } from '@playwright/test'
import { waitForEngine, waitFrame } from './helpers'

/**
 * @boot: what a cold and a warm canvas cost, in seconds and bytes (asset loading plan,
 * section 7). Fresh context: open the home page and time it to the map grid; open the sample
 * map and time it to its first frame behind the loading screen; watch the library pill
 * appear and finish; reload warm and time both again. The numbers go into the report from
 * the annotations and the `[boot-timing]` log line.
 *
 * The rules it holds the branch to: no `gg-demo` art before a map opens, the library pill
 * comes and goes on its own, a warm open fetches no pack art, and a warm reload reaches the
 * grid in under 1.5 s. BOOT_BASELINE=1 is the run against `main`: the same timings, none of
 * the rules (main fetches everything up front and has no loading screen or pill).
 *
 * Run: `pnpm exec playwright test --project slow --grep @boot`.
 */

const WARREN_PATH = fileURLToPath(new URL('../../../session/testdata/goblin-warren.mapbuilder', import.meta.url))
const WARM_GRID_MS = 1500
const LIBRARY_TIMEOUT = 180_000
const baseline = !!process.env.BOOT_BASELINE

interface Fetched {
  url: string
  bytes: number
}

/** Every response from now on, with its body size off the wire (headers left out). */
function recordFetches(page: Page): { all: Fetched[]; mark: () => Fetched[] } {
  const all: Fetched[] = []
  let since = 0
  page.on('response', (res: Response) => {
    res
      .request()
      .sizes()
      .then((s) => all.push({ url: res.url(), bytes: s.responseBodySize }))
      .catch(() => all.push({ url: res.url(), bytes: 0 }))
  })
  return {
    all,
    /** What arrived since the last mark. */
    mark: () => {
      const out = all.slice(since)
      since = all.length
      return out
    },
  }
}

const sum = (list: Fetched[]) => list.reduce((n, f) => n + f.bytes, 0)
const isPackArt = (url: string, packId = '[^/]+') => new RegExp(`/packs/${packId}/[^?]+\\.webp(\\?|$)`).test(url)

/** The home page's map grid is up: the page and at least one card. */
async function gridShown(page: Page): Promise<void> {
  await expect(page.getByTestId('v2-home')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('v2-map-card').first()).toBeVisible({ timeout: 60_000 })
}

/** The editor is up with the map drawn: no loading screen, the engine has a scene, a frame painted. */
async function firstFrame(page: Page): Promise<void> {
  await expect(page.getByTestId('shell')).toBeVisible({ timeout: 120_000 })
  if (!baseline) await expect(page.getByTestId('loading-screen')).toHaveCount(0, { timeout: 120_000 })
  await waitForEngine(page)
  await waitFrame(page, 1)
}

/** One quiet beat so responses still in flight land in the right bucket. */
const settle = (page: Page) => page.waitForTimeout(250)

test('cold home, first map, library and warm reload, timed', { tag: '@boot' }, async ({ page }) => {
  const net = recordFetches(page)
  const metrics: Record<string, number> = {}

  // ── Cold home ──
  let t = Date.now()
  await page.goto('/?e2e=1')
  await gridShown(page)
  metrics.coldGridMs = Date.now() - t
  await settle(page)
  const home = net.mark()
  metrics.coldGridBytes = sum(home)
  if (!baseline) expect(home.filter((f) => isPackArt(f.url, 'gg-demo')), 'gg-demo art before a map opened').toEqual([])

  // ── Cold first map: the warren, through the New map dialog's Map file ──
  await page.getByTestId('v2-new-map-card').click()
  const modal = page.getByTestId('v2-new-map-modal')
  await modal.getByRole('group', { name: 'Start from' }).getByRole('button', { name: 'Map file' }).click()
  await modal.locator('input[type="file"]').setInputFiles(WARREN_PATH)
  await expect(modal).toContainText('goblin-warren.mapbuilder')
  const beforeOpen = net.all.length
  t = Date.now()
  await modal.getByTestId('v2-new-map-submit').click()
  await firstFrame(page)
  metrics.coldMapMs = Date.now() - t
  await settle(page)
  metrics.coldMapBytes = sum(net.mark())
  if (!baseline) {
    const early = net.all.slice(0, beforeOpen).filter((f) => isPackArt(f.url, 'gg-demo'))
    expect(early, 'gg-demo art before the map was opened').toEqual([])
  }

  // ── The library: the pill shows in phase library, then goes when it finishes ──
  if (!baseline) {
    const pill = page.locator('[data-testid="download-pill"][data-phase="library"]')
    await expect(pill).toBeVisible({ timeout: 30_000 })
    t = Date.now()
    await expect(pill).toHaveCount(0, { timeout: LIBRARY_TIMEOUT })
    metrics.libraryMs = Date.now() - t
    await settle(page)
    metrics.libraryBytes = sum(net.mark())
  }

  // ── Warm reload: grid, then the same map from its card ──
  await page.getByTestId('shell-title-card').getByRole('button', { name: 'Save and go home' }).click()
  await gridShown(page)
  net.mark()
  t = Date.now()
  await page.reload()
  await gridShown(page)
  metrics.warmGridMs = Date.now() - t
  await settle(page)
  metrics.warmGridBytes = sum(net.mark())
  t = Date.now()
  await page.getByRole('button', { name: 'Open Goblin Warren', exact: true }).click()
  await firstFrame(page)
  metrics.warmMapMs = Date.now() - t
  await settle(page)
  const warmOpen = net.mark()
  metrics.warmMapBytes = sum(warmOpen)

  for (const [type, value] of Object.entries(metrics)) test.info().annotations.push({ type, description: String(value) })
  console.log(`[boot-timing] canvas ${baseline ? 'baseline' : 'branch'} ${JSON.stringify(metrics)}`)

  if (!baseline) {
    // The library stored everything: a warm open fetches no pack art at all.
    expect(warmOpen.filter((f) => isPackArt(f.url))).toEqual([])
    expect(metrics.warmGridMs, 'warm reload to the grid').toBeLessThan(WARM_GRID_MS)
  }
})
