import { test, expect, type Page } from '@playwright/test'
import { firePointer, waitFrame } from './helpers'
import { openEditor, pickFromFlyout } from './shell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

type Pt = { x: number; y: number }

/** Open floor in the warren, clear of its edges and of every drawn wall. */
const OPEN_FLOOR: Pt = { x: 34, y: 10 }

async function click(page: Page, p: Pt): Promise<void> {
  const at = await page.evaluate(([x, y]) => {
    const w = window as Any
    const r = w.__pixiApp.canvas.getBoundingClientRect()
    const wd = w.__pixiApp.stage.children[0]
    return { x: r.left + x * wd.scale.x + wd.position.x, y: r.top + y * wd.scale.x + wd.position.y }
  }, [p.x, p.y])
  await firePointer(page, 'pointermove', at.x, at.y)
  await firePointer(page, 'pointerdown', at.x, at.y, 0.5, 1)
  await firePointer(page, 'pointerup', at.x, at.y)
  await waitFrame(page, 3)
}

const placed = (page: Page) =>
  page.evaluate(() => {
    const s = (window as Any).__store.getState()
    const l = s.layers.find((x: Any) => x.id === s.ui.activeLayerId)
    const d = l.children.filter((c: Any) => c.childType === 'door').at(-1)
    return d ? { id: d.id, angle: d.angle, freestanding: d.freestanding, wallId: d.wallId } : null
  })

// Item 7: with the Door panel's Freestanding on, a click places a door that stands free;
// its card shows Freestanding on and Angle as a stepper in 5° steps; a step turns it 5°,
// and undo turns it back.
test('freestanding door: placed free, turned 5° on the card, and undo turns it back', { tag: '@design' }, async ({ page }) => {
  await openEditor(page)
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    st.setActiveLayerId(st.layers.find((x: Any) => x.type === 'dungeon').id)
  })
  await pickFromFlyout(page, 'Design', 'Door')
  const sw = page.getByTestId('shell-slot').locator('[data-setting="door.freestanding"]').getByRole('switch')
  await sw.click()
  await expect(sw).toBeChecked()

  await click(page, OPEN_FLOOR)
  const door = await placed(page)
  expect(door?.freestanding).toBe(true)
  expect(door?.angle).toBeCloseTo(0)

  await page.getByTestId('shell-rail').getByRole('button', { name: 'Select' }).click()
  await page.evaluate((id) => (window as Any).__store.getState().setSelectedIds([id]), door!.id)
  const card = page.getByTestId('shell-card')
  await expect(card.locator('[data-setting="card.door.freestanding"]').getByRole('switch')).toBeChecked()
  const angle = card.locator('[data-setting="card.door.angle"]')
  await expect(angle).toContainText('5° steps')
  await angle.getByRole('button', { name: /increase|\+/i }).first().click()
  await waitFrame(page, 3)
  expect((await placed(page))?.angle).toBeCloseTo((5 * Math.PI) / 180)
  await expect(angle).toContainText('5°')

  await page.getByTestId('shell-top-actions').getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await placed(page))?.angle ?? NaN).toBeCloseTo(0)
})
