/**
 * 22 - Focus Mode
 *
 * TDD tests written BEFORE Task #4 UI implementation.
 * Tests 1-4 (store/shortcut) may pass early since the shortcut is wired.
 * Tests 5-12 (UI/DOM/idle) will fail until Task #4 implements:
 *   - data-focus-mode attribute on the layout root
 *   - data-testid="focus-mode-btn" overlay button
 *   - data-testid="left-toolbar" on the left toolbar
 *   - data-testid="right-panel" on the right panel
 *   - Opacity fade on panels when idle in 'auto' mode
 *   - Idle timer reset on mouse movement / pointer events
 *   - CSS grid collapses to "0px 1fr 0px" in 'fullscreen' mode (no browser Fullscreen API)
 */

import { test, expect } from '@playwright/test'
import { gotoApp, waitFrame } from './helpers'

// Helper: read focusMode from store
async function getFocusMode(page: Parameters<typeof gotoApp>[0]): Promise<string> {
  return page.evaluate(() => {
    const store = (window as { __store?: { getState: () => { ui: { focusMode: string } } } }).__store
    return store?.getState().ui.focusMode ?? 'unknown'
  })
}

// Playwright's page isn't available at module scope so inline below
test.describe('22 - Focus Mode', () => {

  // ─── Store / Shortcut Tests (should pass once Task #2 is done) ─────────────

  test('initial focus mode is auto', async ({ page }) => {
    await gotoApp(page)

    const storeExposed = await page.evaluate(() => !!(window as { __store?: unknown }).__store)
    expect(storeExposed, '__store must be exposed on window').toBe(true)

    const mode = await getFocusMode(page)
    expect(mode).toBe('auto')
  })

  test('backtick cycles auto → manual', async ({ page }) => {
    await gotoApp(page)

    const before = await getFocusMode(page)
    expect(before).toBe('auto')

    await page.keyboard.press('`')
    await waitFrame(page, 3)

    const after = await getFocusMode(page)
    expect(after).toBe('manual')
  })

  test('backtick cycles manual → fullscreen', async ({ page }) => {
    await gotoApp(page)

    await page.keyboard.press('`') // auto → manual
    await waitFrame(page, 2)
    await page.keyboard.press('`') // manual → fullscreen
    await waitFrame(page, 2)

    const mode = await getFocusMode(page)
    expect(mode).toBe('fullscreen')
  })

  test('backtick cycles fullscreen → auto (wraps around)', async ({ page }) => {
    await gotoApp(page)

    // 3 presses should complete the cycle
    await page.keyboard.press('`')
    await page.keyboard.press('`')
    await page.keyboard.press('`')
    await waitFrame(page, 3)

    const mode = await getFocusMode(page)
    expect(mode).toBe('auto')
  })

  // ─── DOM Attribute Tests (will fail until Task #4 adds data-focus-mode) ────

  test('data-focus-mode attribute reflects current mode on layout root', async ({ page }) => {
    await gotoApp(page)

    // The layout root element should expose the current focus mode
    const layoutEl = page.locator('[data-focus-mode]').first()
    await expect(layoutEl).toBeAttached()

    const initial = await layoutEl.getAttribute('data-focus-mode')
    expect(initial).toBe('auto')

    // Cycle to manual
    await page.keyboard.press('`')
    await waitFrame(page, 3)

    const updated = await layoutEl.getAttribute('data-focus-mode')
    expect(updated).toBe('manual')

    // Cycle to fullscreen
    await page.keyboard.press('`')
    await waitFrame(page, 3)

    const fullscreen = await layoutEl.getAttribute('data-focus-mode')
    expect(fullscreen).toBe('fullscreen')
  })

  // ─── Overlay Button Tests (will fail until Task #4 adds the button) ────────

  test('focus mode overlay button is present in the canvas area', async ({ page }) => {
    await gotoApp(page)

    const btn = page.locator('[data-testid="focus-mode-btn"]')
    await expect(btn).toBeAttached()
    await expect(btn).toBeVisible()
  })

  test('focus mode button has correct aria-label for auto mode', async ({ page }) => {
    await gotoApp(page)

    const btn = page.locator('[data-testid="focus-mode-btn"]')
    await expect(btn).toBeAttached()

    const label = await btn.getAttribute('aria-label')
    expect(label).toBeTruthy()
    expect(label!.toLowerCase()).toMatch(/focus|auto/)
  })

  test('clicking focus mode button cycles from auto to manual', async ({ page }) => {
    await gotoApp(page)

    const before = await getFocusMode(page)
    expect(before).toBe('auto')

    const btn = page.locator('[data-testid="focus-mode-btn"]')
    await expect(btn).toBeAttached()
    await btn.click()
    await waitFrame(page, 3)

    const after = await getFocusMode(page)
    expect(after).toBe('manual')
    expect(after).not.toBe(before)
  })

  // ─── Idle Fade Tests (will fail until Task #4 implements idle timer/fade) ──

  test('toolbar is fully opaque on load in auto mode', async ({ page }) => {
    await gotoApp(page)

    const mode = await getFocusMode(page)
    expect(mode).toBe('auto')

    // Immediately after load, UI chrome should be visible
    const toolbar = page.locator('[data-testid="left-toolbar"]')
    await expect(toolbar).toBeVisible()

    const opacity = await toolbar.evaluate((el) =>
      parseFloat(window.getComputedStyle(el).opacity),
    )
    expect(opacity).toBeGreaterThan(0.9)
  })

  test('toolbar fades after idle timeout in auto mode', async ({ page }) => {
    await gotoApp(page)

    const mode = await getFocusMode(page)
    expect(mode).toBe('auto')

    const toolbar = page.locator('[data-testid="left-toolbar"]')
    await expect(toolbar).toBeVisible()

    const beforeOpacity = await toolbar.evaluate((el) =>
      parseFloat(window.getComputedStyle(el).opacity),
    )
    expect(beforeOpacity).toBeGreaterThan(0.9)

    // Wait past idle threshold (5 s + 0.5 s buffer for transition)
    await page.waitForTimeout(5500)
    await waitFrame(page, 3)

    const afterOpacity = await toolbar.evaluate((el) =>
      parseFloat(window.getComputedStyle(el).opacity),
    )
    expect(afterOpacity).toBeLessThanOrEqual(0.15)
  })

  test('toolbar stays opaque after idle in manual mode', async ({ page }) => {
    await gotoApp(page)

    // Switch to manual
    await page.keyboard.press('`')
    await waitFrame(page, 2)

    const mode = await getFocusMode(page)
    expect(mode).toBe('manual')

    const toolbar = page.locator('[data-testid="left-toolbar"]')
    await expect(toolbar).toBeVisible()

    // Wait past idle threshold (same 5.5s used in auto-mode test)
    await page.waitForTimeout(5500)
    await waitFrame(page, 3)

    const opacity = await toolbar.evaluate((el) =>
      parseFloat(window.getComputedStyle(el).opacity),
    )
    expect(opacity).toBeGreaterThan(0.9)
  })

  test('hovering over toolbar restores faded panels to full opacity', async ({ page }) => {
    await gotoApp(page)

    const mode = await getFocusMode(page)
    expect(mode).toBe('auto')

    const toolbar = page.locator('[data-testid="left-toolbar"]')

    // Let panels fade fully
    await page.waitForTimeout(5500)
    await waitFrame(page, 3)

    const fadedOpacity = await toolbar.evaluate((el) =>
      parseFloat(window.getComputedStyle(el).opacity),
    )
    expect(fadedOpacity).toBeLessThanOrEqual(0.15)

    // Hover over the toolbar — should restore to full opacity
    const toolbarBox = await toolbar.boundingBox()
    expect(toolbarBox).not.toBeNull()
    await page.mouse.move(
      toolbarBox!.x + toolbarBox!.width / 2,
      toolbarBox!.y + toolbarBox!.height / 2,
    )
    await waitFrame(page, 5)

    const restoredOpacity = await toolbar.evaluate((el) =>
      parseFloat(window.getComputedStyle(el).opacity),
    )
    expect(restoredOpacity).toBeGreaterThan(0.9)
  })

  test('canvas mouse movement does NOT restore faded panels', async ({ page }) => {
    await gotoApp(page)

    const mode = await getFocusMode(page)
    expect(mode).toBe('auto')

    // Let panels fade fully
    await page.waitForTimeout(5500)
    await waitFrame(page, 3)

    const toolbar = page.locator('[data-testid="left-toolbar"]')
    const fadedOpacity = await toolbar.evaluate((el) =>
      parseFloat(window.getComputedStyle(el).opacity),
    )
    expect(fadedOpacity).toBeLessThanOrEqual(0.15)

    // Move mouse around the canvas — should NOT restore panels
    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()
    const cx = box!.x + box!.width / 2
    const cy = box!.y + box!.height / 2
    await page.mouse.move(cx - 50, cy - 50)
    await page.mouse.move(cx + 50, cy + 50)
    await page.mouse.move(cx, cy)
    await waitFrame(page, 5)

    const stillFadedOpacity = await toolbar.evaluate((el) =>
      parseFloat(window.getComputedStyle(el).opacity),
    )
    // Canvas mouse movement must not restore panels — still faded
    expect(stillFadedOpacity).toBeLessThanOrEqual(0.15)
  })

  // ─── Fullscreen Layout Test (will fail until Task #4 collapses panels) ──────

  test('fullscreen mode hides left and right panels', async ({ page }) => {
    await gotoApp(page)

    // Press backtick twice: auto → manual → fullscreen
    await page.keyboard.press('`')
    await page.keyboard.press('`')
    await waitFrame(page, 3)

    const mode = await getFocusMode(page)
    expect(mode).toBe('fullscreen')

    // In fullscreen mode the panels are removed from the DOM entirely
    const leftToolbar = page.locator('[data-testid="left-toolbar"]')
    await expect(leftToolbar).not.toBeAttached()

    // The canvas element must still be present and visible
    const canvas = page.locator('canvas')
    await expect(canvas).toBeVisible()
  })
})
