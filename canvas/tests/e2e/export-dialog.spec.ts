import { readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
import { test, expect, type Page } from '@playwright/test'
import { drawRect, gotoApp, pressShortcut, waitFrame } from './helpers'
import { openEditor, pickTool } from './shell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

/**
 * The editor's Export dialog: Ctrl+E and the More menu open it; Format, Layers, Pixels per
 * square, Apply lighting, Grid lines and Labels are there; Cancel, the X and Escape close it;
 * the size line follows the pixels per square; a preview is drawn; PNG and JPEG download
 * files that are what they say; Map file drops the picture's options and downloads the
 * same container Ctrl+S writes; the lit picture follows the hour, and the weather picked
 * in the dialog is the one the exported file is lit with. Export stays on a short laptop
 * screen with lighting on, an unticked layer leaves the file, and every level of a
 * two-level map comes down as one zip.
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
  await pickTool(page, 'rectangle')
  await drawRect(page, 520, 300, 700, 420)
}

/** Mean brightness (0..255) of a picture, given as base64 PNG bytes or an image element's src. */
const meanOfBytes = (page: Page, bytes: Buffer) =>
  page.evaluate(async (b64) => {
    const bin = atob(b64)
    const arr = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
    const bmp = await createImageBitmap(new Blob([arr], { type: 'image/png' }))
    const c = document.createElement('canvas')
    c.width = bmp.width
    c.height = bmp.height
    const ctx = c.getContext('2d')!
    ctx.drawImage(bmp, 0, 0)
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    let sum = 0
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
    return sum / (d.length / 4)
  }, bytes.toString('base64'))

/** Mean brightness of the dialog's preview picture, once it has drawn. */
async function previewMean(page: Page): Promise<number> {
  await page.waitForTimeout(300)
  const preview = modal(page).getByRole('img', { name: 'Export preview' })
  await expect(preview).toBeVisible({ timeout: 30_000 })
  return preview.evaluate(async (img: HTMLImageElement) => {
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    let sum = 0
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
    return sum / (d.length / 4)
  })
}

/** Apply lighting on in the open dialog; each open starts as the editor shows the map. */
async function lightingOn(page: Page): Promise<void> {
  const lighting = modal(page).getByRole('switch', { name: 'Apply lighting' })
  if ((await lighting.getAttribute('aria-checked')) !== 'true') await lighting.click()
  await expect(lighting).toHaveAttribute('aria-checked', 'true')
}

/** The warren made outdoor, the dialog open with Apply lighting on. */
async function openOutdoorExport(page: Page): Promise<void> {
  await openEditor(page)
  await page.evaluate(() => (window as Any).__store.getState().setEnvironmentSettings({ environment: 'outdoor' }))
  await waitFrame(page, 4)
  await openExport(page)
  await lightingOn(page)
}

test('Ctrl+E opens the dialog, and so does the More menu\'s Export…', { tag: '@export' }, async ({ page }) => {
  await gotoApp(page)
  await openExport(page)
  await expect(modal(page).getByRole('heading', { name: 'Export' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(modal(page)).toHaveCount(0)
  await page.getByTestId('shell-more').click()
  await page.getByRole('menuitem', { name: /Export…/ }).click()
  await expect(modal(page)).toBeVisible()
})

test('the options are all there: format, pixels per square, lighting, grid lines, labels', { tag: '@export' }, async ({ page }) => {
  await gotoApp(page)
  await openExport(page)
  const m = modal(page)
  const format = m.getByRole('group', { name: 'Format' })
  for (const f of ['PNG', 'JPEG', 'Map file']) await expect(format.getByRole('button', { name: f, exact: true })).toBeVisible()
  await expect(format.getByRole('button', { name: 'PNG', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const px = m.getByRole('group', { name: 'Pixels per square' })
  for (const p of ['64', '128', '256']) await expect(px.getByRole('button', { name: p })).toBeVisible()
  await expect(m.getByRole('switch', { name: 'Apply lighting' })).toBeVisible()
  await expect(m.getByRole('switch', { name: 'Grid lines' })).toHaveAttribute('aria-checked', 'false')
  await m.getByRole('switch', { name: 'Grid lines' }).click()
  await expect(m.getByRole('switch', { name: 'Grid lines' })).toHaveAttribute('aria-checked', 'true')
  const labels = m.getByRole('group', { name: 'Labels' })
  for (const l of ['None', 'Players', 'All']) await expect(labels.getByRole('button', { name: l })).toBeVisible()
  // The open level's layers, each ticked; a one-level map has no Level row.
  await expect(m.getByRole('group', { name: 'Layers' }).getByRole('checkbox').first()).toBeVisible()
  await expect(m.getByTestId('v2-export-level')).toHaveCount(0)
})

test('Cancel, the X and Escape each close it', { tag: '@export' }, async ({ page }) => {
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

test('the size line follows the pixels per square, and a preview is drawn', { tag: '@export' }, async ({ page }) => {
  await gotoApp(page)
  await drawSomething(page)
  await openExport(page)
  const size = modal(page).getByTestId('v2-export-size')
  await expect(size).toContainText(/\d+ × \d+ px/)
  const widthAt = async () => Number((await size.innerText()).match(/(\d+) × \d+ px/)![1])
  const px = modal(page).getByRole('group', { name: 'Pixels per square' })
  const at128 = await widthAt()
  await px.getByRole('button', { name: '256' }).click()
  await expect.poll(widthAt).toBe(at128 * 2)
  await px.getByRole('button', { name: '64' }).click()
  await expect.poll(widthAt).toBe(at128 / 2)
  await expect(modal(page).getByRole('img', { name: 'Export preview' })).toBeVisible({ timeout: 30_000 })
})

test('PNG and JPEG download files that are what they say', { tag: '@export' }, async ({ page }) => {
  await gotoApp(page)
  await drawSomething(page)
  await openExport(page)
  const [png] = await Promise.all([page.waitForEvent('download'), modal(page).getByTestId('v2-export-go').click()])
  expect(png.suggestedFilename()).toMatch(/\.png$/)
  const pngBytes = readFileSync(await png.path())
  expect([...pngBytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  await expect(modal(page)).toHaveCount(0)

  await openExport(page)
  await modal(page).getByRole('group', { name: 'Format' }).getByRole('button', { name: 'JPEG' }).click()
  const [jpeg] = await Promise.all([page.waitForEvent('download'), modal(page).getByTestId('v2-export-go').click()])
  expect(jpeg.suggestedFilename()).toMatch(/\.jpe?g$/)
  const jpegBytes = readFileSync(await jpeg.path())
  expect([jpegBytes[0], jpegBytes[1]]).toEqual([0xff, 0xd8])
})

test('Map file drops the picture\'s options and downloads the container Ctrl+S writes', { tag: '@export' }, async ({ page }) => {
  await gotoApp(page)
  await openExport(page)
  await modal(page).getByRole('group', { name: 'Format' }).getByRole('button', { name: 'Map file', exact: true }).click()
  await expect(modal(page).getByRole('group', { name: 'Pixels per square' })).toHaveCount(0)
  await expect(modal(page).getByTestId('v2-export-preview')).toHaveCount(0)
  const [download] = await Promise.all([page.waitForEvent('download'), modal(page).getByTestId('v2-export-go').click()])
  expect(download.suggestedFilename()).toMatch(/\.(mapbuilder|ggvtt)$/)
  const bytes = readFileSync(await download.path())
  // MPBLD\0 magic, then the gzip stream.
  expect(bytes.subarray(0, 6).toString('binary')).toBe('MPBLD\x00')
  expect([bytes[6], bytes[7]]).toEqual([0x1f, 0x8b])
})

test('export at 02:00 is darker than at 12:00', { tag: '@export' }, async ({ page }) => {
  await openOutdoorExport(page)
  const hour = modal(page).getByRole('slider', { name: 'Hour' })
  await hour.fill(String(12 * 60))
  const noon = await previewMean(page)
  await hour.fill(String(2 * 60))
  await expect(modal(page).getByTestId('v2-export-lighting')).toContainText('02:00')
  const night = await previewMean(page)
  expect(night).toBeLessThan(noon - 10)
})

test('the weather picked in the dialog is the weather the exported file is lit with', { tag: '@export' }, async ({ page }) => {
  await openOutdoorExport(page)
  const lighting = modal(page).getByTestId('v2-export-lighting')
  await modal(page).getByRole('slider', { name: 'Hour' }).fill(String(12 * 60))
  const weather = lighting.getByRole('combobox', { name: 'Weather' })
  await expect(weather).toContainText('Clear')

  const download = async () => {
    const [file] = await Promise.all([page.waitForEvent('download'), modal(page).getByTestId('v2-export-go').click()])
    await expect(modal(page)).toHaveCount(0)
    return readFileSync(await file.path())
  }
  // The preview settles before the file is cut, so both are drawn from the same pick.
  await previewMean(page)
  const clear = await meanOfBytes(page, await download())

  await openExport(page)
  await lightingOn(page)
  const again = modal(page).getByTestId('v2-export-lighting')
  await modal(page).getByRole('slider', { name: 'Hour' }).fill(String(12 * 60))
  await again.getByRole('combobox', { name: 'Weather' }).click()
  await page.getByRole('option', { name: 'Storm' }).click()
  await expect(again.getByRole('combobox', { name: 'Weather' })).toContainText('Storm')
  await previewMean(page)
  const storm = await meanOfBytes(page, await download())

  // A storm takes close to half the daylight away; a few luma of slack covers the encoder.
  expect(storm).toBeLessThan(clear - 8)
})

test('on a 1366×600 window with lighting on, Export is on screen', { tag: '@export' }, async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 600 })
  await gotoApp(page)
  await openExport(page)
  await lightingOn(page)
  await expect(modal(page).getByTestId('v2-export-lighting')).toBeVisible()
  const go = modal(page).getByTestId('v2-export-go')
  await expect(go).toBeInViewport({ ratio: 1 })
  const box = (await modal(page).boundingBox())!
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(600)
})

test('unticking a layer leaves it out of the exported picture', { tag: '@export' }, async ({ page }) => {
  await gotoApp(page)
  await drawSomething(page)
  const name = await page.evaluate(() => {
    const s = (window as Any).__store.getState()
    return s.layers.find((l: Any) => l.id === s.ui.activeLayerId).name as string
  })
  const download = async () => {
    const [file] = await Promise.all([page.waitForEvent('download'), modal(page).getByTestId('v2-export-go').click()])
    await expect(modal(page)).toHaveCount(0)
    return readFileSync(await file.path())
  }
  await openExport(page)
  const withLayer = await meanOfBytes(page, await download())

  await openExport(page)
  const tick = modal(page).getByRole('group', { name: 'Layers' }).getByRole('checkbox', { name })
  await expect(tick).toHaveAttribute('aria-checked', 'true')
  await tick.click()
  await expect(tick).toHaveAttribute('aria-checked', 'false')
  const withoutLayer = await meanOfBytes(page, await download())
  expect(Math.abs(withLayer - withoutLayer)).toBeGreaterThan(1)
})

test('every level of a two-level map downloads as one zip, a picture per level', { tag: '@export' }, async ({ page }) => {
  await gotoApp(page)
  await drawSomething(page)
  await page.evaluate(() => (window as Any).__store.getState().addLevel({ id: 'lower', name: 'Lower' }))
  await waitFrame(page, 2)
  await openExport(page)
  await modal(page).getByRole('combobox', { name: 'Level' }).click()
  await page.getByRole('option', { name: 'Every level, one file each' }).click()
  await expect(modal(page).getByTestId('v2-export-filename')).toHaveText(/\.zip$/)
  await expect(modal(page).getByTestId('v2-export-size')).toContainText('2 files')
  const [file] = await Promise.all([page.waitForEvent('download'), modal(page).getByTestId('v2-export-go').click()])
  expect(file.suggestedFilename()).toMatch(/\.zip$/)
  const entries = unzipSync(new Uint8Array(readFileSync(await file.path())))
  const names = Object.keys(entries)
  expect(names).toHaveLength(2)
  expect(names[1]).toMatch(/-Lower\.png$/)
  for (const n of names) expect([...entries[n]!.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
})
