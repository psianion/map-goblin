import { test, expect, type Page } from '@playwright/test'
import { box, dockColumns, expectFrameGeometry, expectSlot, openNext, pickFromFlyout, shot } from './nextShell'

const activeTool = (page: Page) =>
  page.evaluate(() => (window as unknown as { __store: { getState(): { tools: { activeTool: string } } } }).__store.getState().tools.activeTool)

async function frameB(page: Page) {
  await pickFromFlyout(page, 'Design', 'Floor')
  const panel = page.getByTestId('shell-tool-panel')
  await expect(panel).toBeVisible()
  await expect(page.getByTestId('shell-flyout')).toBeHidden()
  // Polygon, as the frame is drawn.
  await page.getByTestId('shell-dock').getByRole('button', { name: 'Polygon', exact: true }).click()
  expect(await activeTool(page)).toBe('polygon')
}

// Frame B (plan 5.2): a tool picked, its panel in the same slot, its dock columns.
test('frame B: the tool panel holds setup, the dock holds what the tool uses', async ({ page }) => {
  await openNext(page)
  await frameB(page)
  const panel = page.getByTestId('shell-tool-panel')

  await expect(panel.locator('[data-composite="panel-header"]')).toContainText('Design / Floor')
  // The switcher row: the family's four tools, Floor ringed.
  const header = panel.locator('[data-composite="panel-header"]')
  await expect(header.getByRole('button')).toHaveCount(4)
  await expect(header.getByRole('button', { name: 'Floor' })).toHaveAttribute('aria-pressed', 'true')

  const captions = await panel.locator('[data-section]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.section))
  expect(captions).toEqual(['Mode', 'Placement', 'Edge', 'Defaults for new floors'])
  await expect(panel.getByText('Snap to grid')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Reset', exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Save as preset' })).toBeVisible()
  // Nothing in both: the dock's settings are not in the panel.
  await expect(panel.locator('[data-setting="edit.curve"], [data-setting="floor.shape"]')).toHaveCount(0)

  expect(await dockColumns(page)).toEqual(['level', 'layers', 'Shape', 'Edit', 'look'])
  await expect(page.getByTestId('shell-dock').locator('[data-setting="floor.mode"]')).toHaveCount(0)

  // The status hint carries the tool's keys as keycaps; help is last.
  const hint = page.getByTestId('shell-status-hint')
  await expect(hint).toContainText('Click points')
  await expect(hint.locator('kbd')).toHaveText(['Enter', 'Backspace', 'Shift'])
  const last = page.getByTestId('shell-status').locator('> *').last()
  await expect(last).toHaveAttribute('data-testid', 'shell-help')

  await expectFrameGeometry(page)
  await expectSlot(page)
  await shot(page, '06-b')

  // Sides shows only for Regular, and the dock keeps its height either way.
  const dock = page.getByTestId('shell-dock')
  await expect(dock.locator('[data-setting="floor.sides"]')).toHaveCount(0)
  await dock.getByRole('button', { name: 'Regular polygon' }).click()
  await expect(dock.locator('[data-setting="floor.sides"]')).toHaveCount(1)
  expect((await box(dock)).height).toBe(112)

  // The panel stays open while drawing; the switcher changes tool without the flyout.
  await page.getByTestId('shell-tool-panel').getByRole('button', { name: 'Wall' }).click()
  expect(await activeTool(page)).toBe('wall')
  await expect(page.getByTestId('shell-tool-panel')).toHaveAttribute('data-tool', 'wall')
})

test('frame B in the dark theme', async ({ page }) => {
  await openNext(page, 'dark')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await frameB(page)
  await expectFrameGeometry(page)
  await shot(page, '06-b-dark')
})
