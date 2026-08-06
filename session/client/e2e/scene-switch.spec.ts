import { readFileSync } from 'node:fs'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { FIXTURE, assertMapRendered, hostTable, loadedMapName } from './table'

/**
 * @scene-switch — the M1 contract: a live scene switch never renders nothing (F1), the
 * camera refits per scene (F3), the return trip is served from cache, and a republish of
 * the scene being played swaps via its new mapId.
 *
 * The blank-frame assertion samples `__testProbe` (main.tsx) from inside a rAF loop: the
 * F1 wipe lived between two frames, which no Playwright poll can catch from outside.
 */

const SCENE_B = 'Upper Level'

function fixtureVariant(name: string, strip: RegExp | null): {
  name: string
  mimeType: string
  buffer: Buffer
} {
  const doc = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    mapSettings: { name: string }
    layers: { children?: { id: string }[] }[]
  }
  doc.mapSettings.name = name
  if (strip) {
    for (const layer of doc.layers) {
      layer.children = layer.children?.filter((child) => !strip.test(child.id))
    }
  }
  return {
    name: `${name.toLowerCase().replace(/\s+/g, '-')}.mapbuilder`,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(doc)),
  }
}

const sceneButton = (page: Page, name: string) =>
  page.getByTestId('scene-list').getByRole('button', { name })

async function switchTo(page: Page, name: string): Promise<void> {
  await sceneButton(page, name).click()
  await expect.poll(() => loadedMapName(page), { timeout: 30_000, intervals: [50] }).toBe(name)
}

/** Total drawn children across every layer container, per frame, until stopped. */
async function startFrameSampler(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __testProbe: { layers(): { drawn: number }[] }
      __frameSamples: number[]
      __samplerRaf: number
    }
    w.__frameSamples = []
    const tick = () => {
      w.__frameSamples.push(w.__testProbe.layers().reduce((n, l) => n + l.drawn, 0))
      w.__samplerRaf = requestAnimationFrame(tick)
    }
    tick()
  })
}

async function stopFrameSampler(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __frameSamples: number[]; __samplerRaf: number }
    cancelAnimationFrame(w.__samplerRaf)
    return w.__frameSamples
  })
}

const readCamera = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as {
      __testProbe: { camera(): { x: number; y: number; scale: number } | null }
    }
    return w.__testProbe.camera()
  })

async function tableWithTwoScenes(
  browser: Browser,
): Promise<{ context: BrowserContext; dm: Page }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const dm = await context.newPage()
  dm.on('pageerror', (e) => console.log('[dm pageerror]', e.message))

  await hostTable(dm)
  await dm.getByRole('button', { name: 'Enter table' }).click()
  await expect(dm.locator('[data-page="table"]')).toBeVisible()
  await assertMapRendered(dm)

  await dm.getByTestId('scene-upload').setInputFiles(fixtureVariant(SCENE_B, /crypt|south/))
  await expect(dm.getByTestId('scene-list').locator('li')).toHaveCount(2, {
    timeout: 30_000,
  })
  await expect(sceneButton(dm, 'Demo Dungeon')).toHaveAttribute('aria-current', 'true')
  return { context, dm }
}

test.describe.serial('@scene-switch', () => {
  test('no frame of a switch ever draws an empty table (F1), and the camera refits (F3)', async ({
    browser,
  }) => {
    const { context, dm } = await tableWithTwoScenes(browser)
    try {
      const cameraA = await readCamera(dm)
      expect(cameraA).not.toBeNull()

      await startFrameSampler(dm)
      await switchTo(dm, SCENE_B)
      // Let the post-switch flush and a few real frames land before reading the tape.
      await dm.waitForTimeout(500)
      const samples = await stopFrameSampler(dm)

      // Enough frames to have caught a wipe, and not one of them empty.
      expect(samples.length).toBeGreaterThan(10)
      expect(Math.min(...samples)).toBeGreaterThan(0)

      // F3: a different dungeon frames differently…
      const cameraB = await readCamera(dm)
      expect(cameraB).not.toBeNull()
      expect(cameraB).not.toEqual(cameraA)

      // …and coming home re-frames home, not wherever the camera happened to be.
      await switchTo(dm, 'Demo Dungeon')
      await expect.poll(() => readCamera(dm), { timeout: 10_000 }).toEqual(cameraA)
    } finally {
      await context.close()
    }
  })

  test('the return trip is served from cache — no second map fetch', async ({ browser }) => {
    const { context, dm } = await tableWithTwoScenes(browser)
    try {
      const mapFetches: string[] = []
      dm.on('request', (req) => {
        if (req.url().includes('/api/maps/') && !req.url().includes('/images/')) {
          mapFetches.push(req.url())
        }
      })

      await switchTo(dm, SCENE_B)
      const afterForward = mapFetches.length
      expect(afterForward).toBeGreaterThan(0) // first visit is a real fetch

      await switchTo(dm, 'Demo Dungeon')
      expect(mapFetches.length).toBe(afterForward) // the visit back is not
    } finally {
      await context.close()
    }
  })

  test('republishing the live scene swaps the table onto the new map (same sceneId, new mapId)', async ({
    browser,
  }) => {
    const { context, dm } = await tableWithTwoScenes(browser)
    try {
      await startFrameSampler(dm)
      // Replace the ACTIVE scene's map with a renamed variant. Same scene row, new map row:
      // without the mapId in scene-changed and the swap key, this is a silent no-op.
      const activeRow = dm
        .getByTestId('scene-list')
        .locator('li', { has: dm.getByRole('button', { name: 'Demo Dungeon' }) })
      await activeRow
        .locator('label', { hasText: 'Replace map' })
        .locator('input[type="file"]')
        .setInputFiles(fixtureVariant('Demo Dungeon Revised', /crypt/))
      await expect
        .poll(() => loadedMapName(dm), { timeout: 30_000, intervals: [50] })
        .toBe('Demo Dungeon Revised')
      await dm.waitForTimeout(300)
      const samples = await stopFrameSampler(dm)
      expect(Math.min(...samples)).toBeGreaterThan(0) // a republish is a switch too — no wipe
    } finally {
      await context.close()
    }
  })
})
