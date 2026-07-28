import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'

/**
 * The steps every E2E shares: host a table, join one, decide whether the map rendered.
 * Extracted from I1's `session-flow.spec.ts` so the I2 metric specs measure exactly the
 * flow the flow-spec asserts — two copies would drift and the timings would stop meaning
 * what the flow proves.
 */

export const FIXTURE = join(import.meta.dirname, '../../testdata/demo-dungeon.mapbuilder')

export const SERVER_URL = process.env.E2E_SERVER_URL ?? 'http://localhost:8787'

/** The map document the fixture carries, once core's store has actually loaded it. */
export async function loadedMapName(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const store = (window as unknown as { __STORE__?: { getState(): { mapSettings: { name: string } } } })
      .__STORE__
    return store?.getState().mapSettings.name
  })
}

/**
 * "The map rendered" is several seams holding at once: the WS snapshot carried an
 * activeSceneId, `GET /api/maps/:id` authorized with the session token, and core's engine
 * loaded the document. Asserted through the core store rather than the status overlay —
 * the overlay is a UI affordance, the store is the thing the renderer draws from.
 */
export async function assertMapRendered(page: Page): Promise<void> {
  const canvas = page.locator('[data-testid="game-canvas"] canvas')
  await expect(canvas).toBeVisible({ timeout: 30_000 })

  await expect(page.getByText(/Waiting for the DM|Loading map|could not|failed/)).toHaveCount(0, {
    timeout: 30_000,
  })

  // Polled, not read once: the engine boot behind this includes installing the bundled
  // asset pack into a cold IndexedDB, which is seconds, and `loadFromFile` only runs once
  // that has finished. The status overlay clears before it — it tracks the fetch, not the
  // engine — so the store is the honest signal.
  //
  // 50ms intervals rather than Playwright's default backoff (100/250/500/1000…): I2 stops
  // a stopwatch on this predicate, and a 1s poll gap would be 20% of the 5s join budget
  // spent inside the measuring instrument.
  await expect
    .poll(() => loadedMapName(page), { timeout: 60_000, intervals: [50] })
    .toBe('Demo Dungeon')

  // Clipper2 unioned the fixture's five rectangles into the floor the renderer draws.
  // Non-null mergedFloor means the engine's store subscription ran, not just the fetch.
  const floorPolygons = await page.evaluate(() => {
    const store = (
      window as unknown as {
        __STORE__?: { getState(): { layers: { type: string; mergedFloor?: unknown[] | null }[] } }
      }
    ).__STORE__
    const dungeon = store?.getState().layers.find((l) => l.type === 'dungeon')
    return dungeon?.mergedFloor?.length ?? 0
  })
  expect(floorPolygons).toBeGreaterThan(0)

  const box = await canvas.boundingBox()
  expect(box!.width).toBeGreaterThan(100)
  expect(box!.height).toBeGreaterThan(100)
}

/** Landing → HostSetup's four steps. Returns the invite code the table is listening on. */
export async function hostTable(page: Page): Promise<string> {
  await page.goto('/')
  await page.getByRole('link', { name: 'Host a game' }).click()

  await page.locator('#server-url').fill(SERVER_URL)
  await page.locator('#admin-pass').fill(process.env.E2E_ADMIN_PASS ?? '')
  await page.getByRole('button', { name: 'Continue' }).click()

  await page.locator('#campaign-name').fill('Cragmaw Hideout')
  await page.getByRole('button', { name: 'Create campaign' }).click()

  await page.locator('#map-file').setInputFiles(FIXTURE)
  await expect(page.getByTestId('uploaded-map')).toContainText('Demo Dungeon')
  await page.getByRole('button', { name: 'Continue' }).click()

  await page.getByRole('button', { name: 'Start session' }).click()
  const code = await page.getByTestId('invite-code').textContent()
  expect(code).toMatch(/^[A-Z0-9]{6}$/)
  return code!
}

/** `/join/CODE` → a seat at the table. Returns when the table page is mounted. */
export async function joinTable(page: Page, code: string, name: string): Promise<void> {
  await page.goto(`/join/${code}`)
  await expect(page.getByText('Table found')).toBeVisible()
  await page.locator('#player-name').fill(name)
  await page.getByRole('button', { name: 'Join' }).click()
  await expect(page.locator('[data-page="table"]')).toBeVisible()
}
