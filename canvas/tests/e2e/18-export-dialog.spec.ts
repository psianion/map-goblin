/**
 * 18-export-dialog.spec.ts
 * Month 1 Export: ExportDialog opens, shows options, and can be closed.
 *
 * Tests:
 * - Ctrl+E opens the Export dialog
 * - Dialog title "Export Map" is visible
 * - PNG and JPEG format buttons are present
 * - Resolution options 64/128/256 are present
 * - "Include grid lines" checkbox is present
 * - Cancel button closes the dialog
 * - Escape key closes the dialog
 */
import { test, expect } from '@playwright/test'
import { gotoApp, pressShortcut, waitFrame } from './helpers'

test.describe('Export Dialog', () => {
  test('Ctrl+E opens the export dialog', async ({ page }) => {
    await gotoApp(page)
    await pressShortcut(page, 'e', { ctrl: true })
    await waitFrame(page, 2)

    await expect(page.getByText('Export Map')).toBeVisible()
  })

  test('dialog shows PNG and JPEG format buttons', async ({ page }) => {
    await gotoApp(page)
    await pressShortcut(page, 'e', { ctrl: true })
    await waitFrame(page, 2)

    await expect(page.getByRole('button', { name: 'PNG' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'JPEG' })).toBeVisible()
  })

  test('dialog shows resolution options', async ({ page }) => {
    await gotoApp(page)
    await pressShortcut(page, 'e', { ctrl: true })
    await waitFrame(page, 2)

    await expect(page.getByRole('button', { name: '64' })).toBeVisible()
    await expect(page.getByRole('button', { name: '128' })).toBeVisible()
    await expect(page.getByRole('button', { name: '256' })).toBeVisible()
  })

  test('dialog shows include grid lines checkbox', async ({ page }) => {
    await gotoApp(page)
    await pressShortcut(page, 'e', { ctrl: true })
    await waitFrame(page, 2)

    await expect(page.getByText('Include grid lines')).toBeVisible()
  })

  test('Cancel button closes the dialog', async ({ page }) => {
    await gotoApp(page)
    await pressShortcut(page, 'e', { ctrl: true })
    await waitFrame(page, 2)

    await expect(page.getByText('Export Map')).toBeVisible()

    await page.getByRole('button', { name: 'Cancel' }).first().click()
    await waitFrame(page, 2)

    await expect(page.getByText('Export Map')).not.toBeVisible()
  })

  test('Escape key closes the dialog', async ({ page }) => {
    await gotoApp(page)
    await pressShortcut(page, 'e', { ctrl: true })
    await waitFrame(page, 2)

    await expect(page.getByText('Export Map')).toBeVisible()

    await page.keyboard.press('Escape')
    await waitFrame(page, 2)

    await expect(page.getByText('Export Map')).not.toBeVisible()
  })

  test('format toggle switches between PNG and JPEG', async ({ page }) => {
    await gotoApp(page)
    await pressShortcut(page, 'e', { ctrl: true })
    await waitFrame(page, 2)

    // Click JPEG — no crash, dialog stays open
    await page.getByRole('button', { name: 'JPEG' }).click()
    await waitFrame(page, 1)
    await expect(page.getByText('Export Map')).toBeVisible()

    // Click PNG — switch back
    await page.getByRole('button', { name: 'PNG' }).click()
    await waitFrame(page, 1)
    await expect(page.getByText('Export Map')).toBeVisible()
  })

  test('output dimensions preview is shown', async ({ page }) => {
    await gotoApp(page)
    await pressShortcut(page, 'e', { ctrl: true })
    await waitFrame(page, 2)

    // Preview text includes "Output:" and "px"
    await expect(page.getByText(/Output:.*px/)).toBeVisible()
  })
})
