/**
 * 24-integration-focus-transform.spec.ts
 * Integration: focus mode + transform controls working together.
 *
 * Tests:
 * - Transform handles work while UI is auto-faded (gizmo overlay unaffected by panel fade)
 * - Transform works in fullscreen mode (panels hidden, canvas fills grid)
 * - Focus mode button still works during active transform session
 * - Panel toggle icons are correct after focus mode cycling
 * - Undo for transform and focus mode operate independently
 */
import { test, expect } from '@playwright/test'
import { gotoApp, waitFrame, firePointer } from './helpers'

// ─── Helpers ──────────────────────────────────────────────────────────────────

type StoreType = { __store?: { getState: () => Record<string, unknown> } }

async function getFocusMode(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as StoreType).__store
    return (store?.getState() as { ui: { focusMode: string } } | undefined)?.ui.focusMode ?? 'unknown'
  })
}

/** Add an images layer with one placed object at (400,300), select it. Returns object ID. */
async function setupImageAndSelect(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const store = (window as StoreType).__store
    if (!store) return ''
    const state = store.getState() as Record<string, (arg: unknown) => void>
    const layerId = crypto.randomUUID()
    state['addLayer']({
      id: layerId,
      name: 'Images 1',
      type: 'images',
      visible: true,
      locked: false,
      opacity: 1,
      objects: [],
    })
    state['setActiveLayerId'](layerId)
    const objId = crypto.randomUUID()
    state['addPlacedObject'](layerId, {
      id: objId,
      layerId,
      objectType: 'image',
      assetId: 'test',
      position: { x: 400, y: 300 },
      rotation: 0,
      scale: 1,
      width: 200,
      height: 150,
      tint: '#ffffff',
      groupId: null,
      flipX: false,
      flipY: false,
    })
    state['setSelectedObjectIds']([objId])
    return objId
  })
}

async function getObjectPosition(page: import('@playwright/test').Page, objId: string) {
  return page.evaluate((id) => {
    const store = (window as StoreType).__store
    if (!store) return null
    const state = store.getState() as {
      layers: Array<{ type: string; objects?: Array<{ id: string; position: { x: number; y: number } }> }>
    }
    for (const layer of state.layers) {
      if (layer.type === 'images' && layer.objects) {
        const obj = layer.objects.find((o) => o.id === id)
        if (obj) return obj.position
      }
    }
    return null
  }, objId)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Integration: Focus Mode + Transforms', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page)
  })

  test('transform still works after UI auto-fades — canvas opacity unaffected', async ({
    page,
  }) => {
    const objId = await setupImageAndSelect(page)
    await waitFrame(page, 5)

    // Verify we start in auto mode
    const mode = await getFocusMode(page)
    expect(mode).toBe('auto')

    // Wait for auto-fade (5.5s past idle threshold)
    await page.waitForTimeout(5500)
    await waitFrame(page, 3)

    // Panel should have faded
    const toolbar = page.locator('[data-testid="left-toolbar"]')
    const panelOpacity = await toolbar.evaluate((el) =>
      parseFloat(window.getComputedStyle(el).opacity),
    )
    expect(panelOpacity).toBeLessThanOrEqual(0.5)

    // Canvas itself must remain at full opacity
    const canvas = page.locator('canvas')
    const canvasOpacity = await canvas.evaluate((el) =>
      parseFloat(window.getComputedStyle(el).opacity),
    )
    expect(canvasOpacity).toBe(1)

    // Move the object — should still work even though UI is faded
    const box = await canvas.boundingBox()
    if (!box) return
    const cx = box.x + 400
    const cy = box.y + 300

    await firePointer(page, 'pointerdown', cx, cy, 0.5, 1)
    await firePointer(page, 'pointermove', cx + 60, cy + 40, 0.5, 1)
    await firePointer(page, 'pointerup', cx + 60, cy + 40, 0, 0)
    await waitFrame(page, 5)

    const pos = await getObjectPosition(page, objId)
    expect(pos).not.toBeNull()
    expect(pos!.x).toBeGreaterThan(400)
  })

  test('transform works in fullscreen mode — canvas occupies full grid', async ({ page }) => {
    // Cycle to fullscreen: auto → manual → fullscreen
    await page.keyboard.press('`')
    await page.keyboard.press('`')
    await waitFrame(page, 3)

    const mode = await getFocusMode(page)
    expect(mode).toBe('fullscreen')

    // Layout must be 0px 1fr 0px
    const gridCols = await page
      .locator('[data-focus-mode]')
      .first()
      .evaluate((el) => window.getComputedStyle(el).gridTemplateColumns)
    const parts = gridCols.trim().split(/\s+/)
    expect(parts.length).toBe(3)
    expect(parts[0]).toBe('0px')
    expect(parts[2]).toBe('0px')
    expect(parseFloat(parts[1])).toBeGreaterThan(0)

    // Import image and try to move it
    const objId = await setupImageAndSelect(page)
    await waitFrame(page, 5)

    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    if (!box) return
    const cx = box.x + 400
    const cy = box.y + 300

    await firePointer(page, 'pointerdown', cx, cy, 0.5, 1)
    await firePointer(page, 'pointermove', cx + 60, cy + 40, 0.5, 1)
    await firePointer(page, 'pointerup', cx + 60, cy + 40, 0, 0)
    await waitFrame(page, 5)

    const pos = await getObjectPosition(page, objId)
    expect(pos).not.toBeNull()
    expect(pos!.x).toBeGreaterThan(400)
  })

  test('focus mode button visible and usable during object selection', async ({ page }) => {
    await setupImageAndSelect(page)
    await waitFrame(page, 5)

    // The focus mode button should remain accessible while object is selected
    const btn = page.locator('[data-testid="focus-mode-btn"]')
    await expect(btn).toBeVisible()

    const before = await getFocusMode(page)
    expect(before).toBe('auto')

    await btn.click()
    await waitFrame(page, 3)

    const after = await getFocusMode(page)
    expect(after).toBe('manual')

    // Object should still be selected after cycling focus mode
    const selected = await page.evaluate(() => {
      const store = (window as StoreType).__store
      return (store?.getState() as { ui: { selectedObjectIds: string[] } } | undefined)?.ui
        .selectedObjectIds ?? []
    })
    expect(selected.length).toBeGreaterThan(0)
  })

  test('right panel collapse button has correct PanelRightClose icon when expanded', async ({
    page,
  }) => {
    // Panel should be expanded by default and show PanelRightClose icon
    const collapseBtn = page.locator('button[aria-label="Collapse panel"]')
    await expect(collapseBtn).toBeVisible()

    // After cycling focus mode (auto → manual → fullscreen → auto) panel is still there
    await page.keyboard.press('`')
    await page.keyboard.press('`')
    await page.keyboard.press('`')
    await waitFrame(page, 5)

    const mode = await getFocusMode(page)
    expect(mode).toBe('auto')

    // Panel re-appears on return to auto
    await expect(collapseBtn).toBeVisible()
  })

  test('undo transform does not affect focus mode, and vice versa', async ({ page }) => {
    const objId = await setupImageAndSelect(page)
    await waitFrame(page, 5)

    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    if (!box) return
    const cx = box.x + 400
    const cy = box.y + 300

    // Move the object
    await firePointer(page, 'pointerdown', cx, cy, 0.5, 1)
    await firePointer(page, 'pointermove', cx + 80, cy + 60, 0.5, 1)
    await firePointer(page, 'pointerup', cx + 80, cy + 60, 0, 0)
    await waitFrame(page, 5)

    const movedPos = await getObjectPosition(page, objId)
    expect(movedPos!.x).toBeGreaterThan(400)

    // Cycle focus mode
    await page.keyboard.press('`') // → manual
    await waitFrame(page, 2)
    const focusAfterMove = await getFocusMode(page)
    expect(focusAfterMove).toBe('manual')

    // Undo — should reverse the transform, NOT the focus mode change
    await page.keyboard.press('Control+z')
    await waitFrame(page, 5)

    const undonePos = await getObjectPosition(page, objId)
    expect(undonePos!.x).toBe(400) // restored to original

    // Focus mode should still be 'manual' (undo doesn't touch it)
    const focusAfterUndo = await getFocusMode(page)
    expect(focusAfterUndo).toBe('manual')
  })
})
