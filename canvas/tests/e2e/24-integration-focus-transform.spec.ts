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

/**
 * A child's on-screen box, in client coordinates.
 *
 * The camera starts at zoom 20 centred on the world origin, so a world position
 * is nowhere near the pixel of the same number — see the same helper in
 * 23-transform-controls for the full story.
 */
async function objectScreenBox(
  page: import('@playwright/test').Page,
  objId: string,
): Promise<{ cx: number; cy: number; w: number; h: number }> {
  const box = await page.evaluate((id) => {
    const store = (window as StoreType).__store
    if (!store) return null
    const state = store.getState() as unknown as {
      layers: Array<{
        children?: Array<{
          id: string
          position: { x: number; y: number }
          width: number
          height: number
        }>
      }>
    }
    const obj = state.layers.flatMap((l) => l.children ?? []).find((c) => c.id === id)
    const app = (
      window as {
        __pixiApp?: {
          stage: { children: Array<{ position: { x: number; y: number }; scale: { x: number } }> }
        }
      }
    ).__pixiApp
    const world = app?.stage.children[0]
    const canvas = document.querySelector('canvas')
    if (!obj || !world || !canvas) return null
    const rect = canvas.getBoundingClientRect()
    const zoom = world.scale.x
    return {
      cx: rect.left + world.position.x + obj.position.x * zoom,
      cy: rect.top + world.position.y + obj.position.y * zoom,
      w: obj.width * zoom,
      h: obj.height * zoom,
    }
  }, objId)
  if (!box) throw new Error(`no on-screen box for child ${objId}`)
  return box
}

/**
 * Place one 4×3 asset child on the world origin of the dungeon layer and select
 * it by clicking, which is what makes the select tool build its gizmo.
 * Returns the child ID. There is no 'images' layer type — assets are children.
 */
async function setupImageAndSelect(page: import('@playwright/test').Page): Promise<string> {
  const objId = await page.evaluate(() => {
    const store = (window as StoreType).__store
    if (!store) return ''
    const state = store.getState() as unknown as Record<string, (...args: unknown[]) => void> & {
      layers: Array<{ id: string; type: string }>
    }
    const layerId = state.layers.find((l) => l.type === 'dungeon')?.id
    if (!layerId) return ''
    state['setActiveLayerId'](layerId)
    const objId = crypto.randomUUID()
    state['addChild'](layerId, {
      id: objId,
      name: 'Test Image',
      childType: 'asset',
      visible: true,
      objectType: 'image',
      assetId: 'test',
      position: { x: 0, y: 0 },
      rotation: 0,
      scale: 1,
      width: 4,
      height: 3,
      tint: '#ffffff',
      flipX: false,
      flipY: false,
    })
    state['setActiveTool']('select')
    return objId
  })
  await waitFrame(page, 5)
  const { cx, cy } = await objectScreenBox(page, objId)
  await firePointer(page, 'pointerdown', cx, cy, 0.5, 1)
  await firePointer(page, 'pointerup', cx, cy, 0, 0)
  await waitFrame(page, 5)
  return objId
}

async function getObjectPosition(page: import('@playwright/test').Page, objId: string) {
  return page.evaluate((id) => {
    const store = (window as StoreType).__store
    if (!store) return null
    const state = store.getState() as {
      layers: Array<{ children?: Array<{ id: string; childType: string; position: { x: number; y: number } }> }>
    }
    for (const layer of state.layers) {
      const obj = (layer.children ?? []).find((c) => c.id === id && c.childType === 'asset')
      if (obj) return obj.position
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
    const startPos = await getObjectPosition(page, objId)
    const { cx, cy } = await objectScreenBox(page, objId)

    await firePointer(page, 'pointerdown', cx, cy, 0.5, 1)
    await firePointer(page, 'pointermove', cx + 60, cy + 40, 0.5, 1)
    await firePointer(page, 'pointerup', cx + 60, cy + 40, 0, 0)
    await waitFrame(page, 5)

    const pos = await getObjectPosition(page, objId)
    expect(pos).not.toBeNull()
    expect(pos!.x).toBeGreaterThan(startPos!.x)
  })

  test('transform works in fullscreen mode — canvas fills the viewport', async ({ page }) => {
    // Cycle to fullscreen: auto → manual → fullscreen
    await page.keyboard.press('`')
    await page.keyboard.press('`')
    await waitFrame(page, 3)

    const mode = await getFocusMode(page)
    expect(mode).toBe('fullscreen')

    // The chrome is unmounted in fullscreen and the canvas covers the viewport.
    // This used to read `grid-template-columns` off the shell and expect
    // `0px 1fr 0px`; the shell has not been a grid since the panels became
    // absolute overlays, so it was measuring a property nothing sets.
    await expect(page.locator('[data-testid="left-toolbar"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="maps-panel"]')).toHaveCount(0)

    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()
    const viewport = page.viewportSize()!
    expect(box!.width).toBeGreaterThanOrEqual(viewport.width - 1)
    expect(box!.height).toBeGreaterThanOrEqual(viewport.height - 1)

    // Import image and try to move it
    const objId = await setupImageAndSelect(page)
    await waitFrame(page, 5)

    const startPos = await getObjectPosition(page, objId)
    const { cx, cy } = await objectScreenBox(page, objId)

    await firePointer(page, 'pointerdown', cx, cy, 0.5, 1)
    await firePointer(page, 'pointermove', cx + 60, cy + 40, 0.5, 1)
    await firePointer(page, 'pointerup', cx + 60, cy + 40, 0, 0)
    await waitFrame(page, 5)

    const pos = await getObjectPosition(page, objId)
    expect(pos).not.toBeNull()
    expect(pos!.x).toBeGreaterThan(startPos!.x)
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
      return (store?.getState() as { selection: { selectedIds: string[] } } | undefined)?.selection
        .selectedIds ?? []
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

    const startPos = await getObjectPosition(page, objId)
    const { cx, cy } = await objectScreenBox(page, objId)

    // Move the object
    await firePointer(page, 'pointerdown', cx, cy, 0.5, 1)
    await firePointer(page, 'pointermove', cx + 80, cy + 60, 0.5, 1)
    await firePointer(page, 'pointerup', cx + 80, cy + 60, 0, 0)
    await waitFrame(page, 5)

    const movedPos = await getObjectPosition(page, objId)
    expect(movedPos!.x).toBeGreaterThan(startPos!.x)

    // Cycle focus mode
    await page.keyboard.press('`') // → manual
    await waitFrame(page, 2)
    const focusAfterMove = await getFocusMode(page)
    expect(focusAfterMove).toBe('manual')

    // Undo — should reverse the transform, NOT the focus mode change
    await page.keyboard.press('Control+z')
    await waitFrame(page, 5)

    const undonePos = await getObjectPosition(page, objId)
    expect(undonePos!.x).toBe(startPos!.x) // restored to original

    // Focus mode should still be 'manual' (undo doesn't touch it)
    const focusAfterUndo = await getFocusMode(page)
    expect(focusAfterUndo).toBe('manual')
  })
})
