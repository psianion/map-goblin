import { test, expect, type Page } from '@playwright/test'
import { waitFrame } from './helpers'
import { box, openNext, pickFromFlyout, shot } from './nextShell'

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
  test(`the asset panel opens from its three triggers and never covers the dock at ${size.width}x${size.height}`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await openNext(page, 'light', size)
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

test('the asset panel in the dark theme', async ({ page }) => {
  await openNext(page, 'dark')
  await pickFromFlyout(page, 'Objects', 'Stamp')
  await expect(panel(page)).toBeVisible()
  await expectPlaced(page, 1400)
  await shot(page, '08-assets-dark')
})
