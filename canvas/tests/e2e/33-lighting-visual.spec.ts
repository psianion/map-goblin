/**
 * 33-lighting-visual.spec.ts
 * Pixel/visual regression for the lighting composite — modeled on 15-shadow-visual.spec.ts:
 * one focused render-pipeline check rather than a full screenshot diff.
 *
 * A light's own footprint has to visibly change under it, and that change has to stay local —
 * a bug in the FBO compositing (e.g. the multiply-blend sprite covering the whole viewport
 * regardless of light radius) would move a distant pixel just as much as the lit one.
 */
import { test, expect } from '@playwright/test'
import { gotoApp, firePointer, waitFrame, getPixelColor } from './helpers'

async function getCanvasCenter(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement
    const r = c.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
}

test.describe('33 - Lighting Visual', () => {
  test('a placed light visibly brightens its own footprint, not the far corner', async ({ page }) => {
    await gotoApp(page)

    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    const dpr = await page.evaluate(() => window.devicePixelRatio)

    // Canvas-pixel coordinates (dpr-scaled), matching getPixelColor's expectations.
    const centerPx = { x: Math.round((box!.width / 2) * dpr), y: Math.round((box!.height / 2) * dpr) }
    // Top-left corner: hundreds of world-space pixels from center at any sane zoom — far
    // outside a torch-sized light's radius, which is the whole point of sampling it.
    const cornerPx = { x: Math.round(10 * dpr), y: Math.round(10 * dpr) }

    const beforeCenter = await getPixelColor(page, centerPx.x, centerPx.y)
    const beforeCorner = await getPixelColor(page, cornerPx.x, cornerPx.y)

    // Place a light at the canvas center with the Light tool — same mechanism 17-lighting.spec.ts
    // uses for placement, so this test measures rendering, not a second copy of tool logic.
    await page.keyboard.press('l')
    await waitFrame(page, 1)
    const center = await getCanvasCenter(page)
    await firePointer(page, 'pointerdown', center.x, center.y)
    await firePointer(page, 'pointerup', center.x, center.y)
    await waitFrame(page, 3)

    // Push intensity and color to the extreme so the pixel diff is unmistakable regardless
    // of whatever the tool's current placement defaults happen to be — radius stays at the
    // tool default (already tuned to read as a sensible torch, not "covers the viewport").
    await page.evaluate(() => {
      type Light = { id: string; childType: string }
      type DungeonLayer = { id: string; type: string; children: Light[] }
      const store = (window as Window & {
        __store?: {
          getState: () => {
            layers: DungeonLayer[]
            updateChild: (layerId: string, childId: string, patch: Record<string, unknown>) => void
          }
        }
      }).__store
      const state = store!.getState()
      const layer = state.layers.find((l) => l.type === 'dungeon')!
      const lightChild = layer.children.find((c) => c.childType === 'light')!
      state.updateChild(layer.id, lightChild.id, {
        color: '#ff2222',
        intensity: 1,
        featherRadius: 0,
        falloff: 'quadratic',
      })
    })
    await waitFrame(page, 5)

    const afterCenter = await getPixelColor(page, centerPx.x, centerPx.y)
    const afterCorner = await getPixelColor(page, cornerPx.x, cornerPx.y)

    expect(afterCenter.a).toBe(255)

    const centerDiff =
      Math.abs(afterCenter.r - beforeCenter.r) +
      Math.abs(afterCenter.g - beforeCenter.g) +
      Math.abs(afterCenter.b - beforeCenter.b)
    const cornerDiff =
      Math.abs(afterCorner.r - beforeCorner.r) +
      Math.abs(afterCorner.g - beforeCorner.g) +
      Math.abs(afterCorner.b - beforeCorner.b)

    // The light measurably changed its own footprint...
    expect(centerDiff).toBeGreaterThan(15)
    // ...and did not move the far corner anywhere near as much — a whole-viewport compositing
    // regression (the bug this test exists to catch) would blow this comparison open.
    expect(cornerDiff).toBeLessThan(centerDiff)
  })
})
