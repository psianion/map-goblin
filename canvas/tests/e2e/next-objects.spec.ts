import { test, expect, type Page } from '@playwright/test'
import { waitFrame } from './helpers'
import { dockColumns, openNext, pickFromFlyout, shot } from './nextShell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

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

// Stamp and Scatter on /next: picking Stamp opens the library; a prop placed with a tint
// and an angle set before placing; a scatter with radius and density changed; undo
// takes both back.
test('objects: stamp with tint and angle, scatter with radius and density, undo both', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openNext(page)
  // Draw on the warren's own layer, keep placing so the stamp stays in hand.
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    st.setActiveLayerId(st.layers.find((l: Any) => l.type === 'dungeon' && !l.locked).id)
    st.updateToolSettings({ continuousPlacement: true })
  })

  await pickFromFlyout(page, 'Objects', 'Stamp')
  await expect(page.getByTestId('shell-assets')).toBeVisible()
  expect((await brush(page)).stampMode).toBe(true)
  expect(await dockColumns(page)).toEqual(['level', 'layers', 'Scale', 'Angle', 'Variant', 'Tint', 'props'])
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
  expect(await dockColumns(page)).toEqual(['level', 'layers', 'Radius', 'Density', 'props'])
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
