import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { FIXTURE, assertMapRendered, hostTable, loadedMapName } from './table'

/**
 * @sprint2-scenes — §2.6 "Scene switch < 2s". One DM context, two maps, a stopwatch on the
 * click.
 *
 * The clock stops on the *loaded document*, not on the button's `aria-current`: a scene
 * switch is `scenes:activate` → `scene-changed` → the store dropping `mapData` → a fresh
 * `GET /api/maps/:id` → core's `loadFromFile`. Anything short of the last step is a
 * highlight moving on a list while the table still looks at the old room.
 *
 * Runs on the production build (see `playwright.sprint2.config.ts`) for the same reason
 * the S1 metrics do — a timing taken on the dev server measures Vite's module waterfall.
 */

const SCENE_B = 'Upper Level'

/**
 * A second, smaller dungeon built from the fixture: renamed, with the crypt and the south
 * corridor (and their door and light) removed.
 *
 * The geometry has to actually differ, not just the name. Core's shape subscription
 * (`subscribeToStore`) compares layer ids, shape counts and shape keys, and skips the
 * Clipper2 re-union when they match — so loading a byte-identical copy of the current map
 * leaves `mergedFloor` null and the floor undrawn. A duplicated file is the only way to
 * hit that in practice; noted for P1 rather than worked around here, because a scene
 * switch between two *different* rooms is what this metric is about anyway.
 */
function secondMap(): { name: string; mimeType: string; buffer: Buffer } {
  const doc = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    mapSettings: { name: string }
    layers: { children?: { id: string }[] }[]
  }
  doc.mapSettings.name = SCENE_B
  for (const layer of doc.layers) {
    layer.children = layer.children?.filter((child) => !/crypt|south/.test(child.id))
  }
  return {
    name: 'upper-level.mapbuilder',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(doc)),
  }
}

const sceneButton = (page: Page, name: string) =>
  page.getByTestId('scene-list').getByRole('button', { name })

/** Click → the named document is what core has loaded. Returns the elapsed ms. */
async function switchTo(page: Page, name: string): Promise<number> {
  const started = Date.now()
  await sceneButton(page, name).click()
  // 50ms intervals rather than Playwright's default backoff: a 1s poll gap would be half
  // the 2s budget spent inside the measuring instrument.
  await expect.poll(() => loadedMapName(page), { timeout: 30_000, intervals: [50] }).toBe(name)
  return Date.now() - started
}

test.describe.serial('@sprint2-scenes', () => {
  test('the DM switches scenes and the table follows in under 2s', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
    const dm = await context.newPage()
    dm.on('pageerror', (e) => console.log('[dm pageerror]', e.message))

    try {
      await hostTable(dm)
      await dm.getByRole('button', { name: 'Enter table' }).click()
      await expect(dm.locator('[data-page="table"]')).toBeVisible()
      await assertMapRendered(dm)

      // D6: an in-session import is the existing upload endpoint plus a snapshot refetch,
      // so the second scene appears in the list without a server round of its own.
      await dm.getByTestId('scene-upload').setInputFiles(secondMap())
      await expect(dm.getByTestId('scene-list').getByRole('button')).toHaveCount(2, {
        timeout: 30_000,
      })
      await expect(sceneButton(dm, 'Demo Dungeon')).toHaveAttribute('aria-current', 'true')

      const there = await switchTo(dm, SCENE_B)
      await expect(sceneButton(dm, SCENE_B)).toHaveAttribute('aria-current', 'true')
      await assertSceneRendered(dm)

      // Back again, because the return trip is the half that a stale-map bug shows up on
      // (the client has to drop `mapData` in *both* directions, not just forward).
      const back = await switchTo(dm, 'Demo Dungeon')
      await expect(sceneButton(dm, 'Demo Dungeon')).toHaveAttribute('aria-current', 'true')

      console.log(
        `[metric] scene switch: → ${SCENE_B} ${there}ms, → Demo Dungeon ${back}ms (target < 2000ms)`,
      )
      expect(there).toBeLessThan(2000)
      expect(back).toBeLessThan(2000)
    } finally {
      await context.close()
    }
  })

  // PHASE 2 (needs `modules/tokens/**` — TokenRenderer + placement): place tokens on scene
  // A, switch to B, switch back, assert every token is on the cell it was left on. The
  // switch timing above is the same walk; only the token assertions are missing.
  test.skip('token positions are restored across a scene switch — phase 2: needs TokenRenderer', () => {})
})

/**
 * The canvas is live and core has geometry for the scene now loaded — Clipper2 unioned the
 * new document's rooms into a floor the renderer draws.
 *
 * Polled, and deliberately outside the measured window: the union runs after
 * `loadFromFile` returns, so a single read here would be a race, and waiting for it inside
 * `switchTo` would charge the scene-switch budget for work the player never waits on (the
 * map document is already in the store and on screen).
 */
async function assertSceneRendered(page: Page): Promise<void> {
  await expect(page.getByText(/Waiting for the DM|Loading map|could not|failed/)).toHaveCount(0)
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const store = (
            window as unknown as {
              __STORE__?: {
                getState(): { layers: { type: string; mergedFloor?: unknown[] | null }[] }
              }
            }
          ).__STORE__
          return store?.getState().layers.find((l) => l.type === 'dungeon')?.mergedFloor?.length ?? 0
        }),
      { timeout: 30_000, intervals: [50] },
    )
    .toBeGreaterThan(0)
}
