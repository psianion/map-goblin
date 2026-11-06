import { test, expect, type Page } from '@playwright/test'
import { waitFrame } from './helpers'
import { openNext, shot } from './nextShell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const activeTool = (page: Page) => page.evaluate(() => (window as Any).__store.getState().tools.activeTool as string)

/** A key to the page, as the map hears it: nothing focused. */
async function press(page: Page, key: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await page.keyboard.press(key)
  await waitFrame(page, 2)
}

// Step 9: the rail, family, tool and dock keys come from the registry on /next.
test('keys from the registry: a family key, a tool key, Escape, Previous tool and the sheet', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openNext(page)
  const flyout = page.getByTestId('shell-flyout')

  // D opens Design's flyout, F picks Floor from it and closes it.
  await press(page, 'd')
  await expect(flyout).toBeVisible()
  await expect(flyout).toHaveAttribute('data-family', 'design')
  await press(page, 'f')
  await expect(flyout).toBeHidden()
  expect(await activeTool(page)).toMatch(/^(rectangle|polygon|regularPolygon)$/)
  await expect(page.getByTestId('shell-tool-panel')).toHaveAttribute('data-tool', 'floor')

  // A dock key: P is the polygon in Floor's shape row.
  await press(page, 'p')
  expect(await activeTool(page)).toBe('polygon')

  // With Design's tool in hand, its tool keys answer straight away: W is Wall.
  await press(page, 'w')
  expect(await activeTool(page)).toBe('wall')

  // Escape closes a flyout without picking anything.
  await press(page, 't')
  await expect(flyout).toHaveAttribute('data-family', 'terrain')
  await press(page, 'Escape')
  await expect(flyout).toBeHidden()
  expect(await activeTool(page)).toBe('wall')

  // V is Select; Q goes back to the last family tool.
  await press(page, 'v')
  expect(await activeTool(page)).toBe('select')
  await press(page, 'q')
  expect(await activeTool(page)).toBe('wall')

  // ? opens the shortcuts sheet, which lists the registry's keys and the global chords.
  await press(page, '?')
  const sheet = page.getByTestId('shell-shortcuts')
  await expect(sheet).toBeVisible()
  await expect(sheet.locator('[data-key-row="family.design"]')).toContainText('D')
  await expect(sheet.locator('[data-key-row="tool.floor"]')).toContainText('F')
  await expect(sheet.locator('[data-key-row="tool.previous"]')).toContainText('Q')
  await expect(sheet.locator('[data-key-row="edit.undo"]')).toBeVisible()
  await shot(page, '09-shortcuts')
  await sheet.getByRole('button', { name: 'Close Keyboard shortcuts' }).click()
  await expect(sheet).toBeHidden()

  // The help button at the end of the status bar opens it too.
  await page.getByTestId('shell-help').click()
  await expect(sheet).toBeVisible()
  expect(errors).toEqual([])
})
