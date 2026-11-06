import { test, expect } from '@playwright/test'
import { dockColumns, expectFrameGeometry, expectSlot, openNext, pickFromFlyout, shot } from './nextShell'

// Frame C (plan 5.3): Select in hand with nothing picked. Select's real panel is step 7;
// the stub family's Select stands in for it here.
test('frame C: Select keeps the last family\'s Look column, drops its drawing columns', async ({ page }) => {
  await openNext(page)
  await pickFromFlyout(page, 'Design', 'Floor')
  expect(await dockColumns(page)).toEqual(['level', 'layers', 'Shape', 'Edit', 'look'])

  const rail = page.getByTestId('shell-rail')
  await rail.getByRole('button', { name: 'Select' }).click()
  await expect(rail.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true')
  await expect(rail.getByRole('button', { name: 'Design' })).not.toHaveAttribute('aria-pressed', 'true')

  const panel = page.getByTestId('shell-tool-panel')
  await expect(panel).toHaveAttribute('data-tool', 'select')
  await expect(panel.locator('[data-composite="panel-header"]')).toHaveText('Select')
  await expect(panel.getByText('Pick only')).toBeVisible()
  await expect(page.getByTestId('shell-card')).toBeHidden()

  expect(await dockColumns(page)).toEqual(['level', 'layers', 'look'])
  await expect(page.getByTestId('shell-status-hint')).toHaveText('Nothing picked')

  await expectFrameGeometry(page)
  await expectSlot(page)
  await shot(page, '06-c')
})
