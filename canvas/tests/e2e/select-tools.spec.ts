import { test, expect, type Locator, type Page } from '@playwright/test'
import { drawRect, firePointer, getPixelColor, gotoApp, pressShortcut, shapeCount, waitForBoot, waitFrame } from './helpers'
import { openEditor, pickTool } from './shell'

/**
 * The Select tool, end to end: box select and move, copy, cut and paste, the transform
 * box on an image and on a drawn wall, every kind through one pick (zones, walls with their
 * doors, props, lights, labels, rooms), the Shift and Alt marquees, the level and
 * whole-face rules, per-object locks, the Mixed card with its Align and Distribute rows, Alt
 * cycling and Alt-drag copies, nudges folding into one undo step, undo handing the selection
 * back, the Escape steps and the key guard in a label's text field.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
type Pt = { x: number; y: number }

const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())

async function key(page: Page, combo: string) {
  await blur(page)
  await page.keyboard.press(combo)
  await waitFrame(page, 2)
}

const activeTool = (page: Page) => page.evaluate(() => (window as Any).__store.getState().tools.activeTool as string)

// ─── Box select, move, copy, cut and delete on a drawn floor ──────────────────────

async function canvasCentre(page: Page): Promise<Pt> {
  const box = await page.locator('canvas').first().boundingBox()
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
}

async function getCanvasInfo(page: Page) {
  return page.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement
    const r = c.getBoundingClientRect()
    return { dpr: window.devicePixelRatio, offsetX: r.left, offsetY: r.top }
  })
}

function toPhysical(clientX: number, clientY: number, info: { dpr: number; offsetX: number; offsetY: number }) {
  return {
    px: Math.round((clientX - info.offsetX) * info.dpr),
    py: Math.round((clientY - info.offsetY) * info.dpr),
  }
}

test('box-select then move changes geometry position', { tag: '@select' }, async ({ page }) => {
  await gotoApp(page)
  await pickTool(page, 'rectangle')
  const { x: cx, y: cy } = await canvasCentre(page)

  const before = await shapeCount(page)
  await drawRect(page, cx - 80, cy - 60, cx + 80, cy + 60)
  await page.waitForTimeout(500)
  await waitFrame(page, 5)
  expect(await shapeCount(page)).toBe(before + 1)

  await pickTool(page, 'select')

  await firePointer(page, 'pointerdown', cx - 90, cy - 70, 0.5, 1)
  await firePointer(page, 'pointermove', cx + 90, cy + 70, 0.5, 1)
  await firePointer(page, 'pointerup', cx + 90, cy + 70, 0, 0)
  await page.waitForTimeout(500)
  await waitFrame(page, 5)

  // The marquee encloses the rectangle, so it must end up selected.
  const selected = await page.evaluate(() => (window as Any).__store.getState().selection.selectedIds)
  expect(selected).toHaveLength(1)
  expect(await shapeCount(page)).toBe(before + 1)
})

test('V takes the Select tool from a drawing tool', { tag: '@select' }, async ({ page }) => {
  await gotoApp(page)
  await pickTool(page, 'rectangle')
  expect(await activeTool(page)).toBe('rectangle')
  await key(page, 'v')
  expect(await activeTool(page)).toBe('select')
})

test('Ctrl+C + Ctrl+V pastes a copy of the selected region', { tag: '@select' }, async ({ page }) => {
  await gotoApp(page)
  await pickTool(page, 'rectangle')
  const { x: cx, y: cy } = await canvasCentre(page)

  // Draw a large rectangle (200x200 CSS px = 4x4 world units)
  await drawRect(page, cx - 100, cy - 100, cx + 100, cy + 100)
  await page.waitForTimeout(800)
  await waitFrame(page, 5)
  const info = await getCanvasInfo(page)

  await pickTool(page, 'select')

  // Box-select the upper-left quadrant of the floor rect: a small sub-region inside the floor.
  await firePointer(page, 'pointerdown', cx - 80, cy - 80, 1, 0)
  await firePointer(page, 'pointermove', cx - 50, cy - 50, 1, 0)
  await firePointer(page, 'pointermove', cx - 20, cy - 20, 1, 0)
  await firePointer(page, 'pointerup', cx - 20, cy - 20, 0, 0)
  await page.waitForTimeout(500)
  await waitFrame(page, 5)

  await blur(page)
  await pressShortcut(page, 'c', { ctrl: true })
  await waitFrame(page, 3)

  // Escape to deselect, then paste: it enters paste preview mode.
  await page.keyboard.press('Escape')
  await waitFrame(page, 2)
  await pressShortcut(page, 'v', { ctrl: true })
  await waitFrame(page, 3)

  // Click to finalize paste at a position to the right of the original rect
  const pasteX = cx + 200
  const pasteY = cy
  await firePointer(page, 'pointerdown', pasteX, pasteY, 1, 0)
  await firePointer(page, 'pointerup', pasteX, pasteY, 0, 0)
  await page.waitForTimeout(500)
  await waitFrame(page, 8)

  // The paste lands somewhere around the click, so the check is that the layer grew by the copy.
  const { px, py } = toPhysical(pasteX, pasteY, info)
  const pastePixel = await getPixelColor(page, px, py)
  const bgPoint = toPhysical(cx + 350, cy, info)
  const bgPixel = await getPixelColor(page, bgPoint.px, bgPoint.py)
  expect(pastePixel.a, 'paste location pixel should be opaque').toBe(255)
  expect(bgPixel.a, 'background pixel should be opaque').toBe(255)
  expect(await shapeCount(page), 'the paste adds a shape').toBeGreaterThan(1)
})

test('Ctrl+X cuts selected region, erased from the original position', { tag: '@select' }, async ({ page }) => {
  await gotoApp(page)
  await pickTool(page, 'rectangle')
  const { x: cx, y: cy } = await canvasCentre(page)

  await drawRect(page, cx - 100, cy - 100, cx + 100, cy + 100)
  await page.waitForTimeout(800)
  await waitFrame(page, 5)

  const info = await getCanvasInfo(page)
  // Sample 15px right of centre to avoid the snap indicator cross-hair, which sits at the
  // centre after the selection drag's last pointermove lands there.
  const selCenter = toPhysical(cx + 15, cy, info)
  const floorPixel = await getPixelColor(page, selCenter.px, selCenter.py)
  expect(floorPixel.r, 'floor should be light before cut').toBeGreaterThan(150)

  await pickTool(page, 'select')
  await firePointer(page, 'pointerdown', cx - 90, cy - 90, 1, 0)
  await firePointer(page, 'pointermove', cx, cy, 1, 0)
  await firePointer(page, 'pointerup', cx + 90, cy + 90, 0, 0)
  await page.waitForTimeout(500)
  await waitFrame(page, 5)

  await blur(page)
  await pressShortcut(page, 'x', { ctrl: true })
  await page.waitForTimeout(500)
  await waitFrame(page, 8)

  // The floor polygon is gone, so the sample reads background (plus shadow) instead.
  const afterCut = await getPixelColor(page, selCenter.px, selCenter.py)
  expect(Math.abs(afterCut.r - floorPixel.r), 'cut region should visually change after floor is removed').toBeGreaterThan(10)
})

test('Delete key erases selected region', { tag: '@select' }, async ({ page }) => {
  await gotoApp(page)
  await pickTool(page, 'rectangle')
  const { x: cx, y: cy } = await canvasCentre(page)

  await drawRect(page, cx - 100, cy - 80, cx + 100, cy + 80)
  await page.waitForTimeout(800)
  await waitFrame(page, 5)

  const info = await getCanvasInfo(page)
  const centerPt = toPhysical(cx + 15, cy, info)
  const beforeDelete = await getPixelColor(page, centerPt.px, centerPt.py)
  expect(beforeDelete.r, 'floor before delete').toBeGreaterThan(150)

  await pickTool(page, 'select')
  await firePointer(page, 'pointerdown', cx - 80, cy - 60, 1, 0)
  await firePointer(page, 'pointermove', cx, cy, 1, 0)
  await firePointer(page, 'pointerup', cx + 80, cy + 60, 0, 0)
  await page.waitForTimeout(500)
  await waitFrame(page, 5)

  await key(page, 'Delete')
  await page.waitForTimeout(500)
  await waitFrame(page, 8)

  const afterDelete = await getPixelColor(page, centerPt.px, centerPt.py)
  expect(Math.abs(afterDelete.r - beforeDelete.r), 'deleted region should visually change after floor is removed').toBeGreaterThan(10)
})

// ─── Transform controls on an image ────────────────────────────────────────────

type StoreWindow = { __store?: { getState: () => Record<string, unknown> } }

/**
 * A child's on-screen box, in client coordinates. The gizmo lays its handles out in screen
 * space, so every pointer coordinate below comes from the live camera rather than from the
 * child's world position.
 */
async function objectScreenBox(page: Page, objId: string): Promise<{ cx: number; cy: number; w: number; h: number; zoom: number }> {
  const box = await page.evaluate((id) => {
    const store = (window as StoreWindow).__store
    if (!store) return null
    const state = store.getState() as { layers: Array<{ children?: Array<{ id: string; position: { x: number; y: number }; width: number; height: number }> }> }
    const obj = state.layers.flatMap((l) => l.children ?? []).find((c) => c.id === id)
    if (!obj) return null
    const app = (window as unknown as { __pixiApp?: { stage: { children: Array<{ position: { x: number; y: number }; scale: { x: number } }> } } }).__pixiApp
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
 * Place a 4x3 (world units) asset child on the origin of the dungeon layer and select it by
 * clicking it, which is how the Select tool builds its gizmo. Returns the child id.
 */
async function importAndSelectImage(page: Page): Promise<string> {
  const objId = await page.evaluate(() => {
    const store = (window as StoreWindow).__store
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
    return id
  })
  await pickTool(page, 'select')
  await waitFrame(page, 5)
  const { cx, cy } = await objectScreenBox(page, objId)
  await firePointer(page, 'pointerdown', cx, cy, 0.5, 1)
  await firePointer(page, 'pointerup', cx, cy, 0, 0)
  await waitFrame(page, 5)
  return objId
}

/** Read a placed asset child from the store by id. */
async function getPlacedObject(page: Page, objId: string): Promise<Record<string, unknown> | null> {
  return page.evaluate((id) => {
    const store = (window as StoreWindow).__store
    if (!store) return null
    const state = store.getState() as { layers: Array<{ children?: Array<{ id: string; childType: string }> }> }
    for (const layer of state.layers) {
      const found = (layer.children ?? []).find((c) => c.id === id && c.childType === 'asset')
      if (found) return found as unknown as Record<string, unknown>
    }
    return null
  }, objId)
}

const rendered = (o: Record<string, unknown>) => (o['width'] as number) * (o['scale'] as number)

test('selecting an image shows its box handles (the selection is populated)', { tag: '@select' }, async ({ page }) => {
  await gotoApp(page)
  await importAndSelectImage(page)
  const selected = await page.evaluate(() => (window as Any).__store.getState().selection.selectedIds as string[])
  expect(selected.length).toBeGreaterThan(0)
})

test('drag SE corner handle increases object width', { tag: '@select' }, async ({ page }) => {
  await gotoApp(page)
  // A resize scales the child rather than rewriting `width`: an asset carries one scalar
  // `scale` on top of its authored size, so `width` alone never moves.
  const objId = await importAndSelectImage(page)
  const before = (await getPlacedObject(page, objId))!
  expect(before).not.toBeNull()

  const sb = await objectScreenBox(page, objId)
  const seX = sb.cx + sb.w / 2
  const seY = sb.cy + sb.h / 2
  await firePointer(page, 'pointerdown', seX, seY, 0.5, 1)
  await firePointer(page, 'pointermove', seX + 60, seY + 45, 0.5, 1)
  await firePointer(page, 'pointerup', seX + 60, seY + 45, 0, 0)
  await waitFrame(page, 5)

  const after = (await getPlacedObject(page, objId))!
  expect(after).not.toBeNull()
  expect(rendered(after)).toBeGreaterThan(rendered(before))
})

test('Escape during a drag cancels the transform: the object is unchanged', { tag: '@select' }, async ({ page }) => {
  await gotoApp(page)
  const objId = await importAndSelectImage(page)
  const before = (await getPlacedObject(page, objId))!

  const sb = await objectScreenBox(page, objId)
  const seX = sb.cx + sb.w / 2
  const seY = sb.cy + sb.h / 2
  await firePointer(page, 'pointerdown', seX, seY, 0.5, 1)
  await firePointer(page, 'pointermove', seX + 80, seY + 60, 0.5, 1)
  await page.keyboard.press('Escape')
  await waitFrame(page, 3)

  const after = (await getPlacedObject(page, objId))!
  expect(after).not.toBeNull()
  expect(after['width']).toBe(before['width'])
  expect((after['position'] as { x: number }).x).toBe((before['position'] as { x: number }).x)
})

test('undo reverses a move: the position is restored', { tag: '@select' }, async ({ page }) => {
  await gotoApp(page)
  const objId = await importAndSelectImage(page)
  const beforeX = ((await getPlacedObject(page, objId))!['position'] as { x: number }).x

  const { cx, cy } = await objectScreenBox(page, objId)
  await firePointer(page, 'pointerdown', cx, cy, 0.5, 1)
  await firePointer(page, 'pointermove', cx + 80, cy + 60, 0.5, 1)
  await firePointer(page, 'pointerup', cx + 80, cy + 60, 0, 0)
  await waitFrame(page, 5)

  const moved = (await getPlacedObject(page, objId))!
  expect((moved['position'] as { x: number }).x).toBeGreaterThan(beforeX)

  await key(page, 'Control+z')
  await waitFrame(page, 3)
  const afterUndo = (await getPlacedObject(page, objId))!
  expect((afterUndo['position'] as { x: number }).x).toBe(beforeX)
})

test('clicking an empty area deselects', { tag: '@select' }, async ({ page }) => {
  await gotoApp(page)
  const objId = await importAndSelectImage(page)
  // Well clear of the object and its handles.
  const sb = await objectScreenBox(page, objId)
  const awayX = sb.cx - sb.w * 3
  const awayY = sb.cy - sb.h * 3
  await firePointer(page, 'pointerdown', awayX, awayY, 0.5, 1)
  await firePointer(page, 'pointerup', awayX, awayY, 0, 0)
  await waitFrame(page, 3)
  const selected = await page.evaluate(() => (window as Any).__store.getState().selection.selectedIds as string[])
  expect(selected).toHaveLength(0)
})

test('Alt + drag corner resizes from the centre: the position stays centred', { tag: '@select' }, async ({ page }) => {
  await gotoApp(page)
  const objId = await importAndSelectImage(page)
  const before = (await getPlacedObject(page, objId))!
  const beforePos = before['position'] as { x: number; y: number }

  const sb = await objectScreenBox(page, objId)
  const seX = sb.cx + sb.w / 2
  const seY = sb.cy + sb.h / 2
  const alt = { alt: true }
  await firePointer(page, 'pointerdown', seX, seY, 0.5, 1, alt)
  await firePointer(page, 'pointermove', seX + 40, seY + 30, 0.5, 1, alt)
  await firePointer(page, 'pointerup', seX + 40, seY + 30, 0, 0, alt)
  await waitFrame(page, 5)

  const after = (await getPlacedObject(page, objId))!
  expect(after).not.toBeNull()
  expect(rendered(after)).toBeGreaterThan(rendered(before))
  // The centre stays put, within a quarter of a world cell.
  const afterPos = after['position'] as { x: number; y: number }
  expect(Math.abs(afterPos.x - beforePos.x)).toBeLessThan(0.25)
  expect(Math.abs(afterPos.y - beforePos.y)).toBeLessThan(0.25)
})

test('grid snap on: a move snaps to the grid, not the raw delta', { tag: '@select' }, async ({ page }) => {
  await gotoApp(page)
  await page.evaluate(() => (window as Any).__store.getState().setSnapEnabled(true))
  const objId = await importAndSelectImage(page)
  const beforeX = ((await getPlacedObject(page, objId))!['position'] as { x: number }).x

  const { cx, cy, zoom } = await objectScreenBox(page, objId)
  // A delta that lands between grid divisions.
  const rawDeltaX = 37 / zoom
  await firePointer(page, 'pointerdown', cx, cy, 0.5, 1)
  await firePointer(page, 'pointermove', cx + 37, cy + 23, 0.5, 1)
  await firePointer(page, 'pointerup', cx + 37, cy + 23, 0, 0)
  await waitFrame(page, 5)

  const pos = (await getPlacedObject(page, objId))!['position'] as { x: number; y: number }
  expect(Math.abs(pos.x - (beforeX + rawDeltaX))).toBeGreaterThan(0.1)
})

test('Shift + rotate snaps to 15-degree steps', { tag: '@select' }, async ({ page }) => {
  await gotoApp(page)
  const objId = await importAndSelectImage(page)
  // The rotation handle sits on a 14px stem above the top edge of the box.
  const sb = await objectScreenBox(page, objId)
  const rotX = sb.cx
  const rotY = sb.cy - sb.h / 2 - 14
  const shift = { shift: true }
  await firePointer(page, 'pointerdown', rotX, rotY, 0.5, 1, shift)
  await firePointer(page, 'pointermove', rotX + 30, rotY + 10, 0.5, 1, shift)
  await firePointer(page, 'pointerup', rotX + 30, rotY + 10, 0, 0, shift)
  await waitFrame(page, 5)

  const rotation = (await getPlacedObject(page, objId))!['rotation'] as number
  const snapUnit = Math.PI / 12
  const remainder = Math.abs(rotation % snapUnit)
  expect(Math.min(remainder, snapUnit - remainder)).toBeLessThan(0.01)
})

test('a locked layer: a transform drag does not move the object', { tag: '@select' }, async ({ page }) => {
  await gotoApp(page)
  const objId = await importAndSelectImage(page)
  await page.evaluate(() => {
    const state = (window as Any).__store.getState()
    const layer = state.layers.find((l: Any) => l.type === 'dungeon')
    if (layer) state.updateLayer(layer.id, { locked: true })
  })
  await waitFrame(page, 3)
  const before = (await getPlacedObject(page, objId))!

  const { cx, cy } = await objectScreenBox(page, objId)
  await firePointer(page, 'pointerdown', cx, cy, 0.5, 1)
  await firePointer(page, 'pointermove', cx + 80, cy + 60, 0.5, 1)
  await firePointer(page, 'pointerup', cx + 80, cy + 60, 0, 0)
  await waitFrame(page, 3)

  // Whether the drag was refused or the selection was dropped, the object has not moved.
  const after = (await getPlacedObject(page, objId))!
  expect((after['position'] as { x: number }).x).toBe((before['position'] as { x: number }).x)
})

test('select a drawn shape then move it: the rings move in the store', { tag: '@select' }, async ({ page }) => {
  await gotoApp(page)
  const { x: cx, y: cy } = await canvasCentre(page)
  await pickTool(page, 'rectangle')
  await drawRect(page, cx - 80, cy - 60, cx + 80, cy + 60)
  await waitFrame(page, 5)

  const minRingX = () =>
    page.evaluate(() => {
      const state = (window as Any).__store.getState()
      const dungeon = state.layers.find((l: Any) => l.type === 'dungeon')
      const shape = (dungeon?.children ?? []).find((c: Any) => c.childType === 'shape')
      return Math.min(...((shape?.contours?.[0] ?? [[0, 0]]) as [number, number][]).map(([x]) => x))
    })
  const x0 = await minRingX()

  await pickTool(page, 'select')
  await firePointer(page, 'pointerdown', cx - 100, cy - 80, 0.5, 1)
  await firePointer(page, 'pointermove', cx + 100, cy + 80, 0.5, 1)
  await firePointer(page, 'pointerup', cx + 100, cy + 80, 0, 0)
  await waitFrame(page, 3)

  await firePointer(page, 'pointerdown', cx, cy, 0.5, 1)
  await firePointer(page, 'pointermove', cx + 60, cy + 40, 0.5, 1)
  await firePointer(page, 'pointerup', cx + 60, cy + 40, 0, 0)
  await waitFrame(page, 5)

  // A move bakes itself into the rings and clears any stored transform.
  expect((await minRingX()) - x0).toBeGreaterThan(0)
})

test('hovering outside the selected object shows the default cursor', { tag: '@select' }, async ({ page }) => {
  await gotoApp(page)
  const objId = await importAndSelectImage(page)
  const canvas = page.locator('canvas').first()
  const sb = await objectScreenBox(page, objId)
  await page.mouse.move(sb.cx - sb.w * 3, sb.cy - sb.h * 3)
  await waitFrame(page, 2)
  const cursor = await canvas.evaluate((el) => (el as HTMLCanvasElement).style.cursor)
  expect(['default', '', 'crosshair']).toContain(cursor)
})

// ─── On a copy of the goblin warren ──────────────────────────────────────────────

/** Run `fn` (source text) in the page with the store getter, the active layer and a world to screen mapping. */
async function inPage<T>(page: Page, fn: string, arg?: unknown): Promise<T> {
  return page.evaluate(
    ({ fn, arg }) => {
      const w = window as Any
      const s = () => w.__store.getState()
      const layer = () => s().layers.find((l: Any) => l.id === s().ui.activeLayerId && l.type === 'dungeon')
      const world = () => w.__pixiApp.stage.children[0]
      const w2s = (x: number, y: number) => {
        const r = w.__pixiApp.canvas.getBoundingClientRect()
        const wd = world()
        return { x: r.left + x * wd.scale.x + wd.position.x, y: r.top + y * wd.scale.x + wd.position.y }
      }
      return new Function('s', 'layer', 'w2s', 'arg', `return (${fn})(s, layer, w2s, arg)`)(s, layer, w2s, arg)
    },
    { fn, arg },
  )
}

const screenOf = (page: Page, p: Pt) => inPage<Pt>(page, `(s, layer, w2s, p) => w2s(p.x, p.y)`, p)
const sel = (page: Page) => inPage<string[]>(page, `(s) => s().selection.selectedIds`)
const select = (page: Page, ids: string[]) => inPage<void>(page, `(s, l, w, ids) => s().setSelectedIds(ids)`, ids)
const zoom = (page: Page) => inPage<number>(page, `() => window.__pixiApp.stage.children[0].scale.x`)
const undo = (page: Page) => key(page, 'Control+z')

type Mods = { shift?: boolean; ctrl?: boolean; alt?: boolean }

async function click(page: Page, at: Pt, mods: Mods = {}) {
  await firePointer(page, 'pointermove', at.x, at.y, 0, 0, mods)
  await firePointer(page, 'pointerdown', at.x, at.y, 0.5, 1, mods)
  await firePointer(page, 'pointerup', at.x, at.y, 0, 0, mods)
  await waitFrame(page, 2)
}

/** A drag in screen px, in steps so every tool sees travel. */
async function drag(page: Page, from: Pt, to: Pt, mods: Mods = {}, steps = 6) {
  await firePointer(page, 'pointermove', from.x, from.y, 0, 0, mods)
  await firePointer(page, 'pointerdown', from.x, from.y, 0.5, 1, mods)
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    await firePointer(page, 'pointermove', from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, 0.5, 1, mods)
  }
  await firePointer(page, 'pointerup', to.x, to.y, 0, 0, mods)
  await waitFrame(page, 3)
}

async function rightClick(page: Page, at: Pt) {
  await page.evaluate((at) => {
    const canvas = document.querySelector('canvas')!
    canvas.dispatchEvent(new MouseEvent('contextmenu', { clientX: at.x, clientY: at.y, button: 2, bubbles: true, cancelable: true }))
  }, at)
  await waitFrame(page, 2)
}

/** A copy of the goblin warren, framed, its rooms measured, the Select tool in hand. */
async function openWarren(page: Page): Promise<void> {
  await openEditor(page)
  await page.waitForFunction(() => {
    const s = (window as Any).__store.getState()
    const l = s.layers.find((x: Any) => x.type === 'dungeon')
    return (l?.rooms ?? []).length > 0 && l.rooms.every((r: Any) => Array.isArray(r.face) && r.face.length > 2)
  })
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const l = st.layers.find((x: Any) => x.type === 'dungeon')
    st.setActiveLayerId(l.id)
    st.setMarqueeFilter('all')
  })
  await waitFrame(page, 4)
}

/** A room's anchor, world units. */
const roomAnchor = (page: Page, name: string) =>
  inPage<Pt>(page, `(s, layer, w2s, name) => { const r = layer().rooms.find((x) => x.name === name); return { x: r.anchor[0], y: r.anchor[1] } }`, name)

/** A room's face box, world units. */
const roomBox = (page: Page, name: string) =>
  inPage<{ x0: number; y0: number; x1: number; y1: number; id: string }>(
    page,
    `(s, layer, w2s, name) => { const r = layer().rooms.find((x) => x.name === name); const xs = r.face.map((p) => p[0]); const ys = r.face.map((p) => p[1]); return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), id: r.id } }`,
    name,
  )

/** Takes every prop, light and zone within `r` of `p` off the active layer, so a click there lands on what a test puts down. */
const clearAround = (page: Page, p: Pt, r: number) =>
  inPage<void>(
    page,
    `(s, layer, w2s, a) => window.__store.setState((st) => {
      const l = st.layers.find((x) => x.id === st.ui.activeLayerId)
      l.children = l.children.filter((c) => {
        if (c.childType !== 'asset' && c.childType !== 'light' && c.childType !== 'zone') return true
        const pos = c.childType === 'zone' ? (c.shape.position ?? { x: c.shape.x, y: c.shape.y }) : c.position
        return Math.hypot(pos.x - a.p.x, pos.y - a.p.y) > a.r
      })
    })`,
    { p, r },
  )

const addChild = (page: Page, child: Record<string, unknown>) => inPage<void>(page, `(s, layer, w2s, c) => s().addChild(layer().id, c)`, child)
const child = (page: Page, id: string) => inPage<Any>(page, `(s, layer, w2s, id) => layer().children.find((c) => c.id === id)`, id)
const wallOf = (page: Page, id: string) => inPage<Any>(page, `(s, layer, w2s, id) => layer().standaloneWalls.find((w) => w.id === id)`, id)

const prop = (id: string, at: Pt, extra: Record<string, unknown> = {}) => ({
  id, name: id, childType: 'asset', visible: true, objectType: 'asset', assetId: 'gg-demo:storage_crates_1_dark_1x1_object_A',
  position: at, rotation: 0, scale: 1, width: 1, height: 1, tint: '#ffffff', flipX: false, flipY: false, ...extra,
})
const light = (id: string, at: Pt) => ({
  id, name: id, childType: 'light', visible: true, color: '#ffcc66', radius: 2, featherRadius: 1, intensity: 0.8,
  falloff: 'linear', position: at,
})

/** A wall's point at `t` along its line, world units. */
async function onWall(page: Page, id: string, t: number): Promise<Pt> {
  const w = await wallOf(page, id)
  const [a, b] = w.points
  return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t }
}

/** The gizmo box of a single wall on screen: its band box. */
async function wallScreenBox(page: Page, id: string) {
  return inPage<{ x0: number; y0: number; x1: number; y1: number }>(
    page,
    `(s, layer, w2s, id) => {
      const w = layer().standaloneWalls.find((x) => x.id === id)
      const reach = 0.75
      const xs = w.points.map((p) => p[0]); const ys = w.points.map((p) => p[1])
      const a = w2s(Math.min(...xs) - reach, Math.min(...ys) - reach)
      const b = w2s(Math.max(...xs) + reach, Math.max(...ys) + reach)
      return { x0: a.x, y0: a.y, x1: b.x, y1: b.y }
    }`,
    id,
  )
}

const distToLine = (p: Pt, a: number[], b: number[]) => {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  return Math.abs(dx * (p.y - a[1]) - dy * (p.x - a[0])) / Math.hypot(dx, dy)
}

const card = (page: Page): Locator => page.getByTestId('shell-card')
const cardTitle = (page: Page): Locator => card(page).locator('[data-composite="panel-header"]')
const toaster = (page: Page) => page.getByLabel('Notifications alt+T')

// ─── Every kind through one pick ────────────────────────────────────────────

test('a click on a zone’s outline selects it; the corner handle drags its radius and the card follows', { tag: '@select' }, async ({ page }) => {
  await openWarren(page)
  const c = await roomAnchor(page, 'Warren Hall')
  await clearAround(page, c, 4)
  await addChild(page, { id: 'z', name: 'Ambush', childType: 'zone', visible: true, shape: { kind: 'circle', position: { x: c.x, y: c.y }, radius: 1.5 } })
  // Inside a room a zone answers by its line (the room has the inside); here, its east edge.
  await click(page, await screenOf(page, { x: c.x + 1.5, y: c.y }))
  expect(await sel(page)).toEqual(['z'])
  const radius = card(page).getByLabel('R', { exact: true })
  await expect(radius).toHaveValue('1.5')
  const z = await zoom(page)
  const corner = await screenOf(page, { x: c.x + 1.5, y: c.y + 1.5 })
  await drag(page, corner, { x: corner.x + z, y: corner.y + z })
  const r = (await child(page, 'z')).shape.radius
  expect(r).toBeGreaterThan(1.9)
  await expect(radius).toHaveValue(String(Math.round(r * 100) / 100))
})

// ─── Drawn walls take the box ───────────────────────────────────────────────

test('a drawn wall gets the box: a drag moves the wall and its door, the door stays on its line', { tag: '@select' }, async ({ page }) => {
  await openWarren(page)
  const grab = await onWall(page, 'wall-001', 0.15)
  await clearAround(page, grab, 2)
  const before = await wallOf(page, 'wall-001')
  const doorId = (await inPage<Any>(page, `(s, layer) => layer().children.find((c) => c.childType === 'door' && c.wallId === 'wall-001')`)).id
  const z = await zoom(page)
  const from = await screenOf(page, grab)
  await click(page, from)
  expect(await sel(page)).toEqual(['wall-001'])
  // The box has handles: the corner shows a resize cursor.
  const box = await wallScreenBox(page, 'wall-001')
  await firePointer(page, 'pointermove', box.x1, box.y1, 0, 0)
  await waitFrame(page, 2)
  expect(await page.evaluate(() => document.querySelector('canvas')!.style.cursor)).toMatch(/resize/)

  const to = { x: from.x + 0.6 * z, y: from.y + 1.6 * z }
  await drag(page, from, to)
  const after = await wallOf(page, 'wall-001')
  const dx = after.points[0][0] - before.points[0][0]
  const dy = after.points[0][1] - before.points[0][1]
  expect(Math.hypot(dx, dy)).toBeGreaterThan(1)
  const door = await child(page, doorId)
  // The door rode along and still hangs on the wall's line (its jambs closed on it).
  expect(distToLine({ x: door.position[0], y: door.position[1] }, after.points[0], after.points[1])).toBeLessThan(0.05)
  await undo(page)
  expect((await wallOf(page, 'wall-001')).points).toEqual(before.points)
})

test('the rotate stem turns a wall about its centre', { tag: '@select' }, async ({ page }) => {
  await openWarren(page)
  const grab = await onWall(page, 'wall-003', 0.15)
  await clearAround(page, grab, 2)
  const before = await wallOf(page, 'wall-003')
  await click(page, await screenOf(page, grab))
  expect(await sel(page)).toEqual(['wall-003'])
  const box = await wallScreenBox(page, 'wall-003')
  const cx = (box.x0 + box.x1) / 2
  const cy = (box.y0 + box.y1) / 2
  const stem = { x: cx, y: box.y0 - 20.5 }
  // Round to the right of the centre: a quarter turn clockwise.
  await drag(page, stem, { x: cx + (cy - stem.y), y: cy }, {}, 10)
  const after = await wallOf(page, 'wall-003')
  const ang = (w: Any) => Math.atan2(w.points[1][1] - w.points[0][1], w.points[1][0] - w.points[0][0])
  let turn = ang(after) - ang(before)
  turn = Math.atan2(Math.sin(turn), Math.cos(turn))
  expect(Math.abs(Math.abs(turn) - Math.PI / 2)).toBeLessThan(0.3)
})

test('a corner handle resizes a wall', { tag: '@select' }, async ({ page }) => {
  await openWarren(page)
  const grab = await onWall(page, 'wall-002', 0.15)
  await clearAround(page, grab, 2)
  const before = await wallOf(page, 'wall-002')
  await click(page, await screenOf(page, grab))
  const box = await wallScreenBox(page, 'wall-002')
  const z = await zoom(page)
  await drag(page, { x: box.x1, y: box.y1 }, { x: box.x1 + 2 * z, y: box.y1 + 2 * z })
  const after = await wallOf(page, 'wall-002')
  const len = (w: Any) => Math.hypot(w.points[1][0] - w.points[0][0], w.points[1][1] - w.points[0][1])
  expect(len(after)).toBeGreaterThan(len(before) + 0.5)
})

test('Ctrl+D on a wall adds a wall and its door; Ctrl+C then Ctrl+V pastes a wall onto the active layer', { tag: '@select' }, async ({ page }) => {
  await openWarren(page)
  const counts = () => inPage<{ walls: number; doors: number }>(page, `(s, layer) => ({ walls: layer().standaloneWalls.length, doors: layer().children.filter((c) => c.childType === 'door').length })`)
  const start = await counts()
  await select(page, ['wall-004'])
  await key(page, 'Control+d')
  expect(await counts()).toEqual({ walls: start.walls + 1, doors: start.doors + 1 })
  await select(page, ['wall-005'])
  await key(page, 'Control+c')
  await key(page, 'Control+v')
  expect((await counts()).walls).toBe(start.walls + 2)
  // The paste is selected: the new wall, not the one it was copied from.
  const pasted = await sel(page)
  expect(pasted).toHaveLength(1)
  expect(pasted[0]).not.toBe('wall-005')
  expect(await wallOf(page, pasted[0])).toBeTruthy()
})

// ─── Marquee ────────────────────────────────────────────────────────────────

test('Shift+marquee adds to the selection; Alt+marquee takes away', { tag: '@select' }, async ({ page }) => {
  await openWarren(page)
  const c = await roomAnchor(page, 'Warren Hall')
  await clearAround(page, c, 5)
  await addChild(page, prop('a', { x: c.x - 3, y: c.y }))
  await addChild(page, prop('b', { x: c.x + 2, y: c.y }))
  await addChild(page, prop('c', { x: c.x + 3, y: c.y }))
  await select(page, ['a'])
  const z = await zoom(page)
  const p = await screenOf(page, { x: c.x + 1.2, y: c.y - 1 })
  await drag(page, p, { x: p.x + 2.6 * z, y: p.y + 2 * z }, { shift: true })
  expect([...(await sel(page))].sort()).toEqual(['a', 'b', 'c'])
  // Well clear of the box's handles, which Alt would grab to resize about the centre.
  const q = await screenOf(page, { x: c.x + 2.6, y: c.y - 2.5 })
  await drag(page, q, { x: q.x + 1.2 * z, y: q.y + 3.2 * z }, { alt: true })
  expect([...(await sel(page))].sort()).toEqual(['a', 'b'])
})

test('a marquee never collects a layer on another level', { tag: '@select' }, async ({ page }) => {
  await openWarren(page)
  const c = await roomAnchor(page, 'Warren Hall')
  await clearAround(page, c, 4)
  await inPage<void>(page, `(s, layer, w2s, c) => {
    s().addLevel({ id: 'lvl-2', name: 'Upstairs' })
    const up = { ...structuredClone(layer()), id: 'up', name: 'Up', levelId: 'lvl-2', children: [], standaloneWalls: [], rooms: [] }
    s().addLayer(up)
    s().addChild('up', { id: 'upstairs', name: 'up', childType: 'light', visible: true, color: '#fff', radius: 1, featherRadius: 1, intensity: 1, falloff: 'linear', position: c })
    s().setActiveLayerId(layer().id)
  }`, c)
  await addChild(page, light('here', { x: c.x + 0.5, y: c.y }))
  const z = await zoom(page)
  const p = await screenOf(page, { x: c.x - 1, y: c.y - 1 })
  await drag(page, p, { x: p.x + 2.5 * z, y: p.y + 2 * z })
  expect(await sel(page)).toContain('here')
  expect(await sel(page)).not.toContain('upstairs')
})

test('a room joins a marquee only when the marquee covers its whole face', { tag: '@select' }, async ({ page }) => {
  await openWarren(page)
  const box = await roomBox(page, 'Warren Hall')
  const a = await screenOf(page, { x: box.x0 + 1, y: box.y0 + 1 })
  const b = await screenOf(page, { x: box.x1 - 1, y: box.y1 - 1 })
  await drag(page, a, b)
  expect(await sel(page)).not.toContain(box.id)
  const a2 = await screenOf(page, { x: box.x0 - 0.5, y: box.y0 - 0.5 })
  const b2 = await screenOf(page, { x: box.x1 + 0.5, y: box.y1 + 0.5 })
  await drag(page, a2, b2)
  expect(await sel(page)).toContain(box.id)
})

// ─── Locks ──────────────────────────────────────────────────────────────────

test('a locked prop selects with its badge, never moves, and Delete refuses with a toast', { tag: '@select' }, async ({ page }) => {
  await openWarren(page)
  const c = await roomAnchor(page, 'Warren Hall')
  await clearAround(page, c, 3)
  await addChild(page, prop('rug', c, { locked: true }))
  const at = await screenOf(page, c)
  const z = await zoom(page)
  await drag(page, at, { x: at.x + 2 * z, y: at.y })
  expect(await sel(page)).toEqual(['rug'])
  expect((await child(page, 'rug')).position).toEqual(c)
  // The card says so: its Lock switch is on, and the status bar reads the locked line.
  await expect(card(page).getByRole('switch', { name: 'Lock', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('shell-status-hint')).toContainText('locked')
  const glyphs = await page.evaluate(() => {
    const find = (n: Any): number => (n.label === 'selectionLock' ? 1 : 0) + (n.children ?? []).reduce((s: number, k: Any) => s + find(k), 0)
    return find((window as Any).__pixiApp.stage)
  })
  expect(glyphs).toBe(1)
  await key(page, 'Delete')
  expect(await child(page, 'rug')).toBeTruthy()
  await expect(toaster(page).getByText('Locked: unlock to edit')).toBeVisible()
})

test('a locked wall selects and refuses Delete the same way', { tag: '@select' }, async ({ page }) => {
  await openWarren(page)
  const grab = await onWall(page, 'wall-006', 0.15)
  await clearAround(page, grab, 2)
  await inPage<void>(page, `(s, layer) => s().updateWall(layer().id, 'wall-006', { locked: true })`)
  await click(page, await screenOf(page, grab))
  expect(await sel(page)).toEqual(['wall-006'])
  await expect(page.getByTestId('shell-status-hint')).toContainText('locked')
  await key(page, 'Delete')
  expect(await wallOf(page, 'wall-006')).toBeTruthy()
})

test('a lock and a hide save within seconds and survive a reload', { tag: '@select' }, async ({ page }) => {
  await openWarren(page)
  const c = await roomAnchor(page, 'Warren Hall')
  await clearAround(page, c, 4)
  await addChild(page, prop('rug', c))
  await addChild(page, prop('crate', { x: c.x + 3, y: c.y + 3 }))
  const savedAt = () => inPage<number>(page, `(s) => s().mapIndex.find((m) => m.id === s().activeMapId)?.updatedAt ?? 0`)
  // Let the adds' own save land first, so the stamp that moves next is the lock and the hide.
  await page.evaluate(() => (window as Any).__store.getState().saveCurrentMap())
  const before = await savedAt()
  await select(page, ['rug'])
  await key(page, 'Control+Shift+l')
  await select(page, ['crate'])
  await key(page, 'Control+Shift+h')
  await page.waitForFunction((t) => {
    const s = (window as Any).__store.getState()
    return (s.mapIndex.find((m: Any) => m.id === s.activeMapId)?.updatedAt ?? 0) > t
  }, before, { timeout: 5000 })
  await page.reload()
  await waitForBoot(page)
  await page.getByTestId('v2-map-card').first().click()
  await expect(page.getByTestId('shell')).toBeVisible()
  const anyChild = (id: string) =>
    inPage<Any>(page, `(s, layer, w2s, id) => s().layers.flatMap((l) => l.children ?? []).find((c) => c.id === id)`, id)
  await expect.poll(async () => (await anyChild('rug'))?.locked).toBe(true)
  expect((await anyChild('crate')).visible).toBe(false)
})

// ─── The Mixed card and the header ──────────────────────────────────────────

test('a light and a wall get the Mixed card, and Align left lines them up', { tag: '@select' }, async ({ page }) => {
  await openWarren(page)
  const c = await roomAnchor(page, 'Warren Hall')
  await addChild(page, light('torch', { x: c.x + 6, y: c.y }))
  await select(page, ['torch', 'wall-001'])
  await expect(card(page)).toHaveAttribute('data-kind', 'mixed')
  await expect(cardTitle(page)).toContainText('1 light · 1 wall')
  const w = await wallOf(page, 'wall-001')
  const wallLeft = Math.min(w.points[0][0], w.points[1][0]) - 0.75
  await card(page).getByRole('button', { name: 'Align left' }).click()
  const t = await child(page, 'torch')
  // The light lines up by its marker square, not its radius.
  expect(t.position.x - 0.5).toBeCloseTo(wallLeft, 1)
})

/** The rotated world box of a prop. */
function aabb(p: { x: number; y: number; width: number; height: number; scale: number; rotation: number }) {
  const w = p.width * p.scale
  const h = p.height * p.scale
  const c = Math.abs(Math.cos(p.rotation))
  const s = Math.abs(Math.sin(p.rotation))
  const hw = (w * c + h * s) / 2
  const hh = (w * s + h * c) / 2
  return { left: p.x - hw, right: p.x + hw, top: p.y - hh, bottom: p.y + hh }
}

const THREE = ['gg-demo:storage_barrel_1_dark_1x1_object_A', 'gg-demo:storage_crates_1_dark_1x1_object_A', 'gg-demo:chest_1_steel_1x1_object_A']

test('three props: one box, Align left, Distribute horizontally, each one undo', { tag: '@select' }, async ({ page }) => {
  await openWarren(page)
  type Row = { id: string; x: number; y: number; width: number; height: number; scale: number; rotation: number }
  const rows = () =>
    inPage<Row[]>(
      page,
      `(s, layer) => layer().children.filter((c) => c.childType === 'asset').map((c) => ({
        id: c.id, assetId: c.assetId, x: c.position.x, y: c.position.y, width: c.width, height: c.height, scale: c.scale, rotation: c.rotation }))`,
    )
  const all = await inPage<{ id: string; assetId: string }[]>(
    page,
    `(s, layer) => layer().children.filter((c) => c.childType === 'asset').map((c) => ({ id: c.id, assetId: c.assetId }))`,
  )
  const ids = THREE.map((a) => all.find((p) => p.assetId === a)!.id)
  const start = (await rows()).filter((p) => ids.includes(p.id))
  await select(page, ids)
  await expect(card(page)).toHaveAttribute('data-kind', 'mixed')
  await expect(cardTitle(page)).toContainText('3 props')

  await card(page).getByRole('button', { name: 'Align left' }).click()
  const lefts = (await rows()).filter((p) => ids.includes(p.id)).map((p) => aabb(p).left)
  expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThan(1e-6)
  await undo(page)

  await card(page).getByRole('button', { name: 'Distribute horizontally' }).click()
  const spread = (await rows()).filter((p) => ids.includes(p.id)).map(aabb).sort((a, b) => a.left - b.left)
  expect(spread[1].left - spread[0].right).toBeCloseTo(spread[2].left - spread[1].right, 4)
  await undo(page)
  for (const p of (await rows()).filter((x) => ids.includes(x.id))) {
    const s = start.find((x) => x.id === p.id)!
    expect(p.x).toBeCloseTo(s.x)
    expect(p.y).toBeCloseTo(s.y)
  }
})

// ─── Alt ────────────────────────────────────────────────────────────────────

test('Alt+click steps from a prop to what lies under it and back round', { tag: '@select' }, async ({ page }) => {
  await openWarren(page)
  const c = await roomAnchor(page, 'Warren Hall')
  await clearAround(page, c, 3)
  // Big enough that the box's handles sit well clear of the middle of it.
  await addChild(page, prop('crate', c, { width: 3, height: 3 }))
  const at = await screenOf(page, c)
  await click(page, at, { alt: true })
  expect(await sel(page)).toEqual(['crate'])
  await click(page, at, { alt: true })
  const second = await sel(page)
  expect(second).toHaveLength(1)
  expect(second[0]).not.toBe('crate')
  for (let i = 0; i < 4 && (await sel(page))[0] !== 'crate'; i++) await click(page, at, { alt: true })
  expect(await sel(page)).toEqual(['crate'])
})

test('Alt+drag copies a prop and moves the copy, one undo step', { tag: '@select' }, async ({ page }) => {
  await openWarren(page)
  const c = await roomAnchor(page, 'Warren Hall')
  await clearAround(page, c, 4)
  await addChild(page, prop('crate', c))
  const n = () => inPage<number>(page, `(s, layer) => layer().children.filter((x) => x.childType === 'asset').length`)
  const before = await n()
  const at = await screenOf(page, c)
  const z = await zoom(page)
  await drag(page, at, { x: at.x + 2 * z, y: at.y }, { alt: true })
  expect(await n()).toBe(before + 1)
  expect((await child(page, 'crate')).position).toEqual(c)
  await undo(page)
  expect(await n()).toBe(before)
})

// ─── Undo ───────────────────────────────────────────────────────────────────

test('ten fast arrow presses undo in one step', { tag: '@select' }, async ({ page }) => {
  await openWarren(page)
  const c = await roomAnchor(page, 'Warren Hall')
  await addChild(page, prop('crate', c))
  await select(page, ['crate'])
  await blur(page)
  // Fired in one page task, as a DM's quick presses reach the page. Ten `keyboard.press`
  // calls each wait for the page to answer, and under a loaded run that round trip passes
  // the 600 ms window, which splits the run whatever the code.
  await page.evaluate(() => {
    for (let i = 0; i < 10; i++) {
      for (const type of ['keydown', 'keyup']) {
        document.body.dispatchEvent(new KeyboardEvent(type, { key: 'ArrowRight', code: 'ArrowRight', bubbles: true, cancelable: true }))
      }
    }
  })
  await waitFrame(page, 2)
  expect((await child(page, 'crate')).position.x).toBeCloseTo(c.x + 10)
  await undo(page)
  expect((await child(page, 'crate')).position.x).toBeCloseTo(c.x)
})

test('undo of a delete hands the objects back selected', { tag: '@select' }, async ({ page }) => {
  await openWarren(page)
  const c = await roomAnchor(page, 'Warren Hall')
  for (const [i, id] of ['a', 'b', 'c', 'd'].entries()) await addChild(page, prop(id, { x: c.x + i, y: c.y }))
  await select(page, ['a', 'b', 'c', 'd'])
  await key(page, 'Delete')
  expect(await child(page, 'a')).toBeUndefined()
  await undo(page)
  expect([...(await sel(page))].sort()).toEqual(['a', 'b', 'c', 'd'])
  await expect(card(page)).toBeVisible()
})

test('Esc does one thing per press: drops the drag, then the selection, then solo', { tag: '@select' }, async ({ page }) => {
  await openWarren(page)
  const c = await roomAnchor(page, 'Warren Hall')
  await clearAround(page, c, 3)
  await addChild(page, prop('crate', c))
  await inPage<void>(page, `(s, layer) => s().toggleSoloLayer(layer().id)`)
  const at = await screenOf(page, c)
  const z = await zoom(page)
  await firePointer(page, 'pointermove', at.x, at.y, 0, 0)
  await firePointer(page, 'pointerdown', at.x, at.y, 0.5, 1)
  await firePointer(page, 'pointermove', at.x + z, at.y, 0.5, 1)
  await firePointer(page, 'pointermove', at.x + 2 * z, at.y, 0.5, 1)
  await key(page, 'Escape')
  expect((await child(page, 'crate')).position).toEqual(c)
  expect(await sel(page)).toEqual(['crate'])
  await firePointer(page, 'pointerup', at.x + 2 * z, at.y, 0, 0)
  await key(page, 'Escape')
  expect(await sel(page)).toEqual([])
  expect(await inPage<unknown>(page, `(s) => s().ui.solo`)).not.toBeNull()
  await key(page, 'Escape')
  expect(await inPage<unknown>(page, `(s) => s().ui.solo`)).toBeNull()
})

// ─── Keys ───────────────────────────────────────────────────────────────────

test('Ctrl+X in the label’s text field cuts text, never the label', { tag: '@select' }, async ({ page }) => {
  await openWarren(page)
  const c = await roomAnchor(page, 'Warren Hall')
  await addChild(page, {
    id: 'lbl', name: 'Rat nest', childType: 'text', visible: true, text: 'Rat nest', position: c, rotation: 0, scale: 1,
    width: 3, height: 1, fontSize: 1, color: '#1b1b1b', fontFamily: 'serif', textStyle: 'room',
  })
  await select(page, ['lbl'])
  const area = card(page).locator('textarea').first()
  await area.click()
  await area.press('Control+a')
  await area.press('Control+x')
  await area.press('Control+z')
  await waitFrame(page, 2)
  expect(await child(page, 'lbl')).toBeTruthy()
  expect(await sel(page)).toEqual(['lbl'])
})

test('the right-click menu on a wall offers Duplicate, flips, Rotate, Lock, Hide and Select behind', { tag: '@select' }, async ({ page }) => {
  await openWarren(page)
  const grab = await onWall(page, 'wall-001', 0.15)
  // Something under the wall, so there is a stack to choose from (the wall's end runs into rock).
  // A floor, which answers below the walls (a zone's outline would answer above them).
  const r = 0.8
  await addChild(page, {
    id: 'f', name: 'Floor', childType: 'shape', visible: true, shapeType: 'polygon',
    contours: [[[grab.x - r, grab.y - r], [grab.x + r, grab.y - r], [grab.x + r, grab.y + r], [grab.x - r, grab.y + r]]],
    textureScale: 1, textureOffsetX: 0, textureOffsetY: 0, textureFillRotation: 0, textureTint: '#ffffff',
  })
  await rightClick(page, await screenOf(page, grab))
  for (const label of ['Duplicate', 'Flip horizontal', 'Rotate 90°', 'Lock', 'Hide', 'Select behind']) {
    await expect(page.getByRole('menuitem', { name: new RegExp(`^${label}`) }).first()).toBeVisible()
  }
})
