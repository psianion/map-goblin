import { test, expect, type Page } from '@playwright/test'
import { waitFrame } from './helpers'
import { dockColumns, openNext, pickFromFlyout, shot } from './nextShell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const lights = (page: Page) =>
  page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const all = st.layers.flatMap((l: Any) => (l.type === 'dungeon' ? l.children : [])).filter((c: Any) => c.childType === 'light')
    return { count: all.length as number, last: all.at(-1) ?? null }
  })

const env = (page: Page) => page.evaluate(() => (window as Any).__store.getState().mapSettings.environment ?? 'indoor')

// The Light tool on /next: Bright and Intensity in the dock and Effect in the panel set up
// the next light, which lands with them; the Sky and mood sheet changes the environment;
// undo takes both back.
test('environment: a light from the dock and panel, the sky sheet, undo', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openNext(page)
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    st.setActiveLayerId(st.layers.find((l: Any) => l.type === 'dungeon' && !l.locked).id)
  })

  await pickFromFlyout(page, 'Environment', 'Light')
  expect(await dockColumns(page)).toEqual(['level', 'layers', 'Bright', 'Dim', 'Intensity', 'Colour', 'presets'])
  const dock = page.getByTestId('shell-dock')
  const panel = page.getByTestId('shell-tool-panel')

  // Bright steps up 5 ft; Intensity drops to its lowest.
  const ftPerCell = await page.evaluate(() => (window as Any).__store.getState().mapSettings.cellScale.value as number)
  const bright0 = await page.evaluate(() => (window as Any).__store.getState().tools.settings.lightDefaults.featherRadius as number)
  await dock.getByRole('button', { name: 'Increase Bright' }).click()
  const brightFt = Math.round(bright0 * ftPerCell) + 5
  await expect(dock.locator('[data-setting="light.bright"]')).toContainText(`${brightFt} ft`)
  await dock.getByRole('group', { name: 'Intensity' }).getByRole('slider').focus()
  await page.keyboard.press('Home')
  await expect(dock.locator('[data-setting="light.intensity"]')).toContainText('10%')

  // Effect in the panel: Pulse, and its Speed shows.
  await panel.getByRole('button', { name: 'None', exact: true }).click()
  await expect(panel.locator('[data-setting="light.speed"]')).toHaveCount(0)
  await panel.getByRole('button', { name: 'Pulse' }).click()
  await expect(panel.locator('[data-setting="light.speed"]').first()).toBeVisible()
  await expect(panel.getByText(/falloff|night only|darkvision/i)).toHaveCount(0)

  const before = await lights(page)
  await page.mouse.click(560, 460)
  await waitFrame(page, 4)
  const after = await lights(page)
  expect(after.count).toBe(before.count + 1)
  expect(after.last).toMatchObject({ intensity: 0.1, animation: { kind: 'pulse' } })
  expect(Math.round(after.last.featherRadius * ftPerCell)).toBe(brightFt)
  await page.mouse.move(1390, 700)
  await shot(page, '13-light')

  // The Sky and mood sheet, from the Light panel.
  await pickFromFlyout(page, 'Environment', 'Light')
  await page.getByTestId('shell-tool-panel').getByRole('button', { name: /Sky and mood/ }).click()
  const sheet = page.getByTestId('shell-sky-sheet')
  await expect(sheet).toBeVisible()
  for (const gone of ['Climate', 'Weather', 'Night sky', 'Fixed hour']) await expect(sheet.getByText(gone)).toHaveCount(0)
  const was = await env(page)
  const to = was === 'outdoor' ? 'Underground' : 'Outdoor'
  await sheet.getByRole('button', { name: to, exact: true }).click()
  expect(await env(page)).toBe(to.toLowerCase())
  await shot(page, '13-sky')

  // Undo: the environment, then the light.
  const undo = page.getByTestId('shell-top-actions').getByRole('button', { name: 'Undo' })
  await undo.click()
  expect(await env(page)).toBe(was)
  await undo.click()
  await expect.poll(async () => (await lights(page)).count).toBe(before.count)
  expect(errors).toEqual([])
})
