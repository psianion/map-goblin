import { test, expect, type Page } from '@playwright/test'
import { waitForBoot } from './helpers'

/**
 * A battlemap image through the New map dialog: picking it reads its pixels and the squares
 * in its name, Size goes to Fixed with them, and "Use as" founds either a battlemap (the
 * line-up follows) or a trace layer stretched to the chosen size.
 */

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any

const store = <T = Any>(page: Page, fn: string) =>
  page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as Any).__store.getState()), fn) as Promise<T>

/** A PNG `w` by `h` pixels with dark grid lines every `cell` pixels, drawn in the page. */
async function gridPng(page: Page, w: number, h: number, cell: number): Promise<Buffer> {
  const b64 = await page.evaluate(
    ({ w, h, cell }) => {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const g = c.getContext('2d')!
      g.fillStyle = '#c8b89a'
      g.fillRect(0, 0, w, h)
      g.fillStyle = '#3a3026'
      for (let x = 0; x < w; x += cell) g.fillRect(x, 0, 2, h)
      for (let y = 0; y < h; y += cell) g.fillRect(0, y, w, 2)
      return c.toDataURL('image/png').split(',')[1]
    },
    { w, h, cell },
  )
  return Buffer.from(b64, 'base64')
}

async function openDialog(page: Page) {
  await page.goto('/?e2e=1')
  await waitForBoot(page)
  await page.getByTestId('v2-new-map-card').click()
  const modal = page.getByTestId('v2-new-map-modal')
  await modal.getByRole('button', { name: 'Image' }).click()
  return modal
}

test('picking a battlemap fills Fixed size from the name and shows pixels and squares', { tag: '@home' }, async ({ page }) => {
  const modal = await openDialog(page)
  const png = await gridPng(page, 600, 400, 50)
  const chooser = page.waitForEvent('filechooser')
  await modal.getByTestId('v2-image-drop').click()
  await (await chooser).setFiles({ name: 'Crypt 12x8.png', mimeType: 'image/png', buffer: png })

  await expect(modal.getByText('600 × 400 px · 12 × 8 squares')).toBeVisible()
  await expect(modal.getByRole('group', { name: 'Size' }).getByRole('button', { name: 'Fixed' })).toHaveAttribute('aria-pressed', 'true')
  await expect(modal.getByLabel('Width in squares')).toHaveValue('12')
  await expect(modal.getByLabel('Height in squares')).toHaveValue('8')
  await expect(modal.getByRole('group', { name: 'Use as' }).getByRole('button', { name: 'Battlemap' })).toHaveAttribute('aria-pressed', 'true')

  await modal.getByTestId('v2-new-map-submit').click()
  await expect(page.getByTestId('shell')).toBeVisible({ timeout: 30_000 })
  expect(await store(page, `(s) => s.mapSettings.fixedSize`)).toEqual({ width: 12, height: 8 })
  // The picture's top-left corner sits on the map origin, at 50 px a square.
  const child = await store(page, `(s) => s.layers.find((l) => l.name === 'Battlemap').children[0]`)
  expect(child.position.x - (child.width * child.scale) / 2).toBeCloseTo(0, 3)
  expect(child.position.y - (child.height * child.scale) / 2).toBeCloseTo(0, 3)
  expect(child.width * child.scale).toBeCloseTo(12, 3)
})

test('Use as Trace founds the map at the size with a trace layer and no line-up', { tag: '@home' }, async ({ page }) => {
  const modal = await openDialog(page)
  const png = await gridPng(page, 600, 400, 50)
  const chooser = page.waitForEvent('filechooser')
  await modal.getByTestId('v2-image-drop').click()
  await (await chooser).setFiles({ name: 'sketch 12x8.png', mimeType: 'image/png', buffer: png })
  await modal.getByRole('group', { name: 'Use as' }).getByRole('button', { name: 'Trace' }).click()
  await expect(modal.getByText(/Never exported or published/)).toBeVisible()
  await expect(modal.getByTestId('v2-new-map-submit')).toHaveText('Create map')

  await modal.getByTestId('v2-new-map-submit').click()
  await expect(page.getByTestId('shell')).toBeVisible({ timeout: 30_000 })
  expect(await store(page, `(s) => s.mapSettings.fixedSize`)).toEqual({ width: 12, height: 8 })
  const trace = await store(page, `(s) => s.layers.find((l) => l.type === 'image') || null`)
  expect(trace).toMatchObject({ fit: 'map', fileName: 'sketch 12x8.png' })
  expect(await store(page, `(s) => s.layers.some((l) => l.name === 'Battlemap')`)).toBe(false)
  await expect(page.getByTestId('grid-lineup-bar')).toHaveCount(0)
})

test('without a size in the name the printed grid sets the squares', { tag: '@home' }, async ({ page }) => {
  const modal = await openDialog(page)
  const png = await gridPng(page, 900, 600, 45)
  const chooser = page.waitForEvent('filechooser')
  await modal.getByTestId('v2-image-drop').click()
  await (await chooser).setFiles({ name: 'cellar.png', mimeType: 'image/png', buffer: png })
  // 45 px squares, not the 70 px guess (which would read 13 × 9).
  await expect(modal.getByText('900 × 600 px · 20 × 13 squares')).toBeVisible()
  await expect(modal.getByLabel('Width in squares')).toHaveValue('20')
})

test('the line-up starts on the found grid and Use this grid sets the map to W by H', { tag: '@home' }, async ({ page }) => {
  const modal = await openDialog(page)
  // 50 px squares with lines 20 px in: the picture hangs 0.4 of a cell past the lattice.
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 620
    c.height = 420
    const g = c.getContext('2d')!
    g.fillStyle = '#c8b89a'
    g.fillRect(0, 0, 620, 420)
    g.fillStyle = '#3a3026'
    for (let x = 20; x < 620; x += 50) g.fillRect(x, 0, 2, 420)
    for (let y = 20; y < 420; y += 50) g.fillRect(0, y, 620, 2)
    return c.toDataURL('image/png').split(',')[1]
  })
  const chooser = page.waitForEvent('filechooser')
  await modal.getByTestId('v2-image-drop').click()
  await (await chooser).setFiles({ name: 'Ruin 12x8.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') })
  await modal.getByTestId('v2-new-map-submit').click()

  const bar = page.getByTestId('grid-lineup-bar')
  await expect(bar).toBeVisible({ timeout: 30_000 })
  await expect(bar.getByText('Line up the grid')).toBeVisible()
  await expect(bar.getByRole('group', { name: 'Squares across' })).toContainText('12')
  await expect(bar.getByRole('group', { name: 'Squares down' })).toContainText('8')
  await expect(page.getByTestId('grid-lineup-px')).toHaveText('50 px per cell')

  // One more column, then take it.
  await bar.getByRole('button', { name: 'Increase Squares across' }).click()
  await expect(bar.getByRole('group', { name: 'Squares across' })).toContainText('13')
  await bar.getByRole('button', { name: 'Decrease Squares across' }).click()
  await bar.getByRole('button', { name: 'Use this grid' }).click()
  await expect(bar).toHaveCount(0)

  expect(await store(page, `(s) => s.mapSettings.fixedSize`)).toEqual({ width: 12, height: 8 })
  const layer = await store(page, `(s) => s.layers.find((l) => l.name === 'Battlemap')`)
  expect(layer.locked).toBe(true)
  const child = layer.children[0]
  // One printed square is one map cell, the lattice corner on the origin.
  expect(child.width * child.scale).toBeCloseTo(620 / 50, 1)
  expect(child.position.x - (child.width * child.scale) / 2).toBeCloseTo(-0.4, 1)
  expect(child.position.y - (child.height * child.scale) / 2).toBeCloseTo(-0.4, 1)
})

test('Skip leaves the battlemap as placed, unlocked', { tag: '@home' }, async ({ page }) => {
  const modal = await openDialog(page)
  const png = await gridPng(page, 600, 400, 50)
  const chooser = page.waitForEvent('filechooser')
  await modal.getByTestId('v2-image-drop').click()
  await (await chooser).setFiles({ name: 'Crypt 12x8.png', mimeType: 'image/png', buffer: png })
  await modal.getByTestId('v2-new-map-submit').click()
  const bar = page.getByTestId('grid-lineup-bar')
  await expect(bar).toBeVisible({ timeout: 30_000 })
  await bar.getByRole('button', { name: 'Skip' }).click()
  await expect(bar).toHaveCount(0)
  const layer = await store(page, `(s) => s.layers.find((l) => l.name === 'Battlemap')`)
  expect(layer.locked).toBe(false)
})
