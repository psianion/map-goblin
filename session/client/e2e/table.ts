import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { GAME_SERVER } from './ports'

/**
 * The steps every E2E shares: host a table, join one, decide whether the map rendered.
 * Extracted from I1's `session-flow.spec.ts` so the I2 metric specs measure exactly the
 * flow the flow-spec asserts — two copies would drift and the timings would stop meaning
 * what the flow proves.
 */

export const FIXTURE = join(import.meta.dirname, '../../testdata/demo-dungeon.mapbuilder')

/** A map a spec hosts on: the file the DM uploads, and the name core's store loads it as. */
export interface MapUnderTest {
  file: string
  name: string
}

export const DEMO: MapUnderTest = { file: FIXTURE, name: 'Demo Dungeon' }

/**
 * D15's dressed gate map: 13 rooms and corridors, 13 doors (3 archways, 1 secret, 2 locked),
 * 206 walls, 4 lights, terrain and water. The S3 rows are only honest against real content.
 */
export const GATE: MapUnderTest = {
  file: join(import.meta.dirname, '../../testdata/emberhold-crypt.mapbuilder'),
  name: 'Emberhold Crypt',
}

/** `global-setup.ts` publishes this; the fallback is for a spec run against a live server. */
export const SERVER_URL = process.env.E2E_SERVER_URL ?? GAME_SERVER

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
/**
 * The half of `assertMapRendered` that holds for a *player* who has explored nothing: the
 * document arrived and the engine loaded it. There is no floor to union yet — every room is
 * still redacted out of their copy (D4) — so the mergedFloor check below would be asking
 * fog to have failed.
 */
export async function assertMapLoaded(page: Page, map: MapUnderTest = DEMO): Promise<void> {
  const canvas = page.locator('[data-testid="game-canvas"] canvas')
  await expect(canvas).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/Waiting for the DM|Loading map|could not|failed/)).toHaveCount(0, {
    timeout: 30_000,
  })
  await expect
    .poll(() => loadedMapName(page), { timeout: 60_000, intervals: [50] })
    .toBe(map.name)
}

export async function assertMapRendered(page: Page, map: MapUnderTest = DEMO): Promise<void> {
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
    .toBe(map.name)

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

/**
 * Landing → HostSetup's four steps. Returns the invite code the table is listening on.
 *
 * The upload step is the real one: `#map-file` POSTs the `.mapbuilder` to
 * `/api/campaigns/:id/maps` exactly as a DM's file picker would. There is no masking step,
 * no fog authoring pass, nothing between the editor's file and a playable table — which is
 * the whole of §2.6's zero-setup row.
 *
 * `startingRoomId` is the one optional decision in that flow (§2.6): the room the DM lights
 * before anyone joins. Left out, the picker stays on "none" and the table starts dark, which
 * is what every other spec in this repo hosts.
 */
export async function hostTable(
  page: Page,
  map: MapUnderTest = DEMO,
  startingRoomId?: string,
): Promise<string> {
  await page.goto('/')
  await page.getByRole('link', { name: 'Host a game' }).click()

  await page.locator('#server-url').fill(SERVER_URL)
  await page.locator('#admin-pass').fill(process.env.E2E_ADMIN_PASS ?? '')
  await page.getByRole('button', { name: 'Continue' }).click()

  await page.locator('#campaign-name').fill('Cragmaw Hideout')
  await page.getByRole('button', { name: 'Create campaign' }).click()

  await page.locator('#map-file').setInputFiles(map.file)
  await expect(page.getByTestId('uploaded-map')).toContainText(map.name)
  if (startingRoomId) await page.locator('#starting-room').selectOption(startingRoomId)
  await page.getByRole('button', { name: 'Continue' }).click()

  await page.getByRole('button', { name: 'Start session' }).click()
  const code = await page.getByTestId('invite-code').textContent()
  expect(code).toMatch(/^[A-Z0-9]{6}$/)
  return code!
}

/**
 * Frames actually painted per second, over `ms`. Foreground only — a hidden tab has its rAF
 * throttled and the number would be about tab visibility, not about what is on the canvas.
 */
export function measureFps(page: Page, ms = 2000): Promise<number> {
  return page.evaluate(
    (duration: number) =>
      new Promise<number>((resolve) => {
        let frames = 0
        const started = performance.now()
        const tick = () => {
          frames += 1
          const elapsed = performance.now() - started
          if (elapsed >= duration) resolve((frames * 1000) / elapsed)
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
    ms,
  )
}

/** `/join/CODE` → a seat at the table. Returns when the table page is mounted. */
export async function joinTable(page: Page, code: string, name: string): Promise<void> {
  await page.goto(`/join/${code}`)
  await expect(page.getByText('Table found')).toBeVisible()
  await page.locator('#player-name').fill(name)
  await page.getByRole('button', { name: 'Join' }).click()
  await expect(page.locator('[data-page="table"]')).toBeVisible()
}
