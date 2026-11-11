import { test, expect, type Page } from '@playwright/test'
import { getPixelColor, waitFrame } from './helpers'
import { dockColumns, openEditor, pickFromFlyout, shot } from './shell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

/** The canvas colour at a viewport point. */
async function rgb(page: Page, x: number, y: number): Promise<{ r: number; g: number; b: number }> {
  const box = await page.evaluate(() => (window as Any).__pixiApp.canvas.getBoundingClientRect())
  const c = await getPixelColor(page, x - box.left, y - box.top)
  return { r: c.r, g: c.g, b: c.b }
}

/** A drag from `from` to `to` in steps, then the pointer off the map. */
async function stroke(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.mouse.move(...from)
  await page.mouse.down()
  await page.mouse.move(...to, { steps: 12 })
  await page.mouse.up()
  await page.mouse.move(1390, 700)
  await waitFrame(page, 8)
}

// The Water brush: a stroke paints water on the layer in hand, Deep in the middle; changing
// Deep in the panel recolours that water at once, and undo takes the colour, then the
// stroke, back.
test('water brush: paint water, change Deep, sample, undo', { tag: '@terrain' }, async ({ page }) => {
  await openEditor(page)
  await pickFromFlyout(page, 'Terrain', 'Water brush')
  await waitFrame(page, 4)

  expect(await dockColumns(page)).toEqual(['level', 'layers', 'family', 'Size', 'Place'])
  const dock = page.getByTestId('shell-dock')
  await expect(dock.getByRole('button', { name: 'Shape' })).toBeDisabled()
  await expect(dock.getByText('Shape comes after the brush')).toBeVisible()
  const panel = page.getByTestId('shell-tool-panel')
  for (const id of ['terrain.mode', 'water.shallow', 'water.deep', 'water.blend', 'water.border']) {
    await expect(panel.locator(`[data-setting="${id}"]`)).toBeVisible()
  }
  await expect(page.getByTestId('shell-status-hint')).toContainText('Paint water')

  // A wide stroke, so its middle is well past the blend distance.
  await page.keyboard.press(']')
  await page.keyboard.press(']')
  const mid: [number, number] = [640, 420]
  const bare = await rgb(page, ...mid)
  await stroke(page, [520, 420], [760, 420])
  const deep = await rgb(page, ...mid)
  expect(Math.abs(deep.r - 0x5f) + Math.abs(deep.g - 0x8a) + Math.abs(deep.b - 0x93), 'the middle is Deep').toBeLessThan(40)
  expect(Math.abs(deep.b - bare.b) + Math.abs(deep.r - bare.r), 'water drew over the ground').toBeGreaterThan(20)

  // Deep to red: the water already on the layer takes it.
  await panel.locator('[data-setting="water.deep"]').getByRole('button', { name: 'Deep' }).click()
  await page.getByRole('textbox', { name: 'Deep hex' }).fill('#ff0000')
  await page.keyboard.press('Escape')
  await waitFrame(page, 6)
  const red = await rgb(page, ...mid)
  expect(red.r - red.b, 'the middle turned red').toBeGreaterThan(80)
  await shot(page, '12-water')

  const undo = page.getByTestId('shell-top-actions').getByRole('button', { name: 'Undo' })
  await undo.click()
  await expect.poll(async () => (await rgb(page, ...mid)).b).toBeGreaterThan(0x70)
  await undo.click()
  await expect.poll(async () => {
    const c = await rgb(page, ...mid)
    return Math.abs(c.r - bare.r) + Math.abs(c.g - bare.g) + Math.abs(c.b - bare.b)
  }).toBeLessThan(6)
})
