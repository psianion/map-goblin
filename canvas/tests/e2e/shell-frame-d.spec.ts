import { test, expect, type Page } from '@playwright/test'
import { waitFrame } from './helpers'
import { box, dockColumns, expectFrameGeometry, expectSlot, openEditor, pickFromFlyout, shot } from './shell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

/** The picked floor's tint and colour pin, read off the store. */
const floor = (page: Page, id: string) =>
  page.evaluate((fid) => {
    const st = (window as Any).__store.getState()
    for (const l of st.layers) {
      const c = l.type === 'dungeon' ? l.children.find((x: Any) => x.id === fid) : null
      if (c) return { tint: c.textureTint as string, colour: (c.styleOverrides?.floorColor ?? null) as string | null }
    }
    return null
  }, id)

// Frame D (plan 5.4) with the real Design family: Select with a floor picked, the floor
// card in the slot and its verbs beside the selection; a card field edited, then undone.
test('frame D: a picked floor shows the Design floor card, and a card edit undoes', { tag: '@shell' }, async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openEditor(page)
  await pickFromFlyout(page, 'Design', 'Floor')
  await page.getByTestId('shell-rail').getByRole('button', { name: 'Select' }).click()

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

  const card = page.getByTestId('shell-card')
  await expect(card).toBeVisible()
  expect(errors).toEqual([])
  await expect(card).toHaveAttribute('data-kind', 'shape')
  await expect(card.locator('[data-composite="panel-header"]')).toContainText('Selection / Floor')

  // Node mode, flip, flip, rotate, duplicate, lock, hide, delete.
  const verbs = card.locator('[data-composite="action-row"]').getByRole('button')
  await expect(verbs).toHaveCount(8)
  await expect(verbs.first()).toHaveAttribute('aria-label', 'Node mode')
  await expect(verbs.last()).toHaveAttribute('aria-label', 'Delete')
  await expect(verbs.last()).toHaveAttribute('data-danger', '')

  // Look carries Opacity, and the Edge section the floor's own edge band.
  const captions = await card.locator('[data-section]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.section))
  expect(captions).toEqual(['', 'Look', 'Edge'])
  await expect(card.locator('[data-setting="card.floor.size"]')).toContainText('sq')
  await expect(card.locator('[data-setting="card.floor.layer"]')).toBeVisible()
  await expect(card.locator('[data-setting="card.floor.texture"]').getByRole('button', { name: 'Change' })).toBeVisible()
  await expect(card.locator('[data-setting="card.floor.opacity"], [data-setting="card.floor.edgeBand"]')).toHaveCount(2)

  // The floating bar carries the quick verbs (not flip V or hide), beside the selection.
  const bar = page.getByTestId('shell-floating-actions')
  await expect(bar).toBeVisible()
  await expect(bar.getByRole('button')).toHaveCount(6)
  const slot = await box(page.getByTestId('shell-slot'))
  expect((await box(bar)).x).toBeGreaterThan(slot.x + slot.width)

  expect(await dockColumns(page)).toEqual(['level', 'layers', 'look'])
  await expectFrameGeometry(page)
  await expectSlot(page)
  await shot(page, '10-d')
  await shot(page, '07-d')

  // Edit a card field: a textured floor's Tint, a plain one's Colour, typed as a hex.
  const before = await floor(page, id!)
  const tinted = (await card.locator('[data-setting="card.floor.tint"]').count()) > 0
  const label = tinted ? 'Tint' : 'Colour'
  const row = card.locator(`[data-setting="card.floor.${tinted ? 'tint' : 'colour'}"]`)
  await row.getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('textbox', { name: `${label} hex` }).fill('#336699')
  await page.keyboard.press('Escape')
  const after = await floor(page, id!)
  expect(tinted ? after?.tint : after?.colour).toBe('#336699')

  await page.getByTestId('shell-top-actions').getByRole('button', { name: 'Undo' }).click()
  await waitFrame(page, 2)
  expect(await floor(page, id!)).toEqual(before)
  expect(errors).toEqual([])
})
