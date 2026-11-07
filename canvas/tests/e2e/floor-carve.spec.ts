import { test, expect, type Page } from '@playwright/test'
import { drawRect, firePointer, waitFrame } from './helpers'
import { openEditor, pickFromFlyout } from './shell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

/** The floors on the active layer: their ids and how many rings each has. */
const floors = (page: Page) =>
  page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const layer = st.layers.find((l: Any) => l.id === st.ui.activeLayerId)
    return (layer?.children ?? [])
      .filter((c: Any) => c.childType === 'shape')
      .map((c: Any) => ({ id: c.id as string, rings: c.contours.length as number }))
  })

// Item 3: draw a floor, carve a rectangle out of its middle with Carve out, see the hole,
// undo it; then carve again with Alt in Draw mode, splitting the floor in two.
test('carve out: a carved rectangle holes the floor, Alt carves while in Draw, undo restores it', { tag: '@design' }, async ({ page }) => {
  await openEditor(page)
  await pickFromFlyout(page, 'Design', 'Floor')
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const layer = st.layers.find((l: Any) => l.type === 'dungeon' && !l.locked)
    st.setActiveLayerId(layer.id)
  })
  const panel = page.getByTestId('shell-tool-panel')
  await expect(panel.locator('[data-setting="floor.mode"]')).toBeVisible()

  const before = (await floors(page)).length
  await drawRect(page, 300, 300, 700, 600)
  const drawn = await floors(page)
  expect(drawn).toHaveLength(before + 1)
  const id = drawn[drawn.length - 1].id

  // Carve out: the mode the panel's Mode section sets, and the hint says so.
  await panel.locator('[data-setting="floor.mode"]').getByRole('button', { name: 'Carve out' }).click()
  await expect(page.getByTestId('shell-status-hint')).toContainText('Carve out')
  await drawRect(page, 450, 400, 550, 500)
  await waitFrame(page, 4)
  expect((await floors(page)).find((f) => f.id === id)?.rings).toBe(2)

  await page.getByTestId('shell-top-actions').getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await floors(page)).find((f) => f.id === id)?.rings).toBe(1)

  // Back in Draw, Alt carves the one shape drawn: a band across splits the floor in two.
  await panel.locator('[data-setting="floor.mode"]').getByRole('button', { name: 'Draw', exact: true }).click()
  await expect(page.getByTestId('shell-status-hint')).toContainText('Alt')
  // The modifier rides on the pointer events themselves (see firePointer).
  await firePointer(page, 'pointerdown', 480, 250, 0.5, 1, { alt: true })
  await firePointer(page, 'pointermove', 520, 650, 0.5, 1, { alt: true })
  await firePointer(page, 'pointerup', 520, 650, 0, 0, { alt: true })
  await waitFrame(page, 4)
  const split = await floors(page)
  expect(split.find((f) => f.id === id)).toBeUndefined()
  // At least the two halves are new floors (any other floor under the band splits too).
  const known = new Set(drawn.map((f) => f.id))
  expect(split.filter((f) => !known.has(f.id)).length).toBeGreaterThanOrEqual(2)

  await page.getByTestId('shell-top-actions').getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await floors(page)).find((f) => f.id === id)?.rings).toBe(1)
})
