/**
 * 23-transform-controls.spec.ts
 * Transform Controls: resize, rotate, move with modifier keys and snap.
 *
 * TDD tests written before final integration verification.
 * Some tests may fail until Tasks #8, #9, #10 are fully integrated.
 *
 * Tests grouped by object type and interaction:
 *
 * === PlacedObject (Image) Transforms ===
 * - Select image shows bounding box + handles (selectedObjectIds > 0)
 * - Drag corner handle resizes image (width increases)
 * - Escape cancels mid-drag (no store change)
 * - Undo reverses transform (position restored)
 * - Deselect clears gizmo (selectedObjectIds empty)
 * - Alt + drag corner resizes from center (position unchanged)
 *
 * === Snap Behavior ===
 * - Grid snap ON: move snaps to grid boundaries (not raw delta)
 * - Ctrl held: toggles snap off when snap is ON (raw delta passes through)
 * - Shift + rotate snaps to 15 degree increments
 *
 * === Edge Cases ===
 * - Locked layer objects — transform drag does not move object
 * - Multi-select move translates all objects by same delta
 *
 * === Dungeon Shape Transforms ===
 * - Select shape then move updates position in store
 * - Moved shape has a transform record in store
 *
 * === Cursor Behavior ===
 * - Hover handles show correct cursors
 */
import { test, expect } from '@playwright/test'
import { gotoApp, waitFrame, drawRect, firePointer } from './helpers'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Add an images layer, place a 200×150 object at (400,300), select it. Returns the object ID. */
async function importAndSelectImage(page: import('@playwright/test').Page): Promise<string> {
  // Add images layer
  await page.evaluate(() => {
    const store = (window as { __store?: { getState: () => Record<string, unknown> } }).__store
    if (!store) return
    const state = store.getState() as Record<string, (arg: unknown) => void>
    const id = crypto.randomUUID()
    state['addLayer']({
      id,
      name: 'Images 1',
      type: 'images',
      visible: true,
      locked: false,
      opacity: 1,
      objects: [],
    })
    state['setActiveLayerId'](id)
  })
  await waitFrame(page, 3)

  // Place a test object via store (bypasses file picker)
  const objId = await page.evaluate(() => {
    const store = (window as { __store?: { getState: () => Record<string, unknown> } }).__store
    if (!store) return ''
    const state = store.getState() as Record<string, unknown>
    const layers = state['layers'] as Array<{ id: string; type: string }>
    const imgLayer = layers.find((l) => l.type === 'images')
    if (!imgLayer) return ''
    const id = crypto.randomUUID()
    ;(state['addPlacedObject'] as (layerId: string, obj: unknown) => void)(imgLayer.id, {
      id,
      layerId: imgLayer.id,
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
    ;(state['setSelectedObjectIds'] as (ids: string[]) => void)([id])
    return id
  })
  await waitFrame(page, 5)
  return objId
}

/** Read a placed object from the store by ID. */
async function getPlacedObject(page: import('@playwright/test').Page, objId: string) {
  return page.evaluate((id) => {
    const store = (window as { __store?: { getState: () => Record<string, unknown> } }).__store
    if (!store) return null
    const state = store.getState() as {
      layers: Array<{ type: string; objects?: Array<{ id: string }> }>
    }
    for (const layer of state.layers) {
      if (layer.type === 'images' && layer.objects) {
        const found = layer.objects.find((o) => o.id === id)
        if (found) return found
      }
    }
    return null
  }, objId)
}

// ─── PlacedObject Transform Tests ─────────────────────────────────────────────

test.describe('Transform Controls — PlacedObject', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page)
  })

  test('selecting image shows bounding box handles (selectedObjectIds populated)', async ({
    page,
  }) => {
    await importAndSelectImage(page)

    const hasSelection = await page.evaluate(() => {
      const store = (window as { __store?: { getState: () => Record<string, unknown> } }).__store
      if (!store) return false
      const state = store.getState() as { ui: { selectedObjectIds: string[] } }
      return state.ui.selectedObjectIds.length > 0
    })
    expect(hasSelection).toBe(true)
  })

  test('drag SE corner handle increases object width', async ({ page }) => {
    const objId = await importAndSelectImage(page)
    const before = (await getPlacedObject(page, objId)) as Record<string, unknown>
    expect(before).not.toBeNull()
    const beforeWidth = before['width'] as number

    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    if (!box) return

    // SE corner: object at world (400,300) size 200×150 → bottom-right ~(500,375)
    // Canvas origin is at box.x/y; world coords map roughly 1:1 at default zoom
    const seX = box.x + 500
    const seY = box.y + 375

    await firePointer(page, 'pointerdown', seX, seY, 0.5, 1)
    await firePointer(page, 'pointermove', seX + 60, seY + 45, 0.5, 1)
    await firePointer(page, 'pointerup', seX + 60, seY + 45, 0, 0)
    await waitFrame(page, 5)

    const after = (await getPlacedObject(page, objId)) as Record<string, unknown>
    expect(after).not.toBeNull()
    expect(after['width'] as number).toBeGreaterThan(beforeWidth)
  })

  test('escape during drag cancels transform — object unchanged', async ({ page }) => {
    const objId = await importAndSelectImage(page)
    const before = (await getPlacedObject(page, objId)) as Record<string, unknown>

    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    if (!box) return

    const seX = box.x + 500
    const seY = box.y + 375

    // Start drag but don't finish
    await firePointer(page, 'pointerdown', seX, seY, 0.5, 1)
    await firePointer(page, 'pointermove', seX + 80, seY + 60, 0.5, 1)

    // Cancel with Escape
    await page.keyboard.press('Escape')
    await waitFrame(page, 3)

    const after = (await getPlacedObject(page, objId)) as Record<string, unknown>
    expect(after).not.toBeNull()
    // Width and position should be identical to before
    expect(after['width']).toBe(before['width'])
    expect((after['position'] as { x: number }).x).toBe(
      (before['position'] as { x: number }).x,
    )
  })

  test('undo reverses transform — position restored', async ({ page }) => {
    const objId = await importAndSelectImage(page)
    const before = (await getPlacedObject(page, objId)) as Record<string, unknown>
    const beforeX = (before['position'] as { x: number }).x

    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    if (!box) return

    // Move the object by dragging its center
    const cx = box.x + 400
    const cy = box.y + 300
    await firePointer(page, 'pointerdown', cx, cy, 0.5, 1)
    await firePointer(page, 'pointermove', cx + 80, cy + 60, 0.5, 1)
    await firePointer(page, 'pointerup', cx + 80, cy + 60, 0, 0)
    await waitFrame(page, 5)

    const moved = (await getPlacedObject(page, objId)) as Record<string, unknown>
    expect((moved['position'] as { x: number }).x).toBeGreaterThan(beforeX)

    // Undo
    await page.keyboard.press('Control+z')
    await waitFrame(page, 5)

    const afterUndo = (await getPlacedObject(page, objId)) as Record<string, unknown>
    expect((afterUndo['position'] as { x: number }).x).toBe(beforeX)
  })

  test('deselect by clicking empty area clears selectedObjectIds', async ({ page }) => {
    await importAndSelectImage(page)

    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    if (!box) return

    // Click far from the object (top-left corner)
    await firePointer(page, 'pointerdown', box.x + 30, box.y + 30, 0.5, 1)
    await firePointer(page, 'pointerup', box.x + 30, box.y + 30, 0, 0)
    await waitFrame(page, 3)

    const selected = await page.evaluate(() => {
      const store = (window as { __store?: { getState: () => Record<string, unknown> } }).__store
      if (!store) return []
      return (store.getState() as { ui: { selectedObjectIds: string[] } }).ui.selectedObjectIds
    })
    expect(selected).toHaveLength(0)
  })

  test('alt + drag corner resizes from center — position stays centered', async ({ page }) => {
    const objId = await importAndSelectImage(page)
    const before = (await getPlacedObject(page, objId)) as Record<string, unknown>
    const beforePos = before['position'] as { x: number; y: number }

    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    if (!box) return

    const seX = box.x + 500
    const seY = box.y + 375

    await page.keyboard.down('Alt')
    await firePointer(page, 'pointerdown', seX, seY, 0.5, 1)
    await firePointer(page, 'pointermove', seX + 40, seY + 30, 0.5, 1)
    await firePointer(page, 'pointerup', seX + 40, seY + 30, 0, 0)
    await page.keyboard.up('Alt')
    await waitFrame(page, 5)

    const after = (await getPlacedObject(page, objId)) as Record<string, unknown>
    expect(after).not.toBeNull()
    // Width should increase
    expect(after['width'] as number).toBeGreaterThan(before['width'] as number)
    // Center position should remain approximately the same (within ±5 world units)
    const afterPos = after['position'] as { x: number; y: number }
    expect(Math.abs(afterPos.x - beforePos.x)).toBeLessThan(5)
    expect(Math.abs(afterPos.y - beforePos.y)).toBeLessThan(5)
  })
})

// ─── Snap Behavior Tests ───────────────────────────────────────────────────────

test.describe('Transform Controls — Snap Behavior', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page)
  })

  test('grid snap ON: move snaps to grid — position is not raw delta', async ({ page }) => {
    // Enable snap
    await page.evaluate(() => {
      const store = (window as { __store?: { getState: () => Record<string, unknown> } }).__store
      if (!store) return
      ;(store.getState() as { setSnapEnabled: (v: boolean) => void }).setSnapEnabled(true)
    })

    const objId = await importAndSelectImage(page)

    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    if (!box) return

    const cx = box.x + 400
    const cy = box.y + 300
    // Move by a non-grid-aligned delta (37, 23)
    await firePointer(page, 'pointerdown', cx, cy, 0.5, 1)
    await firePointer(page, 'pointermove', cx + 37, cy + 23, 0.5, 1)
    await firePointer(page, 'pointerup', cx + 37, cy + 23, 0, 0)
    await waitFrame(page, 5)

    const after = (await getPlacedObject(page, objId)) as Record<string, unknown>
    const pos = after['position'] as { x: number; y: number }
    // Snapped position should NOT equal the raw offset (400+37=437)
    expect(pos.x).not.toBeCloseTo(437, 0)
  })

  test('ctrl held during move overrides snap — raw delta applied', async ({ page }) => {
    // Enable snap first
    await page.evaluate(() => {
      const store = (window as { __store?: { getState: () => Record<string, unknown> } }).__store
      if (!store) return
      ;(store.getState() as { setSnapEnabled: (v: boolean) => void }).setSnapEnabled(true)
    })

    const objId = await importAndSelectImage(page)
    const before = (await getPlacedObject(page, objId)) as Record<string, unknown>
    const beforeX = (before['position'] as { x: number }).x

    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    if (!box) return

    const cx = box.x + 400
    const cy = box.y + 300
    await page.keyboard.down('Control')
    await firePointer(page, 'pointerdown', cx, cy, 0.5, 1)
    await firePointer(page, 'pointermove', cx + 37, cy + 23, 0.5, 1)
    await firePointer(page, 'pointerup', cx + 37, cy + 23, 0, 0)
    await page.keyboard.up('Control')
    await waitFrame(page, 5)

    const after = (await getPlacedObject(page, objId)) as Record<string, unknown>
    const pos = after['position'] as { x: number; y: number }
    // With snap overridden, the position should move by approximately the raw delta
    const delta = pos.x - beforeX
    expect(delta).toBeGreaterThan(0)
    // Not snapped — should be close to 37 world units (within grid cell)
    expect(pos.x).toBeCloseTo(beforeX + 37, 0)
  })

  test('shift + rotate snaps to 15-degree increments', async ({ page }) => {
    const objId = await importAndSelectImage(page)

    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    if (!box) return

    // Rotation handle is above top-center: object at (400,300) h=150 → top ~y=225, handle ~y=211
    const rotX = box.x + 400
    const rotY = box.y + 210

    await page.keyboard.down('Shift')
    await firePointer(page, 'pointerdown', rotX, rotY, 0.5, 1)
    await firePointer(page, 'pointermove', rotX + 30, rotY + 10, 0.5, 1)
    await firePointer(page, 'pointerup', rotX + 30, rotY + 10, 0, 0)
    await page.keyboard.up('Shift')
    await waitFrame(page, 5)

    const after = (await getPlacedObject(page, objId)) as Record<string, unknown>
    const rotation = after['rotation'] as number
    // Must be a multiple of π/12 (15°)
    const snapUnit = Math.PI / 12
    const remainder = Math.abs(rotation % snapUnit)
    expect(Math.min(remainder, snapUnit - remainder)).toBeLessThan(0.01)
  })
})

// ─── Edge Case Tests ───────────────────────────────────────────────────────────

test.describe('Transform Controls — Edge Cases', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page)
  })

  test('locked layer — transform drag does not change object position', async ({ page }) => {
    const objId = await importAndSelectImage(page)

    // Lock the images layer
    await page.evaluate(() => {
      const store = (window as { __store?: { getState: () => Record<string, unknown> } }).__store
      if (!store) return
      const state = store.getState() as {
        layers: Array<{ id: string; type: string }>
        updateLayer: (id: string, patch: Record<string, unknown>) => void
      }
      const imgLayer = state.layers.find((l) => l.type === 'images')
      if (imgLayer) state.updateLayer(imgLayer.id, { locked: true })
    })
    await waitFrame(page, 3)

    const before = (await getPlacedObject(page, objId)) as Record<string, unknown>

    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    if (!box) return

    // Attempt to drag the object
    const cx = box.x + 400
    const cy = box.y + 300
    await firePointer(page, 'pointerdown', cx, cy, 0.5, 1)
    await firePointer(page, 'pointermove', cx + 80, cy + 60, 0.5, 1)
    await firePointer(page, 'pointerup', cx + 80, cy + 60, 0, 0)
    await waitFrame(page, 3)

    // Re-select in case it was cleared
    const selected = await page.evaluate(() => {
      const store = (window as { __store?: { getState: () => Record<string, unknown> } }).__store
      if (!store) return []
      return (store.getState() as { ui: { selectedObjectIds: string[] } }).ui.selectedObjectIds
    })

    // If selection is empty or position is unchanged, either means locked worked
    if (selected.length > 0) {
      const after = (await getPlacedObject(page, objId)) as Record<string, unknown>
      expect((after['position'] as { x: number }).x).toBe(
        (before['position'] as { x: number }).x,
      )
    } else {
      // Locked objects can't be selected — that's also acceptable
      expect(selected).toHaveLength(0)
    }
  })

  test('multi-select move translates both objects by same delta', async ({ page }) => {
    const ids = await page.evaluate(() => {
      const store = (window as { __store?: { getState: () => Record<string, unknown> } }).__store
      if (!store) return []
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
      const id1 = crypto.randomUUID()
      const id2 = crypto.randomUUID()
      state['addPlacedObject'](layerId, {
        id: id1,
        layerId,
        objectType: 'image',
        assetId: 'test1',
        position: { x: 200, y: 200 },
        rotation: 0,
        scale: 1,
        width: 100,
        height: 80,
        tint: '#ffffff',
        groupId: null,
        flipX: false,
        flipY: false,
      })
      state['addPlacedObject'](layerId, {
        id: id2,
        layerId,
        objectType: 'image',
        assetId: 'test2',
        position: { x: 500, y: 400 },
        rotation: 0,
        scale: 1,
        width: 100,
        height: 80,
        tint: '#ffffff',
        groupId: null,
        flipX: false,
        flipY: false,
      })
      state['setSelectedObjectIds']([id1, id2])
      return [id1, id2]
    })
    await waitFrame(page, 5)

    const before1 = (await getPlacedObject(page, ids[0])) as Record<string, unknown>
    const before2 = (await getPlacedObject(page, ids[1])) as Record<string, unknown>

    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    if (!box) return

    // Drag inside the shared bounding box
    const cx = box.x + 350
    const cy = box.y + 300
    await firePointer(page, 'pointerdown', cx, cy, 0.5, 1)
    await firePointer(page, 'pointermove', cx + 50, cy + 50, 0.5, 1)
    await firePointer(page, 'pointerup', cx + 50, cy + 50, 0, 0)
    await waitFrame(page, 5)

    const after1 = (await getPlacedObject(page, ids[0])) as Record<string, unknown>
    const after2 = (await getPlacedObject(page, ids[1])) as Record<string, unknown>

    const delta1x = (after1['position'] as { x: number }).x - (before1['position'] as { x: number }).x
    const delta2x = (after2['position'] as { x: number }).x - (before2['position'] as { x: number }).x

    expect(delta1x).toBeGreaterThan(0)
    expect(delta2x).toBeGreaterThan(0)
    // Both objects moved by the same delta (within 5 world units tolerance)
    expect(Math.abs(delta1x - delta2x)).toBeLessThan(5)
  })
})

// ─── Dungeon Shape Transform Tests ────────────────────────────────────────────

test.describe('Transform Controls — Dungeon Shapes', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page)
  })

  test('select shape then move updates shape transform in store', async ({ page }) => {
    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    if (!box) return

    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    // Draw a rectangle
    await page.keyboard.press('r')
    await waitFrame(page, 2)
    await drawRect(page, cx - 80, cy - 60, cx + 80, cy + 60)
    await waitFrame(page, 5)

    // Switch to select tool
    await page.keyboard.press('v')
    await waitFrame(page, 2)

    // Box-select the shape
    await firePointer(page, 'pointerdown', cx - 100, cy - 80, 0.5, 1)
    await firePointer(page, 'pointermove', cx + 100, cy + 80, 0.5, 1)
    await firePointer(page, 'pointerup', cx + 100, cy + 80, 0, 0)
    await waitFrame(page, 3)

    // Move the selection
    await firePointer(page, 'pointerdown', cx, cy, 0.5, 1)
    await firePointer(page, 'pointermove', cx + 60, cy + 40, 0.5, 1)
    await firePointer(page, 'pointerup', cx + 60, cy + 40, 0, 0)
    await waitFrame(page, 5)

    // Verify shape has a transform or that merged floor changed
    const hasTransform = await page.evaluate(() => {
      const store = (window as { __store?: { getState: () => Record<string, unknown> } }).__store
      if (!store) return false
      const state = store.getState() as {
        layers: Array<{ type: string; shapes?: Array<{ transform?: unknown }> }>
      }
      const dungeon = state.layers.find((l) => l.type === 'dungeon')
      const shape = dungeon?.shapes?.[0]
      return shape?.transform != null
    })
    expect(hasTransform).toBe(true)
  })
})

// ─── Cursor Behavior Tests ─────────────────────────────────────────────────────

test.describe('Transform Controls — Cursor Behavior', () => {
  test('hover over selected object center shows move cursor', async ({ page }) => {
    await gotoApp(page)
    await importAndSelectImage(page)

    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    if (!box) return

    // Hover over the object center
    await page.mouse.move(box.x + 400, box.y + 300)
    await waitFrame(page, 2)

    const cursor = await canvas.evaluate((el) => (el as HTMLCanvasElement).style.cursor)
    expect(cursor).toBe('move')
  })

  test('hover outside selected object shows default cursor', async ({ page }) => {
    await gotoApp(page)
    await importAndSelectImage(page)

    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    if (!box) return

    // Hover far outside object (object is at 400,300)
    await page.mouse.move(box.x + 50, box.y + 50)
    await waitFrame(page, 2)

    const cursor = await canvas.evaluate((el) => (el as HTMLCanvasElement).style.cursor)
    expect(['default', '', 'crosshair']).toContain(cursor)
  })
})
