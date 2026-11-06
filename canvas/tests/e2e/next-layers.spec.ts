import { test, expect, type Locator, type Page } from '@playwright/test'
import { waitFrame } from './helpers'
import { box, openNext, pickFromFlyout, shot } from './nextShell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const store = <T,>(page: Page, fn: string): Promise<T> =>
  page.evaluate((src) => new Function('s', `return (${src})(s)`)((window as Any).__store.getState()), fn)

/** The level on show's dungeon layers, bottom first, as the column lays them out. */
const layerNames = (page: Page) =>
  store<string[]>(page, `(s) => s.layers.filter((l) => l.type === 'dungeon' && l.levelId === s.ui.activeLevelId).map((l) => l.name)`)

const tile = (page: Page, name: string): Locator =>
  page.getByTestId('shell-dock').locator(`[data-testid="shell-layer-tile"][data-name="${name}"]`)

/** A pointer drag from one element's centre to another's, in steps so the sorter sees travel. */
async function dragOnto(page: Page, from: Locator, to: Locator) {
  const a = await box(from)
  const b = await box(to)
  await page.mouse.move(a.x + a.width / 2, a.y + 16)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(a.x + a.width / 2 + ((b.x - a.x) * i) / 10, a.y + 16 + ((b.y - a.y) * i) / 10)
    await waitFrame(page, 1)
  }
  await page.mouse.up()
  await waitFrame(page, 4)
}

// Shell parity: the dock's Layers column does what the old filmstrip did, the three sheets
// open from their triggers, and Space pans with any tool.
test('the Layers column adds, renames, reorders and solos; the sheets open; Space pans', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openNext(page)
  const dock = page.getByTestId('shell-dock')

  // The map-wide tiles come first: Background and Terrain, then the level's layers.
  await expect(dock.locator('[data-testid="shell-layer-tile"][data-name="Terrain"]')).toBeVisible()
  const before = await layerNames(page)

  // Add a layer: its name is asked for at once. Renaming it is the same dialog.
  await dock.getByRole('button', { name: 'Add layer' }).click()
  const rename = page.getByTestId('shell-rename')
  await expect(rename).toBeVisible()
  await rename.getByRole('textbox', { name: 'Name' }).fill('Upper')
  await rename.getByRole('textbox', { name: 'Name' }).press('Enter')
  await expect(rename).toBeHidden()
  expect(await layerNames(page)).toEqual([...before, 'Upper'])

  await tile(page, 'Upper').getByRole('button', { name: 'Draw on Upper' }).dblclick()
  await rename.getByRole('textbox', { name: 'Name' }).fill('Mezzanine')
  await rename.getByRole('button', { name: 'Rename' }).click()
  expect(await layerNames(page)).toEqual([...before, 'Mezzanine'])

  // Drag to reorder: the new layer onto the first, and it goes under it.
  await dragOnto(page, tile(page, 'Mezzanine'), tile(page, before[0]))
  expect((await layerNames(page))[0]).toBe('Mezzanine')

  // Alt on the eye solos; the status bar's chip ends it.
  await tile(page, 'Mezzanine').hover()
  await tile(page, 'Mezzanine').getByTestId('shell-layer-eye').click({ modifiers: ['Alt'] })
  expect(await store<string | null>(page, `(s) => s.ui.solo?.layerId ?? null`)).not.toBeNull()
  await expect(page.getByTestId('shell-solo')).toContainText('Mezzanine')
  await expect(tile(page, before[0])).toHaveClass(/opacity-40/)
  await shot(page, '15a-layers')
  await page.getByTestId('shell-solo').click()
  expect(await store<string | null>(page, `(s) => s.ui.solo?.layerId ?? null`)).toBeNull()

  // The Layers sheet from the column's All layers.
  await dock.getByTestId('shell-open-layers').click()
  const layersSheet = page.getByTestId('shell-layers-sheet')
  await expect(layersSheet).toBeVisible()
  await expect(layersSheet.getByTestId('shell-layers-layer').filter({ hasText: 'Mezzanine' })).toBeVisible()
  await expect(layersSheet.getByTestId('shell-layers-terrain')).toBeVisible()
  await shot(page, '15a-sheets')
  await layersSheet.getByRole('button', { name: 'Close Layers' }).click()
  await expect(layersSheet).toBeHidden()

  // A layer's settings from the gear on the active tile.
  await tile(page, 'Mezzanine').getByRole('button', { name: 'Draw on Mezzanine' }).click()
  await tile(page, 'Mezzanine').getByRole('button', { name: 'Layer settings' }).click()
  const layerSheet = page.getByTestId('shell-layer-sheet')
  await expect(layerSheet).toBeVisible()
  await expect(layerSheet.getByRole('textbox', { name: 'Layer name' })).toHaveValue('Mezzanine')
  await layerSheet.getByRole('button', { name: 'Close Mezzanine' }).click()
  await expect(layerSheet).toBeHidden()

  // Packs from the "…" menu.
  await page.getByTestId('shell-more').click()
  await page.getByRole('menuitem', { name: 'Packs…' }).click()
  const packs = page.getByTestId('shell-packs-sheet')
  await expect(packs).toBeVisible()
  await expect(packs.getByTestId('shell-pack-row').first()).toBeVisible()
  await packs.getByRole('button', { name: 'Close Packs' }).click()
  await expect(packs).toBeHidden()

  // The grid chip opens its popover with the line colour.
  await page.getByTestId('shell-grid-chip').click()
  const grid = page.getByTestId('shell-grid-popover')
  await expect(grid).toBeVisible()
  await expect(grid.getByText('Grid lines')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(grid).toBeHidden()

  // Hold Space: Pan while it is down, the tool back when it comes up.
  await pickFromFlyout(page, 'Design', 'Floor')
  const tool = () => store<string>(page, `(s) => s.tools.activeTool`)
  const floor = await tool()
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await page.keyboard.down(' ')
  await waitFrame(page, 2)
  expect(await tool()).toBe('pan')
  await page.keyboard.up(' ')
  await waitFrame(page, 2)
  expect(await tool()).toBe(floor)
  expect(errors).toEqual([])
})
