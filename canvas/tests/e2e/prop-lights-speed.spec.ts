import { fileURLToPath } from 'node:url'
import { test, expect, type Browser, type Page } from '@playwright/test'
import { waitForEngine, waitFrame } from './helpers'

/**
 * @boot: the prop lights pass's speed budget (plan "Speed budgets"), run the same way on main
 * (a clean export of 1f5b125) and on the branch, back to back on one lane. Every context is
 * 1920x1080 and opens with the lit preview on (Night), so the lighting composite runs.
 *
 * - Map open, per map: three cold opens, each in a fresh context (empty cache and IndexedDB),
 *   timed from submit to the first frame and to the library finishing; then five warm opens
 *   from the Home card in the last context. Lit idle recomposites over 3 s after the last.
 * - Idle and moving lights, on a blank map with lights put in through the store: static lights
 *   with no effect (expect 0 recomposites, 0 sweeps), one static cone that flickers (the
 *   per-frame composite today), and one spinning plus one sweeping cone with no effect (the
 *   branch's moving lights: recomposites every frame, no sweep after the first). Mean composite
 *   ms per frame for the flickering static cone against the moving cones.
 *
 * Nothing asserts a budget here: the numbers are compared by reading the two runs side by side.
 * Run: `pnpm exec playwright test --project slow --workers=1 tests/e2e/prop-lights-speed.spec.ts`.
 */

const MAPS = [
  {
    file: fileURLToPath(new URL('../../../session/testdata/goblin-warren.mapbuilder', import.meta.url)),
    label: 'goblin-warren.mapbuilder',
    name: 'Goblin Warren',
  },
  {
    file: fileURLToPath(new URL('../../../session/testdata/lighting-showcase.ggvtt', import.meta.url)),
    label: 'lighting-showcase.ggvtt',
    name: 'Lighting showcase',
  },
]
const COLD_RUNS = 3
const WARM_RUNS = 5
const IDLE_MS = 3000
const LIBRARY_TIMEOUT = 180_000

/** Every context opens lit: the editor's preview pick, read before the app boots. */
async function litContext(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  await context.addInitScript(() => {
    try {
      localStorage.setItem('mapbuilder-preview', 'night')
    } catch {
      /* no storage */
    }
  })
  return context
}

async function gridShown(page: Page): Promise<void> {
  await expect(page.getByTestId('v2-home')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('v2-new-map-card')).toBeVisible({ timeout: 60_000 })
}

async function firstFrame(page: Page): Promise<void> {
  await expect(page.getByTestId('shell')).toBeVisible({ timeout: 120_000 })
  await expect(page.getByTestId('loading-screen')).toHaveCount(0, { timeout: 120_000 })
  await waitForEngine(page)
  await waitFrame(page, 1)
}

const counters = (page: Page) =>
  page.evaluate(() => {
    const g = globalThis as { __ggLighting?: { recomposites: number }; __ggLightSweeps?: { sweeps: number } }
    return { recomposites: g.__ggLighting?.recomposites ?? -1, sweeps: g.__ggLightSweeps?.sweeps ?? -1 }
  })

/** Recomposites and sweeps over `IDLE_MS` with nothing touched, after 1.5 s to settle. */
async function idle(page: Page): Promise<{ recomposites: number; sweeps: number }> {
  await page.waitForTimeout(1500)
  const a = await counters(page)
  await page.waitForTimeout(IDLE_MS)
  const b = await counters(page)
  return { recomposites: b.recomposites - a.recomposites, sweeps: a.sweeps < 0 ? -1 : b.sweeps - a.sweeps }
}

/** Mean of the composite's last-run ms, sampled once a frame for two seconds. */
const compositeMs = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const g = globalThis as { __ggLighting?: { compositeMs: number } }
        const samples: number[] = []
        const end = performance.now() + 2000
        const step = () => {
          samples.push(g.__ggLighting?.compositeMs ?? 0)
          if (performance.now() < end) requestAnimationFrame(step)
          else resolve(samples.reduce((n, v) => n + v, 0) / Math.max(1, samples.length))
        }
        requestAnimationFrame(step)
      }),
  )

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2)
}
const spread = (xs: number[]): string => {
  const m = median(xs)
  return m ? `${Math.round(((Math.max(...xs) - Math.min(...xs)) / m) * 100)}%` : '-'
}

async function oneColdOpen(browser: Browser, map: (typeof MAPS)[number], warm: boolean) {
  const context = await litContext(browser)
  const page = await context.newPage()
  try {
    await page.goto('/?e2e=1')
    await gridShown(page)
    await page.getByTestId('v2-new-map-card').click()
    const modal = page.getByTestId('v2-new-map-modal')
    await modal.getByRole('group', { name: 'Start from' }).getByRole('button', { name: 'Map file' }).click()
    await modal.locator('input[type="file"]').setInputFiles(map.file)
    await expect(modal).toContainText(map.label)
    let t = Date.now()
    await modal.getByTestId('v2-new-map-submit').click()
    await firstFrame(page)
    const coldMs = Date.now() - t
    const pill = page.locator('[data-testid="download-pill"][data-phase="library"]')
    await expect(pill).toHaveCount(0, { timeout: LIBRARY_TIMEOUT })
    const libraryMs = Date.now() - t

    const warmMs: number[] = []
    let litIdle = { recomposites: -1, sweeps: -1 }
    if (warm) {
      for (let i = 0; i < WARM_RUNS; i++) {
        await page.getByTestId('shell-title-card').getByRole('button', { name: 'Save and go home' }).click()
        await gridShown(page)
        await page.reload()
        await gridShown(page)
        t = Date.now()
        await page.getByRole('button', { name: `Open ${map.name}`, exact: true }).first().click()
        await firstFrame(page)
        warmMs.push(Date.now() - t)
      }
      litIdle = await idle(page)
    }
    return { coldMs, libraryMs, warmMs, litIdle }
  } finally {
    await context.close()
  }
}

// One at a time: two maps opening side by side would time each other.
test.describe.configure({ mode: 'serial' })

// Vite compiles the editor on its first request; pay that here, not in the first cold open.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000)
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/?e2e=1')
  await gridShown(page)
  await page.getByTestId('v2-new-map-card').click()
  await page.getByTestId('v2-new-map-submit').click()
  await firstFrame(page)
  await context.close()
})

for (const map of MAPS) {
  test(`${map.name}: cold and warm open, lit idle recomposites`, { tag: '@boot' }, async ({ browser }) => {
    test.setTimeout(COLD_RUNS * (LIBRARY_TIMEOUT + 180_000))
    const runs = []
    for (let i = 0; i < COLD_RUNS; i++) runs.push(await oneColdOpen(browser, map, i === COLD_RUNS - 1))
    const cold = runs.map((r) => r.coldMs)
    const library = runs.map((r) => r.libraryMs)
    const warm = runs.flatMap((r) => r.warmMs)
    const result = {
      map: map.label,
      coldMs: cold,
      coldMedian: median(cold),
      coldSpread: spread(cold),
      libraryMs: library,
      libraryMedian: median(library),
      warmMs: warm,
      warmMedian: median(warm),
      warmSpread: spread(warm),
      litIdlePer3s: runs[COLD_RUNS - 1]!.litIdle,
    }
    console.log(`[prop-lights-speed] ${JSON.stringify(result)}`)
  })
}

/** Lights put on the blank map's active layer through the store, then idle counted. */
async function lightsScenario(browser: Browser, lights: Record<string, unknown>[]) {
  const context = await litContext(browser)
  const page = await context.newPage()
  try {
    await page.goto('/?e2e=1')
    await gridShown(page)
    await page.getByTestId('v2-new-map-card').click()
    await page.getByTestId('v2-new-map-submit').click()
    await firstFrame(page)
    await page.evaluate((list) => {
      const store = (globalThis as { __store?: { getState: () => { ui: { activeLayerId: string }; addChild: (l: string, c: unknown) => void } } }).__store!
      const layerId = store.getState().ui.activeLayerId
      for (const l of list) store.getState().addChild(layerId, l)
    }, lights)
    const counts = await idle(page)
    const ms = await compositeMs(page)
    return { ...counts, compositeMsMean: Math.round(ms * 1000) / 1000 }
  } finally {
    await context.close()
  }
}

const lamp = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  childType: 'light',
  visible: true,
  color: '#ffb561',
  radius: 8,
  featherRadius: 4,
  intensity: 0.9,
  falloff: 'quadratic',
  position: { x, y },
  ...extra,
})

test('idle and moving lights, lit', { tag: '@boot' }, async ({ browser }) => {
  test.setTimeout(240_000)
  const cone = { angle: 60, direction: 0 }
  const staticNoEffect = await lightsScenario(browser, [
    lamp('a', 4, 4),
    lamp('b', 14, 4),
    lamp('c', 4, 14),
    lamp('d', 14, 14, { cone }),
    lamp('e', 9, 9, { cone: { angle: 90, direction: 180 } }),
  ])
  const flickerCone = await lightsScenario(browser, [lamp('f', 9, 9, { cone, animation: { kind: 'flicker', speed: 1 } })])
  const moving = await lightsScenario(browser, [
    lamp('spin', 6, 9, { cone, motion: { kind: 'spin', rpm: 6, clockwise: true } }),
    lamp('sweep', 12, 9, { cone, motion: { kind: 'sweep', from: 0, to: 90, degPerSec: 45 } }),
  ])
  console.log(`[prop-lights-speed] ${JSON.stringify({ scenario: 'lights', staticNoEffect, flickerCone, moving })}`)
})
