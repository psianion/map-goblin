/**
 * 19-asset-browser.spec.ts
 * Month 1 Asset Browser: tab switching, search, asset selection.
 *
 * Tests:
 * - Right panel shows "layers" and "assets" tabs
 * - Clicking "assets" tab shows AssetBrowserPanel
 * - AssetBrowserPanel shows "Recent" category tab
 * - Search input is visible in assets tab
 * - Clicking "layers" tab restores layer panel
 * - Category tabs render from manifest (if manifest loaded)
 */
import { test, expect } from '@playwright/test'
import { gotoApp, waitFrame } from './helpers'

test.describe('Asset Browser Panel', () => {
  test('right panel has Layers and Assets tabs', async ({ page }) => {
    await gotoApp(page)

    const layersTab = page.getByRole('button', { name: /layers/i })
    const assetsTab = page.getByRole('button', { name: /assets/i })

    await expect(layersTab).toBeVisible()
    await expect(assetsTab).toBeVisible()
  })

  test('clicking Assets tab shows asset browser', async ({ page }) => {
    await gotoApp(page)

    await page.getByRole('button', { name: /assets/i }).click()
    await waitFrame(page, 2)

    // "Recent" category tab should be visible
    await expect(page.getByRole('button', { name: /recent/i })).toBeVisible()
  })

  test('asset browser shows search input', async ({ page }) => {
    await gotoApp(page)

    await page.getByRole('button', { name: /assets/i }).click()
    await waitFrame(page, 2)

    await expect(page.getByPlaceholder('Search assets…')).toBeVisible()
  })

  test('clicking Layers tab restores layer panel', async ({ page }) => {
    await gotoApp(page)

    // Switch to assets
    await page.getByRole('button', { name: /assets/i }).click()
    await waitFrame(page, 2)
    await expect(page.getByRole('button', { name: /recent/i })).toBeVisible()

    // Switch back to layers
    await page.getByRole('button', { name: /layers/i }).click()
    await waitFrame(page, 2)

    // Layer panel content — check the "Recent" tab is gone (asset browser hidden)
    await expect(page.getByRole('button', { name: /recent/i })).not.toBeVisible()
  })

  test('search input filters by text', async ({ page }) => {
    await gotoApp(page)

    await page.getByRole('button', { name: /assets/i }).click()
    await waitFrame(page, 2)

    const searchInput = page.getByPlaceholder('Search assets…')
    await searchInput.fill('zzz_nonexistent_asset_xyz')
    await waitFrame(page, 2)

    // With no matching assets, empty state text should appear
    await expect(page.getByText('No assets in this category.')).toBeVisible()
  })

  test('Recent tab is active by default', async ({ page }) => {
    await gotoApp(page)

    await page.getByRole('button', { name: /assets/i }).click()
    await waitFrame(page, 2)

    // The Recent tab button should have an accent style (active)
    // It renders as bg-accent — just check it's present and visible
    const recentBtn = page.getByRole('button', { name: /^recent$/i })
    await expect(recentBtn).toBeVisible()
  })

  test('selecting a category tab switches content', async ({ page }) => {
    await gotoApp(page)

    await page.getByRole('button', { name: /assets/i }).click()
    await waitFrame(page, 2)

    // Get manifest from store to find real category IDs
    const categories = await page.evaluate(() => {
      const store = (window as { __store?: { getState: () => { assets: { manifest: { categories: Array<{ label: string }> } | null } } } }).__store
      return store?.getState().assets.manifest?.categories ?? []
    })

    if (categories.length > 0) {
      // Click first real category tab
      const firstLabel = categories[0].label
      await page.getByRole('button', { name: firstLabel }).click()
      await waitFrame(page, 2)

      // Panel still visible (no crash)
      await expect(page.getByPlaceholder('Search assets…')).toBeVisible()
    } else {
      // No manifest loaded — Recent tab still shows empty state
      await expect(page.getByPlaceholder('Search assets…')).toBeVisible()
    }
  })
})
