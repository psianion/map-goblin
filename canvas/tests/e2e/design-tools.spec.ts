import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { drawRect, firePointer, getPixelColor, gotoApp, pressShortcut, shapeCount, waitFrame } from './helpers'
import { installStubs } from './publishStubs'
import { openEditor, pickTool, VIEWPORT } from './shell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

/**
 * The Design family's tools on a blank map: the Floor tool's three shapes, carving, snap,
 * undo and redo, the Look column's style presets and a floor's texture fields, then the
 * Door tool and the Elevation tool with their docks and cards.
 */

/** The canvas centre in page pixels, and the device pixel ratio for reading its buffer. */
async function centre(page: Page): Promise<{ cx: number; cy: number; w: number; h: number; dpr: number }> {
  const box = await page.locator('canvas').first().boundingBox()
  const dpr = await page.evaluate(() => window.devicePixelRatio)
  return { cx: box!.x + box!.width / 2, cy: box!.y + box!.height / 2, w: box!.width, h: box!.height, dpr }
}

/** A pixel of the canvas, given in CSS pixels from its top left. */
async function pixelAt(page: Page, x: number, y: number, dpr: number) {
  return getPixelColor(page, Math.round(x * dpr), Math.round(y * dpr))
}

const delta = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) =>
  Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b)

/** Every shape on the first dungeon layer. */
const shapes = (page: Page) =>
  page.evaluate(() => {
    const layer = (window as Any).__store.getState().layers.find((l: Any) => l.type === 'dungeon')
    return layer.children.filter((c: Any) => c.childType === 'shape') as Any[]
  })

test.describe('the Floor tool', () => {
  test('the rectangle draws a floor that changes canvas pixels', { tag: '@design' }, async ({ page }) => {
    await gotoApp(page)
    await pickTool(page, 'rectangle')
    const { cx, cy, w, h, dpr } = await centre(page)
    // A few pixels off the centre: the centre is a grid crossing, where a dot on the
    // background and the grid ink on the floor come out almost the same grey.
    const sx = w / 2 + 7
    const sy = h / 2 + 7

    const shapesBefore = await shapeCount(page)
    const before = await pixelAt(page, sx, sy, dpr)
    await drawRect(page, cx - 80, cy - 60, cx + 80, cy + 60)
    await page.waitForTimeout(500)
    await waitFrame(page, 5)
    const after = await pixelAt(page, sx, sy, dpr)

    expect(await shapeCount(page)).toBe(shapesBefore + 1)
    expect(after.a).toBe(255)
    expect(delta(after, before)).toBeGreaterThan(10)
  })

  test('two overlapping rectangles are two floors that union into one', { tag: '@design' }, async ({ page }) => {
    await gotoApp(page)
    await pickTool(page, 'rectangle')
    const { cx, cy, w, h, dpr } = await centre(page)

    const shapesBefore = await shapeCount(page)
    await drawRect(page, cx - 100, cy - 50, cx, cy + 50)
    await page.waitForTimeout(300)
    await drawRect(page, cx - 30, cy - 50, cx + 100, cy + 50)
    await page.waitForTimeout(500)
    await waitFrame(page, 5)

    // Each drag is its own child; the union happens downstream in mergedFloor.
    expect(await shapeCount(page)).toBe(shapesBefore + 2)
    const pixel = await pixelAt(page, w / 2, h / 2, dpr)
    expect(pixel.a).toBe(255)
  })

  test('the polygon takes clicked vertices and closes on the first', { tag: '@design' }, async ({ page }) => {
    await gotoApp(page)
    await pickTool(page, 'polygon')
    const { cx, cy, w, h, dpr } = await centre(page)
    const before = await shapeCount(page)

    for (const [x, y] of [[cx, cy - 80], [cx + 80, cy], [cx, cy + 80], [cx - 80, cy], [cx, cy - 80]]) {
      await firePointer(page, 'pointerdown', x, y, 0.5, 1)
      await firePointer(page, 'pointerup', x, y, 0, 0)
      await waitFrame(page, 1)
    }
    await page.waitForTimeout(500)
    await waitFrame(page, 5)

    expect(await shapeCount(page)).toBe(before + 1)
    const shape = (await shapes(page)).at(-1)
    expect(shape.shapeType).toBe('polygon')
    expect(shape.contours[0]).toHaveLength(4)
    const pixel = await pixelAt(page, w / 2, h / 2, dpr)
    expect(pixel.a).toBe(255)
  })

  test('Escape cancels a polygon in progress', { tag: '@design' }, async ({ page }) => {
    await gotoApp(page)
    await pickTool(page, 'polygon')
    const { cx, cy } = await centre(page)
    const before = await shapeCount(page)

    await firePointer(page, 'pointerdown', cx - 50, cy - 50, 0.5, 1)
    await firePointer(page, 'pointerup', cx - 50, cy - 50, 0, 0)
    await waitFrame(page, 1)

    await page.keyboard.press('Escape')
    await waitFrame(page, 2)
    expect(await shapeCount(page)).toBe(before)
    await expect(page.locator('canvas').first()).toBeVisible()
  })

  test('a drag with the regular polygon draws a floor with the dock\'s Sides', { tag: '@design' }, async ({ page }) => {
    await gotoApp(page)
    await pickTool(page, 'regularPolygon')
    const { cx, cy, w, h, dpr } = await centre(page)
    const before = await shapeCount(page)

    await firePointer(page, 'pointerdown', cx, cy, 0.5, 1)
    await firePointer(page, 'pointermove', cx + 80, cy, 0.5, 1)
    await firePointer(page, 'pointerup', cx + 80, cy, 0, 0)
    await page.waitForTimeout(500)
    await waitFrame(page, 5)

    expect(await shapeCount(page)).toBe(before + 1)
    const sides = await page.evaluate(() => (window as Any).__store.getState().tools.settings.regularPolygon.sides as number)
    expect((await shapes(page)).at(-1).contours[0]).toHaveLength(sides)
    const pixel = await pixelAt(page, w / 2, h / 2, dpr)
    expect(pixel.a).toBe(255)
  })

  test('snap on gives every contour vertex a place on the snap step', { tag: '@design' }, async ({ page }) => {
    await gotoApp(page)
    await pickTool(page, 'rectangle')
    await expect(page.getByTestId('shell-tool-panel').locator('[data-setting="grid.snap"]').getByRole('switch')).toHaveAttribute(
      'aria-checked',
      'true',
    )
    const { cx, cy } = await centre(page)

    const before = await shapeCount(page)
    await drawRect(page, cx - 73, cy - 47, cx + 73, cy + 47)
    await page.waitForTimeout(500)
    await waitFrame(page, 3)
    expect(await shapeCount(page)).toBe(before + 1)

    // Off-grid drag coordinates, so every contour vertex proves the snap ran.
    const offGrid = await page.evaluate(() => {
      const state = (window as Any).__store.getState()
      const layer = state.layers.find((l: Any) => l.type === 'dungeon')
      const shape = layer.children.filter((c: Any) => c.childType === 'shape').at(-1)
      const step = 1 / state.grid.snapDivision
      return (shape.contours[0] as [number, number][]).filter(
        ([x, y]) => Math.abs(x / step - Math.round(x / step)) > 1e-6 || Math.abs(y / step - Math.round(y / step)) > 1e-6,
      )
    })
    expect(offGrid).toEqual([])
  })
})

test.describe('undo and redo', () => {
  test('Ctrl+Z undoes a rectangle draw', { tag: '@design' }, async ({ page }) => {
    await gotoApp(page)
    await pickTool(page, 'rectangle')
    const { cx, cy, w, h, dpr } = await centre(page)
    const sx = w / 2 + 15
    const sy = h / 2 + 15

    const before = await shapeCount(page)
    await drawRect(page, cx - 80, cy - 60, cx + 80, cy + 60)
    await page.waitForTimeout(500)
    await waitFrame(page, 5)
    expect(await shapeCount(page)).toBe(before + 1)

    const afterDraw = await pixelAt(page, sx, sy, dpr)

    await pressShortcut(page, 'z', { ctrl: true })
    await page.waitForTimeout(500)
    await waitFrame(page, 8)
    expect(await shapeCount(page)).toBe(before)

    // Undo should change the pixel (floor removed, back to background).
    const afterUndo = await pixelAt(page, sx, sy, dpr)
    expect(delta(afterUndo, afterDraw)).toBeGreaterThan(5)
  })

  test('Ctrl+Shift+Z redoes an undone draw', { tag: '@design' }, async ({ page }) => {
    await gotoApp(page)
    await pickTool(page, 'rectangle')
    const { cx, cy, w, h, dpr } = await centre(page)

    const before = await shapeCount(page)
    await drawRect(page, cx - 80, cy - 60, cx + 80, cy + 60)
    await page.waitForTimeout(500)
    await waitFrame(page, 5)
    expect(await shapeCount(page)).toBe(before + 1)

    const afterDraw = await pixelAt(page, w / 2, h / 2, dpr)

    await pressShortcut(page, 'z', { ctrl: true })
    await page.waitForTimeout(300)
    await waitFrame(page, 5)
    expect(await shapeCount(page)).toBe(before)

    await pressShortcut(page, 'z', { ctrl: true, shift: true })
    await page.waitForTimeout(300)
    await waitFrame(page, 5)
    expect(await shapeCount(page)).toBe(before + 1)

    // Redo restores the same shape, so the pixel goes back to what the draw gave.
    const afterRedo = await pixelAt(page, w / 2, h / 2, dpr)
    expect(delta(afterRedo, afterDraw)).toBeLessThan(30)
  })
})

/** Floor colour of the 'Cave / Natural' preset in presetRegistry.ts. */
const CAVE_FLOOR_COLOR = '#7a6a58'

/** Opens the Look column's style presets and picks one by its label. */
async function applyPreset(page: Page, label: string): Promise<void> {
  await page.getByTestId('shell-dock').locator('[data-column="look"]').getByRole('button', { name: /^Style presets/ }).click()
  await page.getByRole('menuitemradio', { name: label, exact: true }).click()
}

/** Shapes on the dungeon layer and its current floor colour. */
async function layerProbe(page: Page): Promise<{ shapes: number; floorColor: string }> {
  return page.evaluate(() => {
    const layer = (window as Any).__store.getState().layers.find((l: Any) => l.type === 'dungeon')
    return {
      shapes: layer.children.filter((c: Any) => c.childType === 'shape').length,
      floorColor: layer.style.floorColor as string,
    }
  })
}

test.describe('style presets', () => {
  // A preset chooses the style for the next shape. Anything already drawn has to come
  // through untouched: it used to repaint the whole map, which is how an authored map lost
  // all its walls to one click.
  test('applying a preset leaves an already-drawn shape looking the same', { tag: '@design' }, async ({ page }) => {
    await gotoApp(page)
    await pickTool(page, 'rectangle')
    const { cx, cy, w, h, dpr } = await centre(page)

    await drawRect(page, cx - 100, cy - 80, cx + 100, cy + 80)
    await page.waitForTimeout(800)
    await waitFrame(page, 5)

    const before = await pixelAt(page, w / 2, h / 2, dpr)
    const probeBefore = await layerProbe(page)
    expect(probeBefore.shapes).toBe(1)

    await applyPreset(page, 'Cave / Natural')
    await page.waitForTimeout(500)
    await waitFrame(page, 8)

    // The preset really landed on the layer...
    const probeAfter = await layerProbe(page)
    expect(probeAfter.floorColor).not.toBe(probeBefore.floorColor)

    // ...the shape carries a pin holding its old look...
    const pinned = (await shapes(page))[0].styleOverrides
    expect(pinned.floorColor).toBe(probeBefore.floorColor)

    // ...and it still renders as it did. Within a couple of levels, not bit for bit: a
    // pinned shape draws through the per-shape path (its own fill, masked to the merged
    // floor) rather than one merged fill, and that composite lands a hair lighter. The
    // regression this exists for was the whole shape repainting in the preset's colour,
    // which is about 40 levels per channel away.
    const after = await pixelAt(page, w / 2, h / 2, dpr)
    for (const ch of ['r', 'g', 'b'] as const) {
      expect(Math.abs(after[ch] - before[ch])).toBeLessThanOrEqual(6)
    }
    expect(after.a).toBe(before.a)
  })

  test('the preset still becomes the style the next shape is drawn in', { tag: '@design' }, async ({ page }) => {
    await gotoApp(page)
    await pickTool(page, 'rectangle')
    const { cx, cy } = await centre(page)

    // First shape in the default style, off to the left.
    await drawRect(page, cx - 220, cy - 60, cx - 80, cy + 60)
    await page.waitForTimeout(800)
    await waitFrame(page, 5)

    await applyPreset(page, 'Cave / Natural')
    await page.waitForTimeout(300)

    // Second shape, drawn after the preset, off to the right.
    await drawRect(page, cx + 80, cy - 60, cx + 220, cy + 60)
    await page.waitForTimeout(800)
    await waitFrame(page, 8)

    const probe = await layerProbe(page)
    expect(probe.shapes).toBe(2)
    expect(probe.floorColor).toBe(CAVE_FLOOR_COLOR)

    // The older shape carries a pinned copy of how it already looked; the one drawn after
    // the preset carries nothing, so it inherits the new layer style. That split is what
    // makes a preset forward-looking.
    const overrides = (await shapes(page)).map((c) => c.styleOverrides?.floorColor ?? null)
    expect(overrides[0]).not.toBeNull()
    expect(overrides[0]).not.toBe(CAVE_FLOOR_COLOR)
    expect(overrides[1]).toBeNull()
  })
})

/** Draws one 200 x 160 rectangle at the canvas centre and returns the layer and the shape's id. */
async function drawOne(page: Page): Promise<{ layerId: string; shapeId: string }> {
  await pickTool(page, 'rectangle')
  const { cx, cy } = await centre(page)
  await drawRect(page, cx - 100, cy - 80, cx + 100, cy + 80)
  await page.waitForTimeout(300)
  await waitFrame(page, 5)
  const layerId = await page.evaluate(() => (window as Any).__store.getState().layers.find((l: Any) => l.type === 'dungeon').id as string)
  const all = await shapes(page)
  expect(all).toHaveLength(1)
  return { layerId, shapeId: all[0].id }
}

test.describe('floor textures', () => {
  test('a drawn floor carries texture scale and tint defaults', { tag: '@design' }, async ({ page }) => {
    await gotoApp(page)
    await drawOne(page)

    const shape = (await shapes(page))[0]
    expect(shape.shapeType).toBe('rectangle')
    // textureScale and textureTint must exist with defaults
    expect(shape.textureScale).toBe(1.0)
    expect(shape.textureTint).toBe('#ffffff')
  })

  test('textureId can be assigned to a floor through the store', { tag: '@design' }, async ({ page }) => {
    await gotoApp(page)
    const { layerId, shapeId } = await drawOne(page)

    // The real child-update action, which is what the texture command drives.
    await page.evaluate(
      ({ layerId, id }) => (window as Any).__store.getState().updateChild(layerId, id, { textureId: 'stone-brick' }),
      { layerId, id: shapeId },
    )
    await waitFrame(page, 3)

    expect((await shapes(page))[0].textureId).toBe('stone-brick')
  })

  test('a picked floor shows its texture row on the floor card', { tag: '@design' }, async ({ page }) => {
    await gotoApp(page)
    const { shapeId } = await drawOne(page)

    await pickTool(page, 'select')
    await page.evaluate((id) => (window as Any).__store.getState().setSelectedIds([id]), shapeId)
    await waitFrame(page, 4)

    const card = page.getByTestId('shell-card')
    await expect(card).toHaveAttribute('data-kind', 'shape')
    await expect(card.locator('[data-setting="card.floor.texture"]').getByRole('button', { name: 'Change' })).toBeVisible()
  })
})

/* ── The Door tool ─────────────────────────────────────── */

type Pt = { x: number; y: number }

/** Open floor in the warren: inside the cave, well clear of its edges and of every drawn wall. */
const OPEN_FLOOR: Pt = { x: 34, y: 10 }

/** Runs `fn` in the page with the store, the active dungeon layer and a world-to-page mapper. */
async function inPage<T>(page: Page, fn: string, arg?: unknown): Promise<T> {
  return page.evaluate(
    ({ fn, arg }) => {
      const w = window as Any
      const s = () => w.__store.getState()
      const layer = () => s().layers.find((l: Any) => l.id === s().ui.activeLayerId && l.type === 'dungeon')
      const w2s = (x: number, y: number) => {
        const r = w.__pixiApp.canvas.getBoundingClientRect()
        const wd = w.__pixiApp.stage.children[0]
        return { x: r.left + x * wd.scale.x + wd.position.x, y: r.top + y * wd.scale.x + wd.position.y }
      }
      return new Function('s', 'layer', 'w2s', 'arg', `return (${fn})(s, layer, w2s, arg)`)(s, layer, w2s, arg)
    },
    { fn, arg },
  )
}

/** The warren with its dungeon layer active, once its rooms have their faces. */
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
    st.setGridVisible(true)
  })
  await waitFrame(page, 6)
}

const screenOf = (page: Page, p: Pt) => inPage<Pt>(page, `(s, layer, w2s, p) => w2s(p.x, p.y)`, p)
const doors = (page: Page) => inPage<Any[]>(page, `(s, layer) => layer().children.filter((c) => c.childType === 'door')`)
const walls = (page: Page) => inPage<Any[]>(page, `(s, layer) => layer().standaloneWalls`)
const sel = (page: Page) => inPage<string[]>(page, `(s) => s().selection.selectedIds`)
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())

async function click(page: Page, world: Pt, mods: { alt?: boolean } = {}): Promise<void> {
  const at = await screenOf(page, world)
  await firePointer(page, 'pointermove', at.x, at.y, 0, 0, mods)
  await firePointer(page, 'pointerdown', at.x, at.y, 0.5, 1, mods)
  await firePointer(page, 'pointerup', at.x, at.y, 0, 0, mods)
  await waitFrame(page, 3)
}

/**
 * `n` down/up pairs at one point, dispatched in one go after a real move there: a driver
 * round trip per event is slower than the tool's double-click window.
 */
async function tap(page: Page, world: Pt, n: number): Promise<void> {
  const at = await screenOf(page, world)
  await page.mouse.move(at.x, at.y)
  await waitFrame(page, 1)
  await page.evaluate(
    ({ x, y, n }) => {
      const canvas = document.querySelector('canvas')!
      for (let i = 0; i < n; i++) {
        for (const type of ['pointerdown', 'pointerup']) {
          canvas.dispatchEvent(
            new PointerEvent(type, {
              clientX: x,
              clientY: y,
              pointerId: 1,
              pointerType: 'mouse',
              bubbles: true,
              cancelable: true,
              buttons: type === 'pointerdown' ? 1 : 0,
              pressure: type === 'pointerdown' ? 0.5 : 0,
            }),
          )
        }
      }
    },
    { x: at.x, y: at.y, n },
  )
  await waitFrame(page, 3)
}

async function undo(page: Page): Promise<void> {
  await blur(page)
  await page.keyboard.press('Control+z')
  await waitFrame(page, 3)
}

/** The Door tool in hand, snap off so the door lands exactly where clicked. */
async function doorTool(page: Page): Promise<void> {
  await page.evaluate(() => (window as Any).__store.getState().setSnapEnabled(false))
  await pickTool(page, 'door')
}

/** The new door (the last one) and the piece it stands on. */
async function freeDoor(page: Page): Promise<{ door: Any; piece: Any }> {
  const door = (await doors(page)).at(-1)
  const piece = (await walls(page)).find((w: Any) => w.id === door.wallId)
  return { door, piece }
}

test.describe('the Door tool', () => {
  test('a door on open floor stands on its own piece; Turn 90° on its card makes it vertical', { tag: '@design' }, async ({ page }) => {
    await openWarren(page)
    const [doorsBefore, wallsBefore] = [(await doors(page)).length, (await walls(page)).length]
    await doorTool(page)
    await click(page, OPEN_FLOOR)
    expect(await doors(page)).toHaveLength(doorsBefore + 1)
    expect(await walls(page)).toHaveLength(wallsBefore + 1)
    const { door, piece } = await freeDoor(page)
    expect(piece).toBeDefined()
    const [a, b] = piece.points
    expect(Math.abs(b[0] - a[0])).toBeCloseTo(door.width)
    expect(b[1]).toBeCloseTo(a[1])
    expect(await sel(page)).toEqual([door.id])

    // The card lives in Select's panel: the door stays picked when Select is taken in hand.
    await pickTool(page, 'select')
    const card = page.getByTestId('shell-card')
    await expect(card).toHaveAttribute('data-kind', 'door')
    const angle = card.locator('[data-setting="card.door.angle"]')
    await expect(angle.getByRole('group', { name: 'Angle' })).toContainText('0°')
    await angle.getByRole('button', { name: 'Turn 90°' }).click()
    await waitFrame(page, 3)
    const turned = await freeDoor(page)
    const [c, d] = turned.piece.points
    expect(c[0]).toBeCloseTo(d[0])
    expect(Math.abs(d[1] - c[1])).toBeCloseTo(door.width)
    expect(turned.door.angle).toBeCloseTo(Math.PI / 2)
    await expect(angle.getByRole('group', { name: 'Angle' })).toContainText('90°')
    // One undo step for the turn, one for the placing.
    await undo(page)
    expect((await freeDoor(page)).piece.points).toEqual(piece.points)
    await undo(page)
    expect(await doors(page)).toHaveLength(doorsBefore)
    expect(await walls(page)).toHaveLength(wallsBefore)
  })

  test('deleting a free door takes its piece with it; one undo brings both back', { tag: '@design' }, async ({ page }) => {
    await openWarren(page)
    const wallsBefore = (await walls(page)).length
    await doorTool(page)
    await click(page, OPEN_FLOOR)
    const { door, piece } = await freeDoor(page)
    await pickTool(page, 'select')
    await page.getByTestId('shell-card').getByRole('button', { name: 'Delete' }).click()
    await waitFrame(page, 3)
    expect((await doors(page)).some((x: Any) => x.id === door.id)).toBe(false)
    expect(await walls(page)).toHaveLength(wallsBefore)
    await undo(page)
    const back = await freeDoor(page)
    expect(back.door.id).toBe(door.id)
    expect(back.piece.id).toBe(piece.id)
  })

  test("the dock's Angle 90 places the next free door vertical; a click on it picks the door, Alt+click steps to its piece", { tag: '@design' }, async ({ page }) => {
    await openWarren(page)
    await doorTool(page)
    const angle = page.getByTestId('shell-dock').locator('[data-setting="door.angle"]')
    await angle.getByRole('button', { name: 'Turn 90°' }).click()
    await expect(angle.getByRole('group', { name: 'Angle' })).toContainText('90°')
    expect(await inPage<number>(page, `(s) => s().tools.settings.doorAngle`)).toBe(90)
    await click(page, OPEN_FLOOR)
    const { door, piece } = await freeDoor(page)
    expect(piece.points[0][0]).toBeCloseTo(piece.points[1][0])
    expect(door.angle).toBeCloseTo(Math.PI / 2)

    await pickTool(page, 'select')
    await page.evaluate(() => (window as Any).__store.getState().setSelectedIds([]))
    await waitFrame(page, 2)
    await click(page, OPEN_FLOOR)
    expect(await sel(page)).toEqual([door.id])
    await click(page, OPEN_FLOOR, { alt: true })
    const seen = new Set<string>([(await sel(page))[0]])
    for (let i = 0; i < 4 && !seen.has(piece.id); i++) {
      await click(page, OPEN_FLOOR, { alt: true })
      seen.add((await sel(page))[0])
    }
    expect(seen.has(piece.id)).toBe(true)
  })

  test("a click on a drawn wall still hangs the door on that wall, at the wall's angle", { tag: '@design' }, async ({ page }) => {
    await openWarren(page)
    const wallsBefore = (await walls(page)).length
    // wall-003, the Timber Door's piece, longer than the door: not a piece of its own.
    const w = (await walls(page)).find((x: Any) => x.id === 'wall-003')
    await page.evaluate(() => (window as Any).__store.getState().updateToolSettings({ doorAngle: 90 }))
    await doorTool(page)
    // Remove the wall's own door first, so the click places rather than picks.
    await page.evaluate(() => {
      const st = (window as Any).__store.getState()
      st.removeChild(st.ui.activeLayerId, 'door-03-timber-door')
    })
    const [a, b] = w.points
    await click(page, { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 })
    const placed = (await doors(page)).at(-1)
    expect(placed.wallId).toBe('wall-003')
    expect(placed.angle).toBeCloseTo(Math.atan2(b[1] - a[1], b[0] - a[0]))
    expect(await walls(page)).toHaveLength(wallsBefore)
  })

  test('W draws a wall by click, click, Enter: a normal wall, and one undo takes it away', { tag: '@design' }, async ({ page }) => {
    await openWarren(page)
    const before = (await walls(page)).length
    // W answers once a Design tool is in hand.
    await doorTool(page)
    await blur(page)
    await page.keyboard.press('w')
    await waitFrame(page, 2)
    expect(await inPage<string>(page, `(s) => s().tools.activeTool`)).toBe('wall')
    await click(page, { x: OPEN_FLOOR.x - 3, y: OPEN_FLOOR.y })
    await click(page, { x: OPEN_FLOOR.x + 3, y: OPEN_FLOOR.y })
    await page.keyboard.press('Enter')
    await waitFrame(page, 4)
    const after = await walls(page)
    expect(after).toHaveLength(before + 1)
    const drawn = after.at(-1)
    expect(drawn.wallType).toBe('normal')
    expect(drawn.points[0][0]).toBeCloseTo(OPEN_FLOOR.x - 3)
    expect(drawn.points.at(-1)[0]).toBeCloseTo(OPEN_FLOOR.x + 3)
    await undo(page)
    expect(await walls(page)).toHaveLength(before)
  })

  test('a double-click on a hung door cycles closed → open → locked → closed; an archway has no state to cycle', { tag: '@design' }, async ({ page }) => {
    await openWarren(page)
    const w = (await walls(page)).find((x: Any) => x.id === 'wall-003')
    await doorTool(page)
    await page.evaluate(() => {
      const st = (window as Any).__store.getState()
      st.removeChild(st.ui.activeLayerId, 'door-03-timber-door')
    })
    const [a, b] = w.points
    const mid = { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 }
    await click(page, mid)
    const placed = (await doors(page)).at(-1)
    expect(placed.wallId).toBe('wall-003')
    expect(placed.state).toBe('closed')
    const state = async () => (await doors(page)).find((d: Any) => d.id === placed.id).state
    const at = { x: placed.position[0], y: placed.position[1] }
    for (const want of ['open', 'locked', 'closed']) {
      await page.waitForTimeout(500)
      await tap(page, at, 2)
      expect(await state()).toBe(want)
    }

    // A permanent opening has no state to cycle: a double-click leaves it as it is.
    await pickTool(page, 'select')
    await page.getByTestId('shell-card').locator('[data-setting="card.door.style"]').getByRole('combobox', { name: 'Style' }).click()
    await page.getByRole('option', { name: 'Archway' }).click()
    await pickTool(page, 'door')
    const arch = await state()
    for (let i = 0; i < 2; i++) {
      await page.waitForTimeout(500)
      await tap(page, at, 2)
      expect(await state()).toBe(arch)
    }
  })

  test("the panel's Secret places a secret door; the card's Secret and Locked each land as one undo step", { tag: '@design' }, async ({ page }) => {
    await openWarren(page)
    await doorTool(page)
    await page.getByTestId('shell-tool-panel').locator('[data-setting="door.secret"]').getByRole('switch').click()
    expect(await inPage<boolean>(page, `(s) => s().tools.settings.doorSecret`)).toBe(true)
    await click(page, OPEN_FLOOR)
    const { door } = await freeDoor(page)
    expect(door.isSecret).toBe(true)
    const now = async () => (await doors(page)).find((d: Any) => d.id === door.id)

    await pickTool(page, 'select')
    const card = page.getByTestId('shell-card')
    await expect(card.getByRole('switch', { name: 'Secret' })).toHaveAttribute('aria-checked', 'true')
    await card.getByRole('switch', { name: 'Secret' }).click()
    expect((await now()).isSecret).toBe(false)
    await undo(page)
    expect((await now()).isSecret).toBe(true)

    await card.getByRole('button', { name: 'Locked' }).click()
    expect((await now()).state).toBe('locked')
    await expect(card.getByRole('button', { name: 'Locked' })).toHaveAttribute('aria-pressed', 'true')
    await undo(page)
    expect((await now()).state).toBe('closed')
    // The door is still there after both undos: each was one step.
    expect(await now()).toBeDefined()
  })
})

/* ── The Elevation tool ────────────────────────────────── */

const read = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../../session/testdata/${name}.mapbuilder`, import.meta.url)), 'utf8'))
const PLATEAU = read('plateau-test')
const TOWER = read('tower-test')
const WARREN = read('goblin-warren')

const fit = async (page: Page) => {
  await page.getByRole('button', { name: 'Fit' }).click()
  await waitFrame(page, 6)
}

/** A fresh blank map at the shell's size, so the map sits clear of the chrome. */
async function openBlank(page: Page): Promise<void> {
  await page.setViewportSize(VIEWPORT)
  await gotoApp(page)
}

const child = (page: Page, id: string) => inPage<Any>(page, `(s, layer, w2s, id) => layer().children.find((c) => c.id === id)`, id)

/** The labels under one band's container in the plateaus sublayer (`plateau-band-<height>`). */
const bandLabels = (page: Page, height: number) =>
  page.evaluate((h) => {
    const w = window as Any
    const find = (c: Any, label: string): Any => (c.label === label ? c : (c.children ?? []).map((k: Any) => find(k, label)).find(Boolean))
    const band = find(w.__pixiApp.stage, `plateau-band-${h}`)
    const out: { label: string; children: number }[] = []
    const walk = (c: Any) => {
      for (const k of c.children ?? []) {
        if (k.label) out.push({ label: k.label, children: k.children?.length ?? 0 })
        walk(k)
      }
    }
    if (band) walk(band)
    return out
  }, height)

/** The fields of a plateau the tool's dock does not set: the card's, written after. */
const CARD_FIELDS = ['name', 'edgeArt', 'slopeWidth', 'contourLines', 'sightOverride', 'crossingId'] as const

/**
 * Draws `plateau` with the Elevation tool on its own layer, as a hand would: its level and
 * layer active, its height and edge set, a click on each corner and one on the first to
 * close. The card's fields follow. Resolves to the new plateau's id.
 */
async function drawWithTool(page: Page, plateau: Any, layer: { id: string; levelId?: string }): Promise<string> {
  await page.evaluate(({ layer, plateau }) => {
    const st = (window as Any).__store.getState()
    if (layer.levelId) st.setActiveLevelId(layer.levelId)
    st.setActiveLayerId(layer.id)
    st.updateToolSettings({ plateau: { height: plateau.height, edge: plateau.edge } })
    st.setSelectedIds([])
  }, { layer, plateau })
  await fit(page)
  await pickTool(page, 'elevation')
  const count = () => inPage<number>(page, `(s) => s().layers.flatMap((l) => l.children ?? []).filter((c) => c.childType === 'plateau').length`)
  const before = await count()
  const ring: [number, number][] = plateau.contours[0]
  for (const [x, y] of [...ring, ring[0]]) {
    const at = await screenOf(page, { x, y })
    await page.mouse.click(at.x, at.y)
    await page.waitForTimeout(350)
  }
  await expect.poll(count).toBe(before + 1)
  return page.evaluate(({ layerId, plateau, fields }) => {
    const st = (window as Any).__store.getState()
    const made = st.selection.selectedIds[0]
    const patch: Any = {}
    for (const k of fields) if (plateau[k] !== undefined) patch[k] = plateau[k]
    st.updateChild(layerId, made, patch)
    return made
  }, { layerId: layer.id, plateau, fields: CARD_FIELDS })
}

/**
 * Opens `doc` with its plateaus taken off, then draws every one of them again with the tool.
 * `ids` maps each plateau's id in the file to the one the tool gave it.
 */
async function openMap(page: Page, doc: Any): Promise<{ errors: string[]; ids: Record<string, string> }> {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openBlank(page)
  const bare = structuredClone(doc)
  const drawn: { plateau: Any; layer: { id: string; levelId?: string } }[] = []
  for (const l of bare.layers) {
    if (l.type !== 'dungeon') continue
    for (const c of l.children) if (c.childType === 'plateau') drawn.push({ plateau: c, layer: { id: l.id, levelId: l.levelId } })
    l.children = l.children.filter((c: Any) => c.childType !== 'plateau')
  }
  await page.evaluate(async (data) => {
    const st = (window as Any).__store.getState()
    st.loadFromFile(structuredClone(data))
    st.setRoomsSheetOpen?.(false)
    st.setSelectedIds([])
    await st.saveCurrentMap()
  }, bare)
  const ids: Record<string, string> = {}
  for (const { plateau, layer } of drawn) ids[plateau.id] = await drawWithTool(page, plateau, layer)
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const l = st.layers.find((x: Any) => x.type === 'dungeon' && x.children.some((c: Any) => c.childType === 'shape'))
    if (l.levelId) st.setActiveLevelId(l.levelId)
    st.setActiveLayerId(l.id)
    st.setSelectedIds([])
  })
  await pickTool(page, 'select')
  await fit(page)
  return { errors, ids }
}

/** The canvas luminance at world `p`: the median of three reads a frame apart. */
async function lum(page: Page, p: Pt): Promise<number> {
  const at = await screenOf(page, p)
  const r = await page.evaluate(() => (window as Any).__pixiApp.canvas.getBoundingClientRect())
  const reads: number[] = []
  for (let k = 0; k < 3; k++) {
    const c = await getPixelColor(page, at.x - r.left, at.y - r.top)
    reads.push(0.299 * c.r + 0.587 * c.g + 0.114 * c.b)
    await waitFrame(page, 1)
  }
  return reads.sort((a, b) => a - b)[1]
}

// sharp comes in with the workspace's own tools (vault-engine), as the sheet scripts take it.
const sharp = createRequire(fileURLToPath(new URL('../../../packages/vault-engine/package.json', import.meta.url)))('sharp')

/** The luminance of the page as shown at world `p`: a 5 x 5 px screenshot's mean. */
async function shownLum(page: Page, p: Pt): Promise<number> {
  const at = await screenOf(page, p)
  const png = await page.screenshot({ clip: { x: at.x - 2, y: at.y - 2, width: 5, height: 5 } })
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  let sum = 0
  for (let i = 0; i < data.length; i += info.channels) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  return sum / (data.length / info.channels)
}

/** The sun at a fixed hour of the editor's preview clock. */
async function sunAt(page: Page, hour: number): Promise<void> {
  await page.evaluate((h) => {
    ;(window as Any).__store.setState((s: Any) => {
      s.mapSettings.environment = 'outdoor'
      s.mapSettings.naturalLight = true
      s.ui.previewClock = h * 60
    })
  }, hour)
  await waitFrame(page, 8)
}

async function select(page: Page, id: string): Promise<void> {
  await page.evaluate((i) => (window as Any).__store.getState().setSelectedIds([i]), id)
  await waitFrame(page, 2)
}

test.describe('plateau-test in the editor', () => {
  test('opens with every named object and draws every band without an error', { tag: '@design' }, async ({ page }) => {
    const { errors } = await openMap(page, PLATEAU)
    for (const id of ['ground', 'outcrop', 'hill', 'summit', 'pit', 'far-mesa', 'torch-top', 'torch-ground']) {
      expect(await child(page, id), id).toBeTruthy()
    }
    await expect.poll(async () => (await bandLabels(page, 2)).length).toBeGreaterThan(0)
    for (const h of [-2, 1, 2, 3]) expect((await bandLabels(page, h)).length, `band ${h}`).toBeGreaterThan(0)
    expect(errors).toEqual([])
  })

  test('scenario 2: the outcrop is laid with rock and throws a shadow the clock swings', { tag: '@design' }, async ({ page }) => {
    await openMap(page, PLATEAU)
    // The outcrop is the only +2 band: rock along its edge, and a top line.
    await expect
      .poll(async () => (await bandLabels(page, 2)).find((l) => l.label === 'plateau-cliff')?.children ?? 0)
      .toBeGreaterThan(4)
    // Morning: the shadow falls west, off the outcrop's west cliff; late afternoon, east.
    const west = { x: 3.5, y: 10 }
    const east = { x: 12.5, y: 9.75 }
    await sunAt(page, 9)
    const [w9, e9] = [await lum(page, west), await lum(page, east)]
    await sunAt(page, 17)
    const [w17, e17] = [await lum(page, west), await lum(page, east)]
    expect(w9, 'west of the cliff is darker in the morning').toBeLessThan(w17 - 2)
    expect(e17, 'east of the cliff is darker in the afternoon').toBeLessThan(e9 - 2)
  })

  test('scenario 3: the hill reads 1 and the summit 3, with contours on the slope and a 2-cell drop', { tag: '@design' }, async ({ page }) => {
    const { ids } = await openMap(page, PLATEAU)
    const hill = await bandLabels(page, 1)
    expect(hill.some((l) => l.label === 'plateau-slope')).toBe(true)
    expect(hill.some((l) => l.label === 'plateau-contours')).toBe(true)
    expect((await bandLabels(page, 3)).some((l) => l.label === 'plateau-cliff')).toBe(true)

    const card = page.getByTestId('shell-card')
    await select(page, ids['hill-plateau'])
    await expect(card.locator('[data-setting="card.plateau.height"]')).toContainText('+1')
    await expect(card.getByTestId('design-plateau-standing')).toHaveText('+1 · drop 1')
    await select(page, ids['summit-plateau'])
    await expect(card.locator('[data-setting="card.plateau.height"]')).toContainText('+2')
    await expect(card.getByTestId('design-plateau-standing')).toHaveText('+3 · drop 2')
    // Blocks sight is what Auto decides: a 2-cell cliff hides the top.
    await expect(card.getByRole('switch', { name: 'Blocks sight' })).toHaveAttribute('aria-checked', 'true')
  })
})

/** A fresh map with one 20 x 16 field floor on its layer, the layer active, the view fitted. */
async function openField(page: Page): Promise<string[]> {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openBlank(page)
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const l = st.layers.find((x: Any) => x.type === 'dungeon')
    st.setActiveLayerId(l.id)
    st.addChild(l.id, {
      id: 'field', name: 'Field', childType: 'shape', visible: true, shapeType: 'rectangle',
      contours: [[[0, 0], [20, 0], [20, 16], [0, 16]]],
      textureScale: 1, textureOffsetX: 0, textureOffsetY: 0, textureFillRotation: 0, textureTint: '#ffffff',
    })
    st.setSelectedIds([])
  })
  await fit(page)
  return errors
}

const plateausOf = (page: Page) => inPage<Any[]>(page, `(s, layer) => layer().children.filter((c) => c.childType === 'plateau')`)

/** A real mouse drag through world points, a few moves per stretch. */
async function dragThrough(page: Page, pts: Pt[]): Promise<void> {
  const first = await screenOf(page, pts[0])
  await page.mouse.move(first.x, first.y)
  await page.mouse.down()
  for (const p of pts.slice(1)) {
    const at = await screenOf(page, p)
    await page.mouse.move(at.x, at.y, { steps: 6 })
  }
  await page.mouse.up()
  await waitFrame(page, 3)
}

const rectAround = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 },
]

test.describe('the Elevation tool', () => {
  test('a dragged rectangle on the field: one plateau at +1 with a cliff ledge, selected', { tag: '@design' }, async ({ page }) => {
    const errors = await openField(page)
    await pickTool(page, 'elevation')
    expect(await inPage(page, `(s) => s().tools.activeTool`)).toBe('plateau')
    const dock = page.getByTestId('shell-dock')
    await expect(dock.locator('[data-setting="elevation.height"]')).toContainText('+1')
    await expect(dock.locator('[data-setting="elevation.edge"]').getByRole('button', { name: 'Cliff' })).toHaveAttribute('aria-pressed', 'true')
    await dragThrough(page, rectAround(4, 4, 10, 9))
    await expect.poll(async () => (await plateausOf(page)).length).toBe(1)
    const [p] = await plateausOf(page)
    expect(p).toMatchObject({ height: 1, edge: 'cliff' })
    expect(await inPage(page, `(s) => s().selection.selectedIds`)).toEqual([p.id])
    // The floor is untouched: one shape, no new walls, its ring the same.
    expect(await inPage(page, `(s, layer) => layer().children.filter((c) => c.childType === 'shape').length`)).toBe(1)
    await expect.poll(async () => (await bandLabels(page, 1)).find((l) => l.label === 'plateau-cliff')?.children ?? 0).toBeGreaterThan(4)
    expect(errors).toEqual([])
  })

  test("the dock's Height and Edge set the next plateau", { tag: '@design' }, async ({ page }) => {
    await openField(page)
    await pickTool(page, 'elevation')
    const dock = page.getByTestId('shell-dock')
    // Up from +1 to +2, and Slope in place of Cliff.
    await dock.getByRole('button', { name: 'Increase Height' }).click()
    await dock.locator('[data-setting="elevation.edge"]').getByRole('button', { name: 'Slope' }).click()
    await dragThrough(page, rectAround(4, 4, 10, 9))
    await expect.poll(async () => (await plateausOf(page)).length).toBe(1)
    expect((await plateausOf(page))[0]).toMatchObject({ height: 2, edge: 'slope' })
    // Two steps down from +2 go through +1 and over flat to -1: a plateau is never level with the ground.
    await dock.getByRole('button', { name: 'Decrease Height' }).click()
    await dock.getByRole('button', { name: 'Decrease Height' }).click()
    expect(await inPage(page, `(s) => s().tools.settings.plateau.height`)).toBe(-1)
  })

  test('clicks place the points and a click on the first closes the ring', { tag: '@design' }, async ({ page }) => {
    await openField(page)
    await pickTool(page, 'elevation')
    for (const p of [{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 7 }, { x: 2, y: 7 }, { x: 2, y: 2 }]) {
      const at = await screenOf(page, p)
      await page.mouse.click(at.x, at.y)
      await page.waitForTimeout(350)
    }
    await expect.poll(async () => (await plateausOf(page)).length).toBe(1)
    expect((await plateausOf(page))[0].contours[0]).toEqual([[2, 2], [8, 2], [8, 7], [2, 7]])
  })

  test('a plateau drawn on void is refused with the toast, and nothing is added', { tag: '@design' }, async ({ page }) => {
    await openField(page)
    await pickTool(page, 'elevation')
    await dragThrough(page, rectAround(26, 4, 32, 9))
    await expect(page.getByLabel('Notifications alt+T').getByText('A plateau needs ground under it')).toBeVisible()
    expect(await plateausOf(page)).toHaveLength(0)
  })

  test('a node drag reshapes it, and a move that leaves the ground is put back', { tag: '@design' }, async ({ page }) => {
    await openField(page)
    await pickTool(page, 'elevation')
    await dragThrough(page, rectAround(4, 4, 10, 9))
    await expect.poll(async () => (await plateausOf(page)).length).toBe(1)
    await pickTool(page, 'select')
    const id = (await plateausOf(page))[0].id
    await select(page, id)
    // The corner nearest (10, 9), wherever simplifying put it.
    const corner = await inPage<Pt>(page, `(s, layer, w2s, id) => {
      const ring = layer().children.find((c) => c.id === id).contours[0]
      const [x, y] = ring.reduce((b, p) => (Math.hypot(p[0] - 10, p[1] - 9) < Math.hypot(b[0] - 10, b[1] - 9) ? p : b))
      return { x, y }
    }`, id)
    await dragThrough(page, [corner, { x: 14, y: 12 }])
    await expect
      .poll(async () => (await child(page, id)).contours[0].some((p: number[]) => Math.hypot(p[0] - 14, p[1] - 12) < 0.3))
      .toBe(true)
    // The whole plateau dragged east, most of it past the field's edge.
    await dragThrough(page, [{ x: 7, y: 6 }, { x: 15, y: 6 }, { x: 25, y: 6 }])
    await expect(page.getByLabel('Notifications alt+T').getByText('A plateau needs ground under it')).toBeVisible()
    await expect
      .poll(async () => (await child(page, id)).contours[0].some((p: number[]) => Math.hypot(p[0] - 14, p[1] - 12) < 0.3))
      .toBe(true)
  })

  test('the card changes height, edge and contours; the floor card has no Height or Edge row; the layers sheet lists it', { tag: '@design' }, async ({ page }) => {
    await openField(page)
    await pickTool(page, 'elevation')
    await dragThrough(page, rectAround(4, 4, 10, 9))
    await expect.poll(async () => (await plateausOf(page)).length).toBe(1)
    const id = (await plateausOf(page))[0].id
    await pickTool(page, 'select')
    await select(page, id)
    const card = page.getByTestId('shell-card')
    await expect(card).toHaveAttribute('data-kind', 'plateau')
    await card.locator('[data-setting="card.plateau.height"]').getByRole('button', { name: 'Increase Height' }).click()
    await expect.poll(async () => (await child(page, id)).height).toBe(2)
    await card.locator('[data-setting="card.plateau.edge"]').getByRole('button', { name: 'Slope' }).click()
    await expect.poll(async () => (await child(page, id)).edge).toBe('slope')
    await expect.poll(async () => (await bandLabels(page, 2)).some((l) => l.label === 'plateau-contours')).toBe(true)
    await card.getByRole('switch', { name: 'Contour lines' }).click()
    await expect.poll(async () => (await child(page, id)).contourLines).toBe(false)
    await expect.poll(async () => (await bandLabels(page, 2)).some((l) => l.label === 'plateau-contours')).toBe(false)

    await select(page, 'field')
    await expect(card).toHaveAttribute('data-kind', 'shape')
    await expect(card.locator('[data-setting="card.plateau.height"]')).toHaveCount(0)
    await expect(card.locator('[data-setting="card.plateau.edge"]')).toHaveCount(0)

    await page.getByTestId('shell-dock').getByTestId('shell-open-layers').click()
    const sheet = page.getByTestId('shell-layers-sheet')
    const expand = sheet.getByTestId('shell-layers-layer').first().getByRole('button', { name: 'Expand' })
    if (await expand.count()) await expand.click()
    await expect(sheet.locator(`[data-object-id="${id}"]`)).toContainText('Plateau 1')
  })
})

test.describe('how a plateau draws', () => {
  test('its top is a lift over whatever is beneath: terrain paint shows through a +1 plateau', { tag: '@design' }, async ({ page }) => {
    await openField(page)
    // Paint terrain on the void east of the field, then draw the plateau on the paint.
    await inPage(page, `(s) => s().setTerrainData({ palette: ['gg-demo:floor_small_8x8_floor_A', null, null, null, null, null] })`)
    await waitFrame(page, 6)
    await pickTool(page, 'terrain')
    for (const y of [5, 6, 7, 8, 9]) await dragThrough(page, [{ x: 25, y }, { x: 29, y }, { x: 33, y }])
    await expect.poll(() => inPage(page, `(s) => s().mapSettings.terrain?.bounds?.maxX ?? 0`)).toBeGreaterThan(30)
    // The view out to the paint as well.
    await fit(page)
    const painted = await shownLum(page, { x: 29, y: 7 })
    const bare = await shownLum(page, { x: 29, y: 13 })
    expect(Math.abs(painted - bare), 'the paint is on the canvas').toBeGreaterThan(10)
    await inPage(page, `(s) => s().setActiveLayerId(s().layers.find((l) => l.type === 'dungeon').id)`)
    await pickTool(page, 'elevation')
    await dragThrough(page, rectAround(27, 5.5, 31, 8.5))
    await expect.poll(async () => (await plateausOf(page)).length).toBe(1)
    await waitFrame(page, 10)
    const lifted = await shownLum(page, { x: 29, y: 7 })
    // Lifted a few percent, the paint still there under it: not a fill of its own.
    expect(lifted).toBeGreaterThanOrEqual(painted - 2)
    expect(lifted - painted).toBeLessThan(25)
    expect(Math.abs(lifted - bare)).toBeGreaterThan(10)
  })
})

test.describe('the test maps export and publish', () => {
  for (const [name, doc] of [['plateau-test', PLATEAU], ['tower-test', TOWER], ['goblin-warren', WARREN]] as const) {
    test(`${name}, drawn with the Elevation tool, exports a PNG and publishes`, { tag: '@design' }, async ({ page }) => {
      const { errors } = await openMap(page, doc)
      if (name === 'tower-test') {
        expect(await page.evaluate(() => (window as Any).__store.getState().levels.map((l: Any) => l.name))).toEqual([
          'Cellar',
          'Ground',
          'First floor',
        ])
      }

      await blur(page)
      await pressShortcut(page, 'e', { ctrl: true })
      const modal = page.getByTestId('v2-export-modal')
      await expect(modal).toBeVisible()
      const [png] = await Promise.all([page.waitForEvent('download'), modal.getByTestId('v2-export-go').click()])
      expect(png.suggestedFilename()).toMatch(/\.png$/)
      expect([...readFileSync(await png.path()).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])

      const calls = await installStubs(page, [
        { method: 'GET', path: /^\/api\/campaigns$/, respond: () => ({ json: { campaigns: [] } }) },
        { method: 'POST', path: /^\/api\/campaigns$/, respond: () => ({ json: { campaignId: 'camp-1', identityId: 'id-1', token: 'tok-1' } }) },
        {
          method: 'POST',
          path: /^\/api\/campaigns\/camp-1\/maps$/,
          respond: () => ({ json: { mapId: 'map-1', sceneId: 'scene-1', name: doc.mapSettings.name, sizeBytes: 1 } }),
        },
      ])
      await page.getByTestId('shell-publish').click()
      const dialog = page.getByTestId('v2-publish-dialog')
      await dialog.getByLabel('Admin pass').fill('adminpass')
      await dialog.getByLabel('Admin pass').press('Enter')
      await dialog.getByLabel('Create new campaign').fill('Plateaus')
      await dialog.getByRole('button', { name: 'Create' }).click()
      await expect(dialog.getByTestId('v2-publish-done')).toBeVisible({ timeout: 10_000 })
      const upload = calls.find((c) => c.method === 'POST' && /\/maps$/.test(c.path))
      expect(upload?.bodyBuffer?.length ?? 0).toBeGreaterThan(100)
      expect(errors).toEqual([])
    })
  }
})
