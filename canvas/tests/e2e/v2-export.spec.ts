import { readFileSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { drawRect, gotoApp, pressShortcut, waitFrame } from './helpers'

/**
 * The editor's Export dialog: Ctrl+E and the More menu open it; Format, Pixels per square,
 * Apply lighting, Grid lines and Labels are there; Cancel, the X and Escape close it; the
 * size line follows the pixels per square; a preview is drawn; PNG and JPEG download
 * files that are what they say; Map file drops the picture's options and downloads the
 * same container Ctrl+S writes.
 */

const modal = (page: Page) => page.getByTestId('v2-export-modal')

async function openExport(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await pressShortcut(page, 'e', { ctrl: true })
  await waitFrame(page, 2)
  await expect(modal(page)).toBeVisible()
}

/** Something to export: one rectangle in the middle of the view. */
async function drawSomething(page: Page): Promise<void> {
  await page.keyboard.press('r')
  await drawRect(page, 520, 300, 700, 420)
}

test('Ctrl+E opens the dialog, and so does the More menu\'s Export…', async ({ page }) => {
  await gotoApp(page)
  await openExport(page)
  await expect(modal(page).getByRole('heading', { name: 'Export' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(modal(page)).toHaveCount(0)
  await page.getByTestId('v2-more').click()
  await page.getByRole('menuitem', { name: /Export…/ }).click()
  await expect(modal(page)).toBeVisible()
})

test('the options are all there: format, pixels per square, lighting, grid lines, labels', async ({ page }) => {
  await gotoApp(page)
  await openExport(page)
  const m = modal(page)
  const format = m.getByRole('radiogroup', { name: 'Format' })
  for (const f of ['PNG', 'JPEG', 'Map file']) await expect(format.getByRole('radio', { name: f, exact: true })).toBeVisible()
  await expect(format.getByRole('radio', { name: 'PNG' })).toHaveAttribute('aria-checked', 'true')
  const px = m.getByRole('radiogroup', { name: 'Pixels per square' })
  for (const p of ['64', '128', '256']) await expect(px.getByRole('radio', { name: p })).toBeVisible()
  await expect(m.getByRole('switch', { name: 'Apply lighting' })).toBeVisible()
  await expect(m.getByRole('switch', { name: 'Grid lines' })).toHaveAttribute('aria-checked', 'false')
  await m.getByRole('switch', { name: 'Grid lines' }).click()
  await expect(m.getByRole('switch', { name: 'Grid lines' })).toHaveAttribute('aria-checked', 'true')
  const labels = m.getByRole('radiogroup', { name: 'Labels' })
  for (const l of ['None', 'Players', 'All']) await expect(labels.getByRole('radio', { name: l })).toBeVisible()
})

test('Cancel, the X and Escape each close it', async ({ page }) => {
  await gotoApp(page)
  await openExport(page)
  await modal(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(modal(page)).toHaveCount(0)
  await openExport(page)
  await modal(page).getByRole('button', { name: 'Close' }).click()
  await expect(modal(page)).toHaveCount(0)
  await openExport(page)
  await page.keyboard.press('Escape')
  await expect(modal(page)).toHaveCount(0)
})

test('the size line follows the pixels per square, and a preview is drawn', async ({ page }) => {
  await gotoApp(page)
  await drawSomething(page)
  await openExport(page)
  const size = modal(page).getByTestId('v2-export-size')
  await expect(size).toContainText(/\d+ × \d+ px/)
  const widthAt = async () => Number((await size.innerText()).match(/(\d+) × \d+ px/)![1])
  const at128 = await widthAt()
  await modal(page).getByRole('radio', { name: '256' }).click()
  await expect.poll(widthAt).toBe(at128 * 2)
  await modal(page).getByRole('radio', { name: '64' }).click()
  await expect.poll(widthAt).toBe(at128 / 2)
  await expect(modal(page).getByRole('img', { name: 'Export preview' })).toBeVisible({ timeout: 30_000 })
})

test('PNG and JPEG download files that are what they say', async ({ page }) => {
  await gotoApp(page)
  await drawSomething(page)
  await openExport(page)
  const [png] = await Promise.all([page.waitForEvent('download'), modal(page).getByTestId('v2-export-go').click()])
  expect(png.suggestedFilename()).toMatch(/\.png$/)
  const pngBytes = readFileSync(await png.path())
  expect([...pngBytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  await expect(modal(page)).toHaveCount(0)

  await openExport(page)
  await modal(page).getByRole('radio', { name: 'JPEG' }).click()
  const [jpeg] = await Promise.all([page.waitForEvent('download'), modal(page).getByTestId('v2-export-go').click()])
  expect(jpeg.suggestedFilename()).toMatch(/\.jpe?g$/)
  const jpegBytes = readFileSync(await jpeg.path())
  expect([jpegBytes[0], jpegBytes[1]]).toEqual([0xff, 0xd8])
})

test('Map file drops the picture\'s options and downloads the container Ctrl+S writes', async ({ page }) => {
  await gotoApp(page)
  await openExport(page)
  await modal(page).getByRole('radio', { name: 'Map file', exact: true }).click()
  await expect(modal(page).getByRole('radiogroup', { name: 'Pixels per square' })).toHaveCount(0)
  await expect(modal(page).getByTestId('v2-export-preview')).toHaveCount(0)
  const [download] = await Promise.all([page.waitForEvent('download'), modal(page).getByTestId('v2-export-go').click()])
  expect(download.suggestedFilename()).toMatch(/\.(mapbuilder|ggvtt)$/)
  const bytes = readFileSync(await download.path())
  // MPBLD\0 magic, then the gzip stream.
  expect(bytes.subarray(0, 6).toString('binary')).toBe('MPBLD\x00')
  expect([bytes[6], bytes[7]]).toEqual([0x1f, 0x8b])
})
