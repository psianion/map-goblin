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

/**
 * A child's on-screen box, in client coordinates.
 *
 * The gizmo lays its handles out in screen space, so every pointer coordinate in
 * this file has to come from the live camera rather than from the child's world
 * position. They used to be the same number — "world coords map roughly 1:1 at
 * default zoom" — which has not been true since the camera started at zoom 20
 * centred on the origin. An object at world (400,300) sits eight thousand pixels
 * off the right edge, so every drag below landed on empty canvas and every
 * assertion about the object not having moved passed for the wrong reason.
 */
async function objectScreenBox(
  page: import('@playwright/test').Page,
  objId: string,
): Promise<{ cx: number; cy: number; w: number; h: number; zoom: number }> {
  const box = await page.evaluate((id) => {
    const store = (window as { __store?: { getState: () => Record<string, unknown> } }).__store
    if (!store) return null
    const state = store.getState() as {
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
    if (!obj) return null
    const app = (
      window as {
        __pixiApp?: {
          stage: { children: Array<{ position: { x: number; y: number }; scale: { x: number } }> }
        }
      }
    ).__pixiApp
    const world = app?.stage.children[0]
    const canvas = document.querySelector('canvas')
    if (!world || !canvas) return null
    const rect = canvas.getBoundingClientRect()
    const zoom = world.scale.x
    return {
      cx: rect.left + world.position.x + obj.position.x * zoom,
      cy: rect.top + world.position.y + obj.position.y * zoom,
      w: obj.width * zoom,
      h: obj.height * zoom,
      zoom,
    }
  }, objId)
  if (!box) throw new Error(`no on-screen box for child ${objId}`)
  return box
}

/**
 * Place a 4×3 (world units) asset child on the origin of the dungeon layer and
 * select it. Returns the child ID. There is no 'images' layer type and no
 * addPlacedObject/setSelectedObjectIds action — assets are layer children.
 *
 * Origin-sized on purpose: the camera starts centred there at zoom 20, so the
 * object lands in the middle of the viewport at a workable 80×60 px.
 */
async function importAndSelectImage(page: import('@playwright/test').Page): Promise<string> {
  const objId = await page.evaluate(() => {
    const store = (window as { __store?: { getState: () => Record<string, unknown> } }).__store
    if (!store) return ''
    const state = store.getState() as Record<string, unknown>
    const layers = state['layers'] as Array<{ id: string; type: string }>
    const layer = layers.find((l) => l.type === 'dungeon')
    if (!layer) return ''
    ;(state['setActiveLayerId'] as (id: string) => void)(layer.id)
    const id = crypto.randomUUID()
    ;(state['addChild'] as (layerId: string, child: unknown) => void)(layer.id, {
      id,
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
    // The gizmo belongs to the select tool. Without this the pointer lands on
    // whatever tool booted active, and every drag below draws instead of
    // transforming.
    ;(state['setActiveTool'] as (t: string) => void)('select')
    return id
  })
  await waitFrame(page, 5)

  // Select by clicking it, not by writing `selectedIds`. The select tool builds
  // its gizmo when *it* makes a selection; a store write leaves the tool IDLE
  // with no handles to grab, which is why these drags used to do nothing.
  const { cx, cy } = await objectScreenBox(page, objId)
  await firePointer(page, 'pointerdown', cx, cy, 0.5, 1)
  await firePointer(page, 'pointerup', cx, cy, 0, 0)
  await waitFrame(page, 5)
  return objId
}

/** Read a placed asset child from the store by ID. */
async function getPlacedObject(page: import('@playwright/test').Page, objId: string) {
  return page.evaluate((id) => {
    const store = (window as { __store?: { getState: () => Record<string, unknown> } }).__store
    if (!store) return null
    const state = store.getState() as {
      layers: Array<{ children?: Array<{ id: string; childType: string }> }>
    }
    for (const layer of state.layers) {
      const found = (layer.children ?? []).find((c) => c.id === id && c.childType === 'asset')
      if (found) return found
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
      const state = store.getState() as { selection: { selectedIds: string[] } }
      return state.selection.selectedIds.length > 0
    })
    expect(hasSelection).toBe(true)
  })

  test('drag SE corner handle increases object width', async ({ page }) => {
    // A resize scales the child rather than rewriting `width`: an asset carries
    // one scalar `scale` on top of its authored size (childTransform's 'box'
    // case), so `width` alone never moves and asserting on it always failed.
    const objId = await importAndSelectImage(page)
    const before = (await getPlacedObject(page, objId)) as Record<string, unknown>
    expect(before).not.toBeNull()
    const beforeWidth = (before['width'] as number) * (before['scale'] as number)

    const sb = await objectScreenBox(page, objId)
    const seX = sb.cx + sb.w / 2
    const seY = sb.cy + sb.h / 2

    await firePointer(page, 'pointerdown', seX, seY, 0.5, 1)
    await firePointer(page, 'pointermove', seX + 60, seY + 45, 0.5, 1)
    await firePointer(page, 'pointerup', seX + 60, seY + 45, 0, 0)
    await waitFrame(page, 5)

    const after = (await getPlacedObject(page, objId)) as Record<string, unknown>
    expect(after).not.toBeNull()
    expect((after['width'] as number) * (after['scale'] as number)).toBeGreaterThan(beforeWidth)
  })

  test('escape during drag cancels transform — object unchanged', async ({ page }) => {
    const objId = await importAndSelectImage(page)
    const before = (await getPlacedObject(page, objId)) as Record<string, unknown>

    const sb = await objectScreenBox(page, objId)
    const seX = sb.cx + sb.w / 2
    const seY = sb.cy + sb.h / 2

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

    // Move the object by dragging its center
    const { cx, cy } = await objectScreenBox(page, objId)
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
    const objId = await importAndSelectImage(page)

    // Click well clear of the object and its handles
    const sb = await objectScreenBox(page, objId)
    const awayX = sb.cx - sb.w * 3
    const awayY = sb.cy - sb.h * 3
    await firePointer(page, 'pointerdown', awayX, awayY, 0.5, 1)
    await firePointer(page, 'pointerup', awayX, awayY, 0, 0)
    await waitFrame(page, 3)

    const selected = await page.evaluate(() => {
      const store = (window as { __store?: { getState: () => Record<string, unknown> } }).__store
      if (!store) return []
      return (store.getState() as { selection: { selectedIds: string[] } }).selection.selectedIds
    })
    expect(selected).toHaveLength(0)
  })

  test('alt + drag corner resizes from center — position stays centered', async ({ page }) => {
    const objId = await importAndSelectImage(page)
    const before = (await getPlacedObject(page, objId)) as Record<string, unknown>
    const beforePos = before['position'] as { x: number; y: number }

    const sb = await objectScreenBox(page, objId)
    const seX = sb.cx + sb.w / 2
    const seY = sb.cy + sb.h / 2

    const alt = { alt: true }
    await firePointer(page, 'pointerdown', seX, seY, 0.5, 1, alt)
    await firePointer(page, 'pointermove', seX + 40, seY + 30, 0.5, 1, alt)
    await firePointer(page, 'pointerup', seX + 40, seY + 30, 0, 0, alt)
    await waitFrame(page, 5)

    const after = (await getPlacedObject(page, objId)) as Record<string, unknown>
    expect(after).not.toBeNull()
    // Rendered width should increase — the scale is what a resize moves
    expect((after['width'] as number) * (after['scale'] as number)).toBeGreaterThan(
      (before['width'] as number) * (before['scale'] as number),
    )
    // Center position should stay put (within a quarter of a world cell)
    const afterPos = after['position'] as { x: number; y: number }
    expect(Math.abs(afterPos.x - beforePos.x)).toBeLessThan(0.25)
    expect(Math.abs(afterPos.y - beforePos.y)).toBeLessThan(0.25)
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
    const before = (await getPlacedObject(page, objId)) as Record<string, unknown>
    const beforeX = (before['position'] as { x: number }).x

    const { cx, cy, zoom } = await objectScreenBox(page, objId)
    // Move by a delta that lands between grid divisions: 37px at zoom 20 is
    // 1.85 cells.
    const rawDeltaX = 37 / zoom
    await firePointer(page, 'pointerdown', cx, cy, 0.5, 1)
    await firePointer(page, 'pointermove', cx + 37, cy + 23, 0.5, 1)
    await firePointer(page, 'pointerup', cx + 37, cy + 23, 0, 0)
    await waitFrame(page, 5)

    const after = (await getPlacedObject(page, objId)) as Record<string, unknown>
    const pos = after['position'] as { x: number; y: number }
    // Snapped position should NOT be the raw offset
    expect(Math.abs(pos.x - (beforeX + rawDeltaX))).toBeGreaterThan(0.1)
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

    const { cx, cy, zoom } = await objectScreenBox(page, objId)
    const rawDeltaX = 37 / zoom
    const ctrl = { ctrl: true }
    await firePointer(page, 'pointerdown', cx, cy, 0.5, 1, ctrl)
    await firePointer(page, 'pointermove', cx + 37, cy + 23, 0.5, 1, ctrl)
    await firePointer(page, 'pointerup', cx + 37, cy + 23, 0, 0, ctrl)
    await waitFrame(page, 5)

    const after = (await getPlacedObject(page, objId)) as Record<string, unknown>
    const pos = after['position'] as { x: number; y: number }
    // With snap overridden, the position should move by the raw delta
    const delta = pos.x - beforeX
    expect(delta).toBeGreaterThan(0)
    expect(Math.abs(delta - rawDeltaX)).toBeLessThan(0.1)
  })

  test('shift + rotate snaps to 15-degree increments', async ({ page }) => {
    const objId = await importAndSelectImage(page)

    // Rotation handle sits on a 14px stem above the top edge of the gizmo box.
    const sb = await objectScreenBox(page, objId)
    const rotX = sb.cx
    const rotY = sb.cy - sb.h / 2 - 14

    const shift = { shift: true }
    await firePointer(page, 'pointerdown', rotX, rotY, 0.5, 1, shift)
    await firePointer(page, 'pointermove', rotX + 30, rotY + 10, 0.5, 1, shift)
    await firePointer(page, 'pointerup', rotX + 30, rotY + 10, 0, 0, shift)
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
      const imgLayer = state.layers.find((l) => l.type === 'dungeon')
      if (imgLayer) state.updateLayer(imgLayer.id, { locked: true })
    })
    await waitFrame(page, 3)

    const before = (await getPlacedObject(page, objId)) as Record<string, unknown>

    // Attempt to drag the object
    const { cx, cy } = await objectScreenBox(page, objId)
    await firePointer(page, 'pointerdown', cx, cy, 0.5, 1)
    await firePointer(page, 'pointermove', cx + 80, cy + 60, 0.5, 1)
    await firePointer(page, 'pointerup', cx + 80, cy + 60, 0, 0)
    await waitFrame(page, 3)

    // Whether the drag was refused or the selection was dropped, the object
    // on a locked layer must not have moved.
    const after = (await getPlacedObject(page, objId)) as Record<string, unknown>
    expect((after['position'] as { x: number }).x).toBe(
      (before['position'] as { x: number }).x,
    )
  })

  test('multi-select move translates both objects by same delta', async ({ page }) => {
    const ids = await page.evaluate(() => {
      const store = (window as { __store?: { getState: () => Record<string, unknown> } }).__store
      if (!store) return []
      const s = store.getState() as unknown as Record<string, (...args: unknown[]) => void> & {
        layers: Array<{ id: string; type: string }>
      }
      const layerId = s.layers.find((l) => l.type === 'dungeon')?.id
      if (!layerId) return []
      s['setActiveLayerId'](layerId)
      const id1 = crypto.randomUUID()
      const id2 = crypto.randomUUID()
      s['addChild'](layerId, {
        id: id1,
        name: 'Test Image 1',
        childType: 'asset',
        visible: true,
        objectType: 'image',
        assetId: 'test1',
        position: { x: -3, y: -2 },
        rotation: 0,
        scale: 1,
        width: 2,
        height: 1.6,
        tint: '#ffffff',
        flipX: false,
        flipY: false,
      })
      s['addChild'](layerId, {
        id: id2,
        name: 'Test Image 2',
        childType: 'asset',
        visible: true,
        objectType: 'image',
        assetId: 'test2',
        position: { x: 3, y: 2 },
        rotation: 0,
        scale: 1,
        width: 2,
        height: 1.6,
        tint: '#ffffff',
        flipX: false,
        flipY: false,
      })
      s['setActiveTool']('select')
      return [id1, id2]
    })
    await waitFrame(page, 5)

    // Select both through the tool — click one, shift-click the other — so the
    // gizmo exists and spans them.
    const first = await objectScreenBox(page, ids[0])
    await firePointer(page, 'pointerdown', first.cx, first.cy, 0.5, 1)
    await firePointer(page, 'pointerup', first.cx, first.cy, 0, 0)
    await waitFrame(page, 3)
    const second = await objectScreenBox(page, ids[1])
    await firePointer(page, 'pointerdown', second.cx, second.cy, 0.5, 1, { shift: true })
    await firePointer(page, 'pointerup', second.cx, second.cy, 0, 0, { shift: true })
    await waitFrame(page, 5)

    const before1 = (await getPlacedObject(page, ids[0])) as Record<string, unknown>
    const before2 = (await getPlacedObject(page, ids[1])) as Record<string, unknown>

    // Drag inside the shared bounding box — the two objects straddle the world
    // origin, so its midpoint is the centre of the first object's box shifted
    // halfway to the second.
    const a = await objectScreenBox(page, ids[0])
    const b = await objectScreenBox(page, ids[1])
    const cx = (a.cx + b.cx) / 2
    const cy = (a.cy + b.cy) / 2
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
    // Both objects moved by the same delta
    expect(Math.abs(delta1x - delta2x)).toBeLessThan(0.1)
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

    const minRingX = await page.evaluate(() => {
      const store = (window as { __store?: { getState: () => Record<string, unknown> } }).__store
      const state = store!.getState() as {
        layers: Array<{
          type: string
          children?: Array<{ childType: string; contours?: [number, number][][] }>
        }>
      }
      const dungeon = state.layers.find((l) => l.type === 'dungeon')
      const shape = (dungeon?.children ?? []).find((c) => c.childType === 'shape')
      return Math.min(...(shape?.contours?.[0] ?? [[0, 0]]).map(([x]) => x))
    })

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

    // A move bakes itself into the rings and clears any stored transform
    // (childTransform.transformChild), so the rings are what moved. This used to
    // look for a leftover `transform` record, which is the one thing a completed
    // move is guaranteed *not* to leave behind.
    const movedBy = await page.evaluate((x0) => {
      const store = (window as { __store?: { getState: () => Record<string, unknown> } }).__store
      if (!store) return null
      const state = store.getState() as {
        layers: Array<{
          type: string
          children?: Array<{ childType: string; contours?: [number, number][][] }>
        }>
      }
      const dungeon = state.layers.find((l) => l.type === 'dungeon')
      const shape = (dungeon?.children ?? []).find((c) => c.childType === 'shape')
      const ring = shape?.contours?.[0]
      if (!ring) return null
      return Math.min(...ring.map(([x]) => x)) - x0
    }, minRingX)
    expect(movedBy).not.toBeNull()
    expect(movedBy!).toBeGreaterThan(0)
  })
})

// ─── Cursor Behavior Tests ─────────────────────────────────────────────────────

test.describe('Transform Controls — Cursor Behavior', () => {
  test('hover over selected object center shows move cursor', async ({ page }) => {
    await gotoApp(page)
    const objId = await importAndSelectImage(page)

    const canvas = page.locator('canvas')
    const { cx, cy } = await objectScreenBox(page, objId)

    // Hover over the object center
    await page.mouse.move(cx, cy)
    await waitFrame(page, 2)

    const cursor = await canvas.evaluate((el) => (el as HTMLCanvasElement).style.cursor)
    expect(cursor).toBe('move')
  })

  test('hover outside selected object shows default cursor', async ({ page }) => {
    await gotoApp(page)
    const objId = await importAndSelectImage(page)

    const canvas = page.locator('canvas')
    const sb = await objectScreenBox(page, objId)

    // Hover well clear of the object and its handles
    await page.mouse.move(sb.cx - sb.w * 3, sb.cy - sb.h * 3)
    await waitFrame(page, 2)

    const cursor = await canvas.evaluate((el) => (el as HTMLCanvasElement).style.cursor)
    expect(['default', '', 'crosshair']).toContain(cursor)
  })
})
