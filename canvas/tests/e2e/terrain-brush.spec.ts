import { test, expect, type Page } from '@playwright/test'
import { getPixelColor, waitFrame } from './helpers'
import { dockColumns, openEditor, pickFromFlyout, shot } from './shell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const brush = (page: Page) =>
  page.evaluate(() => {
    const b = (window as Any).__store.getState().tools.settings.terrainBrush
    return { radius: b.radius as number, strength: b.strength as number, tint: b.tintColor as string, alpha: b.tintOpacity as number }
  })

/** The canvas colour at a viewport point. */
async function rgb(page: Page, x: number, y: number): Promise<{ r: number; g: number; b: number }> {
  const box = await page.evaluate(() => (window as Any).__pixiApp.canvas.getBoundingClientRect())
  const c = await getPixelColor(page, x - box.left, y - box.top)
  return { r: c.r, g: c.g, b: c.b }
}

const lum = (c: { r: number; g: number; b: number }) => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b

/** A stroke across Warren Hall's floor at height `y`, then the pointer off the map so the ring is gone. */
async function stroke(page: Page, y: number): Promise<void> {
  await page.mouse.move(480, y)
  await page.mouse.down()
  await page.mouse.move(640, y, { steps: 16 })
  await page.mouse.up()
  await page.mouse.move(1390, 700)
  await waitFrame(page, 8)
}

// The Terrain brush: its dock and panel, then three strokes on the warren's hall,
// at the lowest strength, at full strength and tinted, each changing what is painted, and
// undo taking all three back.
test('terrain brush: strength and colour alpha change the paint, and undo takes it back', { tag: '@terrain' }, async ({ page }) => {
  await openEditor(page)
  await pickFromFlyout(page, 'Terrain', 'Terrain brush')
  await page.evaluate(() =>
    (window as Any).__store.getState().setTerrainData({ palette: ['gg-demo:floor_small_8x8_floor_A', null, null, null, null, null] }),
  )
  await waitFrame(page, 10)

  expect(await dockColumns(page)).toEqual(['level', 'layers', 'Size', 'Strength', 'slots'])
  const panel = page.getByTestId('shell-tool-panel')
  await expect(panel.locator('[data-setting="edit.erase"]')).toBeVisible()
  await expect(panel.locator('[data-setting="terrain.colour"]')).toBeVisible()
  await expect(page.getByTestId('shell-status-hint')).toContainText('Drag to paint')

  // Size: ] and the wheel step it.
  const r0 = (await brush(page)).radius
  await page.mouse.move(900, 300)
  await page.keyboard.press(']')
  expect((await brush(page)).radius).toBe(r0 + 0.5)
  await page.mouse.wheel(0, 100)
  await waitFrame(page, 2)
  expect((await brush(page)).radius).toBe(r0)

  // Where each stroke is read: clear floor, away from the hall's label, props and rocks.
  const rows = [415, 485, 560]
  const xs = [500, 500, 640]
  const bare = await Promise.all(rows.map((y, i) => rgb(page, xs[i], y)))

  // Strength at its lowest blends the texture in over the floor.
  const strength = page.getByTestId('shell-dock').getByRole('group', { name: 'Strength' }).getByRole('slider')
  await strength.focus()
  await page.keyboard.press('Home')
  expect((await brush(page)).strength).toBe(0.1)
  await stroke(page, rows[0])
  const low = await rgb(page, xs[0], rows[0])

  // At full strength the same stroke lays the texture solid.
  await strength.focus()
  await page.keyboard.press('End')
  expect((await brush(page)).strength).toBe(1)
  await stroke(page, rows[1])
  const full = await rgb(page, xs[1], rows[1])
  expect(Math.abs(lum(full) - lum(bare[1])), 'full strength paints').toBeGreaterThan(30)
  expect(Math.abs(lum(low) - lum(bare[0])), 'low strength paints a little').toBeGreaterThan(5)
  expect(Math.abs(lum(full) - lum(low)), 'strength changes the paint').toBeGreaterThan(20)

  // One colour with alpha: red at 80% tints the stroke.
  await panel.locator('[data-setting="terrain.colour"]').getByRole('button', { name: 'Colour' }).click()
  await page.getByRole('textbox', { name: 'Colour hex' }).fill('#ff0000cc')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('textbox', { name: 'Colour hex' })).toBeHidden()
  expect(await brush(page)).toMatchObject({ tint: '#ff0000', alpha: 0.8 })
  await stroke(page, rows[2])
  const red = await rgb(page, xs[2], rows[2])
  expect(red.r - red.g, 'the stroke is tinted').toBeGreaterThan(40)
  await shot(page, '11-terrain')

  // Undo takes the three strokes back, last first.
  const undo = page.getByTestId('shell-top-actions').getByRole('button', { name: 'Undo' })
  for (const i of [2, 1, 0]) {
    await undo.click()
    await expect.poll(async () => Math.abs(lum(await rgb(page, xs[i], rows[i])) - lum(bare[i]))).toBeLessThan(3)
  }
})
