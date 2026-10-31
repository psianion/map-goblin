import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page, type Locator } from '@playwright/test'
import { firePointer, waitForBoot, waitFrame } from './helpers'

/**
 * Layers in /v2, end to end: the filmstrip as the layer panel (names and counts, lock,
 * Alt-click solo, rename in place, drag to reorder with a pixel check, the tile menu and
 * its guards, Duplicate), drop to layer from a canvas drag, the Layers sheet (levels,
 * wall and room rows, per-object lock, the name filter, cross-level drag), levels in the
 * chrome (Page Up and Down, the title card, Delete level), the gear sheet's Labels row
 * and the background colour (pixels), no accent colour, and v1 keeping its panel.
 */

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any
type Pt = { x: number; y: number }

const WARREN = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../session/testdata/goblin-warren.mapbuilder', import.meta.url)), 'utf8'),
)

const CRATE = 'gg-demo:storage_crates_1_dark_1x1_object_A'

/** Run `fn` (source text) in the page with the store getter and a world → screen mapping. */
async function inPage<T>(page: Page, fn: string, arg?: unknown): Promise<T> {
  return page.evaluate(
    ({ fn, arg }) => {
      const w = window as Any
      const s = () => w.__store.getState()
      const w2s = (x: number, y: number) => {
        const r = w.__pixiApp.canvas.getBoundingClientRect()
        const wd = w.__pixiApp.stage.children[0]
        return { x: r.left + x * wd.scale.x + wd.position.x, y: r.top + y * wd.scale.x + wd.position.y }
      }
      return new Function('s', 'w2s', 'arg', `return (${fn})(s, w2s, arg)`)(s, w2s, arg)
    },
    { fn, arg },
  )
}

/**
 * Pixel reads go through `window.__readCanvas`: it reads the canvas's own buffer, whatever
 * render target is bound between frames (a tile thumbnail's, say), and puts the binding back.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as Any).__readCanvas = (read: (gl: WebGL2RenderingContext) => void) => {
      const canvas = (window as Any).__pixiApp.canvas
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
      const gl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext
      const draw = gl.getParameter(gl.FRAMEBUFFER_BINDING)
      const readFb = gl2 ? gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) : null
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      try {
        read(gl)
      } finally {
        gl.bindFramebuffer(gl.FRAMEBUFFER, draw)
        if (gl2) gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFb)
      }
    }
  })
})

const store = <T>(page: Page, fn: string, arg?: unknown) => inPage<T>(page, fn, arg)
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())

async function key(page: Page, combo: string) {
  await blur(page)
  await page.keyboard.press(combo)
  await waitFrame(page, 2)
}

/** Into the /v2 editor on a fresh blank map: one level, one layer. */
async function openEditor(page: Page): Promise<void> {
  await page.goto('/v2?e2e=1')
  await waitForBoot(page)
  await page.getByTestId('v2-new-map-card').click()
  await page.getByTestId('v2-new-map-submit').click()
  await expect(page.getByTestId('v2-editor')).toBeVisible()
  await store(page, `(s) => s().setActiveTool('select')`)
}

/** A copy of the goblin warren, framed, the Select tool in hand. */
async function openWarren(page: Page): Promise<void> {
  await openEditor(page)
  await page.evaluate(async (data) => {
    const st = (window as Any).__store.getState()
    st.loadFromFile(structuredClone(data))
    st.setRoomsSheetOpen(false)
    st.setSelectedIds([])
    await st.saveCurrentMap()
  }, WARREN)
  await page.waitForFunction(() => {
    const l = (window as Any).__store.getState().layers.find((x: Any) => x.type === 'dungeon')
    return (l?.rooms ?? []).length > 0 && l.rooms.every((r: Any) => Array.isArray(r.face) && r.face.length > 2)
  })
  await store(page, `(s) => { const l = s().layers.find((x) => x.type === 'dungeon'); s().setActiveLayerId(l.id); s().setActiveTool('select') }`)
  await page.keyboard.press('Control+0')
  await waitFrame(page, 6)
}

/** A new empty layer on the level on show, named, on top; its id. */
const addLayer = (page: Page, name: string, levelId?: string) =>
  store<string>(
    page,
    `(s, w2s, a) => {
      const base = s().layers.find((x) => x.type === 'dungeon')
      const l = structuredClone(base)
      l.id = crypto.randomUUID(); l.name = a.name; l.children = []; l.standaloneWalls = []; l.locked = false; l.visible = true
      delete l.rooms; delete l.areas; delete l.thresholds; delete l.floorWallEdits; l.mergedFloor = null; delete l.groups
      l.levelId = a.levelId ?? s().ui.activeLevelId
      s().addLayer(l)
      return l.id
    }`,
    { name, levelId },
  )

const layerByName = (page: Page, name: string) => store<Any>(page, `(s, w2s, n) => s().layers.find((l) => l.name === n)`, name)
const layerNames = (page: Page) => store<string[]>(page, `(s) => s().layers.filter((l) => l.type === 'dungeon').map((l) => l.name)`)
const activeLayer = (page: Page) => store<string>(page, `(s) => s().ui.activeLayerId`)

const crate = (id: string, at: Pt, extra: Record<string, unknown> = {}) => ({
  id, name: id, childType: 'asset', visible: true, objectType: 'asset', assetId: CRATE, position: at, rotation: 0, scale: 1,
  width: 1, height: 1, tint: '#ffffff', flipX: false, flipY: false, ...extra,
})

const addChildTo = (page: Page, layerId: string, child: Record<string, unknown>) =>
  store<void>(page, `(s, w2s, a) => s().addChild(a.layerId, a.child)`, { layerId, child })

const tile = (page: Page, name: string): Locator =>
  page.getByTestId('v2-film-tile').filter({ has: page.getByRole('button', { name: `Draw on ${name}`, exact: true }) })

const toaster = (page: Page) => page.getByLabel('Notifications alt+T')

/** A canvas-dispatched drag, in steps, so the Select tool sees travel. */
async function canvasDrag(page: Page, from: Pt, to: Pt, steps = 8) {
  await firePointer(page, 'pointermove', from.x, from.y)
  await firePointer(page, 'pointerdown', from.x, from.y, 0.5, 1)
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    await firePointer(page, 'pointermove', from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, 0.5, 1)
    await waitFrame(page, 1)
  }
}

/** A real mouse drag between two DOM points (dnd-kit listens for pointer events on the page). */
async function mouseDrag(page: Page, from: Pt, to: Pt) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 8, from.y + 2, { steps: 3 })
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await waitFrame(page, 2)
  await page.mouse.up()
  await waitFrame(page, 3)
}

/** The canvas pixel over a world point, mapped and read in one go. */
const pixelAtWorld = (page: Page, world: Pt) =>
  inPage<{ r: number; g: number; b: number; a: number }>(
    page,
    `(s, w2s, p) => {
      const canvas = window.__pixiApp.canvas
      const r = canvas.getBoundingClientRect()
      const at = w2s(p.x, p.y)
      const x = Math.round((at.x - r.left) * devicePixelRatio), y = Math.round((at.y - r.top) * devicePixelRatio)
      const out = new Uint8Array(4)
      window.__readCanvas((gl) => gl.readPixels(x, canvas.height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out))
      return { r: out[0], g: out[1], b: out[2], a: out[3] }
    }`,
    world,
  )

const centre = async (l: Locator): Promise<Pt> => {
  const b = (await l.boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

// ─── Filmstrip ───────────────────────────────────────────────────────────────

test('every tile shows its name and object count under it', async ({ page }) => {
  await openWarren(page)
  const t = tile(page, 'Warren')
  await expect(t.getByTestId('v2-film-name')).toHaveText('Warren')
  const count = await store<number>(page, `(s) => { const l = s().layers.find((x) => x.type === 'dungeon'); return l.children.length + l.standaloneWalls.length + l.rooms.length }`)
  await expect(t.getByTestId('v2-film-count')).toHaveText(String(count))
  await expect(tile(page, 'Terrain').getByTestId('v2-film-name')).toHaveText('Terrain')
})

test('a lock from the tile blocks drawing with a toast; unlocking lets it draw', async ({ page }) => {
  await openEditor(page)
  const t = tile(page, 'Layer 1')
  await t.hover()
  await t.getByRole('button', { name: 'Lock Layer 1' }).click()
  expect((await layerByName(page, 'Layer 1')).locked).toBe(true)
  await store(page, `(s) => s().setActiveTool('rectangle')`)
  const a = await inPage<Pt>(page, `(s, w2s) => w2s(2, 2)`)
  const b = await inPage<Pt>(page, `(s, w2s) => w2s(5, 5)`)
  await firePointer(page, 'pointerdown', a.x, a.y, 0.5, 1)
  await firePointer(page, 'pointermove', b.x, b.y, 0.5, 1)
  await firePointer(page, 'pointerup', b.x, b.y)
  await waitFrame(page, 2)
  await expect(toaster(page).getByText('Layer is locked')).toBeVisible()
  expect((await layerByName(page, 'Layer 1')).children).toHaveLength(0)
  await t.hover()
  await t.getByRole('button', { name: 'Unlock Layer 1' }).click()
  await firePointer(page, 'pointerdown', a.x, a.y, 0.5, 1)
  await firePointer(page, 'pointermove', b.x, b.y, 0.5, 1)
  await firePointer(page, 'pointerup', b.x, b.y)
  await waitFrame(page, 2)
  expect((await layerByName(page, 'Layer 1')).children.length).toBeGreaterThan(0)
})

test('Alt+click on an eye solos that layer and dims every other tile', async ({ page }) => {
  await openEditor(page)
  await addLayer(page, 'Lights')
  await addLayer(page, 'Props')
  const lights = tile(page, 'Lights')
  await lights.hover()
  await lights.getByTestId('v2-film-eye').click({ modifiers: ['Alt'] })
  expect(await store(page, `(s) => s().ui.solo?.layerId`)).toBe((await layerByName(page, 'Lights')).id)
  await expect(tile(page, 'Props')).toHaveClass(/v2-tile--soloout/)
  await expect(tile(page, 'Layer 1')).toHaveClass(/v2-tile--soloout/)
  await expect(lights).not.toHaveClass(/v2-tile--soloout/)
  await expect(lights.getByTestId('v2-film-eye')).toHaveClass(/v2-tile__eye--solo/)
  await expect(page.getByTestId('v2-status')).toContainText('Soloing Lights')
})

test('a double-click on a tile name renames it in place; Escape keeps the old name', async ({ page }) => {
  await openEditor(page)
  await tile(page, 'Layer 1').getByTestId('v2-film-name').dblclick()
  const input = page.getByRole('textbox', { name: 'Layer name' })
  await input.fill('Cave walls')
  await input.press('Enter')
  await expect(tile(page, 'Cave walls')).toBeVisible()
  await tile(page, 'Cave walls').getByTestId('v2-film-name').dblclick()
  await page.getByRole('textbox', { name: 'Layer name' }).fill('Nope')
  await page.getByRole('textbox', { name: 'Layer name' }).press('Escape')
  expect(await layerNames(page)).toEqual(['Cave walls'])
})

test('dragging a tile right changes the draw order; one undo puts order and active layer back', async ({ page }) => {
  await openEditor(page)
  const lower = (await layerByName(page, 'Layer 1')).id
  const upperId = await addLayer(page, 'Upper')
  // The same crate on both layers: red on the bottom one, plain on the top one.
  await addChildTo(page, lower, crate('red', { x: 6, y: 6 }, { tint: '#ff0000', width: 3, height: 3 }))
  await addChildTo(page, upperId, crate('plain', { x: 6, y: 6 }, { width: 3, height: 3 }))
  await store(page, `(s, w2s, id) => s().setActiveLayerId(id)`, lower)
  await waitFrame(page, 8)
  // The plain crate on top: green is there. The red one on top: green is gone. Read where the
  // crates are now (the camera may still be settling) and let the textures land.
  const crateCentre = () => pixelAtWorld(page, { x: 6, y: 6 })
  await expect.poll(async () => (await crateCentre()).g, { timeout: 30_000 }).toBeGreaterThan(12)
  const before = await crateCentre()

  const upper = await centre(tile(page, 'Upper'))
  await mouseDrag(page, await centre(tile(page, 'Layer 1')), { x: upper.x + 20, y: upper.y })
  expect(await layerNames(page)).toEqual(['Upper', 'Layer 1'])
  await expect.poll(async () => (await crateCentre()).g, { timeout: 30_000 }).toBeLessThan(before.g * 0.5)
  const after = await crateCentre()
  expect(after.r).toBeGreaterThan(after.g)

  await store(page, `(s, w2s, id) => s().setActiveLayerId(id)`, upperId)
  await key(page, 'Control+z')
  expect(await layerNames(page)).toEqual(['Layer 1', 'Upper'])
  expect(await activeLayer(page)).toBe(lower)
})

test('Ctrl+Z with the dragged tile still focused undoes the reorder and puts the active layer back', async ({ page }) => {
  await openEditor(page)
  const lower = (await layerByName(page, 'Layer 1')).id
  const upperId = await addLayer(page, 'Upper')
  await store(page, `(s, w2s, id) => s().setActiveLayerId(id)`, lower)
  const upper = await centre(tile(page, 'Upper'))
  await mouseDrag(page, await centre(tile(page, 'Layer 1')), { x: upper.x + 20, y: upper.y })
  expect(await layerNames(page)).toEqual(['Upper', 'Layer 1'])
  await store(page, `(s, w2s, id) => s().setActiveLayerId(id)`, upperId)
  // Focus stays on the tile the drag started from, as the press that began it leaves it.
  await tile(page, 'Layer 1').focus()
  await page.keyboard.press('Control+z')
  await waitFrame(page, 2)
  expect(await layerNames(page)).toEqual(['Layer 1', 'Upper'])
  expect(await activeLayer(page)).toBe(lower)
})

test('the tile menu refuses to delete the last layer of a level', async ({ page }) => {
  await openEditor(page)
  await tile(page, 'Layer 1').click({ button: 'right' })
  const del = page.getByRole('menuitem', { name: 'Delete layer' })
  await expect(del).toBeDisabled()
  await page.keyboard.press('Escape')
  await tile(page, 'Layer 1').focus()
  await page.keyboard.press('Delete')
  await expect(toaster(page).getByText('A level needs one layer. Delete the level instead.')).toBeVisible()
  expect(await layerNames(page)).toEqual(['Layer 1'])
})

test('Duplicate puts the copy on the tile right of the source; its rooms get new ids', async ({ page }) => {
  await openWarren(page)
  await tile(page, 'Warren').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Duplicate' }).click()
  await expect(tile(page, 'Warren copy')).toBeVisible()
  const names = await page.getByTestId('v2-film-name').allTextContents()
  expect(names.indexOf('Warren copy')).toBe(names.indexOf('Warren') + 1)
  const ids = await store<{ src: string[]; copy: string[]; copyChildren: number; srcChildren: number }>(
    page,
    `(s) => { const src = s().layers.find((l) => l.name === 'Warren'); const copy = s().layers.find((l) => l.name === 'Warren copy');
      return { src: src.rooms.map((r) => r.id), copy: copy.rooms.map((r) => r.id), copyChildren: copy.children.length, srcChildren: src.children.length } }`,
  )
  expect(ids.copy).toHaveLength(ids.src.length)
  expect(ids.copy.some((id) => ids.src.includes(id))).toBe(false)
  expect(ids.copyChildren).toBe(ids.srcChildren)
  expect(await activeLayer(page)).toBe((await layerByName(page, 'Warren copy')).id)
})

test('a prop dragged from the canvas onto another tile moves there, with a ring, a toast and one undo', async ({ page }) => {
  await openEditor(page)
  const home = (await layerByName(page, 'Layer 1')).id
  const lightsId = await addLayer(page, 'Lights')
  await addChildTo(page, home, crate('box', { x: 6, y: 6 }, { width: 2, height: 2 }))
  await store(page, `(s, w2s, id) => { s().setActiveLayerId(id); s().setSelectedIds(['box']) }`, home)
  await waitFrame(page, 4)
  const from = await inPage<Pt>(page, `(s, w2s) => w2s(6, 6)`)
  const to = await centre(tile(page, 'Lights'))
  await canvasDrag(page, from, to)
  await expect(tile(page, 'Lights')).toHaveClass(/v2-tile--drop/)
  await expect(page.getByTestId('v2-status')).toContainText('Release to move to Lights')
  await firePointer(page, 'pointerup', to.x, to.y)
  await waitFrame(page, 3)
  await expect(tile(page, 'Lights')).not.toHaveClass(/v2-tile--drop/)
  await expect(toaster(page).getByText('Moved 1 object to Lights')).toBeVisible()
  const moved = await store<{ home: string[]; lights: string[]; pos: Pt }>(
    page,
    `(s, w2s, a) => { const L = (id) => s().layers.find((l) => l.id === id); const box = L(a.lightsId).children.find((c) => c.id === 'box');
      return { home: L(a.home).children.map((c) => c.id), lights: L(a.lightsId).children.map((c) => c.id), pos: box?.position } }`,
    { home, lightsId },
  )
  expect(moved.lights).toEqual(['box'])
  expect(moved.home).toEqual([])
  expect(moved.pos).toEqual({ x: 6, y: 6 })
  await key(page, 'Control+z')
  expect((await store<string[]>(page, `(s, w2s, id) => s().layers.find((l) => l.id === id).children.map((c) => c.id)`, home))).toEqual(['box'])
})

test('a tile click changes the draw target and keeps the selection', async ({ page }) => {
  await openEditor(page)
  const home = (await layerByName(page, 'Layer 1')).id
  const other = await addLayer(page, 'Other')
  await addChildTo(page, home, crate('box', { x: 6, y: 6 }))
  await store(page, `(s) => s().setSelectedIds(['box'])`)
  await tile(page, 'Other').getByRole('button', { name: 'Draw on Other' }).click()
  expect(await activeLayer(page)).toBe(other)
  expect(await store(page, `(s) => s().selection.selectedIds`)).toEqual(['box'])
})

test('"+" adds a layer and opens its name for typing', async ({ page }) => {
  await openEditor(page)
  await page.getByRole('button', { name: 'Add layer' }).first().click()
  const input = page.getByRole('textbox', { name: 'Layer name' })
  await expect(input).toBeFocused()
  await input.fill('Traps')
  await input.press('Enter')
  await expect(tile(page, 'Traps').getByTestId('v2-film-count')).toHaveText('0')
  expect(await activeLayer(page)).toBe((await layerByName(page, 'Traps')).id)
})

test('at 1920 every tab keeps Background, four named tiles and "+" in view, the Props tab too', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 911 })
  await openEditor(page)
  for (const name of ['Props', 'Walls', 'Lights']) await addLayer(page, name)
  for (const tab of ['floors', 'walls', 'rooms', 'props', 'lights', 'labels', 'assets']) {
    await page.getByTestId(`v2-dock-tab-${tab}`).click()
    await waitFrame(page, 3)
    const fit = await page.evaluate(() => {
      const inside = (r: DOMRect, box: DOMRect) => r.left >= box.left - 1 && r.right <= box.right + 1
      const strip = document.querySelector('.v2-film__scroll')!.getBoundingClientRect()
      const dock = document.querySelector('[data-testid="v2-dock"]')!.getBoundingClientRect()
      const tiles = [...document.querySelectorAll('.v2-film__scroll [data-layer-tile]')].map((t) => inside(t.getBoundingClientRect(), strip))
      const bg = document.querySelector('[data-testid="v2-filmstrip"] button[aria-label="Draw on Background"]')
      const add = document.querySelector('[data-testid="v2-filmstrip"] .v2-tile--add')!.getBoundingClientRect()
      return { tiles, add: inside(add, dock), bg: bg ? inside(bg.getBoundingClientRect(), dock) : null }
    })
    expect(fit.tiles, tab).toEqual([true, true, true, true])
    expect(fit.add, tab).toBe(true)
    // The Rooms tab leaves the map-wide tiles out by design.
    if (tab !== 'rooms') expect(fit.bg, tab).toBe(true)
  }
})

// ─── Layers sheet ────────────────────────────────────────────────────────────

test('the sheet groups layers by level; a wall row selects the wall on the canvas', async ({ page }) => {
  await openWarren(page)
  await store(page, `(s) => s().addLevel({ id: 'lv-cellar', name: 'Cellar' })`)
  await addLayer(page, 'Cellar floor', 'lv-cellar')
  await page.getByTestId('v2-open-layers').click()
  const sheet = page.getByTestId('v2-layers-sheet')
  await expect(sheet.getByTestId('v2-layers-level')).toHaveCount(2)
  await sheet.getByTestId('v2-layers-layer').filter({ hasText: 'Warren' }).getByRole('button', { name: 'Expand' }).click()
  await sheet.getByTestId('v2-layers-group').filter({ hasText: 'Walls' }).waitFor()
  await expect(sheet.getByTestId('v2-layers-object').filter({ hasText: 'Wall 1' })).toBeVisible()
  await sheet.getByTestId('v2-layers-object').filter({ hasText: 'Wall 1' }).click()
  const wallId = await store<string>(page, `(s) => s().layers.find((l) => l.name === 'Warren').standaloneWalls[0].id`)
  expect(await store(page, `(s) => s().selection.selectedIds`)).toEqual([wallId])
  await expect(page.getByTestId('v2-selection-card')).toBeVisible()
})

test('a per-object lock from a sheet row shows the padlock badge on the canvas', async ({ page }) => {
  await openEditor(page)
  const home = (await layerByName(page, 'Layer 1')).id
  await addChildTo(page, home, crate('box', { x: 6, y: 6 }))
  await page.getByTestId('v2-open-layers').click()
  await store(page, `(s) => s().setSelectedIds(['box'])`)
  const row = page.locator('[data-object-id="box"]')
  await row.hover()
  await row.getByTestId('v2-layers-obj-lock').click()
  expect((await store<Any>(page, `(s) => s().layers.find((l) => l.name === 'Layer 1').children[0]`)).locked).toBe(true)
  await waitFrame(page, 4)
  const glyphs = await page.evaluate(() => {
    const find = (n: Any): number => (n.label === 'selectionLock' ? 1 : 0) + (n.children ?? []).reduce((s: number, k: Any) => s + find(k), 0)
    return find((window as Any).__pixiApp.stage)
  })
  expect(glyphs).toBe(1)
})

test('with a prop selected, the Layers sheet opens beside the selection card, not over it', async ({ page }) => {
  await openEditor(page)
  const home = (await layerByName(page, 'Layer 1')).id
  await addChildTo(page, home, crate('box', { x: 6, y: 6 }))
  await store(page, `(s) => s().setSelectedIds(['box'])`)
  const card = page.getByTestId('v2-selection-card')
  await expect(card).toBeVisible()
  const alone = (await card.boundingBox())!
  await page.getByTestId('v2-open-layers').click()
  const sheet = page.getByTestId('v2-layers-sheet')
  await expect(sheet).toBeVisible()
  // The card eases aside at the sheet's pace.
  await expect
    .poll(async () => {
      const c = (await card.boundingBox())!
      const s = (await sheet.boundingBox())!
      return c.x + c.width <= s.x
    })
    .toBe(true)
  await page.getByRole('button', { name: 'Close Layers' }).click()
  await expect.poll(async () => Math.round((await card.boundingBox())!.x)).toBe(Math.round(alone.x))
})

test('the filter matches layer names: "wall" keeps the Walls layer', async ({ page }) => {
  await openEditor(page)
  await addLayer(page, 'Walls')
  await addLayer(page, 'Props')
  await page.getByTestId('v2-open-layers').click()
  await page.getByTestId('v2-layers-filter').fill('wall')
  const rows = page.getByTestId('v2-layers-layer')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Walls')
  await expect(rows.first()).toContainText('layer name')
})

test('dragging a layer row into another level’s group moves it there', async ({ page }) => {
  await openEditor(page)
  await store(page, `(s) => s().addLevel({ id: 'lv-cellar', name: 'Cellar' })`)
  await addLayer(page, 'Spare')
  await addLayer(page, 'Cellar floor', 'lv-cellar')
  await page.getByTestId('v2-open-layers').click()
  const sheet = page.getByTestId('v2-layers-sheet')
  // Open the Cellar group so its layer row is a target.
  await sheet.getByTestId('v2-layers-level').filter({ hasText: 'Cellar' }).click()
  const grip = sheet.getByTestId('v2-layers-layer').filter({ hasText: 'Spare' }).locator('.v2-lrow__grip')
  const target = sheet.getByTestId('v2-layers-layer').filter({ hasText: 'Cellar floor' })
  await sheet.getByTestId('v2-layers-layer').filter({ hasText: 'Spare' }).hover()
  await mouseDrag(page, await centre(grip), await centre(target))
  expect((await layerByName(page, 'Spare')).levelId).toBe('lv-cellar')
})

// ─── Levels ──────────────────────────────────────────────────────────────────

test('New level shows on the title card; Page Up and Page Down switch levels', async ({ page }) => {
  await openEditor(page)
  await expect(page.getByTestId('v2-title-level')).toHaveCount(0)
  await page.getByTestId('v2-level-button').click()
  await page.getByTestId('v2-level-new').click()
  await expect(page.getByTestId('v2-title-level')).toHaveText('· Level 2')
  const [first, second] = await store<string[]>(page, `(s) => s().levels.map((l) => l.id)`)
  expect(await store(page, `(s) => s().ui.activeLevelId`)).toBe(second)
  await key(page, 'PageUp')
  expect(await store(page, `(s) => s().ui.activeLevelId`)).toBe(first)
  await expect(page.getByTestId('v2-title-level')).toHaveText('· Level 1')
  await key(page, 'PageDown')
  expect(await store(page, `(s) => s().ui.activeLevelId`)).toBe(second)
  await key(page, 'PageDown')
  expect(await store(page, `(s) => s().ui.activeLevelId`)).toBe(second)
})

test('New level leaves no selection behind: no lock badge, no card, nothing selected in the status bar', async ({ page }) => {
  await openEditor(page)
  const home = (await layerByName(page, 'Layer 1')).id
  await addChildTo(page, home, crate('box', { x: 6, y: 6 }, { locked: true }))
  await store(page, `(s) => s().setSelectedIds(['box'])`)
  await waitFrame(page, 4)
  await expect(page.getByTestId('v2-status-selection')).toBeVisible()
  const lockBadges = () =>
    page.evaluate(() => {
      const find = (n: Any): number => (n.label === 'selectionLock' ? 1 : 0) + (n.children ?? []).reduce((s: number, k: Any) => s + find(k), 0)
      return find((window as Any).__pixiApp.stage)
    })
  expect(await lockBadges()).toBe(1)
  await page.getByTestId('v2-level-button').click()
  await page.getByTestId('v2-level-new').click()
  await waitFrame(page, 4)
  expect(await store(page, `(s) => s().selection.selectedIds`)).toEqual([])
  await expect(page.getByTestId('v2-status-selection')).toHaveCount(0)
  await expect(page.getByTestId('v2-status')).not.toContainText('Locked')
  await expect(page.getByTestId('v2-selection-card')).toHaveCount(0)
  expect(await lockBadges()).toBe(0)
})

test('Delete level asks; "Move its layers" keeps them, and Ctrl+Z brings the level back on show', async ({ page }) => {
  await openEditor(page)
  await page.getByTestId('v2-level-button').click()
  await page.getByTestId('v2-level-new').click()
  const level2 = await store<string>(page, `(s) => s().ui.activeLevelId`)
  const layer = await store<string>(page, `(s) => s().ui.activeLayerId`)
  await page.getByTestId('v2-level-button').click()
  await page.getByTestId('v2-level-delete').click()
  const dialog = page.getByTestId('v2-level-delete-dialog')
  await expect(dialog).toContainText('Move its layers to')
  await page.getByTestId('v2-level-delete-confirm').click()
  expect(await store<number>(page, `(s) => s().levels.length`)).toBe(1)
  expect(await store(page, `(s, w2s, id) => s().layers.some((l) => l.id === id)`, layer)).toBe(true)
  await expect(page.getByTestId('v2-title-level')).toHaveCount(0)
  await key(page, 'Control+z')
  expect(await store<number>(page, `(s) => s().levels.length`)).toBe(2)
  expect(await store(page, `(s) => s().ui.activeLevelId`)).toBe(level2)
  expect(await store(page, `(s, w2s, id) => s().layers.find((l) => l.id === id).levelId`, layer)).toBe(level2)
})

// ─── Gear sheet ──────────────────────────────────────────────────────────────

/** The pixels in a box around a world point, from the live drawing buffer. */
async function region(page: Page, world: Pt, half = 30): Promise<number[]> {
  return inPage<number[]>(
    page,
    `(s, w2s, a) => {
      const canvas = window.__pixiApp.canvas
      const r = canvas.getBoundingClientRect()
      const p = w2s(a.world.x, a.world.y)
      const d = devicePixelRatio
      const cx = Math.round((p.x - r.left) * d), cy = Math.round((p.y - r.top) * d), h = Math.round(a.half * d)
      const w = 2 * h, out = new Uint8Array(w * w * 4)
      window.__readCanvas((gl) => gl.readPixels(cx - h, canvas.height - (cy + h), w, w, gl.RGBA, gl.UNSIGNED_BYTE, out))
      return Array.from(out)
    }`,
    { world, half },
  )
}

/** How many pixels differ by more than a little between two reads of the same box. */
function changed(a: number[], b: number[]): number {
  let n = 0
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 60) n++
  }
  return n
}

test('the gear sheet’s Labels row hides a text label', async ({ page }) => {
  await openEditor(page)
  const home = (await layerByName(page, 'Layer 1')).id
  await waitFrame(page, 8)
  // A blank map's sheet is centred on the origin; the label sits in the middle of it.
  const bare = await region(page, { x: 0, y: 0 })
  await addChildTo(page, home, {
    id: 'lbl', name: 'Rat nest', childType: 'text', visible: true, text: 'RAT NEST', position: { x: 0, y: 0 }, rotation: 0, scale: 1,
    width: 4, height: 1.5, fontSize: 1.5, color: '#111111', fontFamily: 'serif', textStyle: 'room',
  })
  await store(page, `(s) => s().setSelectedIds([])`)
  await waitFrame(page, 8)
  const shown = await region(page, { x: 0, y: 0 })
  expect(changed(bare, shown)).toBeGreaterThan(30)
  await tile(page, 'Layer 1').getByRole('button', { name: 'Layer settings' }).click()
  await page.getByTestId('v2-layer-sheet').getByRole('switch', { name: 'Labels' }).click()
  await waitFrame(page, 8)
  const hidden = await region(page, { x: 0, y: 0 })
  expect(changed(bare, hidden)).toBeLessThan(changed(bare, shown) / 5)
  expect((await layerByName(page, 'Layer 1')).sublayerVisibility.labels).toBe(false)
})

test('the Background gear sheet: a colour reaches the tile, a texture shows on the canvas', async ({ page }) => {
  await openEditor(page)
  await waitFrame(page, 6)
  await tile(page, 'Background').getByRole('button', { name: 'Draw on Background' }).dblclick()
  const hex = page.getByRole('textbox', { name: 'Background hex' })
  await hex.fill('#2050c0')
  await hex.press('Enter')
  expect((await store<Any>(page, `(s) => s().layers[0]`)).backgroundColor).toBe('#2050c0')
  // The editor desk paints its paper under an untextured background; the tile shows the colour.
  await expect(tile(page, 'Background').locator('.v2-tile__swatch')).toHaveCSS('background-color', 'rgb(32, 80, 192)')

  const bare = await region(page, { x: 0, y: 0 })
  const sheet = page.getByTestId('v2-layer-sheet')
  await sheet.getByRole('group', { name: 'Background texture' }).getByRole('button').nth(1).click()
  expect((await store<Any>(page, `(s) => s().layers[0]`)).backgroundTexture).toBeTruthy()
  // The pack texture loads asynchronously (slower while the whole suite runs); wait for the sprite.
  await page.waitForFunction(
    () => {
      const find = (n: Any): boolean => n.label === 'bgTexture' || (n.children ?? []).some(find)
      return find((window as Any).__pixiApp.stage)
    },
    undefined,
    { timeout: 90_000 },
  )
  await expect.poll(async () => changed(bare, await region(page, { x: 0, y: 0 })), { timeout: 15_000 }).toBeGreaterThan(200)
  await key(page, 'Control+z')
  expect((await store<Any>(page, `(s) => s().layers[0]`)).backgroundTexture).toBeNull()
})

// ─── Guards ──────────────────────────────────────────────────────────────────

test('no accent colour in the new CSS: every colour it names is a grey', () => {
  for (const file of ['filmstrip.css', 'layers-sheet.css', 'layer-sheet.css']) {
    const css = readFileSync(fileURLToPath(new URL(`../../src/v2/editor/${file}`, import.meta.url)), 'utf8')
    for (const hex of css.match(/#[0-9a-f]{3,8}\b/gi) ?? []) {
      const h = hex.slice(1)
      const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6)
      expect(full.slice(0, 2) === full.slice(2, 4) && full.slice(2, 4) === full.slice(4, 6), `${file}: ${hex} is not a grey`).toBe(true)
    }
    for (const m of css.matchAll(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/g)) {
      expect(m[1] === m[2] && m[2] === m[3], `${file}: ${m[0]} is not a grey`).toBe(true)
    }
    expect(css).not.toMatch(/hsla?\(|oklch\(/)
  }
})

test('/v2 no longer mounts the v1 layer panel; / still does', async ({ page }) => {
  await openEditor(page)
  await page.getByTestId('v2-open-layers').click()
  await expect(page.getByTestId('v2-layers-tree')).toBeVisible()
  await expect(page.getByTestId('layer-filter')).toHaveCount(0)
  await page.goto('/?e2e=1')
  await waitForBoot(page)
  await expect(page.getByTestId('layer-filter')).toBeVisible()
})
