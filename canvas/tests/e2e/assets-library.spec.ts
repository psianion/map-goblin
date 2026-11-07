import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { gotoApp, waitForBoot, waitFrame } from './helpers'
import { box, openEditor, pickFromFlyout, shot } from './shell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const panel = (page: Page) => page.getByTestId('shell-assets')

/** Right 12 from the viewport, top 68, 320 wide, and its bottom edge above the dock's top. */
async function expectPlaced(page: Page, width: number) {
  const p = await box(panel(page))
  const dock = await box(page.getByTestId('shell-dock'))
  expect(p.x + p.width).toBe(width - 12)
  expect(p.y).toBe(68)
  expect(p.width).toBe(320)
  expect(p.y + p.height).toBeLessThan(dock.y)
  expect(dock.y - (p.y + p.height)).toBe(12)
}

/** Closes with X and stays closed. */
async function closeWithX(page: Page) {
  await panel(page).getByRole('button', { name: 'Close assets' }).click()
  await expect(panel(page)).toBeHidden()
  await waitFrame(page, 10)
  await expect(panel(page)).toBeHidden()
}

async function pickFloor(page: Page) {
  const id = await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    for (const l of st.layers) {
      if (l.type !== 'dungeon' || l.locked) continue
      const shape = l.children.find((c: Any) => c.childType === 'shape' && c.visible !== false && !c.locked)
      if (shape) {
        st.setActiveLayerId(l.id)
        st.setSelectedIds([shape.id])
        return shape.id as string
      }
    }
    return null
  })
  expect(id).not.toBeNull()
  await waitFrame(page, 4)
}

for (const size of [
  { width: 1400, height: 1000 },
  { width: 1200, height: 800 },
]) {
  test(`the asset panel opens from its three triggers and never covers the dock at ${size.width}x${size.height}`, { tag: '@assets' }, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await openEditor(page, 'light', size)
    await expect(panel(page)).toHaveCount(0)

    // 1. From library in the dock, with Floor in hand: textures.
    await pickFromFlyout(page, 'Design', 'Floor')
    await page.getByTestId('shell-dock').getByRole('button', { name: 'From library' }).click()
    await expect(panel(page)).toBeVisible()
    await expect(panel(page)).toHaveAttribute('data-chip', 'textures')
    await expect(panel(page).locator('[data-composite="panel-header"]')).toContainText('Assets')
    await expect(panel(page).getByRole('textbox', { name: 'Search assets' })).toBeVisible()
    await expect(panel(page).getByRole('group', { name: 'Kind' }).getByRole('button')).toHaveText([
      'Textures',
      'Props',
      'Walls',
      'Paths',
      'Lights',
    ])
    await expect(panel(page).getByRole('button', { name: 'Used' })).toBeVisible()
    expect(Number(await page.getByTestId('shell-assets-count').textContent())).toBeGreaterThan(0)
    await expectPlaced(page, size.width)
    await closeWithX(page)

    // 2. A card's texture Change, with a floor picked under Select.
    await page.getByTestId('shell-rail').getByRole('button', { name: 'Select' }).click()
    await pickFloor(page)
    await page.getByTestId('shell-card').locator('[data-setting="card.floor.texture"]').getByRole('button', { name: 'Change' }).click()
    await expect(panel(page)).toBeVisible()
    await expect(panel(page)).toHaveAttribute('data-chip', 'textures')
    await expectPlaced(page, size.width)
    await closeWithX(page)
    await page.evaluate(() => (window as Any).__store.getState().setSelectedIds([]))

    // 3. A family tool that works from the library (the stub Objects family's Stamp): props.
    await pickFromFlyout(page, 'Objects', 'Stamp')
    await expect(panel(page)).toBeVisible()
    await expect(panel(page)).toHaveAttribute('data-chip', 'props')
    await expectPlaced(page, size.width)

    if (size.width === 1400) {
      // A prop picked from the library goes to the stamp.
      const tile = panel(page).locator('[data-composite="tile"]').first()
      const assetId = await tile.getAttribute('data-asset')
      await tile.click()
      expect(await page.evaluate(() => (window as Any).__store.getState().tools.settings.scatterBrush.assetIds[0])).toBe(assetId)
      // Search narrows the tiles; Used shows only what the map holds.
      const before = Number(await page.getByTestId('shell-assets-count').textContent())
      await panel(page).getByRole('textbox', { name: 'Search assets' }).fill('barrel')
      expect(Number(await page.getByTestId('shell-assets-count').textContent())).toBeLessThan(before)
      await panel(page).getByRole('textbox', { name: 'Search assets' }).fill('')
      await panel(page).getByRole('button', { name: 'Used' }).click()
      expect(Number(await page.getByTestId('shell-assets-count').textContent())).toBeLessThan(before)
      await panel(page).getByRole('button', { name: 'Used' }).click()
      await shot(page, '08-assets')
    }
    await closeWithX(page)
    expect(errors).toEqual([])
  })
}

test('the asset panel in the dark theme', { tag: '@assets' }, async ({ page }) => {
  await openEditor(page, 'dark')
  await pickFromFlyout(page, 'Objects', 'Stamp')
  await expect(panel(page)).toBeVisible()
  await expectPlaced(page, 1400)
  await shot(page, '08-assets-dark')
})

// ─── The Packs sheet ─────────────────────────────────────────────────────────

/*
 * The Packs sheet: bundled rows, installing a pack file (picker and drop), its props in
 * the library and on the map, a reload, uninstalling it (the confirm, the tiles, the
 * placeholder, the cache line), and the files it refuses. Fixture zips are built by
 * tests/fixtures/packs/build-fixture-packs.mjs.
 */

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/packs/${name}`, import.meta.url))
const CRATE = 'fixture-crates:fixture_crate_1x1_object_A'

// Minimal 1×1 transparent PNG, for the paste test.
const PNG_UINT8 = Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ),
)

/** The bundled packs as the committed index lists them, so a rebuild never leaves a literal behind. */
const BUNDLED: Record<string, { version: string; entryCount: number }> = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../public/packs/index.json', import.meta.url)), 'utf8'),
).packs

/** A blank map with its dungeon layer active. */
async function openBlank(page: Page): Promise<void> {
  await gotoApp(page)
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    st.setActiveLayerId(st.layers.find((x: Any) => x.type === 'dungeon').id)
  })
}

async function openPacks(page: Page) {
  await page.getByTestId('shell-more').click()
  await page.getByRole('menuitem', { name: 'Packs…' }).click()
  const sheet = page.getByTestId('shell-packs-sheet')
  await expect(sheet).toBeVisible()
  return sheet
}

const row = (page: Page, packId: string) => page.locator(`[data-testid="shell-pack-row"][data-pack-id="${packId}"]`)

async function installFixture(page: Page, name = 'fixture-crates.zip') {
  await page.getByTestId('shell-packs-file').setInputFiles(fixture(name))
}

/** Pick the fixture crate in the library under Stamp and stamp it in the middle of the canvas. */
async function stampCrate(page: Page): Promise<string> {
  await pickFromFlyout(page, 'Objects', 'Stamp')
  await expect(panel(page)).toBeVisible()
  await panel(page).getByRole('textbox', { name: 'Search assets' }).fill('fixture crate')
  await panel(page).locator(`[data-asset="${CRATE}"]`).click()
  const box = (await page.locator('canvas').first().boundingBox())!
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(at.x, at.y)
  await waitFrame(page, 2)
  await page.mouse.click(at.x, at.y)
  await waitFrame(page, 3)
  const id = await page.evaluate((assetId) => {
    const s = (window as Any).__store.getState()
    for (const l of s.layers) for (const c of l.children ?? []) if (c.assetId === assetId) return c.id as string
    return null
  }, CRATE)
  expect(id).not.toBeNull()
  return id!
}

/** The placed sprite's texture size: 64 for the fixture's art, 1 for the missing placeholder. */
async function spriteTexture(page: Page, childId: string): Promise<number | null> {
  return page.evaluate((label) => {
    const walk = (n: Any): Any => {
      if (n.label === label) return n
      for (const c of n.children ?? []) {
        const hit = walk(c)
        if (hit) return hit
      }
      return null
    }
    const sprite = walk((window as Any).__pixiApp.stage)
    return sprite ? (sprite.texture.width as number) : null
  }, `placed-${childId}`)
}

/** The cache line's used megabytes, once the sheet has read them. */
async function usageMB(page: Page): Promise<number> {
  const line = page.getByTestId('shell-packs-usage')
  await expect(line).toHaveText(/Installed: [\d.]+ MB · cache [\d.]+ MB of \d+ MB/)
  return Number((await line.textContent())!.match(/cache ([\d.]+) MB/)![1])
}

test('the … menu opens Packs: the bundled packs, tagged, with no way to uninstall them', { tag: '@assets' }, async ({ page }) => {
  await openBlank(page)
  const sheet = await openPacks(page)
  for (const id of ['gg-demo', 'gg-forge']) {
    await expect(row(page, id)).toContainText('Bundled')
    await expect(row(page, id)).toContainText(/\d+\.\d+\.\d+ · \d+ entries · \d+\.\d MB/)
  }
  await row(page, 'gg-forge').getByRole('button', { name: /gg-forge options/i }).click()
  await expect(page.getByRole('menuitem', { name: /Uninstall/ })).toBeDisabled()

  await sheet.getByRole('button', { name: 'Check updates' }).click()
  await expect(sheet.getByRole('status')).toHaveText(/Up to date|\d+ updates? available|Could not reach the update source/)
})

// Escape belongs to the open row menu first and puts only that away; a second press closes the sheet.
test('Escape closes a pack menu and leaves the sheet; a second Escape puts the sheet away', { tag: '@assets' }, async ({ page }) => {
  await openBlank(page)
  const sheet = await openPacks(page)
  await row(page, 'gg-forge').getByRole('button', { name: /gg-forge options/i }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(sheet).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
})

test('a pack file installs from the picker, its prop stamps, and both survive a reload', { tag: '@assets' }, async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await openBlank(page)
  const sheet = await openPacks(page)
  const before = await usageMB(page)
  await installFixture(page)
  await expect(row(page, 'fixture-crates')).toContainText('From file')
  await expect(row(page, 'fixture-crates')).toContainText('1.0.0 · 2 entries')
  await expect.poll(() => usageMB(page)).toBeGreaterThanOrEqual(before)
  await expect(sheet.getByTestId('shell-pack-row').first()).toHaveAttribute('data-pack-id', /^gg-/)
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)

  const id = await stampCrate(page)
  await expect.poll(() => spriteTexture(page, id)).toBe(64)
  await page.evaluate(() => (window as Any).__store.getState().saveCurrentMap())

  await page.reload()
  await waitForBoot(page)
  await page.getByTestId('v2-map-card').first().click()
  await expect(page.getByTestId('shell')).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => spriteTexture(page, id)).toBe(64)
  // The boot list itself carries the stored flag (before the sheet re-reads it).
  const booted = await page.evaluate(() =>
    (window as Any).__store.getState().packs.installedPacks.map((p: Any) => [p.packId, p.bundled]),
  )
  expect(booted).toEqual(expect.arrayContaining([['fixture-crates', false], ['gg-demo', true]]))
  await openPacks(page)
  await expect(row(page, 'fixture-crates')).toContainText('From file')
  expect(errors).toEqual([])
})

test('uninstall asks first when the map uses the pack; the row, the tiles and the art go, and stay gone', { tag: '@assets' }, async ({ page }) => {
  await openBlank(page)
  await openPacks(page)
  await installFixture(page)
  await expect(row(page, 'fixture-crates')).toBeVisible()
  await page.keyboard.press('Escape')
  const id = await stampCrate(page)
  await expect.poll(() => spriteTexture(page, id)).toBe(64)

  // With the library still open: the … menu has to come up over it.
  await openPacks(page)
  const used = await usageMB(page)
  await row(page, 'fixture-crates').getByRole('button', { name: /fixture-crates options/i }).click()
  await page.getByRole('menuitem', { name: 'Uninstall' }).click()
  const dialog = page.getByRole('dialog').filter({ hasText: 'Uninstall fixture-crates?' })
  await expect(dialog).toContainText('1 prop on this map uses fixture-crates. It will show as missing until the pack is back.')
  await dialog.getByRole('button', { name: 'Uninstall' }).click()
  await expect(row(page, 'fixture-crates')).toHaveCount(0)
  await expect.poll(() => usageMB(page)).toBeLessThanOrEqual(used)
  // The placed crate keeps its place and shows the missing-texture placeholder.
  await expect.poll(() => spriteTexture(page, id)).toBe(1)

  await page.keyboard.press('Escape')
  await pickFromFlyout(page, 'Objects', 'Stamp')
  await panel(page).getByRole('textbox', { name: 'Search assets' }).fill('fixture crate')
  await expect(panel(page).locator('[data-composite="tile"]')).toHaveCount(0)

  await page.evaluate(() => (window as Any).__store.getState().saveCurrentMap())
  await page.reload()
  await waitForBoot(page)
  await page.getByTestId('v2-map-card').first().click()
  await expect(page.getByTestId('shell')).toBeVisible({ timeout: 30_000 })
  await openPacks(page)
  await expect(row(page, 'gg-demo')).toBeVisible()
  await expect(row(page, 'fixture-crates')).toHaveCount(0)
})

test('a zip without a manifest, and one named like a bundled pack, are refused with the reason', { tag: '@assets' }, async ({ page }) => {
  await openBlank(page)
  const sheet = await openPacks(page)
  const rowsBefore = await sheet.getByTestId('shell-pack-row').count()

  await installFixture(page, 'no-manifest.zip')
  await expect(sheet.getByRole('alert')).toContainText("Couldn't install no-manifest.zip: No manifest.json at the root of the zip")
  await installFixture(page, 'bad-bundled-id.zip')
  await expect(sheet.getByRole('alert')).toContainText('gg-forge is bundled with the app; rename the pack to install it beside it')
  await expect(sheet.getByTestId('shell-pack-row')).toHaveCount(rowsBefore)
  // The bundled version is whatever the committed index says, not a number written here.
  await expect(row(page, 'gg-forge')).toContainText(BUNDLED['gg-forge'].version)
  await expect(row(page, 'gg-forge')).toContainText(`${BUNDLED['gg-forge'].entryCount} entries`)
})

test('a pack .zip dropped on the sheet installs', { tag: '@assets' }, async ({ page }) => {
  await openBlank(page)
  await openPacks(page)

  const bytes = [...readFileSync(fixture('fixture-crates.zip'))]
  await page.evaluate((bytes) => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array(bytes)], 'fixture-crates.zip', { type: 'application/zip' }))
    const zone = document.querySelector('[data-testid="shell-packs-drop"]')!
    zone.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
    zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, bytes)
  await expect(row(page, 'fixture-crates')).toContainText('From file')
})

// ─── The asset browser ───────────────────────────────────────────────────────

/** The assets on every layer, the count the paste test compares. */
const placedAssets = (page: Page) =>
  page.evaluate(
    () =>
      (window as Any).__store
        .getState()
        .layers.flatMap((l: Any) => l.children ?? [])
        .filter((c: Any) => c.childType === 'asset').length as number,
  )

const search = (page: Page) => panel(page).getByRole('textbox', { name: 'Search assets' })
const count = async (page: Page) => Number(await page.getByTestId('shell-assets-count').textContent())

test('the asset browser opens from a tool that works from the library, with its search box', { tag: '@assets' }, async ({ page }) => {
  await openBlank(page)
  await expect(panel(page)).toHaveCount(0)
  await pickFromFlyout(page, 'Objects', 'Stamp')
  await expect(panel(page)).toBeVisible()
  await expect(search(page)).toBeVisible()
  expect(await count(page)).toBeGreaterThan(0)
})

test('asset search narrows the tiles and clearing it brings them back', { tag: '@assets' }, async ({ page }) => {
  await openBlank(page)
  await pickFromFlyout(page, 'Objects', 'Stamp')
  await expect(panel(page)).toHaveAttribute('data-chip', 'props')
  const all = await count(page)
  expect(all).toBeGreaterThan(0)

  await search(page).fill('barrel')
  await expect.poll(() => count(page)).toBeGreaterThan(0)
  expect(await count(page)).toBeLessThan(all)
  await expect(page.locator('canvas').first()).toBeVisible()

  await search(page).fill('')
  await expect.poll(() => count(page)).toBe(all)
})

test('a search with no matches says so', { tag: '@assets' }, async ({ page }) => {
  await openBlank(page)
  await pickFromFlyout(page, 'Objects', 'Stamp')
  await search(page).fill('zzz_definitely_not_in_any_pack_xyz')
  await expect(page.getByTestId('shell-assets-empty')).toContainText('Nothing matches')
  expect(await count(page)).toBe(0)
  await expect(page.locator('canvas').first()).toBeVisible()
})

// A clipboard image pasted outside a text field lands on the map; with the library's search
// box focused the paste belongs to the field and places nothing.
test('clipboard paste while the asset search is focused is NOT triggered', { tag: '@assets' }, async ({ page }) => {
  await openBlank(page)
  await pickFromFlyout(page, 'Objects', 'Stamp')
  await search(page).focus()
  await waitFrame(page, 2)

  const before = await placedAssets(page)
  await page.evaluate((pngBytes) => {
    const file = new File([new Uint8Array(pngBytes)], 'paste.png', { type: 'image/png' })
    const dt = new DataTransfer()
    dt.items.add(file)
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, PNG_UINT8)
  await waitFrame(page, 15)
  await page.waitForTimeout(400)

  expect(await placedAssets(page)).toBe(before)
})
