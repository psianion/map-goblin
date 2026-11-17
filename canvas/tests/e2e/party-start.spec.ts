/**
 * Table fix pass decision f: "Set party start" in the rooms list puts a point the party starts
 * the table at, on the shown level, and a second press clears it; undo puts it back.
 * Written, never run by the builders: the tester runs it once (plan section 6.3).
 */
import { test, expect } from '@playwright/test'
import { gotoApp } from './helpers'

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any

const partyStart = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as Any).__store.getState().mapSettings.partyStart ?? null)

test('Set party start in the rooms list sets, clears and undoes', { tag: '@party-start' }, async ({ page }) => {
  await gotoApp(page)
  await page.evaluate(() => (window as Any).__store.getState().setRoomsSheetOpen(true))
  const button = page.getByTestId('rooms-party-start')
  await expect(button).toBeVisible()

  await button.click()
  const set = await partyStart(page)
  expect(set).not.toBeNull()
  // A cell centre, on the level the editor shows.
  expect(set.x % 1).toBe(0.5)
  expect(set.y % 1).toBe(0.5)
  expect(set.levelId).toBe(await page.evaluate(() => (window as Any).__store.getState().ui.activeLevelId))

  await button.click()
  expect(await partyStart(page)).toBeNull()
  await page.keyboard.press('Control+z')
  expect(await partyStart(page)).toEqual(set)
})
