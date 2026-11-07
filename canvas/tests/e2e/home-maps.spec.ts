import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { drawRect, waitForBoot, waitFrame } from './helpers'
import { pickTool } from './shell'

/**
 * The home page and the New map dialog, end to end: the first load's one card, a new map
 * named in the dialog (Escape leaves nothing, Enter creates, a fixed size is validated),
 * opening a card and coming back with the work kept, rename in place (Enter, Escape, F2,
 * the menu, an empty name), duplicate, delete behind a confirmation with Undo on the
 * toast, the last map never leaving the page empty, a map file by picker and by drop, VTT
 * files by picker, folder and drop, Map settings from the card menu, thumbnails, newest
 * first, the list surviving a reload, and an old /v2 link landing here.
 */

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any

const WARREN_PATH = fileURLToPath(new URL('../../../session/testdata/goblin-warren.mapbuilder', import.meta.url))
const WARREN = JSON.parse(readFileSync(WARREN_PATH, 'utf8'))

/** A small Universal VTT map: a 4×3 grid, one wall, one door, one light, no image. */
const uvtt = (shift = 0) =>
  JSON.stringify({
    format: 0.3,
    resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 4 + shift, y: 3 }, pixels_per_grid: 100 },
    line_of_sight: [[{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }]],
    portals: [
      { position: { x: 2, y: 3 }, bounds: [{ x: 1.5, y: 3 }, { x: 2.5, y: 3 }], rotation: 0, closed: true, freestanding: false },
    ],
    lights: [{ position: { x: 2, y: 1.5 }, range: 4, intensity: 1, color: 'ffaabbcc', shadows: true }],
    environment: { baked_lighting: false, ambient_light: 'ffffffff' },
  })

const store = <T = Any>(page: Page, fn: string, arg?: unknown) =>
  page.evaluate(
    ({ fn, arg }) => new Function('s', 'arg', `return (${fn})(s, arg)`)(() => (window as Any).__store.getState(), arg),
    { fn, arg },
  ) as Promise<T>

const cards = (page: Page) => page.getByTestId('v2-map-card')
const card = (page: Page, name: string) => page.getByRole('button', { name: `Open ${name}`, exact: true })
const toaster = (page: Page) => page.getByLabel('Notifications alt+T')
const names = (page: Page) => cards(page).getByTestId('v2-card-name').allInnerTexts()

/** The home page on a fresh profile: the boot has made its one blank map. */
async function openHome(page: Page, path = '/?e2e=1'): Promise<void> {
  await page.goto(path)
  await waitForBoot(page)
  await expect(page.getByTestId('v2-home')).toBeVisible()
  await expect(cards(page)).toHaveCount(1)
}

/** A new map named `name` from the "+" card; lands in the editor. */
async function newMap(page: Page, name: string): Promise<void> {
  await page.getByTestId('v2-new-map-card').click()
  const modal = page.getByTestId('v2-new-map-modal')
  await modal.getByLabel('Name', { exact: true }).fill(name)
  await modal.getByTestId('v2-new-map-submit').click()
  await expect(page.getByTestId('shell')).toBeVisible({ timeout: 30_000 })
}

async function goHome(page: Page): Promise<void> {
  await page.getByTestId('shell-title-card').getByRole('button', { name: 'Save and go home' }).click()
  await expect(page.getByTestId('v2-home')).toBeVisible()
}

/** One rectangle on the open map, drawn with the Rectangle tool. */
async function drawShape(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await pickTool(page, 'rectangle')
  await drawRect(page, 520, 300, 680, 400)
}
const shapeCount = (page: Page) =>
  store<number>(page, `(s) => s().layers.filter((l) => l.type === 'dungeon').flatMap((l) => l.children).filter((c) => c.childType === 'shape').length`)

async function openMenu(page: Page, name: string) {
  await page.getByRole('button', { name: `More for ${name}` }).click()
  return page.getByRole('menu')
}

async function deleteFromCard(page: Page, name: string) {
  await page.getByRole('button', { name: `Delete ${name}` }).click()
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
  await expect(dialog.getByText('Delete map?')).toBeVisible()
  return dialog
}

// ─── First load and new maps ─────────────────────────────────────────────────

test('an old /v2 link lands on /, keeping its query, with the home page up', { tag: '@home' }, async ({ page }) => {
  await openHome(page, '/v2?e2e=1')
  expect(new URL(page.url()).pathname).toBe('/')
  expect(new URL(page.url()).search).toBe('?e2e=1')
})

test('the first load shows one card, an untitled map marked open', { tag: '@home' }, async ({ page }) => {
  await openHome(page)
  await expect(page.getByTestId('v2-home')).toContainText('1 map')
  expect(await names(page)).toEqual(['Untitled Map'])
  await expect(cards(page).first().getByTestId('v2-card-badge')).toHaveText('Open')
})

test('the "+" card asks first: Escape leaves nothing, the typed name is the card, Enter creates', { tag: '@home' }, async ({ page }) => {
  await openHome(page)
  await page.getByTestId('v2-new-map-card').click()
  const modal = page.getByTestId('v2-new-map-modal')
  await expect(modal).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(modal).toHaveCount(0)
  await expect(cards(page)).toHaveCount(1)

  await page.getByTestId('v2-new-map-card').click()
  await modal.getByLabel('Name', { exact: true }).fill('Crypt of Ash')
  await modal.getByLabel('Name', { exact: true }).press('Enter')
  await expect(page.getByTestId('shell')).toBeVisible({ timeout: 30_000 })
  await goHome(page)
  await expect(cards(page)).toHaveCount(2)
  // Newest first, and the badge moved to it.
  expect((await names(page))[0]).toBe('Crypt of Ash')
  await expect(card(page, 'Crypt of Ash').getByTestId('v2-card-badge')).toHaveText('Open')
  await expect(card(page, 'Untitled Map').getByTestId('v2-card-badge')).toHaveCount(0)
})

test('a fixed size is validated before it can be committed, and lands on the map', { tag: '@home' }, async ({ page }) => {
  await openHome(page)
  await page.getByTestId('v2-new-map-card').click()
  const modal = page.getByTestId('v2-new-map-modal')
  await modal.getByRole('group', { name: 'Size' }).getByRole('button', { name: 'Fixed' }).click()
  await modal.getByLabel('Width in squares').fill('0')
  await expect(modal.getByRole('alert')).toBeVisible()
  await expect(modal.getByTestId('v2-new-map-submit')).toBeDisabled()
  await modal.getByLabel('Width in squares').fill('24')
  await modal.getByLabel('Height in squares').fill('16')
  await expect(modal.getByTestId('v2-new-map-submit')).toBeEnabled()
  await modal.getByTestId('v2-new-map-submit').click()
  await expect(page.getByTestId('shell')).toBeVisible({ timeout: 30_000 })
  expect(await store(page, `(s) => s().mapSettings.fixedSize`)).toEqual({ width: 24, height: 16 })
})

test('a new map is blank, and each map keeps its own work when switching back and forth', { tag: '@home' }, async ({ page }) => {
  await openHome(page)
  await card(page, 'Untitled Map').click()
  await expect(page.getByTestId('shell')).toBeVisible({ timeout: 30_000 })
  await drawShape(page)
  expect(await shapeCount(page)).toBe(1)
  await goHome(page)

  await newMap(page, 'Second')
  expect(await shapeCount(page)).toBe(0)
  await goHome(page)

  await card(page, 'Untitled Map').click()
  await expect(page.getByTestId('shell')).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => shapeCount(page)).toBe(1)
  await goHome(page)
  await card(page, 'Second').click()
  await expect.poll(() => shapeCount(page)).toBe(0)
})

test('keys pressed on the home page never pick a tool underneath it', { tag: '@home' }, async ({ page }) => {
  await openHome(page)
  const before = await store<string>(page, `(s) => s().tools.activeTool`)
  for (const k of ['v', 'w', 'd', 'e']) await page.keyboard.press(k)
  expect(await store<string>(page, `(s) => s().tools.activeTool`)).toBe(before)
})

// ─── Rename ──────────────────────────────────────────────────────────────────

test('rename in place: double-click and Enter commits, Escape reverts, an empty name keeps the old one', { tag: '@home' }, async ({ page }) => {
  await openHome(page)
  const name = cards(page).first().getByTestId('v2-card-name')
  await name.dblclick()
  const field = page.getByTestId('v2-card-rename')
  await expect(field).toBeFocused()
  await field.fill('Goblin Den')
  await field.press('Enter')
  await expect(card(page, 'Goblin Den')).toBeVisible()
  await expect(toaster(page).getByText('Renamed')).toBeVisible()
  // Renaming did not open the map.
  await expect(page.getByTestId('v2-home')).toBeVisible()

  await card(page, 'Goblin Den').getByTestId('v2-card-name').dblclick()
  await field.fill('Never kept')
  await field.press('Escape')
  await expect(card(page, 'Goblin Den')).toBeVisible()

  await card(page, 'Goblin Den').getByTestId('v2-card-name').dblclick()
  await field.fill('   ')
  await field.press('Enter')
  await expect(card(page, 'Goblin Den')).toBeVisible()
  expect(await store(page, `(s) => s().mapIndex.map((m) => m.name)`)).toEqual(['Goblin Den'])
})

test('F2 on a focused card and the menu\'s Rename both open the field; the name survives a reload', { tag: '@home' }, async ({ page }) => {
  await openHome(page)
  await card(page, 'Untitled Map').focus()
  await page.keyboard.press('F2')
  const field = page.getByTestId('v2-card-rename')
  await expect(field).toBeFocused()
  await field.fill('By key')
  await field.press('Enter')
  await expect(card(page, 'By key')).toBeVisible()

  const menu = await openMenu(page, 'By key')
  await menu.getByRole('menuitem', { name: 'Rename' }).click()
  await expect(field).toBeVisible()
  await field.fill('By menu')
  await field.press('Enter')
  await expect(card(page, 'By menu')).toBeVisible()

  await page.reload()
  await waitForBoot(page)
  await expect(card(page, 'By menu')).toBeVisible()
})

// ─── Duplicate and delete ────────────────────────────────────────────────────

test('Duplicate from the menu makes "Copy of" with the same size and content, one more card', { tag: '@home' }, async ({ page }) => {
  await openHome(page)
  await card(page, 'Untitled Map').click()
  await drawShape(page)
  await store(page, `(s) => s().setFixedSize({ width: 18, height: 12 })`)
  await goHome(page)

  const menu = await openMenu(page, 'Untitled Map')
  await menu.getByRole('menuitem', { name: 'Duplicate' }).click()
  await expect(cards(page)).toHaveCount(2)
  await expect(toaster(page).getByText('Duplicated as Copy of Untitled Map')).toBeVisible()
  await card(page, 'Copy of Untitled Map').click()
  await expect(page.getByTestId('shell')).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => shapeCount(page)).toBe(1)
  expect(await store(page, `(s) => s().mapSettings.fixedSize`)).toEqual({ width: 18, height: 12 })
})

test('delete asks first: Cancel keeps the map, Delete removes it, the toast\'s Undo brings it back', { tag: '@home' }, async ({ page }) => {
  await openHome(page)
  await newMap(page, 'Doomed')
  await drawShape(page)
  await goHome(page)
  await expect(cards(page)).toHaveCount(2)

  let dialog = await deleteFromCard(page, 'Doomed')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(cards(page)).toHaveCount(2)

  dialog = await deleteFromCard(page, 'Doomed')
  await dialog.getByRole('button', { name: 'Delete' }).click()
  await expect(cards(page)).toHaveCount(1)
  await expect(page.getByTestId('v2-home')).toContainText('1 map')
  await toaster(page).getByRole('button', { name: 'Undo' }).click()
  await expect(toaster(page).getByText('Map restored')).toBeVisible()
  await expect(cards(page)).toHaveCount(2)
  // It was the open map: it is open again, with its work.
  await expect(card(page, 'Doomed').getByTestId('v2-card-badge')).toHaveText('Open')
  await card(page, 'Doomed').click()
  await expect.poll(() => shapeCount(page)).toBe(1)
})

test('the menu\'s Delete opens the same confirmation; the delete button is reachable by keyboard', { tag: '@home' }, async ({ page }) => {
  await openHome(page)
  await newMap(page, 'Spare')
  await goHome(page)
  const menu = await openMenu(page, 'Spare')
  await menu.getByRole('menuitem', { name: 'Delete' }).click()
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
  await expect(dialog.getByText('Delete map?')).toBeVisible()
  await expect(dialog).toContainText('"Spare"')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(cards(page)).toHaveCount(2)

  const del = page.getByRole('button', { name: 'Delete Spare' })
  await del.focus()
  await page.keyboard.press('Enter')
  await expect(dialog.getByText('Delete map?')).toBeVisible()
  await dialog.getByRole('button', { name: 'Delete' }).click()
  await expect(cards(page)).toHaveCount(1)
})

test('deleting the only map leaves a fresh untitled one, never an empty page; Undo takes the blank back out', { tag: '@home' }, async ({ page }) => {
  await openHome(page)
  await card(page, 'Untitled Map').click()
  await drawShape(page)
  await goHome(page)
  await card(page, 'Untitled Map').getByTestId('v2-card-name').dblclick()
  await page.getByTestId('v2-card-rename').fill('Only one')
  await page.getByTestId('v2-card-rename').press('Enter')

  const dialog = await deleteFromCard(page, 'Only one')
  await dialog.getByRole('button', { name: 'Delete' }).click()
  // The delete and the fresh blank land one after the other; wait for the pair.
  await expect.poll(() => names(page)).toEqual(['Untitled Map'])
  await toaster(page).getByRole('button', { name: 'Undo' }).click()
  await expect(toaster(page).getByText('Map restored')).toBeVisible()
  await expect.poll(() => names(page)).toEqual(['Only one'])
})

// ─── Import ──────────────────────────────────────────────────────────────────

test('Map file by picker opens the file as a new map, named from it, with everything on it', { tag: '@home' }, async ({ page }) => {
  await openHome(page)
  await page.getByTestId('v2-new-map-card').click()
  const modal = page.getByTestId('v2-new-map-modal')
  await modal.getByRole('group', { name: 'Start from' }).getByRole('button', { name: 'Map file' }).click()
  // The file brings its own name and size.
  await expect(modal.getByLabel('Name', { exact: true })).toHaveCount(0)
  await expect(modal.getByTestId('v2-new-map-submit')).toBeDisabled()
  await modal.locator('input[type="file"]').setInputFiles(WARREN_PATH)
  await expect(modal).toContainText('goblin-warren.mapbuilder')
  await modal.getByTestId('v2-new-map-submit').click()
  // The whole warren loads, with its textures, before the editor comes up.
  await expect(page.getByTestId('shell')).toBeVisible({ timeout: 30_000 })
  await expect(toaster(page).getByText('Map opened')).toBeVisible()
  const want = WARREN.layers.find((l: Any) => l.type === 'dungeon').children.length
  await expect
    .poll(() => store<number>(page, `(s) => s().layers.find((l) => l.type === 'dungeon').children.length`))
    .toBe(want)
  await goHome(page)
  await expect(cards(page)).toHaveCount(2)
  expect((await names(page))[0]).toBe('Goblin Warren')
})

test('a map file dropped on the drop zone is taken; something else is refused with a reason', { tag: '@home' }, async ({ page }) => {
  await openHome(page)
  await page.getByTestId('v2-new-map-card').click()
  const modal = page.getByTestId('v2-new-map-modal')
  await modal.getByRole('group', { name: 'Start from' }).getByRole('button', { name: 'Map file' }).click()
  const drop = async (name: string, text: string) => {
    const dt = await page.evaluateHandle(
      ({ name, text }) => {
        const d = new DataTransfer()
        d.items.add(new File([text], name))
        return d
      },
      { name, text },
    )
    await modal.getByTestId('v2-map-file-drop').dispatchEvent('drop', { dataTransfer: dt })
  }
  await drop('fake.ggvtt', '{"not":"a map"}')
  await expect(modal.getByRole('alert')).toContainText('not a Good Goblin map file')
  await drop('warren.mapbuilder', readFileSync(WARREN_PATH, 'utf8'))
  await expect(modal).toContainText('warren.mapbuilder')
  await expect(modal.getByRole('alert')).toHaveCount(0)
  await modal.getByTestId('v2-new-map-submit').click()
  await expect(page.getByTestId('shell')).toBeVisible({ timeout: 30_000 })
})

test('VTT files by picker: the scan lists each map with its counts, and Import opens a single one', { tag: '@home' }, async ({ page }) => {
  await openHome(page)
  await page.getByTestId('v2-new-map-card').click()
  const modal = page.getByTestId('v2-new-map-modal')
  await modal.getByRole('group', { name: 'Start from' }).getByRole('button', { name: 'VTT files' }).click()
  await modal.getByTestId('v2-vtt-files-input').setInputFiles({
    name: 'Keep.dd2vtt',
    mimeType: 'application/json',
    buffer: Buffer.from(uvtt()),
  })
  await expect(modal.getByTestId('v2-vtt-count')).toHaveText('1 of 1 selected')
  await expect(modal).toContainText('4×3 cells')
  await expect(modal.getByTestId('v2-new-map-submit')).toHaveText('Import 1')
  await modal.getByTestId('v2-new-map-submit').click()
  await expect(modal.getByTestId('v2-import-report')).toBeVisible()
  await modal.getByTestId('v2-import-done').click()
  await expect(page.getByTestId('shell')).toBeVisible({ timeout: 30_000 })
  // The one imported map is the open one, under the file's name.
  expect(await store(page, `(s) => s().mapIndex.find((m) => m.id === s().activeMapId).name`)).toBe('Keep')
  await goHome(page)
  await expect(cards(page)).toHaveCount(2)
})

test('VTT folder: every map in it is listed, None and Select all work, and Done leaves the new cards', { tag: '@home' }, async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'v2-home-vtt-'))
  writeFileSync(join(dir, 'Cellar.dd2vtt'), uvtt())
  writeFileSync(join(dir, 'Attic.dd2vtt'), uvtt(2))
  writeFileSync(join(dir, 'notes.txt'), 'not a map')
  await openHome(page)
  await page.getByTestId('v2-new-map-card').click()
  const modal = page.getByTestId('v2-new-map-modal')
  await modal.getByRole('group', { name: 'Start from' }).getByRole('button', { name: 'VTT files' }).click()
  await modal.getByTestId('v2-vtt-folder-input').setInputFiles(dir)
  await expect(modal.getByTestId('v2-vtt-count')).toHaveText('2 of 2 selected')
  await modal.getByRole('button', { name: 'None' }).click()
  await expect(modal.getByTestId('v2-vtt-count')).toHaveText('0 of 2 selected')
  await expect(modal.getByTestId('v2-new-map-submit')).toBeDisabled()
  await modal.getByRole('button', { name: 'Select all' }).click()
  await modal.getByTestId('v2-new-map-submit').click()
  await expect(modal.getByTestId('v2-import-done')).toHaveText('Done', { timeout: 60_000 })
  await modal.getByTestId('v2-import-done').click()
  // Several maps: back to the cards to pick one.
  await expect(page.getByTestId('v2-home')).toBeVisible()
  await expect(cards(page)).toHaveCount(3)
  await expect(card(page, 'Cellar')).toBeVisible()
  await expect(card(page, 'Attic')).toBeVisible()
})

test('VTT files dropped on the drop zone are scanned like picked ones', { tag: '@home' }, async ({ page }) => {
  await openHome(page)
  await page.getByTestId('v2-new-map-card').click()
  const modal = page.getByTestId('v2-new-map-modal')
  await modal.getByRole('group', { name: 'Start from' }).getByRole('button', { name: 'VTT files' }).click()
  const dt = await page.evaluateHandle((text) => {
    const d = new DataTransfer()
    d.items.add(new File([text], 'Dropped.dd2vtt'))
    return d
  }, uvtt())
  await modal.getByTestId('v2-vtt-drop').dispatchEvent('drop', { dataTransfer: dt })
  await expect(modal.getByTestId('v2-vtt-count')).toHaveText('1 of 1 selected')
  await expect(modal.getByRole('checkbox', { name: 'Dropped' })).toBeChecked()
})

// ─── Map settings, thumbnails, order, reload ────────────────────────────────

test('Map settings from the card menu opens that map with its settings; a save pins size and scale', { tag: '@home' }, async ({ page }) => {
  await openHome(page)
  await newMap(page, 'Measured')
  await drawShape(page)
  await goHome(page)
  const menu = await openMenu(page, 'Untitled Map')
  await menu.getByRole('menuitem', { name: 'Map settings…' }).click()
  const settings = page.getByTestId('v2-map-settings-modal')
  await expect(settings).toBeVisible()
  await expect(page.getByTestId('shell')).toBeVisible({ timeout: 30_000 })
  await expect(settings.getByLabel('Name', { exact: true })).toHaveValue('Untitled Map')
  await settings.getByLabel('Name', { exact: true }).fill('Renamed in settings')
  await settings.getByRole('group', { name: 'Size' }).getByRole('button', { name: 'Fixed' }).click()
  await settings.getByLabel('Width in squares').fill('40')
  await settings.getByLabel('Height in squares').fill('30')
  await settings.getByLabel('Distance per square').fill('10')
  await settings.getByTestId('v2-map-settings-save').click()
  await expect(settings).toHaveCount(0)
  expect(await store(page, `(s) => s().mapSettings.fixedSize`)).toEqual({ width: 40, height: 30 })
  expect(await store(page, `(s) => s().mapSettings.cellScale.value`)).toBe(10)
  await goHome(page)
  await expect(card(page, 'Renamed in settings')).toBeVisible()
})

test('Fixed in Map settings starts at the size the map already measures', { tag: '@home' }, async ({ page }) => {
  await openHome(page)
  await card(page, 'Untitled Map').click()
  await store(page, `(s) => s().loadFromFile(arg)`, WARREN)
  await store(page, `(s) => s().saveCurrentMap()`)
  await goHome(page)
  const menu = await openMenu(page, 'Untitled Map')
  await menu.getByRole('menuitem', { name: 'Map settings…' }).click()
  const settings = page.getByTestId('v2-map-settings-modal')
  await settings.getByRole('group', { name: 'Size' }).getByRole('button', { name: 'Fixed' }).click()
  // The card index measured the map at its last save; the dialog starts from the same size.
  const measured = await store<{ width: number; height: number }>(
    page,
    `(s) => s().mapIndex.find((m) => m.id === s().activeMapId).gridSize`,
  )
  expect(measured.width).toBeGreaterThan(0)
  await expect(settings.getByLabel('Width in squares')).toHaveValue(String(measured.width))
  await expect(settings.getByLabel('Height in squares')).toHaveValue(String(measured.height))
})

test('a map with work on it shows its thumbnail on the card; a blank one reads Empty', { tag: '@home' }, async ({ page }) => {
  await openHome(page)
  await expect(cards(page).first().getByTestId('v2-card-empty')).toHaveText('Empty')
  await card(page, 'Untitled Map').click()
  await store(page, `(s) => s().loadFromFile(arg)`, WARREN)
  await waitFrame(page, 6)
  await goHome(page)
  const img = card(page, 'Untitled Map').locator('img')
  await expect(img).toHaveCount(1)
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0)
  await page.reload()
  await waitForBoot(page)
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0)
})

test('cards are newest first, and editing an older map moves it to the front', { tag: '@home' }, async ({ page }) => {
  await openHome(page)
  await newMap(page, 'B')
  await goHome(page)
  await newMap(page, 'C')
  await goHome(page)
  expect(await names(page)).toEqual(['C', 'B', 'Untitled Map'])
  await card(page, 'Untitled Map').click()
  await expect(page.getByTestId('shell')).toBeVisible({ timeout: 30_000 })
  await drawShape(page)
  await goHome(page)
  await expect.poll(() => names(page)).toEqual(['Untitled Map', 'C', 'B'])
})

test('the maps and the open one survive a reload', { tag: '@home' }, async ({ page }) => {
  await openHome(page)
  await newMap(page, 'Kept')
  await goHome(page)
  await card(page, 'Untitled Map').click()
  await expect(page.getByTestId('shell')).toBeVisible({ timeout: 30_000 })
  await goHome(page)
  await page.reload()
  await waitForBoot(page)
  await expect(cards(page)).toHaveCount(2)
  await expect(card(page, 'Kept')).toBeVisible()
  await expect(card(page, 'Untitled Map').getByTestId('v2-card-badge')).toHaveText('Open')
})
