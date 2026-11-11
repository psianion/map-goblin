import { test, expect, type Page } from '@playwright/test'
import { gotoApp, waitFrame } from './helpers'
import { shot } from './shell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const store = <T,>(page: Page, fn: string): Promise<T> =>
  page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as Any).__store.getState()), fn)

const titleLevel = (page: Page) => page.getByTestId('shell-title-level')

/**
 * The canvas colour at a viewport point, drawn and read in one go: a read between frames can
 * catch the buffer cleared (a resize, a level switch) and come back black.
 */
async function rgb(page: Page, x: number, y: number): Promise<{ r: number; g: number; b: number }> {
  return page.evaluate(
    ([x, y]) => {
      const app = (window as Any).__pixiApp
      const canvas = app.canvas as HTMLCanvasElement
      const box = canvas.getBoundingClientRect()
      app.render()
      const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext
      const px = Math.round(((x - box.left) * canvas.width) / box.width)
      // readPixels counts from the bottom-left.
      const py = canvas.height - 1 - Math.round(((y - box.top) * canvas.height) / box.height)
      const out = new Uint8Array(4)
      gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out)
      return { r: out[0], g: out[1], b: out[2] }
    },
    [x, y],
  )
}

/** A blank map, Select in hand, one red floor on its first layer under the middle of the view. */
async function openWithFloor(page: Page): Promise<void> {
  await gotoApp(page)
  // A floor's own colour is a style override: a bare `floorColor` on the child is no field, and
  // left the floor the default near-white, which reads as grey whether greyed or not.
  await store(page, `(s) => {
    s.setFocusMode('manual'); s.setActiveTool('select');
    const layer = s.layers.find((l) => l.type === 'dungeon');
    s.addChild(layer.id, { id: 'floor-a', name: 'Floor', childType: 'shape', visible: true, shapeType: 'rectangle',
      contours: [[[-3, -3], [3, -3], [3, 3], [-3, 3]]], styleOverrides: { floorColor: '#ff0000' } });
  }`)
  await waitFrame(page, 6)
}

// Clone: the level menu's Clone this level copies the level with new ids, shows the copy,
// and one undo takes it all back.
test('clone a level from the level menu, then undo', { tag: '@layers' }, async ({ page }) => {
  await openWithFloor(page)
  const source = await store<string>(page, `(s) => s.ui.activeLevelId`)
  await titleLevel(page).click()
  await page.getByTestId('shell-level-menu').getByRole('menuitem', { name: 'Clone this level' }).click()
  await expect(page.getByTestId('shell-level-menu')).toHaveCount(0)
  const clone = await store<string>(page, `(s) => s.ui.activeLevelId`)
  expect(clone).not.toBe(source)
  await expect(titleLevel(page)).toContainText('Level 1 copy')
  const ids = await store<string[]>(page, `(s) => s.layers.filter((l) => l.levelId === '${clone}').flatMap((l) => l.children.map((c) => c.id))`)
  expect(ids).toHaveLength(1)
  expect(ids[0]).not.toBe('floor-a')

  await page.getByTestId('shell-top-actions').getByRole('button', { name: 'Undo' }).click()
  await expect.poll(() => store<number>(page, `(s) => s.levels.length`)).toBe(1)
  expect(await store(page, `(s) => s.ui.activeLevelId`)).toBe(source)
})

// Compare: the Layers sheet's Compare row draws another level greyed under the one on show
// at the chosen opacity; nothing on it can be picked, and None stops it.
test('compare two levels from the Layers sheet', { tag: '@layers' }, async ({ page }) => {
  await openWithFloor(page)
  const mid = await page.evaluate(() => {
    const r = (window as Any).__pixiApp.canvas.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  // The floor under the middle of the view is red, so a grey reading later is the compare's grey.
  const own = await rgb(page, mid.x, mid.y)
  expect(own.r - own.g, 'the floor is red').toBeGreaterThan(100)
  await titleLevel(page).click()
  await page.getByTestId('shell-level-menu').getByRole('menuitem', { name: 'New level' }).click()
  await waitFrame(page, 4)
  const bare = await rgb(page, mid.x, mid.y)

  await titleLevel(page).click()
  await page.getByTestId('shell-level-menu').getByRole('menuitem', { name: 'Levels and layers…' }).click()
  const compare = page.getByTestId('shell-layers-compare')
  await expect(compare).toBeVisible()
  await compare.getByRole('combobox').click()
  await page.getByRole('option', { name: 'L2 Level 1' }).click()
  await waitFrame(page, 6)
  await expect.poll(() => store(page, `(s) => s.ui.compare && s.ui.compare.opacity`)).toBe(0.4)

  // The red floor shows through, grey: the three channels close together, not the bare ground.
  const seen = await rgb(page, mid.x, mid.y)
  expect(Math.abs(seen.r - seen.g) + Math.abs(seen.g - seen.b), 'greyed').toBeLessThan(12)
  expect(Math.abs(seen.r - bare.r) + Math.abs(seen.g - bare.g) + Math.abs(seen.b - bare.b), 'drawn').toBeGreaterThan(10)
  await expect(page.getByTestId('shell-status-hint')).toContainText('comparing with L2 Level 1 at 40%')
  await shot(page, '13-compare')

  // No interaction: a click on the compared floor picks nothing.
  await page.mouse.click(mid.x, mid.y)
  expect(await store<string[]>(page, `(s) => s.selection.selectedIds`)).toEqual([])

  // Not map data: the saved map does not carry it.
  expect(await store<string>(page, `(s) => JSON.stringify(s.getSerializableState())`)).not.toContain('"compare"')

  await compare.getByRole('combobox').click()
  await page.getByRole('option', { name: 'None' }).click()
  await waitFrame(page, 6)
  const after = await rgb(page, mid.x, mid.y)
  expect(Math.abs(after.r - bare.r) + Math.abs(after.g - bare.g) + Math.abs(after.b - bare.b)).toBeLessThan(6)
})
