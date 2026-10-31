import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { firePointer, waitForBoot, waitFrame } from './helpers'

/**
 * The Packs sheet in /v2: bundled rows, installing a pack file (picker and drop), its
 * props in the browser and on the map, a reload, uninstalling it (the confirm, the tiles,
 * the placeholder, the cache line), and the files it refuses. Fixture zips are built by
 * tests/fixtures/packs/build-fixture-packs.mjs.
 */

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/packs/${name}`, import.meta.url))
const CRATE = 'fixture-crates:fixture_crate_1x1_object_A'

async function openEditor(page: Page): Promise<void> {
  await page.goto('/v2?e2e=1')
  await waitForBoot(page)
  await page.getByTestId('v2-new-map-card').click()
  await page.getByTestId('v2-new-map-submit').click()
  await expect(page.getByTestId('v2-editor')).toBeVisible()
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const l = st.layers.find((x: Any) => x.type === 'dungeon')
    st.setActiveLayerId(l.id)
  })
}

async function openPacks(page: Page) {
  await page.getByTestId('v2-more').click()
  await page.getByRole('menuitem', { name: 'Packs…' }).click()
  const sheet = page.getByTestId('v2-packs-sheet')
  await expect(sheet).toBeVisible()
  return sheet
}

const row = (page: Page, packId: string) => page.locator(`[data-testid="v2-pack-row"][data-pack-id="${packId}"]`)

async function installFixture(page: Page, name = 'fixture-crates.zip') {
  await page.getByTestId('v2-packs-file').setInputFiles(fixture(name))
}

/** Pick the fixture crate in the Props browser and stamp it in the middle of the canvas. */
async function stampCrate(page: Page): Promise<string> {
  await page.getByTestId('v2-dock-tab-assets').click()
  const sheet = page.getByTestId('v2-props-sheet')
  await sheet.getByLabel('Search props').fill('fixture crate')
  await sheet.getByTestId('v2-prop-tile').first().locator('.v2-ptile__pk').click()
  const box = (await page.locator('canvas').first().boundingBox())!
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await firePointer(page, 'pointermove', at.x, at.y)
  await waitFrame(page, 2)
  await firePointer(page, 'pointerdown', at.x, at.y, 0.5, 1)
  await firePointer(page, 'pointerup', at.x, at.y)
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
  const line = page.getByTestId('v2-packs-usage')
  await expect(line).toHaveText(/Installed: [\d.]+ MB · cache [\d.]+ MB of \d+ MB/)
  return Number((await line.textContent())!.match(/cache ([\d.]+) MB/)![1])
}

test('the … menu opens Packs: the bundled packs, tagged, with no way to uninstall them', async ({ page }) => {
  await openEditor(page)
  const sheet = await openPacks(page)
  for (const id of ['gg-demo', 'gg-forge']) {
    await expect(row(page, id)).toContainText('Bundled')
    await expect(row(page, id)).toContainText(/\d+\.\d+\.\d+ · \d+ entries · \d+\.\d MB/)
  }
  await row(page, 'gg-forge').getByRole('button', { name: 'gg-forge options' }).click()
  await expect(page.getByRole('menuitem', { name: /Uninstall/ })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(sheet).toBeVisible()

  await sheet.getByRole('button', { name: 'Check updates' }).click()
  await expect(sheet.getByRole('status')).toHaveText(/Up to date|\d+ updates? available|Could not reach the update source/)
  await page.screenshot({ path: test.info().outputPath('packs-sheet.png') })
  // Escape puts the sheet away.
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
})

test('a pack file installs from the picker, its prop stamps, and both survive a reload', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await openEditor(page)
  const sheet = await openPacks(page)
  const before = await usageMB(page)
  await installFixture(page)
  await expect(row(page, 'fixture-crates')).toContainText('From file')
  await expect(row(page, 'fixture-crates')).toContainText('1.0.0 · 2 entries')
  await expect.poll(() => usageMB(page)).toBeGreaterThanOrEqual(before)
  await expect(sheet.getByTestId('v2-pack-row').first()).toHaveAttribute('data-pack-id', /^gg-/)

  const id = await stampCrate(page)
  await expect.poll(() => spriteTexture(page, id)).toBe(64)
  await page.screenshot({ path: test.info().outputPath('fixture-stamped.png') })
  await page.evaluate(() => (window as Any).__store.getState().saveCurrentMap())

  await page.reload()
  await waitForBoot(page)
  await page.getByTestId('v2-map-card').first().click()
  await expect(page.getByTestId('v2-editor')).toBeVisible()
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

test('uninstall asks first when the map uses the pack; the row, the tiles and the art go, and stay gone', async ({ page }) => {
  await openEditor(page)
  await openPacks(page)
  await installFixture(page)
  await expect(row(page, 'fixture-crates')).toBeVisible()
  const id = await stampCrate(page)
  await expect.poll(() => spriteTexture(page, id)).toBe(64)

  // With the Props browser still open: the … menu has to come up over the sheet.
  await openPacks(page)
  const used = await usageMB(page)
  await row(page, 'fixture-crates').getByRole('button', { name: 'fixture-crates options' }).click()
  await page.getByRole('menuitem', { name: 'Uninstall' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('1 prop on this map uses fixture-crates. It will show as missing until the pack is back.')
  await dialog.getByRole('button', { name: 'Uninstall' }).click()
  await expect(row(page, 'fixture-crates')).toHaveCount(0)
  await expect.poll(() => usageMB(page)).toBeLessThanOrEqual(used)
  // The placed crate keeps its place and shows the missing-texture placeholder.
  await expect.poll(() => spriteTexture(page, id)).toBe(1)

  await page.getByTestId('v2-dock-tab-assets').click()
  const props = page.getByTestId('v2-props-sheet')
  await props.getByLabel('Search props').fill('fixture crate')
  await expect(props.getByTestId('v2-prop-tile')).toHaveCount(0)

  await page.evaluate(() => (window as Any).__store.getState().saveCurrentMap())
  await page.reload()
  await waitForBoot(page)
  await page.getByTestId('v2-map-card').first().click()
  await expect(page.getByTestId('v2-editor')).toBeVisible()
  await openPacks(page)
  await expect(row(page, 'gg-demo')).toBeVisible()
  await expect(row(page, 'fixture-crates')).toHaveCount(0)
})

test('a zip without a manifest, and one named like a bundled pack, are refused with the reason', async ({ page }) => {
  await openEditor(page)
  const sheet = await openPacks(page)
  const rowsBefore = await sheet.getByTestId('v2-pack-row').count()

  await installFixture(page, 'no-manifest.zip')
  await expect(sheet.getByRole('alert')).toContainText("Couldn't install no-manifest.zip: No manifest.json at the root of the zip")
  await installFixture(page, 'bad-bundled-id.zip')
  await expect(sheet.getByRole('alert')).toContainText('gg-forge is bundled with the app; rename the pack to install it beside it')
  await expect(sheet.getByTestId('v2-pack-row')).toHaveCount(rowsBefore)
  await expect(row(page, 'gg-forge')).toContainText('1.5.0')
})

test('a pack .zip dropped on the sheet installs; the Props header links to the sheet', async ({ page }) => {
  await openEditor(page)
  await page.getByTestId('v2-dock-tab-assets').click()
  await page.getByTestId('v2-props-packs').click()
  const sheet = page.getByTestId('v2-packs-sheet')
  await expect(sheet).toBeVisible()
  await expect(page.getByTestId('v2-props-sheet')).toHaveCount(0)

  const bytes = [...readFileSync(fixture('fixture-crates.zip'))]
  await page.evaluate((bytes) => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array(bytes)], 'fixture-crates.zip', { type: 'application/zip' }))
    const zone = document.querySelector('[data-testid="v2-packs-drop"]')!
    zone.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
    zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, bytes)
  await expect(row(page, 'fixture-crates')).toContainText('From file')
})
