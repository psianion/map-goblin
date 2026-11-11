import { test, expect, type Locator, type Page } from '@playwright/test'
import { firePointer, gotoApp, waitFrame } from './helpers'
import { box, openEditor, pickFromFlyout, pickTool, shot } from './shell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
type Pt = { x: number; y: number }

const store = <T,>(page: Page, fn: string): Promise<T> =>
  page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as Any).__store.getState()), fn)

/** The level on show's dungeon layers, bottom first, as the column lays them out. */
const layerNames = (page: Page) =>
  store<string[]>(page, `(s) => s.layers.filter((l) => l.type === 'dungeon' && l.levelId === s.ui.activeLevelId).map((l) => l.name)`)

const tile = (page: Page, name: string): Locator =>
  page.getByTestId('shell-dock').locator(`[data-testid="shell-layer-tile"][data-name="${name}"]`)

/** A pointer drag from one element's centre to another's, in steps so the sorter sees travel. */
async function dragOnto(page: Page, from: Locator, to: Locator) {
  const a = await box(from)
  const b = await box(to)
  await page.mouse.move(a.x + a.width / 2, a.y + 16)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(a.x + a.width / 2 + ((b.x - a.x) * i) / 10, a.y + 16 + ((b.y - a.y) * i) / 10)
    await waitFrame(page, 1)
  }
  await page.mouse.up()
  await waitFrame(page, 4)
}

// Shell parity: the dock's Layers column does what the old filmstrip did, the three sheets
// open from their triggers, and Space pans with any tool.
test('the Layers column adds, renames, reorders and solos; the sheets open; Space pans', { tag: '@layers' }, async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openEditor(page)
  const dock = page.getByTestId('shell-dock')

  // The map-wide tiles come first: Background and Terrain, then the level's layers.
  await expect(dock.locator('[data-testid="shell-layer-tile"][data-name="Terrain"]')).toBeVisible()
  const before = await layerNames(page)

  // Add a layer: its name is asked for at once. Renaming it is the same dialog.
  await dock.getByRole('button', { name: 'Add layer' }).click()
  const rename = page.getByTestId('shell-rename')
  await expect(rename).toBeVisible()
  await rename.getByRole('textbox', { name: 'Name' }).fill('Upper')
  await rename.getByRole('textbox', { name: 'Name' }).press('Enter')
  await expect(rename).toBeHidden()
  expect(await layerNames(page)).toEqual([...before, 'Upper'])

  await tile(page, 'Upper').getByRole('button', { name: 'Draw on Upper' }).dblclick()
  await rename.getByRole('textbox', { name: 'Name' }).fill('Mezzanine')
  await rename.getByRole('button', { name: 'Rename' }).click()
  expect(await layerNames(page)).toEqual([...before, 'Mezzanine'])

  // Drag to reorder: the new layer onto the first, and it goes under it.
  await dragOnto(page, tile(page, 'Mezzanine'), tile(page, before[0]))
  expect((await layerNames(page))[0]).toBe('Mezzanine')

  // Alt on the eye solos; the status bar's chip ends it.
  await tile(page, 'Mezzanine').hover()
  await tile(page, 'Mezzanine').getByTestId('shell-layer-eye').click({ modifiers: ['Alt'] })
  expect(await store<string | null>(page, `(s) => s.ui.solo?.layerId ?? null`)).not.toBeNull()
  await expect(page.getByTestId('shell-solo')).toContainText('Mezzanine')
  await expect(tile(page, before[0])).toHaveClass(/opacity-40/)
  await shot(page, '15a-layers')
  await page.getByTestId('shell-solo').click()
  expect(await store<string | null>(page, `(s) => s.ui.solo?.layerId ?? null`)).toBeNull()

  // The Layers sheet from the column's All layers.
  await dock.getByTestId('shell-open-layers').click()
  const layersSheet = page.getByTestId('shell-layers-sheet')
  await expect(layersSheet).toBeVisible()
  await expect(layersSheet.getByTestId('shell-layers-layer').filter({ hasText: 'Mezzanine' })).toBeVisible()
  await expect(layersSheet.getByTestId('shell-layers-terrain')).toBeVisible()
  await shot(page, '15a-sheets')
  await layersSheet.getByRole('button', { name: 'Close Layers' }).click()
  await expect(layersSheet).toBeHidden()

  // A layer's settings from the gear on the active tile.
  await tile(page, 'Mezzanine').getByRole('button', { name: 'Draw on Mezzanine' }).click()
  await tile(page, 'Mezzanine').getByRole('button', { name: 'Layer settings' }).click()
  const layerSheet = page.getByTestId('shell-layer-sheet')
  await expect(layerSheet).toBeVisible()
  await expect(layerSheet.getByRole('textbox', { name: 'Layer name' })).toHaveValue('Mezzanine')
  await layerSheet.getByRole('button', { name: 'Close Mezzanine' }).click()
  await expect(layerSheet).toBeHidden()

  // Packs from the "…" menu.
  await page.getByTestId('shell-more').click()
  await page.getByRole('menuitem', { name: 'Packs…' }).click()
  const packs = page.getByTestId('shell-packs-sheet')
  await expect(packs).toBeVisible()
  await expect(packs.getByTestId('shell-pack-row').first()).toBeVisible()
  await packs.getByRole('button', { name: 'Close Packs' }).click()
  await expect(packs).toBeHidden()

  // The grid chip opens its popover with the line colour.
  await page.getByTestId('shell-grid-chip').click()
  const grid = page.getByTestId('shell-grid-popover')
  await expect(grid).toBeVisible()
  await expect(grid.getByText('Grid lines')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(grid).toBeHidden()

  // Hold Space: Pan while it is down, the tool back when it comes up.
  await pickFromFlyout(page, 'Design', 'Floor')
  const tool = () => store<string>(page, `(s) => s.tools.activeTool`)
  const floor = await tool()
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await page.keyboard.down(' ')
  await waitFrame(page, 2)
  expect(await tool()).toBe('pan')
  await page.keyboard.up(' ')
  await waitFrame(page, 2)
  expect(await tool()).toBe(floor)
  expect(errors).toEqual([])
})

// ─── The old filmstrip, level and sheet tests, on the dock and the new sheets ───────────

const WARREN_LAYER = 'Warren'
const CRATE = 'gg-demo:storage_crates_1_dark_1x1_object_A'

/**
 * Run `fn` (source text) in the page with the store getter and a world to screen mapping.
 * Source text, so the page needs nothing imported.
 */
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

const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())

async function key(page: Page, combo: string) {
  await blur(page)
  await page.keyboard.press(combo)
  await waitFrame(page, 2)
}

/** A fresh blank map: one level, one layer, Select in hand. */
async function openBlank(page: Page): Promise<void> {
  await gotoApp(page)
  await store(page, `(s) => { s.setFocusMode('manual'); s.setActiveTool('select') }`)
}

/** The goblin warren, framed, its rooms measured, the Select tool in hand. */
async function openWarren(page: Page): Promise<void> {
  await openEditor(page)
  await page.waitForFunction(() => {
    const l = (window as Any).__store.getState().layers.find((x: Any) => x.type === 'dungeon')
    return (l?.rooms ?? []).length > 0 && l.rooms.every((r: Any) => Array.isArray(r.face) && r.face.length > 2)
  })
  await store(page, `(s) => { const l = s.layers.find((x) => x.type === 'dungeon'); s.setActiveLayerId(l.id) }`)
  await waitFrame(page, 4)
}

/** A new empty layer on the level on show, named, on top; its id. */
const addLayer = (page: Page, name: string, levelId?: string) =>
  inPage<string>(
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

const layerByName = (page: Page, name: string) => inPage<Any>(page, `(s, w2s, n) => s().layers.find((l) => l.name === n)`, name)
const allLayerNames = (page: Page) => store<string[]>(page, `(s) => s.layers.filter((l) => l.type === 'dungeon').map((l) => l.name)`)
const activeLayer = (page: Page) => store<string>(page, `(s) => s.ui.activeLayerId`)

const crate = (id: string, at: Pt, extra: Record<string, unknown> = {}) => ({
  id, name: id, childType: 'asset', visible: true, objectType: 'asset', assetId: CRATE, position: at, rotation: 0, scale: 1,
  width: 1, height: 1, tint: '#ffffff', flipX: false, flipY: false, ...extra,
})

const addChildTo = (page: Page, layerId: string, child: Record<string, unknown>) =>
  inPage<void>(page, `(s, w2s, a) => s().addChild(a.layerId, a.child)`, { layerId, child })

const toaster = (page: Page) => page.getByLabel('Notifications alt+T')
const tileNames = (page: Page) => page.getByTestId('shell-dock').locator('[data-testid="shell-layer-tile"] [data-slot="tile-name"]').allTextContents()
const titleLevel = (page: Page) => page.getByTestId('shell-title-level')

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
  const b = await box(l)
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

/** The number of padlock badges the canvas is drawing. */
const lockBadges = (page: Page) =>
  page.evaluate(() => {
    const find = (n: Any): number => (n.label === 'selectionLock' ? 1 : 0) + (n.children ?? []).reduce((s: number, k: Any) => s + find(k), 0)
    return find((window as Any).__pixiApp.stage)
  })

// ─── Layer tiles ─────────────────────────────────────────────────────────────

test('every tile shows its name, and its tip counts the objects on it', { tag: '@layers' }, async ({ page }) => {
  await openWarren(page)
  const t = tile(page, WARREN_LAYER)
  await expect(t.locator('[data-slot="tile-name"]')).toHaveText(WARREN_LAYER)
  const count = await store<number>(page, `(s) => { const l = s.layers.find((x) => x.type === 'dungeon'); return l.children.length + l.standaloneWalls.length + l.rooms.length }`)
  await expect(t.getByRole('button', { name: `Draw on ${WARREN_LAYER}`, exact: true })).toHaveAttribute('data-tip', `${WARREN_LAYER} · ${count} objects`)
  await expect(tile(page, 'Terrain').locator('[data-slot="tile-name"]')).toHaveText('Terrain')
  await expect(tile(page, 'Background').locator('[data-slot="tile-name"]')).toHaveText('Background')
})

test('a lock from the tile blocks drawing with a toast; unlocking lets it draw', { tag: '@layers' }, async ({ page }) => {
  await openBlank(page)
  const t = tile(page, 'Layer 1')
  await t.hover()
  await t.getByRole('button', { name: 'Lock Layer 1' }).click()
  expect((await layerByName(page, 'Layer 1')).locked).toBe(true)
  await pickTool(page, 'rectangle')
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

test('Alt+click on an eye solos that layer and dims every other tile', { tag: '@layers' }, async ({ page }) => {
  await openBlank(page)
  await addLayer(page, 'Lights')
  await addLayer(page, 'Props')
  const lights = tile(page, 'Lights')
  await lights.hover()
  await lights.getByTestId('shell-layer-eye').click({ modifiers: ['Alt'] })
  expect(await store(page, `(s) => s.ui.solo?.layerId`)).toBe((await layerByName(page, 'Lights')).id)
  await expect(tile(page, 'Props')).toHaveClass(/opacity-40/)
  await expect(tile(page, 'Layer 1')).toHaveClass(/opacity-40/)
  await expect(lights).not.toHaveClass(/opacity-40/)
  await expect(lights.getByTestId('shell-layer-eye')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('shell-solo')).toContainText('Lights')
})

test('a double-click on a tile renames it; Escape keeps the old name', { tag: '@layers' }, async ({ page }) => {
  await openBlank(page)
  const rename = page.getByTestId('shell-rename')
  await tile(page, 'Layer 1').getByRole('button', { name: 'Draw on Layer 1' }).dblclick()
  await rename.getByRole('textbox', { name: 'Name' }).fill('Cave walls')
  await rename.getByRole('textbox', { name: 'Name' }).press('Enter')
  await expect(tile(page, 'Cave walls')).toBeVisible()
  await tile(page, 'Cave walls').getByRole('button', { name: 'Draw on Cave walls' }).dblclick()
  await rename.getByRole('textbox', { name: 'Name' }).fill('Nope')
  await rename.getByRole('textbox', { name: 'Name' }).press('Escape')
  await expect(rename).toBeHidden()
  expect(await allLayerNames(page)).toEqual(['Cave walls'])
})

test('dragging a tile right changes the draw order; one undo puts order and active layer back', { tag: '@layers' }, async ({ page }) => {
  await openBlank(page)
  const lower = (await layerByName(page, 'Layer 1')).id
  const upperId = await addLayer(page, 'Upper')
  // The same crate on both layers: red on the bottom one, plain on the top one.
  await addChildTo(page, lower, crate('red', { x: 6, y: 6 }, { tint: '#ff0000', width: 3, height: 3 }))
  await addChildTo(page, upperId, crate('plain', { x: 6, y: 6 }, { width: 3, height: 3 }))
  await inPage(page, `(s, w2s, id) => s().setActiveLayerId(id)`, lower)
  await waitFrame(page, 8)
  // The plain crate on top: green is there. The red one on top: green is gone. Read where the
  // crates are now (the camera may still be settling) and let the textures land.
  const crateCentre = () => pixelAtWorld(page, { x: 6, y: 6 })
  await expect.poll(async () => (await crateCentre()).g, { timeout: 30_000 }).toBeGreaterThan(12)
  const before = await crateCentre()

  const upper = await centre(tile(page, 'Upper'))
  await mouseDrag(page, await centre(tile(page, 'Layer 1')), { x: upper.x + 20, y: upper.y })
  expect(await allLayerNames(page)).toEqual(['Upper', 'Layer 1'])
  await expect.poll(async () => (await crateCentre()).g, { timeout: 30_000 }).toBeLessThan(before.g * 0.5)
  const after = await crateCentre()
  expect(after.r).toBeGreaterThan(after.g)

  await inPage(page, `(s, w2s, id) => s().setActiveLayerId(id)`, upperId)
  await key(page, 'Control+z')
  expect(await allLayerNames(page)).toEqual(['Layer 1', 'Upper'])
  expect(await activeLayer(page)).toBe(lower)
})

test('Ctrl+Z with the dragged tile still focused undoes the reorder and puts the active layer back', { tag: '@layers' }, async ({ page }) => {
  await openBlank(page)
  const lower = (await layerByName(page, 'Layer 1')).id
  const upperId = await addLayer(page, 'Upper')
  await inPage(page, `(s, w2s, id) => s().setActiveLayerId(id)`, lower)
  const upper = await centre(tile(page, 'Upper'))
  await mouseDrag(page, await centre(tile(page, 'Layer 1')), { x: upper.x + 20, y: upper.y })
  expect(await allLayerNames(page)).toEqual(['Upper', 'Layer 1'])
  await inPage(page, `(s, w2s, id) => s().setActiveLayerId(id)`, upperId)
  // Focus stays on the tile the drag started from, as the press that began it leaves it.
  await tile(page, 'Layer 1').focus()
  await page.keyboard.press('Control+z')
  await waitFrame(page, 2)
  expect(await allLayerNames(page)).toEqual(['Layer 1', 'Upper'])
  expect(await activeLayer(page)).toBe(lower)
})

test('the tile menu refuses to delete the last layer of a level', { tag: '@layers' }, async ({ page }) => {
  await openBlank(page)
  await tile(page, 'Layer 1').click({ button: 'right' })
  const del = page.getByRole('menuitem', { name: 'Delete layer' })
  await expect(del).toBeDisabled()
  await page.keyboard.press('Escape')
  await tile(page, 'Layer 1').focus()
  await page.keyboard.press('Delete')
  await expect(toaster(page).getByText('A level needs one layer. Delete the level instead.')).toBeVisible()
  expect(await allLayerNames(page)).toEqual(['Layer 1'])
})

test('Duplicate puts the copy on the tile right of the source; its rooms get new ids', { tag: '@layers' }, async ({ page }) => {
  await openWarren(page)
  await tile(page, WARREN_LAYER).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Duplicate' }).click()
  await expect(tile(page, 'Warren copy')).toBeVisible()
  const names = await tileNames(page)
  expect(names.indexOf('Warren copy')).toBe(names.indexOf(WARREN_LAYER) + 1)
  const ids = await store<{ src: string[]; copy: string[]; copyChildren: number; srcChildren: number }>(
    page,
    `(s) => { const src = s.layers.find((l) => l.name === 'Warren'); const copy = s.layers.find((l) => l.name === 'Warren copy');
      return { src: src.rooms.map((r) => r.id), copy: copy.rooms.map((r) => r.id), copyChildren: copy.children.length, srcChildren: src.children.length } }`,
  )
  expect(ids.copy).toHaveLength(ids.src.length)
  expect(ids.copy.some((id) => ids.src.includes(id))).toBe(false)
  expect(ids.copyChildren).toBe(ids.srcChildren)
  expect(await activeLayer(page)).toBe((await layerByName(page, 'Warren copy')).id)
})

test('a prop dragged from the canvas onto another tile moves there, with a ring, a toast and one undo', { tag: '@layers' }, async ({ page }) => {
  await openBlank(page)
  const home = (await layerByName(page, 'Layer 1')).id
  const lightsId = await addLayer(page, 'Lights')
  await addChildTo(page, home, crate('box', { x: 6, y: 6 }, { width: 2, height: 2 }))
  await inPage(page, `(s, w2s, id) => { s().setActiveLayerId(id); s().setSelectedIds(['box']) }`, home)
  await waitFrame(page, 4)
  const from = await inPage<Pt>(page, `(s, w2s) => w2s(6, 6)`)
  const to = await centre(tile(page, 'Lights'))
  await canvasDrag(page, from, to)
  await expect(tile(page, 'Lights').locator('[data-slot="tile-thumb"]')).toHaveCSS('outline-style', 'dashed')
  await expect(page.getByTestId('shell-status-hint')).toContainText('Release to move to Lights')
  await firePointer(page, 'pointerup', to.x, to.y)
  await waitFrame(page, 3)
  await expect(tile(page, 'Lights').locator('[data-slot="tile-thumb"]')).not.toHaveCSS('outline-style', 'dashed')
  await expect(toaster(page).getByText('Moved 1 object to Lights')).toBeVisible()
  const moved = await inPage<{ home: string[]; lights: string[]; pos: Pt }>(
    page,
    `(s, w2s, a) => { const L = (id) => s().layers.find((l) => l.id === id); const box = L(a.lightsId).children.find((c) => c.id === 'box');
      return { home: L(a.home).children.map((c) => c.id), lights: L(a.lightsId).children.map((c) => c.id), pos: box?.position } }`,
    { home, lightsId },
  )
  expect(moved.lights).toEqual(['box'])
  expect(moved.home).toEqual([])
  expect(moved.pos).toEqual({ x: 6, y: 6 })
  await key(page, 'Control+z')
  expect(await inPage<string[]>(page, `(s, w2s, id) => s().layers.find((l) => l.id === id).children.map((c) => c.id)`, home)).toEqual(['box'])
})

test('a tile click changes the draw target and keeps the selection', { tag: '@layers' }, async ({ page }) => {
  await openBlank(page)
  const home = (await layerByName(page, 'Layer 1')).id
  const other = await addLayer(page, 'Other')
  await addChildTo(page, home, crate('box', { x: 6, y: 6 }))
  await store(page, `(s) => s.setSelectedIds(['box'])`)
  await tile(page, 'Other').getByRole('button', { name: 'Draw on Other' }).click()
  expect(await activeLayer(page)).toBe(other)
  expect(await store(page, `(s) => s.selection.selectedIds`)).toEqual(['box'])
})

test('"+" adds a layer and opens its name for typing', { tag: '@layers' }, async ({ page }) => {
  await openBlank(page)
  await page.getByTestId('shell-dock').getByRole('button', { name: 'Add layer' }).click()
  const input = page.getByTestId('shell-rename').getByRole('textbox', { name: 'Name' })
  await expect(input).toBeFocused()
  await input.fill('Traps')
  await input.press('Enter')
  await expect(tile(page, 'Traps').getByRole('button', { name: 'Draw on Traps' })).toHaveAttribute('data-tip', 'Traps · 0 objects')
  expect(await activeLayer(page)).toBe((await layerByName(page, 'Traps')).id)
})

test('at 1920 the column keeps Background, Terrain, four named tiles and "+" in view, whichever tool is in hand', { tag: '@layers' }, async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 911 })
  await openBlank(page)
  for (const name of ['Props', 'Walls', 'Lights']) await addLayer(page, name)
  const fits = () =>
    page.evaluate(() => {
      const inside = (r: DOMRect, outer: DOMRect) => r.left >= outer.left - 1 && r.right <= outer.right + 1
      const dock = document.querySelector('[data-testid="shell-dock"]')!.getBoundingClientRect()
      const strip = document.querySelector('[data-testid="shell-dock"] [role="group"][aria-label="Layers"]')!
      const stripBox = strip.getBoundingClientRect()
      const tiles = [...strip.querySelectorAll('[data-testid="shell-layer-tile"]')].map((t) => inside(t.getBoundingClientRect(), stripBox))
      const add = document.querySelector('[data-testid="shell-dock"] button[aria-label="Add layer"]')!.getBoundingClientRect()
      return { tiles, add: inside(add, dock), overflow: strip.scrollWidth - strip.clientWidth }
    })
  const check = async (what: string) => {
    const fit = await fits()
    expect(fit.tiles, what).toEqual([true, true, true, true, true, true])
    expect(fit.add, what).toBe(true)
    expect(fit.overflow, what).toBeLessThanOrEqual(0)
  }
  await check('select')
  await pickTool(page, 'rectangle')
  await check('floor')
  await pickTool(page, 'stamp')
  await check('stamp')
  await pickTool(page, 'light')
  await check('light')
})

test('the dock shows the family’s tools and changes tool without the flyout', { tag: '@layers' }, async ({ page }) => {
  await openBlank(page)
  await pickTool(page, 'wall')
  const family = page.getByTestId('shell-dock').locator('[data-column="family"]')
  await expect(family).toContainText('Design')
  for (const name of ['Floor', 'Wall', 'Door', 'Elevation']) await expect(family.getByRole('button', { name, exact: true })).toBeVisible()
  await expect(family.getByRole('button', { name: 'Wall', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await family.getByRole('button', { name: 'Door', exact: true }).click()
  await waitFrame(page, 2)
  expect(await store(page, `(s) => s.tools.activeTool`)).toBe('door')
  expect((await box(page.getByTestId('shell-dock'))).height).toBe(112)
})

test('Set up tabs: with Rooms in hand the Walls tab shows the wall Look, and Rooms stays in hand', { tag: '@layers' }, async ({ page }) => {
  await openBlank(page)
  await pickFromFlyout(page, 'Text', 'Rooms')
  const dock = page.getByTestId('shell-dock')
  const setup = dock.locator('[data-column="setup"]')
  await expect(setup.getByRole('button')).toHaveText(['Rooms', 'Walls', 'Doors'])
  await expect(dock.getByTestId('design-floor-look')).toBeVisible()
  await setup.getByRole('button', { name: 'Walls', exact: true }).click()
  await waitFrame(page, 2)
  await expect(dock.getByTestId('design-wall-look')).toBeVisible()
  await expect(dock.getByTestId('design-floor-look')).toHaveCount(0)
  await expect(dock.locator('[data-setting="rooms.mode"]')).toHaveCount(0)
  expect(await store(page, `(s) => s.tools.activeTool`)).toBe('roomRect')
  await expect(page.getByTestId('shell-tool-panel')).toHaveAttribute('data-tool', 'rooms')
  expect((await box(dock)).height).toBe(112)
  // Back to the tool's own tab.
  await setup.getByRole('button', { name: 'Rooms', exact: true }).click()
  await expect(dock.getByTestId('design-floor-look')).toBeVisible()
})

// ─── Layers sheet ────────────────────────────────────────────────────────────

test('the sheet groups layers by level; a wall row selects the wall on the canvas', { tag: '@layers' }, async ({ page }) => {
  await openWarren(page)
  await store(page, `(s) => s.addLevel({ id: 'lv-cellar', name: 'Cellar' })`)
  await addLayer(page, 'Cellar floor', 'lv-cellar')
  await page.getByTestId('shell-open-layers').click()
  const sheet = page.getByTestId('shell-layers-sheet')
  await expect(sheet.getByTestId('shell-layers-level')).toHaveCount(2)
  await sheet.getByTestId('shell-layers-layer').filter({ hasText: WARREN_LAYER }).getByRole('button', { name: 'Expand' }).click()
  await sheet.getByTestId('shell-layers-group').filter({ hasText: 'Walls' }).waitFor()
  await expect(sheet.getByTestId('shell-layers-object').filter({ hasText: 'Wall 1' })).toBeVisible()
  await sheet.getByTestId('shell-layers-object').filter({ hasText: 'Wall 1' }).click()
  const wallId = await store<string>(page, `(s) => s.layers.find((l) => l.name === 'Warren').standaloneWalls[0].id`)
  expect(await store(page, `(s) => s.selection.selectedIds`)).toEqual([wallId])
  await expect(page.getByTestId('shell-card')).toBeVisible()
})

test('a per-object lock from a sheet row shows the padlock badge on the canvas', { tag: '@layers' }, async ({ page }) => {
  await openBlank(page)
  const home = (await layerByName(page, 'Layer 1')).id
  await addChildTo(page, home, crate('box', { x: 6, y: 6 }))
  await page.getByTestId('shell-open-layers').click()
  await store(page, `(s) => s.setSelectedIds(['box'])`)
  const row = page.locator('[data-object-id="box"]')
  await row.hover()
  await row.getByTestId('shell-layers-obj-lock').click()
  expect((await store<Any>(page, `(s) => s.layers.find((l) => l.name === 'Layer 1').children[0]`)).locked).toBe(true)
  await waitFrame(page, 4)
  expect(await lockBadges(page)).toBe(1)
})

test('with a prop selected, the Layers sheet opens beside the card, not over it', { tag: '@layers' }, async ({ page }) => {
  await openBlank(page)
  const home = (await layerByName(page, 'Layer 1')).id
  await addChildTo(page, home, crate('box', { x: 6, y: 6 }))
  await store(page, `(s) => s.setSelectedIds(['box'])`)
  const card = page.getByTestId('shell-card')
  await expect(card).toBeVisible()
  const alone = await box(card)
  await page.getByTestId('shell-open-layers').click()
  const sheet = page.getByTestId('shell-layers-sheet')
  await expect(sheet).toBeVisible()
  await expect
    .poll(async () => {
      const c = await box(card)
      const s = await box(sheet)
      return c.x + c.width <= s.x
    })
    .toBe(true)
  await page.getByRole('button', { name: 'Close Layers' }).click()
  await expect.poll(async () => Math.round((await box(card)).x)).toBe(Math.round(alone.x))
})

test('the filter matches layer names: "wall" keeps the Walls layer', { tag: '@layers' }, async ({ page }) => {
  await openBlank(page)
  await addLayer(page, 'Walls')
  await addLayer(page, 'Props')
  await page.getByTestId('shell-open-layers').click()
  await page.getByTestId('shell-layers-filter').fill('wall')
  const rows = page.getByTestId('shell-layers-layer')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Walls')
  await expect(rows.first()).toContainText('layer name')
})

test('dragging a layer row into another level’s group moves it there', { tag: '@layers' }, async ({ page }) => {
  await openBlank(page)
  await store(page, `(s) => s.addLevel({ id: 'lv-cellar', name: 'Cellar' })`)
  // The new level is not the one on show, so the layer goes to the level that is.
  await store(page, `(s) => s.setActiveLevelId(s.levels.find((l) => l.id !== 'lv-cellar').id)`)
  await addLayer(page, 'Spare')
  await addLayer(page, 'Cellar floor', 'lv-cellar')
  await page.getByTestId('shell-open-layers').click()
  const sheet = page.getByTestId('shell-layers-sheet')
  // Open the Cellar group so its layer row is a target.
  await sheet.getByTestId('shell-layers-level').filter({ hasText: 'Cellar' }).click()
  const spare = sheet.getByTestId('shell-layers-layer').filter({ hasText: 'Spare' })
  const grip = spare.getByLabel('Drag Spare')
  const target = sheet.getByTestId('shell-layers-layer').filter({ hasText: 'Cellar floor' })
  await spare.hover()
  await mouseDrag(page, await centre(grip), await centre(target))
  expect((await layerByName(page, 'Spare')).levelId).toBe('lv-cellar')
})

// ─── Levels ──────────────────────────────────────────────────────────────────

test('New level shows on the title card; Page Up and Page Down switch levels', { tag: '@layers' }, async ({ page }) => {
  await openBlank(page)
  await expect(titleLevel(page)).toContainText('L1 Level 1')
  const first = await store<string>(page, `(s) => s.ui.activeLevelId`)
  await titleLevel(page).click()
  await page.getByTestId('shell-level-menu').getByRole('menuitem', { name: 'New level' }).click()
  // The menu fades out; while it is still up its trigger keeps the keys.
  await expect(page.getByTestId('shell-level-menu')).toHaveCount(0)
  const second = await store<string>(page, `(s) => s.ui.activeLevelId`)
  expect(second).not.toBe(first)
  // Levels are listed top first, so the new one is the lowest: L1.
  await expect(titleLevel(page)).toContainText('L1 Level 2')
  await key(page, 'PageUp')
  await expect.poll(() => store(page, `(s) => s.ui.activeLevelId`)).toBe(first)
  await expect(titleLevel(page)).toContainText('L2 Level 1')
  await key(page, 'PageDown')
  expect(await store(page, `(s) => s.ui.activeLevelId`)).toBe(second)
  await key(page, 'PageDown')
  expect(await store(page, `(s) => s.ui.activeLevelId`)).toBe(second)
})

test('the level menu lists the levels, top first, with the Page Up key on the one above, and switches on a click', { tag: '@layers' }, async ({ page }) => {
  await openBlank(page)
  const first = await store<string>(page, `(s) => s.ui.activeLevelId`)
  await titleLevel(page).click()
  await page.getByTestId('shell-level-menu').getByRole('menuitem', { name: 'New level' }).click()
  await titleLevel(page).click()
  const menu = page.getByTestId('shell-level-menu')
  const radios = menu.getByRole('menuitemradio')
  await expect(radios).toHaveCount(2)
  await expect(radios.nth(0)).toContainText('L2 Level 1')
  await expect(radios.nth(0)).toContainText('PgUp')
  await expect(radios.nth(1)).toContainText('L1 Level 2')
  await expect(radios.nth(1)).toHaveAttribute('aria-checked', 'true')
  await radios.nth(0).click()
  expect(await store(page, `(s) => s.ui.activeLevelId`)).toBe(first)
})

test('New level leaves no selection behind: no lock badge, no card, nothing selected in the status bar', { tag: '@layers' }, async ({ page }) => {
  await openBlank(page)
  const home = (await layerByName(page, 'Layer 1')).id
  await addChildTo(page, home, crate('box', { x: 6, y: 6 }, { locked: true }))
  await store(page, `(s) => s.setSelectedIds(['box'])`)
  await waitFrame(page, 4)
  await expect(page.getByTestId('shell-status-selection')).toBeVisible()
  expect(await lockBadges(page)).toBe(1)
  await titleLevel(page).click()
  await page.getByTestId('shell-level-menu').getByRole('menuitem', { name: 'New level' }).click()
  await waitFrame(page, 4)
  expect(await store(page, `(s) => s.selection.selectedIds`)).toEqual([])
  await expect(page.getByTestId('shell-status-selection')).toHaveCount(0)
  await expect(page.getByTestId('shell-status')).not.toContainText('Locked')
  await expect(page.getByTestId('shell-card')).toHaveCount(0)
  expect(await lockBadges(page)).toBe(0)
})

test('Delete level asks; "Move to a level" keeps the layers, and Ctrl+Z brings the level back on show', { tag: '@layers' }, async ({ page }) => {
  await openBlank(page)
  await titleLevel(page).click()
  await page.getByTestId('shell-level-menu').getByRole('menuitem', { name: 'New level' }).click()
  const level2 = await store<string>(page, `(s) => s.ui.activeLevelId`)
  const layer = await store<string>(page, `(s) => s.ui.activeLayerId`)
  await titleLevel(page).click()
  await page.getByTestId('shell-level-menu').getByRole('menuitem', { name: 'Delete level…' }).click()
  const dialog = page.getByTestId('v2-level-delete-dialog')
  await expect(dialog).toContainText('Move to')
  // The choice is a segmented pair, Move to a level on, and the target a combobox.
  await expect(page.getByTestId('v2-level-delete-move')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('v2-level-delete-all')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('v2-level-delete-target')).toHaveRole('combobox')
  await page.getByTestId('v2-level-delete-confirm').click()
  await expect(dialog).toBeHidden()
  expect(await store<number>(page, `(s) => s.levels.length`)).toBe(1)
  expect(await inPage(page, `(s, w2s, id) => s().layers.some((l) => l.id === id)`, layer)).toBe(true)
  await key(page, 'Control+z')
  expect(await store<number>(page, `(s) => s.levels.length`)).toBe(2)
  expect(await store(page, `(s) => s.ui.activeLevelId`)).toBe(level2)
  expect(await inPage(page, `(s, w2s, id) => s().layers.find((l) => l.id === id).levelId`, layer)).toBe(level2)
})

// ─── Layer settings sheet ────────────────────────────────────────────────────

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

test('the layer sheet’s Labels row hides a text label', { tag: '@layers' }, async ({ page }) => {
  await openBlank(page)
  const home = (await layerByName(page, 'Layer 1')).id
  await waitFrame(page, 8)
  // A blank map's sheet is centred on the origin; the label sits in the middle of it.
  const bare = await region(page, { x: 0, y: 0 })
  await addChildTo(page, home, {
    id: 'lbl', name: 'Rat nest', childType: 'text', visible: true, text: 'RAT NEST', position: { x: 0, y: 0 }, rotation: 0, scale: 1,
    width: 4, height: 1.5, fontSize: 1.5, color: '#111111', fontFamily: 'serif', textStyle: 'room',
  })
  await store(page, `(s) => s.setSelectedIds([])`)
  await waitFrame(page, 8)
  const shown = await region(page, { x: 0, y: 0 })
  expect(changed(bare, shown)).toBeGreaterThan(30)
  await tile(page, 'Layer 1').getByRole('button', { name: 'Layer settings' }).click()
  await page.getByTestId('shell-layer-sheet').getByRole('switch', { name: 'Labels' }).click()
  await waitFrame(page, 8)
  const hidden = await region(page, { x: 0, y: 0 })
  expect(changed(bare, hidden)).toBeLessThan(changed(bare, shown) / 5)
  expect((await layerByName(page, 'Layer 1')).sublayerVisibility.labels).toBe(false)
})

test('the Background settings: a colour reaches the tile, a texture shows on the canvas', { tag: '@layers' }, async ({ page }) => {
  await openBlank(page)
  await waitFrame(page, 6)
  await tile(page, 'Background').getByRole('button', { name: 'Draw on Background' }).dblclick()
  const sheet = page.getByTestId('shell-layer-sheet')
  await sheet.getByRole('button', { name: 'Background', exact: true }).click()
  const hex = page.getByRole('textbox', { name: 'Background hex' })
  await hex.fill('#2050c0')
  await hex.press('Enter')
  expect((await store<Any>(page, `(s) => s.layers[0]`)).backgroundColor).toBe('#2050c0')
  await page.keyboard.press('Escape')
  // The editor desk paints its paper under an untextured background; the tile shows the colour.
  await expect(tile(page, 'Background').locator('[data-slot="tile-thumb"] span').first()).toHaveCSS('background-color', 'rgb(32, 80, 192)')

  const bare = await region(page, { x: 0, y: 0 })
  await sheet.getByRole('group', { name: 'Background texture' }).getByRole('button').nth(1).click()
  expect((await store<Any>(page, `(s) => s.layers[0]`)).backgroundTexture).toBeTruthy()
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
  expect((await store<Any>(page, `(s) => s.layers[0]`)).backgroundTexture).toBeNull()
})
