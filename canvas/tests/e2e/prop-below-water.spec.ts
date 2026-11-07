import { test, expect, type Page } from '@playwright/test'
import { getPixelColor, waitFrame } from './helpers'
import { openEditor, pickFromFlyout, pickTool, shot } from './shell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const store = <T,>(page: Page, fn: string): Promise<T> =>
  page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as Any).__store.getState()), fn)

/** The canvas colour at a viewport point. */
async function rgb(page: Page, x: number, y: number): Promise<{ r: number; g: number; b: number }> {
  const box = await page.evaluate(() => (window as Any).__pixiApp.canvas.getBoundingClientRect())
  const c = await getPixelColor(page, x - box.left, y - box.top)
  return { r: c.r, g: c.g, b: c.b }
}

// Below water: a prop standing in the Water brush's water, switched Below water on its card,
// takes the water's colour; switched off, it draws as it is again.
test('below water: place a prop in water, switch it, sample', { tag: '@objects' }, async ({ page }) => {
  await openEditor(page)
  await pickFromFlyout(page, 'Terrain', 'Water brush')
  await page.keyboard.press(']')
  await page.keyboard.press(']')
  const mid: [number, number] = [640, 420]
  await page.mouse.move(520, 420)
  await page.mouse.down()
  await page.mouse.move(760, 420, { steps: 12 })
  await page.mouse.up()
  await waitFrame(page, 8)

  // A plain white prop centred on the water, picked.
  await store(page, `(s) => {
    const app = window.__pixiApp; const r = app.canvas.getBoundingClientRect();
    const st = app.stage;
    const at = { x: (${mid[0]} - r.left - st.position.x) / st.scale.x, y: (${mid[1]} - r.top - st.position.y) / st.scale.y };
    const layer = s.layers.find((l) => l.id === s.ui.activeLayerId);
    s.addChild(layer.id, { id: 'barrel', name: 'Barrel', childType: 'asset', visible: true, objectType: 'image',
      assetId: 'missing:white', position: at, rotation: 0, scale: 1, width: 2, height: 2, tint: '#ffffff', flipX: false, flipY: false });
    s.setSelectedIds(['barrel']);
  }`)
  await pickTool(page, 'select')
  await waitFrame(page, 6)
  const dry = await rgb(page, ...mid)

  const card = page.getByTestId('shell-card')
  const below = card.locator('[data-setting="card.prop.belowWater"]').getByRole('switch')
  await expect(below).toBeVisible()
  await below.click()
  await waitFrame(page, 6)
  expect(await store(page, `(s) => s.layers.flatMap((l) => l.children || []).find((c) => c.id === 'barrel').belowWater`)).toBe(true)
  const wet = await rgb(page, ...mid)
  expect(Math.abs(wet.r - dry.r) + Math.abs(wet.g - dry.g) + Math.abs(wet.b - dry.b), 'tinted by the water').toBeGreaterThan(30)
  expect(wet.b, 'towards the water colour').toBeGreaterThan(wet.r)
  await expect(page.getByTestId('shell-status-hint')).toContainText('below water')
  await shot(page, '16-below-water')

  await page.getByTestId('shell-top-actions').getByRole('button', { name: 'Undo' }).click()
  await waitFrame(page, 6)
  const back = await rgb(page, ...mid)
  expect(Math.abs(back.r - dry.r) + Math.abs(back.g - dry.g) + Math.abs(back.b - dry.b)).toBeLessThan(6)
})
