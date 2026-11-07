import { test, expect, type Page } from '@playwright/test'
import { drawRect, gotoApp, shapeCount, waitFrame } from './helpers'
import { pickTool } from './shell'

/**
 * Focus modes in the editor chrome: Auto by default, the backtick cycling Auto, Manual,
 * Fullscreen and back, the "…" menu's three radio rows, the mode on the layout root and
 * remembered across a reload; Auto fading the chrome once the pointer has been off it and
 * bringing it back on hover (moving over the canvas does not), never while something is
 * picked; Manual never fading; Fullscreen taking the chrome away with a Leave focus
 * button and leaving the canvas the whole viewport, the tools and undo still working.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const mode = (page: Page) => page.evaluate(() => (window as Any).__store.getState().ui.focusMode as string)
const shell = (page: Page) => page.getByTestId('shell')
const title = (page: Page) => page.getByTestId('shell-title-card')
const opacity = (page: Page) => title(page).evaluate((el) => parseFloat(getComputedStyle(el).opacity))

/** Past the 5 s idle delay and the 400 ms ease. */
const IDLE_MS = 5_800

async function backtick(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await page.keyboard.press('`')
  await waitFrame(page, 2)
}

/** The pointer onto the middle of the canvas, clear of every piece of chrome. */
async function overCanvas(page: Page, dx = 0): Promise<void> {
  const size = page.viewportSize()!
  await page.mouse.move(size.width / 2 + dx, size.height / 2 - 60)
}

test('the editor comes up in Auto, and the backtick cycles Auto, Manual, Fullscreen, Auto', { tag: '@shell' }, async ({ page }) => {
  await gotoApp(page)
  expect(await mode(page)).toBe('auto')
  const root = page.locator('[data-focus-mode]')
  await expect(root).toHaveAttribute('data-focus-mode', 'auto')
  await backtick(page)
  expect(await mode(page)).toBe('manual')
  await expect(root).toHaveAttribute('data-focus-mode', 'manual')
  await backtick(page)
  expect(await mode(page)).toBe('fullscreen')
  await expect(root).toHaveAttribute('data-focus-mode', 'fullscreen')
  await backtick(page)
  expect(await mode(page)).toBe('auto')
})

test('the "…" menu sets each mode and shows which one is on', { tag: '@shell' }, async ({ page }) => {
  await gotoApp(page)
  await page.getByTestId('shell-more').click()
  await expect(page.getByRole('menuitemradio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('menuitemradio', { name: 'Manual' }).click()
  expect(await mode(page)).toBe('manual')
  // A radio row leaves the menu open, showing the new mode.
  await expect(page.getByRole('menuitemradio', { name: 'Manual' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('menuitemradio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('menuitemradio', { name: 'Fullscreen' }).click()
  expect(await mode(page)).toBe('fullscreen')
})

test('the mode is remembered across a reload', { tag: '@shell' }, async ({ page }) => {
  await gotoApp(page)
  await backtick(page)
  expect(await mode(page)).toBe('manual')
  await page.reload()
  await page.getByTestId('v2-map-card').first().click()
  await expect(shell(page)).toBeVisible()
  expect(await mode(page)).toBe('manual')
})

test('Auto: the chrome is solid under the pointer and fades once the pointer has been off it', { tag: '@shell' }, async ({ page }) => {
  await gotoApp(page)
  await title(page).hover()
  await waitFrame(page, 3)
  await expect.poll(() => opacity(page)).toBeGreaterThan(0.9)
  await overCanvas(page)
  await page.waitForTimeout(IDLE_MS)
  await expect(shell(page)).toHaveAttribute('data-faded', 'true')
  await expect.poll(() => opacity(page)).toBeLessThan(0.5)
})

test('Auto: hovering the chrome brings it back; moving over the canvas does not', { tag: '@shell' }, async ({ page }) => {
  await gotoApp(page)
  await overCanvas(page)
  await page.waitForTimeout(IDLE_MS)
  await expect.poll(() => opacity(page)).toBeLessThan(0.5)
  for (const dx of [-50, 50, 0]) await overCanvas(page, dx)
  await waitFrame(page, 5)
  await expect(shell(page)).toHaveAttribute('data-faded', 'true')
  await title(page).hover()
  await expect.poll(() => opacity(page)).toBeGreaterThan(0.9)
})

test('Auto: nothing fades while something is picked', { tag: '@shell' }, async ({ page }) => {
  await gotoApp(page)
  await pickTool(page, 'rectangle')
  await drawRect(page, 500, 300, 640, 400)
  const id = await page.evaluate(() => {
    const s = (window as Any).__store.getState()
    const l = s.layers.find((x: Any) => x.type === 'dungeon')
    return l.children.at(-1).id as string
  })
  await page.evaluate((id) => (window as Any).__store.getState().setSelectedIds([id]), id)
  await overCanvas(page)
  await page.waitForTimeout(IDLE_MS)
  await expect(shell(page)).not.toHaveAttribute('data-faded', /.*/)
  expect(await opacity(page)).toBeGreaterThan(0.9)
})

test('Manual: the chrome stays solid however long the pointer is away', { tag: '@shell' }, async ({ page }) => {
  await gotoApp(page)
  await backtick(page)
  expect(await mode(page)).toBe('manual')
  await overCanvas(page)
  await page.waitForTimeout(IDLE_MS)
  await expect(shell(page)).not.toHaveAttribute('data-faded', /.*/)
  expect(await opacity(page)).toBeGreaterThan(0.9)
})

test('Fullscreen: the chrome goes, the canvas fills the viewport, and Leave focus comes back to Manual', { tag: '@shell' }, async ({ page }) => {
  await gotoApp(page)
  await backtick(page)
  await backtick(page)
  expect(await mode(page)).toBe('fullscreen')
  await expect(shell(page)).toHaveCount(0)
  await expect(title(page)).toHaveCount(0)
  await expect(page.getByTestId('shell-dock')).toHaveCount(0)
  const box = (await page.locator('canvas').first().boundingBox())!
  const size = page.viewportSize()!
  expect(box.width).toBeGreaterThanOrEqual(size.width - 1)
  expect(box.height).toBeGreaterThanOrEqual(size.height - 1)

  await page.getByRole('button', { name: 'Leave focus' }).click()
  expect(await mode(page)).toBe('manual')
  await expect(shell(page)).toBeVisible()
})

test('Fullscreen: a floor still draws and undo still undoes, and neither changes the mode', { tag: '@shell' }, async ({ page }) => {
  await gotoApp(page)
  // The rail is gone in Fullscreen, so the tool comes into hand first.
  await pickTool(page, 'rectangle')
  await backtick(page)
  await backtick(page)
  expect(await mode(page)).toBe('fullscreen')
  const before = await shapeCount(page)
  await drawRect(page, 500, 300, 640, 400)
  expect(await shapeCount(page)).toBe(before + 1)
  await page.keyboard.press('Control+z')
  await waitFrame(page, 2)
  expect(await shapeCount(page)).toBe(before)
  expect(await mode(page)).toBe('fullscreen')
  // And a mode change is not an undo step.
  await backtick(page)
  await page.keyboard.press('Control+z')
  await waitFrame(page, 2)
  expect(await mode(page)).toBe('auto')
  expect(await shapeCount(page)).toBe(before)
})
