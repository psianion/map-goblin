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

/** Hold the brush still on one spot of Warren Hall's floor for `ms`, then take the pointer off the map. */
async function hold(page: Page, x: number, y: number, ms: number): Promise<void> {
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.waitForTimeout(ms)
  await page.mouse.up()
  await page.mouse.move(1390, 700)
  await waitFrame(page, 8)
}

/** Intensity through its dock slider: Home is the lowest, End full. */
async function setIntensity(page: Page, key: 'Home' | 'End'): Promise<void> {
  const slider = page.getByTestId('shell-dock').getByRole('group', { name: 'Intensity' }).getByRole('slider')
  await slider.focus()
  await page.keyboard.press(key)
}

// The Terrain brush, Dungeondraft style: holding the brush still adds paint over time,
// Intensity setting how fast. One second held at the lowest intensity lays a little, one
// second at full lays the texture solid; the colour tints a hold; undo takes all three back.
test('terrain brush: a held brush builds paint at the intensity set, and undo takes it back', { tag: '@terrain' }, async ({ page }) => {
  await openEditor(page)
  await pickFromFlyout(page, 'Terrain', 'Terrain brush')
  await page.evaluate(() =>
    (window as Any).__store.getState().setTerrainData({ palette: ['gg-demo:floor_small_8x8_floor_A', null, null, null, null, null] }),
  )
  await waitFrame(page, 10)

  expect(await dockColumns(page)).toEqual(['level', 'layers', 'Size', 'Intensity', 'slots'])
  const panel = page.getByTestId('shell-tool-panel')
  await expect(panel.locator('[data-setting="terrain.mode"]')).toBeVisible()
  await expect(panel.locator('[data-setting="terrain.smoothBlend"]')).toBeVisible()
  await expect(panel.locator('[data-setting="terrain.fill"]')).toBeVisible()
  await expect(panel.locator('[data-setting="terrain.colour"]')).toBeVisible()
  await expect(page.getByTestId('shell-status-hint')).toContainText('Hold to build up')

  // Size: ] and the wheel step it.
  const r0 = (await brush(page)).radius
  await page.mouse.move(900, 300)
  await page.keyboard.press(']')
  expect((await brush(page)).radius).toBe(r0 + 0.5)
  await page.mouse.wheel(0, 100)
  await waitFrame(page, 2)
  expect((await brush(page)).radius).toBe(r0)

  // Where each hold is read: clear floor, away from the hall's label, props and rocks.
  const spots: [number, number][] = [
    [520, 415],
    [520, 485],
    [640, 560],
  ]
  const bare = await Promise.all(spots.map(([x, y]) => rgb(page, x, y)))

  // One second at the lowest intensity lays a little paint.
  await setIntensity(page, 'Home')
  expect((await brush(page)).strength).toBe(0.1)
  await hold(page, ...spots[0], 1000)
  const low = await rgb(page, ...spots[0])

  // One second at full intensity lays the texture solid.
  await setIntensity(page, 'End')
  expect((await brush(page)).strength).toBe(1)
  await hold(page, ...spots[1], 1000)
  const full = await rgb(page, ...spots[1])
  expect(Math.abs(lum(low) - lum(bare[0])), 'a second at low intensity paints a little').toBeGreaterThan(3)
  expect(Math.abs(lum(full) - lum(bare[1])), 'a second at full intensity paints').toBeGreaterThan(30)
  expect(Math.abs(lum(full) - lum(low)), 'intensity changes how fast paint builds').toBeGreaterThan(15)

  // One colour with alpha: red at 80% tints a hold.
  await panel.locator('[data-setting="terrain.colour"]').getByRole('button', { name: 'Colour' }).click()
  await page.getByRole('textbox', { name: 'Colour hex' }).fill('#ff0000cc')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('textbox', { name: 'Colour hex' })).toBeHidden()
  expect(await brush(page)).toMatchObject({ tint: '#ff0000', alpha: 0.8 })
  await hold(page, ...spots[2], 1000)
  const red = await rgb(page, ...spots[2])
  expect(red.r - red.g, 'the hold is tinted').toBeGreaterThan(40)
  await shot(page, '11-terrain')

  // Undo takes the three holds back, last first.
  const undo = page.getByTestId('shell-top-actions').getByRole('button', { name: 'Undo' })
  for (const i of [2, 1, 0]) {
    await undo.click()
    await expect.poll(async () => Math.abs(lum(await rgb(page, ...spots[i])) - lum(bare[i]))).toBeLessThan(3)
  }
})
