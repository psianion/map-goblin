/**
 * 25-scatter-brush.spec.ts
 * Scatter Brush: select tool, inject test asset, click to scatter, verify PlacedObjects, undo, erase mode.
 */
import { test, expect } from '@playwright/test'
import { gotoApp, waitFrame, firePointer, pressShortcut } from './helpers'

// ---------- Store helpers ----------

async function getActiveTool(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as Window & { __store?: { getState: () => { tools: { activeTool: string } } } }).__store
    return store?.getState().tools.activeTool ?? ''
  })
}

async function getPlacedObjects(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const store = (window as Window & { __store?: { getState: () => {
      layers: Array<{ type: string; objects?: Array<{ id: string; position: { x: number; y: number } }> }>
    } } }).__store
    if (!store) return []
    return store.getState().layers
      .filter((l) => l.type === 'images')
      .flatMap((l) => l.objects ?? [])
  })
}

async function activateScatterBrush(page: import('@playwright/test').Page): Promise<void> {
  const btn = page.getByRole('button', { name: /scatter\s*brush/i })
  if (await btn.isVisible()) {
    await btn.click()
  } else {
    await page.keyboard.press('b')
  }
  await waitFrame(page, 2)
}

async function injectScatterAsset(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const store = (window as Window & { __store?: { getState: () => {
      updateToolSettings: (patch: Record<string, unknown>) => void
      tools: { settings: { scatterBrush: Record<string, unknown> } }
    } } }).__store
    if (!store) return
    const state = store.getState()
    const current = state.tools.settings.scatterBrush
    state.updateToolSettings({
      scatterBrush: { ...current, assetIds: ['test-scatter-asset'] },
    })
  })
  await waitFrame(page, 1)
}

// ---------- Tests ----------

test.describe('Scatter Brush Tool', () => {
  test('selecting scatter brush tool activates it', async ({ page }) => {
    await gotoApp(page)
    await activateScatterBrush(page)

    const active = await getActiveTool(page)
    expect(active).toBe('scatterBrush')
  })

  test('clicking canvas creates scattered PlacedObjects', async ({ page }) => {
    await gotoApp(page)

    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()
    const cx = box!.x + box!.width / 2
    const cy = box!.y + box!.height / 2

    await activateScatterBrush(page)
    await injectScatterAsset(page)

    const before = await getPlacedObjects(page)

    await firePointer(page, 'pointerdown', cx, cy, 0.5, 1)
    await firePointer(page, 'pointerup', cx, cy, 0, 0)
    await page.waitForTimeout(200)
    await waitFrame(page, 5)

    const after = await getPlacedObjects(page)
    expect(after.length).toBeGreaterThan(before.length)
  })

  test('scattered objects have distinct positions (Poisson-disk)', async ({ page }) => {
    await gotoApp(page)
    await activateScatterBrush(page)
    await injectScatterAsset(page)

    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()
    const cx = box!.x + box!.width / 2
    const cy = box!.y + box!.height / 2

    await firePointer(page, 'pointerdown', cx, cy, 0.5, 1)
    await firePointer(page, 'pointerup', cx, cy, 0, 0)
    await page.waitForTimeout(200)
    await waitFrame(page, 5)

    const objects = await getPlacedObjects(page)
    if (objects.length > 1) {
      const positions = new Set(objects.map((o) => `${o.position.x},${o.position.y}`))
      expect(positions.size).toBeGreaterThan(1)
    }
  })

  test('undo removes scattered objects', async ({ page }) => {
    await gotoApp(page)
    await activateScatterBrush(page)
    await injectScatterAsset(page)

    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()
    const cx = box!.x + box!.width / 2
    const cy = box!.y + box!.height / 2

    const before = await getPlacedObjects(page)

    await firePointer(page, 'pointerdown', cx, cy, 0.5, 1)
    await firePointer(page, 'pointerup', cx, cy, 0, 0)
    await page.waitForTimeout(200)
    await waitFrame(page, 5)

    const afterScatter = await getPlacedObjects(page)
    expect(afterScatter.length).toBeGreaterThan(before.length)

    await pressShortcut(page, 'z', { ctrl: true })
    await waitFrame(page, 5)

    const afterUndo = await getPlacedObjects(page)
    expect(afterUndo.length).toBe(before.length)
  })

  test('erase mode removes scattered objects under brush', async ({ page }) => {
    await gotoApp(page)
    await activateScatterBrush(page)
    await injectScatterAsset(page)

    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()
    const cx = box!.x + box!.width / 2
    const cy = box!.y + box!.height / 2

    // Place objects
    await firePointer(page, 'pointerdown', cx, cy, 0.5, 1)
    await firePointer(page, 'pointerup', cx, cy, 0, 0)
    await page.waitForTimeout(200)
    await waitFrame(page, 5)

    const afterScatter = await getPlacedObjects(page)
    expect(afterScatter.length).toBeGreaterThan(0)

    // Activate erase mode
    await page.keyboard.press('e')
    await waitFrame(page, 2)

    // Erase at same location
    await firePointer(page, 'pointerdown', cx, cy, 0.5, 1)
    await firePointer(page, 'pointerup', cx, cy, 0, 0)
    await page.waitForTimeout(200)
    await waitFrame(page, 5)

    const afterErase = await getPlacedObjects(page)
    expect(afterErase.length).toBeLessThan(afterScatter.length)
  })

  test('multiple scatter strokes accumulate objects', async ({ page }) => {
    await gotoApp(page)
    await activateScatterBrush(page)
    await injectScatterAsset(page)

    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()
    const cx = box!.x + box!.width / 2
    const cy = box!.y + box!.height / 2

    // Stroke 1
    await firePointer(page, 'pointerdown', cx - 100, cy, 0.5, 1)
    await firePointer(page, 'pointerup', cx - 100, cy, 0, 0)
    await page.waitForTimeout(200)
    await waitFrame(page, 5)
    const afterFirst = await getPlacedObjects(page)

    // Stroke 2
    await firePointer(page, 'pointerdown', cx + 100, cy, 0.5, 1)
    await firePointer(page, 'pointerup', cx + 100, cy, 0, 0)
    await page.waitForTimeout(200)
    await waitFrame(page, 5)
    const afterSecond = await getPlacedObjects(page)

    expect(afterSecond.length).toBeGreaterThan(afterFirst.length)
  })
})
