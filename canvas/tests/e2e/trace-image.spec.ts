import { test, expect, type Page } from '@playwright/test'
import { gotoApp } from './helpers'
import { shot } from './shell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const store = <T,>(page: Page, fn: string): Promise<T> =>
  page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as Any).__store.getState()), fn)

/** A 4x4 red PNG, as a file the picker hands over. */
const RED_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEklEQVR4nGP4z8CAB+GTG8HSALfKY52fTcuYAAAAAElFTkSuQmCC',
  'base64',
)

const trace = (page: Page) => store<Any>(page, `(s) => s.layers.find((l) => l.type === 'image') || null`)

// Trace image: More > Import as trace brings a picture in as a background image layer at
// 40%; its sheet shows the opacity and the toggle key, and J hides and shows it.
test('trace image: import an image, set 40 percent, toggle it', { tag: '@layers' }, async ({ page }) => {
  await gotoApp(page)
  await store(page, `(s) => { s.setFocusMode('manual'); s.setActiveTool('select') }`)

  await page.getByTestId('shell-more').click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: 'Import as trace…' }).click()
  await (await chooser).setFiles({ name: 'cellars-sketch.png', mimeType: 'image/png', buffer: RED_PNG })
  await expect.poll(() => trace(page)).not.toBeNull()
  const layer = await trace(page)
  expect(layer).toMatchObject({ name: 'Trace', fileName: 'cellars-sketch.png', opacity: 0.4, fit: 'map', visible: true })
  // At the bottom of its level, under the level's own layer.
  const order = await store<string[]>(page, `(s) => s.layers.filter((l) => l.levelId === '${layer.levelId}' && l.type !== 'background').map((l) => l.type)`)
  expect(order[0]).toBe('image')

  // Its sheet, from its tile's gear: frame 14's rows.
  await store(page, `(s) => s.setActiveLayerId('${layer.id}')`)
  const tile = page.getByTestId('shell-dock').locator('[data-testid="shell-layer-tile"][data-name="Trace"]')
  await tile.hover()
  await tile.getByRole('button', { name: /settings/i }).click()
  const sheet = page.getByTestId('shell-layer-sheet')
  await expect(sheet.getByText('Background image')).toBeVisible()
  await expect(sheet.getByText('cellars-sketch.png')).toBeVisible()
  await expect(sheet.locator('kbd', { hasText: 'J' })).toBeVisible()
  await expect(sheet.getByText('40%')).toBeVisible()
  await expect(page.getByTestId('shell-status-hint')).toContainText('Trace 40%')
  await shot(page, '14-trace')

  // J hides it and shows it again; each is one undo step.
  await page.mouse.move(700, 500)
  await page.keyboard.press('j')
  await expect.poll(async () => (await trace(page)).visible).toBe(false)
  await page.keyboard.press('j')
  await expect.poll(async () => (await trace(page)).visible).toBe(true)
  await page.getByTestId('shell-top-actions').getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await trace(page)).visible).toBe(false)
})
