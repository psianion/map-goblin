import { test, expect } from '@playwright/test'
import { dockColumns, expectFrameGeometry, expectSlot, openEditor, shot } from './shell'

// Frame A (plan 5.1): a family clicked opens its flyout in the slot beside the rail.
test('frame A: a family click opens its flyout, a pick or Escape closes it', { tag: '@shell' }, async ({ page }) => {
  await openEditor(page)
  const rail = page.getByTestId('shell-rail')
  await rail.getByRole('button', { name: 'Design' }).click()

  const flyout = page.getByTestId('shell-flyout')
  await expect(flyout).toBeVisible()
  await expect(flyout).toContainText('Esc closes')
  const rows = flyout.getByRole('button')
  await expect(rows).toHaveCount(4)
  await expect(rows.nth(0)).toContainText('Floor')
  await expect(rows.nth(0)).toContainText('Rectangle, polygon, regular polygon')
  await expect(rows.nth(3)).toContainText('Elevation')

  // The ring is on the open family, not on the rail tool in hand.
  await expect(rail.getByRole('button', { name: 'Design' })).toHaveAttribute('aria-pressed', 'true')
  await expect(rail.getByRole('button', { name: 'Select' })).not.toHaveAttribute('aria-pressed', 'true')

  await expectFrameGeometry(page)
  await expectSlot(page)
  expect(await dockColumns(page)).toEqual(['level', 'layers'])
  await shot(page, '06-a')

  await page.keyboard.press('Escape')
  await expect(flyout).toBeHidden()

  await rail.getByRole('button', { name: 'Design' }).click()
  await flyout.getByRole('button', { name: /^Wall/ }).click()
  await expect(flyout).toBeHidden()
  expect(await page.evaluate(() => (window as unknown as { __store: { getState(): { tools: { activeTool: string } } } }).__store.getState().tools.activeTool)).toBe('wall')
})
