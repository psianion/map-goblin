import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { firePointer, gotoApp, waitFrame } from './helpers'
import { dockColumns, openEditor, pickFromFlyout, pickTool, shot } from './shell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
type Pt = { x: number; y: number }

/** Props on the active layer, and the newest one's tint and angle. */
const props = (page: Page) =>
  page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const layer = st.layers.find((l: Any) => l.id === st.ui.activeLayerId)
    const list = (layer?.children ?? []).filter((c: Any) => c.childType === 'asset')
    const last = list.at(-1)
    return { count: list.length as number, tint: last?.tint as string, rotation: last?.rotation as number }
  })

const brush = (page: Page) => page.evaluate(() => (window as Any).__store.getState().tools.settings.scatterBrush)

// Stamp and Scatter: picking Stamp opens the library; a prop placed with a tint
// and an angle set before placing; a scatter with radius and density changed; undo
// takes both back.
test('objects: stamp with tint and angle, scatter with radius and density, undo both', { tag: '@objects' }, async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openEditor(page)
  // Draw on the warren's own layer, keep placing so the stamp stays in hand.
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    st.setActiveLayerId(st.layers.find((l: Any) => l.type === 'dungeon' && !l.locked).id)
    st.updateToolSettings({ continuousPlacement: true })
  })

  await pickFromFlyout(page, 'Objects', 'Stamp')
  await expect(page.getByTestId('shell-assets')).toBeVisible()
  expect((await brush(page)).stampMode).toBe(true)
  expect(await dockColumns(page)).toEqual(['level', 'layers', 'family', 'Scale', 'Angle', 'Variant', 'Tint', 'props'])
  const panel = page.getByTestId('shell-tool-panel')
  await expect(panel.locator('[data-setting="stamp.keepPlacing"]')).toBeVisible()
  await expect(panel.locator('[data-setting="objects.placeUnder"]')).toBeVisible()

  // A prop from the strip, then the tint and the angle before placing.
  const dock = page.getByTestId('shell-dock')
  await dock.locator('[data-column="props"] [data-composite="tile"]').first().click()
  expect((await brush(page)).assetIds.length).toBe(1)
  await dock.locator('[data-setting="stamp.tint"]').getByRole('button', { name: 'Tint' }).click()
  await page.getByRole('textbox', { name: 'Tint hex' }).fill('#cc3322')
  await page.keyboard.press('Escape')
  const chip = dock.locator('[data-setting="stamp.angle"]').getByRole('button')
  await chip.hover()
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -100)
  await expect(chip).toHaveText('90°')
  await shot(page, '12-objects')

  const before = await props(page)
  await page.mouse.move(560, 460)
  await waitFrame(page, 2)
  await page.mouse.click(560, 460)
  await waitFrame(page, 4)
  const stamped = await props(page)
  expect(stamped.count).toBe(before.count + 1)
  expect(stamped.tint).toBe('#cc3322')
  expect(stamped.rotation).toBeCloseTo(Math.PI / 2, 3)

  // Scatter: the switcher swaps tools without the flyout; radius up, density to its top.
  await panel.getByRole('button', { name: 'Scatter' }).click()
  expect((await brush(page)).stampMode).toBe(false)
  expect(await dockColumns(page)).toEqual(['level', 'layers', 'family', 'Radius', 'Density', 'props'])
  const r0 = (await brush(page)).brushRadius
  await dock.getByRole('button', { name: 'Increase Radius' }).click()
  expect((await brush(page)).brushRadius).toBe(r0 + 0.5)
  await dock.getByRole('group', { name: 'Density' }).getByRole('slider').focus()
  await page.keyboard.press('End')
  expect((await brush(page)).density).toBe(1.5)
  await expect(panel.locator('[data-setting="scatter.rotationRange"]').first()).toBeVisible()
  await expect(panel.getByText(/seed/i)).toHaveCount(0)

  await page.mouse.move(470, 430)
  await page.mouse.down()
  await page.mouse.move(650, 430, { steps: 12 })
  await page.mouse.up()
  await waitFrame(page, 4)
  const scattered = await props(page)
  expect(scattered.count).toBeGreaterThan(stamped.count)

  // Undo: the scatter stroke, then the stamp.
  const undo = page.getByTestId('shell-top-actions').getByRole('button', { name: 'Undo' })
  await undo.click()
  await expect.poll(async () => (await props(page)).count).toBe(stamped.count)
  await undo.click()
  await expect.poll(async () => (await props(page)).count).toBe(before.count)
  expect(errors).toEqual([])
})

// ─── The scatter brush, on a blank map ───────────────────────────────────────────

/** Scattered objects are asset children of the layer they were dropped on. */
async function getPlacedObjects(page: Page) {
  return page.evaluate(() => {
    const store = (window as Any).__store
    return store
      .getState()
      .layers.flatMap((l: Any) => l.children ?? [])
      .filter((c: Any) => c.childType === 'asset')
      .map((c: Any) => ({ id: c.id as string, position: c.position as Pt }))
  }) as Promise<{ id: string; position: Pt }[]>
}

/**
 * Arm the brush with an asset it can actually size: the tool asks the catalog (or a loaded
 * texture) for the asset's natural size and drops the placement when neither answers, so a
 * made-up id places nothing. A bundled catalog entry is sized without waiting on a texture
 * download. A blank map has no floor, so the brush is told it need not stay on one.
 */
async function armScatter(page: Page): Promise<void> {
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    st.updateScatterBrushSettings({
      assetIds: ['gg-forge:GG_Fieldstone_Corner_A_1x1_1x1_wall_A'],
      stayOnFloor: false,
    })
  })
  await waitFrame(page, 1)
}

async function canvasCentre(page: Page): Promise<Pt> {
  const box = await page.locator('canvas').first().boundingBox()
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
}

/** The tool builds its placements on pointer move; a bare click commits nothing. */
async function strokeAt(page: Page, at: Pt): Promise<void> {
  await firePointer(page, 'pointermove', at.x, at.y, 0, 0)
  await firePointer(page, 'pointerdown', at.x, at.y, 0.5, 1)
  await firePointer(page, 'pointerup', at.x, at.y, 0, 0)
  await page.waitForTimeout(200)
  await waitFrame(page, 5)
}

test('picking Scatter from the Objects flyout puts the brush in hand', { tag: '@objects' }, async ({ page }) => {
  await gotoApp(page)
  await pickTool(page, 'scatter')
  expect(await page.evaluate(() => (window as Any).__store.getState().tools.activeTool)).toBe('scatterBrush')
  expect((await brush(page)).stampMode).toBe(false)
  await expect(page.getByTestId('shell-tool-panel')).toHaveAttribute('data-tool', 'scatter')
})

test('a stamp click drops one prop, a scatter stroke drops several at distinct positions (Poisson disk)', { tag: '@objects' }, async ({ page }) => {
  await gotoApp(page)
  await armScatter(page)
  const c = await canvasCentre(page)

  // Stamp mode drops exactly one object.
  await pickTool(page, 'stamp')
  await armScatter(page)
  const none = await getPlacedObjects(page)
  await strokeAt(page, c)
  const stamped = await getPlacedObjects(page)
  expect(stamped.length).toBe(none.length + 1)

  // Scatter mode spreads a pool over the brush.
  await pickTool(page, 'scatter')
  await armScatter(page)
  await strokeAt(page, { x: c.x + 200, y: c.y })
  const objects = await getPlacedObjects(page)
  expect(objects.length).toBeGreaterThan(stamped.length + 1)
  const positions = new Set(objects.map((o) => `${o.position.x},${o.position.y}`))
  expect(positions.size).toBe(objects.length)
})

test('undo removes scattered objects', { tag: '@objects' }, async ({ page }) => {
  await gotoApp(page)
  await pickTool(page, 'scatter')
  await armScatter(page)
  const c = await canvasCentre(page)
  const before = await getPlacedObjects(page)

  await strokeAt(page, c)
  const afterScatter = await getPlacedObjects(page)
  expect(afterScatter.length).toBeGreaterThan(before.length)

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await page.keyboard.press('Control+z')
  await waitFrame(page, 5)
  expect((await getPlacedObjects(page)).length).toBe(before.length)
})

test('erase mode, switched on in the panel, removes scattered objects under the brush', { tag: '@objects' }, async ({ page }) => {
  await gotoApp(page)
  await pickTool(page, 'scatter')
  await armScatter(page)
  const c = await canvasCentre(page)

  await strokeAt(page, c)
  const afterScatter = await getPlacedObjects(page)
  expect(afterScatter.length).toBeGreaterThan(0)

  // Erase is a mode on the tool: its switch is in the panel.
  const erase = page.getByTestId('shell-tool-panel').getByRole('switch', { name: 'Erase mode' })
  await expect(erase).toBeVisible()
  await erase.click()
  expect(await page.evaluate(() => (window as Any).__store.getState().tools.eraseMode)).toBe(true)
  await strokeAt(page, c)
  expect((await getPlacedObjects(page)).length).toBeLessThan(afterScatter.length)
})

test('multiple scatter strokes accumulate objects', { tag: '@objects' }, async ({ page }) => {
  await gotoApp(page)
  await pickTool(page, 'scatter')
  await armScatter(page)
  const c = await canvasCentre(page)

  await strokeAt(page, { x: c.x - 100, y: c.y })
  const afterFirst = await getPlacedObjects(page)
  await strokeAt(page, { x: c.x + 100, y: c.y })
  const afterSecond = await getPlacedObjects(page)
  expect(afterSecond.length).toBeGreaterThan(afterFirst.length)
})

// ─── Props on a copy of the goblin warren ─────────────────────────────────────────

/**
 * An asset's art size in squares, read from its shipped manifest (atlas frames are the
 * natural size, 200 px a square; a "1x1" crate's art need not fill its cell).
 */
function naturalCells(assetId: string): { w: number; h: number } {
  const [packId, entryId] = assetId.split(':')
  const dir = fileURLToPath(new URL(`../../public/packs/${packId}/`, import.meta.url))
  const file = readdirSync(dir).find((n) => /^pack-.*[.]json$/.test(n))!
  const entry = JSON.parse(readFileSync(dir + file, 'utf8')).entries[entryId]
  return { w: entry.frame.w / 200, h: entry.frame.h / 200 }
}

const CRATE = 'gg-demo:storage_crates_1_dark_1x1_object_A'
const FIREWOOD = 'gg-demo:firewood_pile_2x1_object_A'
const RUBBLE_S = 'gg-demo:rubble_small_3x3_object_A'
const RUBBLE_M = 'gg-demo:rubble_medium_4x2_object_A'
const THREE = ['gg-demo:storage_barrel_1_dark_1x1_object_A', CRATE, 'gg-demo:chest_1_steel_1x1_object_A']

/** Run `fn` (source text) in the page with the store getter, the active dungeon layer and a world to screen mapping. */
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

interface PropRow {
  id: string
  assetId: string
  objectType: string
  x: number
  y: number
  rotation: number
  scale: number
  width: number
  height: number
  flipX: boolean
  flipY: boolean
  locked?: boolean
  overhead?: boolean
  groupId?: string
}

const propRows = (page: Page) =>
  inPage<PropRow[]>(
    page,
    `(s, layer) => layer().children.filter((c) => c.childType === 'asset').map((c) => ({
      id: c.id, assetId: c.assetId, objectType: c.objectType, x: c.position.x, y: c.position.y, rotation: c.rotation,
      scale: c.scale, width: c.width, height: c.height, flipX: c.flipX, flipY: c.flipY, locked: c.locked,
      overhead: c.overhead, groupId: c.groupId }))`,
  )

const childIds = (page: Page) => inPage<string[]>(page, `(s, layer) => layer().children.map((c) => c.id)`)
const setBrush = (page: Page, patch: Record<string, unknown>) =>
  page.evaluate((patch) => (window as Any).__store.getState().updateScatterBrushSettings(patch), patch)
const select = (page: Page, ids: string[]) => page.evaluate((ids) => (window as Any).__store.getState().setSelectedIds(ids), ids)
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())

async function key(page: Page, combo: string) {
  await blur(page)
  await page.keyboard.press(combo)
  await waitFrame(page, 2)
}

const undo = (page: Page) => key(page, 'Control+z')

/** A world point on the screen. */
const screenOf = (page: Page, x: number, y: number) =>
  inPage<Pt>(page, `(s, layer, w2s, p) => w2s(p.x, p.y)`, { x, y })

/** The first prop of `assetId` on the layer. */
async function propOf(page: Page, assetId: string): Promise<PropRow> {
  const p = (await propRows(page)).find((c) => c.assetId === assetId)
  if (!p) throw new Error(`no ${assetId} on the map`)
  return p
}

/** A wheel notch on the canvas at a screen point. deltaY < 0 is "up". */
async function wheel(page: Page, at: Pt, deltaY: number, mods: { alt?: boolean; shift?: boolean; ctrl?: boolean } = {}) {
  await page.evaluate(
    ({ at, deltaY, mods }) => {
      const canvas = document.querySelector('canvas')!
      canvas.dispatchEvent(
        new WheelEvent('wheel', {
          clientX: at.x,
          clientY: at.y,
          deltaY,
          bubbles: true,
          cancelable: true,
          altKey: !!mods.alt,
          shiftKey: !!mods.shift,
          ctrlKey: !!mods.ctrl,
        }),
      )
    },
    { at, deltaY, mods },
  )
  await waitFrame(page, 1)
}

async function rightClick(page: Page, at: Pt) {
  await page.evaluate((at) => {
    const canvas = document.querySelector('canvas')!
    canvas.dispatchEvent(new MouseEvent('contextmenu', { clientX: at.x, clientY: at.y, button: 2, bubbles: true, cancelable: true }))
  }, at)
  await waitFrame(page, 2)
}

async function click(page: Page, at: Pt, mods: { shift?: boolean; ctrl?: boolean } = {}) {
  await firePointer(page, 'pointermove', at.x, at.y, 0, 0, mods)
  await firePointer(page, 'pointerdown', at.x, at.y, 0.5, 1, mods)
  await firePointer(page, 'pointerup', at.x, at.y, 0, 0, mods)
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
    st.setActiveLayerId(st.layers.find((x: Any) => x.type === 'dungeon').id)
  })
  await waitFrame(page, 4)
}

/** A room's face centre (its anchor) in world units. */
const roomAnchor = (page: Page, name: string) =>
  inPage<Pt>(page, `(s, layer, w2s, name) => { const r = layer().rooms.find((x) => x.name === name); return { x: r.anchor[0], y: r.anchor[1] } }`, name)

const card = (page: Page) => page.getByTestId('shell-card')
const dock = (page: Page) => page.getByTestId('shell-dock')

test('a stamp shaped by wheel, right-click, Alt+wheel, F and Shift+wheel lands exactly as the ghost', { tag: '@objects' }, async ({ page }) => {
  await openWarren(page)
  await pickTool(page, 'stamp')
  await setBrush(page, { stampMode: true, assetIds: [CRATE], stampRotation: 0, stampScale: 1, stampFlipX: false })
  // The hint names the gestures, and the Variant stepper shows the crate's place in its family.
  await expect(page.getByTestId('shell-status-hint')).toContainText('wheel turns 15°')
  await expect(dock(page).getByRole('group', { name: 'Variant' })).toContainText('/')
  const hall = await roomAnchor(page, 'Warren Hall')
  const at = await screenOf(page, hall.x + 2, hall.y + 2)
  await firePointer(page, 'pointermove', at.x, at.y, 0, 0)

  await wheel(page, at, 100)
  await wheel(page, at, 100)
  expect((await brush(page)).stampRotation).toBeCloseTo(Math.PI / 6)
  await rightClick(page, at)
  expect((await brush(page)).stampRotation).toBeCloseTo((2 * Math.PI) / 3)
  await expect(dock(page).getByRole('button', { name: /^Angle 120°/ })).toBeVisible()
  await wheel(page, at, -100, { alt: true })
  expect((await brush(page)).stampScale).toBeCloseTo(1.1)
  await key(page, 'f')
  expect((await brush(page)).stampFlipX).toBe(true)
  await wheel(page, at, 100, { shift: true })
  const shaped = await brush(page)
  expect(shaped.assetIds[0]).not.toBe(CRATE)

  // Ctrl+wheel still zooms while stamping, and leaves the stamp alone.
  const zoom = () => inPage<number>(page, `() => window.__pixiApp.stage.children[0].scale.x`)
  const zoomBefore = await zoom()
  await wheel(page, at, -100, { ctrl: true })
  await waitFrame(page, 4)
  expect(Math.abs((await zoom()) - zoomBefore)).toBeGreaterThan(1e-4)
  expect((await brush(page)).stampRotation).toBeCloseTo((2 * Math.PI) / 3)

  const before = new Set((await propRows(page)).map((p) => p.id))
  await click(page, await screenOf(page, hall.x + 2, hall.y + 2))
  const placed = (await propRows(page)).filter((p) => !before.has(p.id))
  expect(placed).toHaveLength(1)
  const p = placed[0]
  expect(p.assetId).toBe(shaped.assetIds[0])
  expect(p.rotation).toBeCloseTo(shaped.stampRotation)
  expect(p.flipX).toBe(true)
  expect(p.scale).toBe(1)
  // The art at 1.1 times its own size.
  const art = naturalCells(shaped.assetIds[0])
  expect(p.width).toBeCloseTo(art.w * 1.1, 3)
  expect(p.height).toBeCloseTo(art.h * 1.1, 3)

  await undo(page)
  expect((await propRows(page)).some((c) => c.id === p.id)).toBe(false)
})

test('a 2x1 prop snaps its footprint, not its centre, to the ½ grid', { tag: '@objects' }, async ({ page }) => {
  await openWarren(page)
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    st.setSnapEnabled(true)
    st.setSnapDivision(2)
  })
  await pickTool(page, 'stamp')
  await setBrush(page, { stampMode: true, assetIds: [FIREWOOD], stampRotation: 0, stampScale: 1, stampFlipX: false })
  const hall = await roomAnchor(page, 'Warren Hall')
  const before = new Set((await propRows(page)).map((p) => p.id))
  await click(page, await screenOf(page, hall.x + 1.37, hall.y + 1.21))
  const p = (await propRows(page)).find((c) => !before.has(c.id))!
  const art = naturalCells(FIREWOOD)
  expect(p.width).toBeCloseTo(art.w, 3)
  expect(p.height).toBeCloseTo(art.h, 3)
  const onHalf = (v: number) => Math.abs(v * 2 - Math.round(v * 2)) < 1e-6
  expect(onHalf(p.x - p.width / 2)).toBe(true)
  expect(onHalf(p.y - p.height / 2)).toBe(true)
  await undo(page)
})

test('the dock Scale stamps the prop at that scale', { tag: '@objects' }, async ({ page }) => {
  await openWarren(page)
  await pickTool(page, 'stamp')
  await setBrush(page, { stampMode: true, assetIds: [CRATE], stampRotation: 0, stampScale: 1, stampFlipX: false })
  await page.evaluate(() => (window as Any).__store.getState().updateToolSettings({ continuousPlacement: true }))
  const hall = await roomAnchor(page, 'Warren Hall')
  let before = new Set((await propRows(page)).map((p) => p.id))
  await click(page, await screenOf(page, hall.x - 3, hall.y + 2))
  const one = (await propRows(page)).find((c) => !before.has(c.id))!

  // The slider's keys set it: End takes it to the top of its range.
  const slider = dock(page).getByRole('group', { name: 'Scale' }).getByRole('slider')
  expect((await dock(page).getByRole('group', { name: 'Scale' }).boundingBox())!.width).toBeGreaterThan(60)
  await slider.focus()
  await page.keyboard.press('End')
  const top = (await brush(page)).stampScale
  expect(top).toBeGreaterThan(1)
  before = new Set((await propRows(page)).map((p) => p.id))
  await click(page, await screenOf(page, hall.x + 3, hall.y + 2))
  const big = (await propRows(page)).find((c) => !before.has(c.id))!
  expect(big.width / one.width).toBeCloseTo(top)
  expect(big.scale).toBe(1)
  await undo(page)
  await undo(page)
})

/** Whether a prop's drawn box (centre and corners) lies in one room face. Run in the page. */
const IN_ONE_FACE = `(c, faces) => {
  const inRing = (x, y, ring) => {
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j]
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
  }
  const w = (c.width * c.scale) / 2, h = (c.height * c.scale) / 2
  const cos = Math.cos(c.rotation), sin = Math.sin(c.rotation)
  const pts = [[0, 0], [-w, -h], [w, -h], [w, h], [-w, h]].map(([u, v]) => [c.position.x + u * cos - v * sin, c.position.y + u * sin + v * cos])
  return faces.some((f) => pts.every(([x, y]) => inRing(x, y, f)))
}`

/** Whether two props' boxes, shrunk to 0.8, overlap (separating axes). Run in the page. */
const OVERLAP = `(a, b) => {
  const box = (c) => {
    const w = (c.width * c.scale * 0.8) / 2, h = (c.height * c.scale * 0.8) / 2
    const cos = Math.cos(c.rotation), sin = Math.sin(c.rotation)
    return { pts: [[-w, -h], [w, -h], [w, h], [-w, h]].map(([u, v]) => [c.position.x + u * cos - v * sin, c.position.y + u * sin + v * cos]), axes: [[cos, sin], [-sin, cos]] }
  }
  const A = box(a), B = box(b)
  for (const [ax, ay] of [...A.axes, ...B.axes]) {
    const pa = A.pts.map(([x, y]) => x * ax + y * ay), pb = B.pts.map(([x, y]) => x * ax + y * ay)
    if (Math.max(...pa) < Math.min(...pb) - 1e-6 || Math.max(...pb) < Math.min(...pa) - 1e-6) return false
  }
  return true
}`

test('a scatter stroke across Warren Hall into its wall stays on the floor, overlaps nothing, and undoes in one step', { tag: '@objects' }, async ({ page }) => {
  await openWarren(page)
  await pickTool(page, 'scatter')
  await setBrush(page, {
    stampMode: false,
    assetIds: [RUBBLE_S, RUBBLE_M],
    brushRadius: 3,
    density: 0.6,
    avoidOverlap: true,
    stayOnFloor: true,
    tints: ['#a39a8c', '#8c968a'],
  })
  const hall = await roomAnchor(page, 'Warren Hall')
  const right = await inPage<number>(page, `(s, layer) => Math.max(...layer().rooms.find((r) => r.name === 'Warren Hall').face.map((p) => p[0]))`)
  const before = new Set(await childIds(page))

  const start = await screenOf(page, hall.x, hall.y)
  await firePointer(page, 'pointermove', start.x, start.y, 0, 0)
  await firePointer(page, 'pointerdown', start.x, start.y, 0.5, 1)
  for (let x = hall.x; x <= right + 3; x += 0.5) {
    const p = await screenOf(page, x, hall.y)
    await firePointer(page, 'pointermove', p.x, p.y, 0.5, 1)
  }
  const end = await screenOf(page, right + 3, hall.y)
  await firePointer(page, 'pointerup', end.x, end.y, 0, 0)
  await waitFrame(page, 3)
  await expect.poll(async () => (await childIds(page)).filter((id) => !before.has(id)).length).toBeGreaterThan(3)

  const result = await inPage<{ added: number; offFloor: number; overlaps: number; tinted: number }>(
    page,
    `(s, layer, w2s, arg) => {
      const inOne = (${IN_ONE_FACE}); const overlap = (${OVERLAP})
      const faces = layer().rooms.map((r) => r.face)
      const assets = layer().children.filter((c) => c.childType === 'asset' && c.visible !== false)
      const added = assets.filter((c) => !arg.before.includes(c.id))
      let overlaps = 0
      for (const a of added) for (const b of assets) if (a.id !== b.id && overlap(a, b)) overlaps++
      return { added: added.length, offFloor: added.filter((c) => !inOne(c, faces)).length, overlaps, tinted: added.filter((c) => c.tint !== '#ffffff').length }
    }`,
    { before: [...before] },
  )
  expect(result.added).toBeGreaterThan(3)
  expect(result.offFloor).toBe(0)
  expect(result.overlaps).toBe(0)
  expect(result.tinted).toBe(result.added)

  // One Ctrl+Z takes the whole stroke.
  await undo(page)
  expect(new Set(await childIds(page))).toEqual(before)
})

test('an erase stroke takes rubble but spares cave rock and an imported image, and undoes in one step', { tag: '@objects' }, async ({ page }) => {
  await openWarren(page)
  const rubble = await propOf(page, RUBBLE_S)
  // An imported image right beside the rubble, and a piece of the cave kit's rock placed as a
  // prop a little further on (the Warren's own walls are drawn live, so it has none placed).
  const rock = { id: 'e2e-rock', x: rubble.x + 1.5, y: rubble.y }
  await page.evaluate(
    ({ x, y, rock }) => {
      const st = (window as Any).__store.getState()
      const layer = st.layers.find((l: Any) => l.type === 'dungeon')
      st.addChild(layer.id, {
        id: 'e2e-image', name: 'map scrap', childType: 'asset', visible: true, objectType: 'image', assetId: 'e2e-missing-image',
        position: { x, y }, rotation: 0, scale: 1, width: 1, height: 1, tint: '#ffffff', flipX: false, flipY: false,
      })
      st.addChild(layer.id, {
        id: rock.id, name: 'cave rock', childType: 'asset', visible: true, objectType: 'asset', assetId: 'gg-forge:wall_short_2x2_object_A',
        position: { x: rock.x, y: rock.y }, rotation: 0, scale: 1, width: 1, height: 1, tint: '#ffffff', flipX: false, flipY: false,
      })
    },
    { x: rubble.x + 0.6, y: rubble.y, rock },
  )
  await pickTool(page, 'scatter')
  await setBrush(page, { stampMode: false, brushRadius: 1 })
  // Erase is a mode on the tool: the switch in its panel.
  const erase = page.getByTestId('shell-tool-panel').getByRole('switch', { name: 'Erase mode' })
  await expect(erase).toBeVisible()
  await erase.click()
  await expect(page.getByTestId('shell-status-hint')).toContainText('clear props under the brush')
  const before = new Set(await childIds(page))

  const a = await screenOf(page, rubble.x, rubble.y)
  await firePointer(page, 'pointermove', a.x, a.y, 0, 0)
  await firePointer(page, 'pointerdown', a.x, a.y, 0.5, 1)
  const b = await screenOf(page, rubble.x + 0.6, rubble.y)
  await firePointer(page, 'pointermove', b.x, b.y, 0.5, 1)
  const c = await screenOf(page, rock.x, rock.y)
  await firePointer(page, 'pointermove', c.x, c.y, 0.5, 1)
  await firePointer(page, 'pointerup', c.x, c.y, 0, 0)
  await waitFrame(page, 3)
  const after = new Set(await childIds(page))
  expect(after.has(rubble.id)).toBe(false)
  expect(after.has(rock.id)).toBe(true)
  expect(after.has('e2e-image')).toBe(true)

  await erase.click()
  await undo(page)
  expect(new Set(await childIds(page))).toEqual(before)
})

test('the card W on a prop turned 90° grows its own length, not its width on screen', { tag: '@objects' }, async ({ page }) => {
  await openWarren(page)
  const COT = 'gg-demo:bed_small_single_cot_1x2_object_A'
  const cot = await propOf(page, COT)
  await select(page, [cot.id])
  await expect(card(page)).toHaveAttribute('data-kind', 'asset')
  const angle = card(page).getByLabel('Degrees')
  await angle.fill('90')
  await angle.press('Enter')
  const turned = await propOf(page, COT)
  expect(turned.rotation).toBeCloseTo(Math.PI / 2)
  const w0 = turned.width * turned.scale
  const h0 = turned.height * turned.scale
  const link = card(page).getByRole('button', { name: 'Keep W:H ratio' })
  if ((await link.getAttribute('aria-pressed')) === 'true') await link.click()
  const w = card(page).getByLabel('W', { exact: true })
  await w.fill((w0 + 1).toFixed(2))
  await w.press('Enter')
  const grown = await propOf(page, COT)
  expect(grown.width * grown.scale).toBeCloseTo(w0 + 1, 2)
  expect(grown.height * grown.scale).toBeCloseTo(h0, 2)
  expect(grown.rotation).toBeCloseTo(Math.PI / 2)
  await undo(page)
  await undo(page)
  expect((await propOf(page, COT)).rotation).toBeCloseTo(cot.rotation)
})

test('z-order keys move a prop in the layer order', { tag: '@objects' }, async ({ page }) => {
  await openWarren(page)
  const crate = await propOf(page, CRATE)
  const order = async () => (await propRows(page)).map((p) => p.id)
  const start = await order()
  await select(page, [crate.id])
  await key(page, 'Control+Shift+BracketLeft')
  expect((await order())[0]).toBe(crate.id)
  await key(page, 'Control+BracketRight')
  expect((await order())[1]).toBe(crate.id)
  await undo(page)
  await undo(page)
  expect(await order()).toEqual(start)
})

test('a sibling swap from the card keeps the footprint; Replace opens the library on it', { tag: '@objects' }, async ({ page }) => {
  await openWarren(page)
  const crate = await propOf(page, CRATE)
  await select(page, [crate.id])
  const variants = card(page).locator('[data-section="Variant"]')
  await variants.getByRole('button', { name: 'storage crates 2 dark' }).click()
  const swapped = (await propRows(page)).find((p) => p.id === crate.id)!
  expect(swapped.assetId).toBe('gg-demo:storage_crates_2_dark_1x1_object_A')
  for (const k of ['x', 'y', 'rotation'] as const) expect(swapped[k]).toBeCloseTo(crate[k])
  expect(swapped.width * swapped.scale).toBeCloseTo(crate.width * crate.scale)
  expect(swapped.height * swapped.scale).toBeCloseTo(crate.height * crate.scale)
  await undo(page)

  await variants.getByRole('button', { name: 'Replace…' }).click()
  expect(await inPage<string[] | null>(page, `(s) => s().ui.propReplaceIds`)).toEqual([crate.id])
  await expect(page.getByTestId('shell-assets')).toBeVisible()
})

test('a locked prop selects on click but never moves, offers Unlock on right-click, and unlocks', { tag: '@objects' }, async ({ page }) => {
  await openWarren(page)
  // The boulder: no light sits on it, so a click and a right-click reach the prop itself.
  const BOULDER = 'gg-demo:boulder_2x2_object_A'
  const boulder = await propOf(page, BOULDER)
  const at = await screenOf(page, boulder.x, boulder.y)
  // Unlocked, a click takes it.
  await click(page, at)
  expect(await inPage<string[]>(page, `(s) => s().selection.selectedIds`)).toEqual([boulder.id])
  await card(page).getByRole('switch', { name: 'Lock', exact: true }).click()
  expect((await propOf(page, BOULDER)).locked).toBe(true)
  // A locked selection's line is the Select tool's locked one, ahead of the prop's keys.
  await expect(page.getByTestId('shell-status-hint')).toContainText('locked, Unlock in the card')
  await select(page, [])
  // Locked on its own: a click still selects it (its card can unlock it), a drag never moves it.
  await click(page, at)
  expect(await inPage<string[]>(page, `(s) => s().selection.selectedIds`)).toContain(boulder.id)
  await firePointer(page, 'pointerdown', at.x, at.y, 0.5, 1)
  await firePointer(page, 'pointermove', at.x + 60, at.y + 20, 0.5, 1)
  await firePointer(page, 'pointerup', at.x + 60, at.y + 20, 0, 0)
  await waitFrame(page, 2)
  expect((await propOf(page, BOULDER)).x).toBeCloseTo(boulder.x)

  await rightClick(page, at)
  const unlock = page.getByRole('menuitem', { name: 'Unlock' })
  await expect(unlock).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Delete Del' })).toHaveCount(0)
  await unlock.click()
  expect((await propOf(page, BOULDER)).locked).toBeFalsy()
})

test('Ctrl+G groups props, Ctrl+Shift+G gives the members back, and undo re-groups them', { tag: '@objects' }, async ({ page }) => {
  await openWarren(page)
  const ids = await Promise.all(THREE.map(async (a) => (await propOf(page, a)).id))
  const members = async () => (await propRows(page)).filter((p) => ids.includes(p.id))
  await select(page, ids)
  await key(page, 'Control+g')
  const grouped = await members()
  expect(new Set(grouped.map((p) => p.groupId)).size).toBe(1)
  expect(grouped.every((p) => !!p.groupId)).toBe(true)
  await select(page, ids)
  await key(page, 'Control+Shift+g')
  expect((await members()).every((p) => !p.groupId)).toBe(true)
  await undo(page)
  expect((await members()).every((p) => !!p.groupId)).toBe(true)
})

test('a group has its own card: a name field and Ungroup', { tag: '@objects' }, async ({ page }) => {
  await openWarren(page)
  const ids = await Promise.all(THREE.map(async (a) => (await propOf(page, a)).id))
  await select(page, ids)
  await key(page, 'Control+g')
  await select(page, ids)
  const name = card(page).getByLabel('Group name')
  await expect(name).toBeVisible()
  await name.fill('Supply corner')
  await name.press('Enter')
  await expect(card(page).locator('[data-composite="panel-header"]')).toContainText('Supply corner')
  await card(page).getByRole('button', { name: 'Ungroup' }).click()
  expect((await propRows(page)).filter((p) => ids.includes(p.id)).every((p) => !p.groupId)).toBe(true)
  await undo(page)
  expect((await propRows(page)).filter((p) => ids.includes(p.id)).every((p) => !!p.groupId)).toBe(true)
})

test('an attached light follows nudge, rotate 90, flip, duplicate and move to layer', { tag: '@objects' }, async ({ page }) => {
  await openWarren(page)
  const BRAZIER = 'gg-demo:light_brazier_1_a_1x1_object_A'
  const brazier = await propOf(page, BRAZIER)
  // Attach the den's light two squares east of the brazier, clear of its art.
  await page.evaluate(
    ({ id, x, y }) => {
      const st = (window as Any).__store.getState()
      const layer = st.layers.find((l: Any) => l.type === 'dungeon')
      st.updateChild(layer.id, 'light-den-brazier', { attachedTo: id, position: { x: x + 2, y } })
    },
    { id: brazier.id, x: brazier.x, y: brazier.y },
  )
  const light = () =>
    inPage<{ x: number; y: number; layerId: string }>(
      page,
      `(s) => { for (const l of s().layers) { const c = (l.children ?? []).find((x) => x.id === 'light-den-brazier'); if (c) return { x: c.position.x, y: c.position.y, layerId: l.id } } return null }`,
    )
  const offset = async () => {
    const b = await propOf(page, BRAZIER)
    const l = await light()
    return { dx: l.x - b.x, dy: l.y - b.y }
  }
  await select(page, [brazier.id])
  await blur(page)

  await page.keyboard.press('ArrowRight')
  await waitFrame(page, 2)
  expect((await propOf(page, BRAZIER)).x).toBeGreaterThan(brazier.x)
  expect((await offset()).dx).toBeCloseTo(2)

  const here = async () => {
    const b = await propOf(page, BRAZIER)
    return screenOf(page, b.x, b.y)
  }
  await rightClick(page, await here())
  await page.getByRole('menuitem', { name: 'Rotate 90°' }).click()
  await waitFrame(page, 2)
  const turned = await offset()
  expect(Math.hypot(turned.dx, turned.dy)).toBeCloseTo(2)
  expect(Math.abs(turned.dx)).toBeLessThan(1e-6)

  await select(page, [brazier.id])
  await blur(page)
  const flipFrom = (await propOf(page, BRAZIER)).flipX
  await page.keyboard.press('Shift+h')
  await waitFrame(page, 2)
  expect((await propOf(page, BRAZIER)).flipX).toBe(!flipFrom)
  const flipped = await offset()
  expect(Math.hypot(flipped.dx, flipped.dy)).toBeCloseTo(2)

  const lightsBefore = await inPage<number>(page, `(s, layer) => layer().children.filter((c) => c.childType === 'light').length`)
  await page.keyboard.press('Control+d')
  await waitFrame(page, 2)
  const copied = await inPage<{ lights: number; attached: boolean }>(
    page,
    `(s, layer, w2s, arg) => {
      const kids = layer().children
      const copy = kids.find((c) => c.childType === 'asset' && c.assetId === arg.asset && c.id !== arg.id)
      const lights = kids.filter((c) => c.childType === 'light')
      return { lights: lights.length, attached: !!copy && lights.some((l) => l.attachedTo === copy.id) }
    }`,
    { asset: BRAZIER, id: brazier.id },
  )
  expect(copied.lights).toBe(lightsBefore + 1)
  expect(copied.attached).toBe(true)
  await undo(page)

  // A second map layer to move to.
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const src = st.layers.find((l: Any) => l.type === 'dungeon')
    const copy = structuredClone(src)
    Object.assign(copy, { id: 'e2e-upper', name: 'Upper', children: [], rooms: [], areas: [], groups: [], standaloneWalls: [], mergedFloor: null })
    st.addLayer(copy)
  })
  await select(page, [brazier.id])
  await rightClick(page, await here())
  await page.getByRole('menuitem', { name: 'Move to layer' }).click()
  await page.getByRole('menuitem', { name: 'Upper' }).click()
  await waitFrame(page, 2)
  expect((await light()).layerId).toBe('e2e-upper')
})

test('overhead draws the web above everything; See under overhead, in the View menu, fades it', { tag: '@objects' }, async ({ page }) => {
  await openWarren(page)
  const WEB = 'gg-demo:spider_web_3x2_object_A'
  const web = await propOf(page, WEB)
  await select(page, [web.id])
  await card(page).getByRole('switch', { name: 'Overhead', exact: true }).click()
  expect((await propOf(page, WEB)).overhead).toBe(true)
  await waitFrame(page, 3)
  const overhead = () =>
    inPage<{ count: number; alpha: number }>(
      page,
      `() => {
        const find = (c) => c.label === 'overheadContainer' ? c : (c.children ?? []).map(find).find(Boolean)
        const box = find(window.__pixiApp.stage)
        const kids = box ? box.children : []
        return { count: kids.length, alpha: kids.length ? Math.min(...kids.map((k) => k.alpha)) : 1 }
      }`,
    )
  expect((await overhead()).count).toBeGreaterThan(0)
  expect((await overhead()).alpha).toBeGreaterThan(0.9)

  await page.getByTestId('shell-more').click()
  await page.getByRole('menuitemcheckbox', { name: 'See under overhead' }).click()
  expect(await inPage(page, `(s) => s().ui.seeUnderOverhead`)).toBe(true)
  await waitFrame(page, 3)
  expect((await overhead()).alpha).toBeLessThan(0.5)
  // A check item leaves the menu open, so the same row turns it off again.
  await page.getByRole('menuitemcheckbox', { name: 'See under overhead' }).click()
  expect(await inPage(page, `(s) => s().ui.seeUnderOverhead`)).toBe(false)
  await page.keyboard.press('Escape')
  await undo(page)
  expect((await propOf(page, WEB)).overhead).toBeFalsy()
})

/** The first Pixi node labelled `label` under the stage, its bounds in canvas pixels, or null. */
const pixiNode = (page: Page, label: string) =>
  inPage<{ visible: boolean; x: number; y: number; w: number; h: number } | null>(
    page,
    `(s, layer, w2s, label) => {
      const find = (c) => c.label === label ? c : (c.children ?? []).map(find).find(Boolean)
      const n = find(window.__pixiApp.stage)
      if (!n) return null
      const b = n.getBounds()
      return { visible: n.visible, x: b.x, y: b.y, w: b.width, h: b.height }
    }`,
    label,
  )

test('the Stamp dock: a strip of prop tiles with the Library after them; Scatter defaults and two tints that differ', { tag: '@objects' }, async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 911 })
  await openWarren(page)
  await page.evaluate((id) => (window as Any).__store.getState().toggleFavourite(id), 'gg-demo:storage_barrel_1_dark_1x1_object_A')
  await pickTool(page, 'stamp')
  await setBrush(page, { stampMode: true, assetIds: [CRATE] })
  await waitFrame(page, 3)
  const strip = dock(page).locator('[data-column="props"]')
  const tiles = strip.locator('[data-composite="tile"]')
  // Six prop tiles and the Library tile after them, the starred barrel leading, all inside the dock.
  await expect(tiles).toHaveCount(6)
  await expect(tiles.first()).toHaveAccessibleName(/storage barrel 1 dark/)
  await expect(strip.locator('[data-composite="add-tile"]')).toContainText('Library')
  const fit = await page.evaluate(() => {
    const d = document.querySelector('[data-testid="shell-dock"]')!.getBoundingClientRect()
    const tiles = [...document.querySelectorAll('[data-column="props"] [data-composite="tile"], [data-column="props"] [data-composite="add-tile"]')].map((t) => t.getBoundingClientRect())
    return tiles.every((r) => r.left >= d.left - 1 && r.right <= d.right + 1)
  })
  expect(fit).toBe(true)
  // Scale is a track wide enough to set by hand.
  expect((await dock(page).getByRole('group', { name: 'Scale' }).boundingBox())!.width).toBeGreaterThanOrEqual(60)

  // Scatter: the board's defaults, and each added tint its own colour.
  const panel = page.getByTestId('shell-tool-panel')
  await panel.getByRole('button', { name: 'Scatter' }).click()
  await expect(panel.getByRole('switch', { name: 'Random variant' })).toHaveAttribute('aria-checked', 'true')
  expect((await brush(page)).minSpacing).toBe(0.5)
  await panel.getByRole('button', { name: 'Add a tint' }).click()
  await panel.getByRole('button', { name: 'Add a tint' }).click()
  const tints: string[] = (await brush(page)).tints
  expect(tints).toHaveLength(2)
  expect(tints[0]).not.toBe(tints[1])
})

test('erase is left behind with the tool: Select, then Scatter again, comes back painting', { tag: '@objects' }, async ({ page }) => {
  await openWarren(page)
  await pickTool(page, 'scatter')
  const erase = page.getByTestId('shell-tool-panel').getByRole('switch', { name: 'Erase mode' })
  await expect(erase).toBeVisible()
  await erase.click()
  expect(await inPage(page, `(s) => s().tools.eraseMode`)).toBe(true)
  await pickTool(page, 'select')
  await pickTool(page, 'scatter')
  expect(await inPage(page, `(s) => s().tools.eraseMode`)).toBe(false)
  expect((await brush(page)).stampMode).toBe(false)
  await expect(page.getByTestId('shell-status-hint')).not.toContainText('clear props under the brush')
})

test('the card follows: the selection outline moves with an X edit, the box survives lock and ungroup, a locked prop’s row is Unlock and More', { tag: '@objects' }, async ({ page }) => {
  await openWarren(page)
  const barrel = await propOf(page, THREE[0])
  await page.evaluate(({ id }) => {
    const st = (window as Any).__store.getState()
    const layer = st.layers.find((l: Any) => l.type === 'dungeon')
    st.updateChild(layer.id, id, { rotation: Math.PI / 4 })
  }, { id: barrel.id })
  await select(page, [barrel.id])
  // Hover the barrel: its outline is drawn where it is.
  const at = await screenOf(page, barrel.x, barrel.y)
  await firePointer(page, 'pointermove', at.x, at.y)
  await waitFrame(page, 2)
  const before = (await pixiNode(page, 'selectHover'))!
  expect(before.w).toBeGreaterThan(0)
  // Move it from the card: the outline goes along, none is left at the old spot.
  const x = card(page).getByLabel('X', { exact: true })
  await x.fill(String(barrel.x + 3))
  await x.press('Enter')
  await waitFrame(page, 3)
  const after = (await pixiNode(page, 'selectHover'))!
  const moved = await screenOf(page, barrel.x + 3, barrel.y)
  const canvasLeft = await page.evaluate(() => document.querySelector('canvas')!.getBoundingClientRect().left)
  expect(Math.abs(after.x + after.w / 2 + canvasLeft - moved.x)).toBeLessThan(2)
  expect(after.x).toBeGreaterThan(before.x + 1)

  // Group, lock all, unlock all, ungroup: still three props selected, boxed.
  const ids = await Promise.all(THREE.map(async (a) => (await propOf(page, a)).id))
  await select(page, ids)
  await key(page, 'Control+g')
  await select(page, ids)
  await key(page, 'Control+Shift+l')
  await key(page, 'Control+Shift+l')
  await key(page, 'Control+Shift+g')
  await waitFrame(page, 3)
  expect(await inPage<string[]>(page, `(s) => s().selection.selectedIds`)).toEqual(ids)
  await expect(card(page)).toHaveAttribute('data-kind', 'mixed')
  const gizmo = await pixiNode(page, 'transformGizmo')
  expect(gizmo?.visible).toBe(true)
  expect(gizmo!.w).toBeGreaterThan(10)

  // A locked prop: the card's action row offers Unlock and the menu, nothing else.
  await select(page, [barrel.id])
  await card(page).getByRole('switch', { name: 'Lock', exact: true }).click()
  const row = card(page).locator('[data-composite="action-row"]')
  await expect(row.getByRole('button')).toHaveCount(2)
  await expect(row.getByRole('button', { name: 'More' })).toBeVisible()
  await row.getByRole('button', { name: 'Unlock' }).click()
  expect((await propOf(page, THREE[0])).locked).toBeFalsy()
  await expect(row.getByRole('button', { name: 'Lock', exact: true })).toBeVisible()
})

test('the prop menu: Move to layer stays on the level, Overhead is an empty check, a swap closes the menu', { tag: '@objects' }, async ({ page }) => {
  await openWarren(page)
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const src = st.layers.find((l: Any) => l.type === 'dungeon')
    st.addLevel({ id: 'e2e-level-2', name: 'Level 2' })
    const blank = { children: [], rooms: [], areas: [], groups: [], standaloneWalls: [], mergedFloor: null }
    st.addLayer(Object.assign(structuredClone(src), blank, { id: 'e2e-same', name: 'Same level' }))
    st.addLayer(Object.assign(structuredClone(src), blank, { id: 'e2e-other', name: 'Other level', levelId: 'e2e-level-2' }))
    st.setActiveLayerId(src.id)
  })
  const levelBefore = await inPage<string>(page, `(s) => s().ui.activeLevelId`)
  const crate = await propOf(page, CRATE)
  const at = await screenOf(page, crate.x, crate.y)
  await select(page, [crate.id])
  await rightClick(page, at)
  const overhead = page.getByRole('menuitemcheckbox', { name: 'Overhead' })
  await expect(overhead).toHaveAttribute('aria-checked', 'false')
  await expect(overhead.locator('[data-look="check"]')).toHaveCount(1)
  await expect(overhead.locator('[data-look="check"] svg')).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'Move to layer' }).click()
  await expect(page.getByRole('menuitem', { name: 'Same level' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Other level' })).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'Same level' }).click()
  await waitFrame(page, 2)
  expect(await inPage<string>(page, `(s) => s().ui.activeLevelId`)).toBe(levelBefore)
  await undo(page)

  await select(page, [crate.id])
  await rightClick(page, at)
  await page.getByRole('menuitemradio', { name: 'storage crates 2 dark' }).click()
  await waitFrame(page, 2)
  expect((await propRows(page)).find((p) => p.id === crate.id)!.assetId).toBe('gg-demo:storage_crates_2_dark_1x1_object_A')
  await expect(page.getByRole('menu')).toHaveCount(0)
})
