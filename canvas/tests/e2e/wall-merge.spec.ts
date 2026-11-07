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

async function drawWall(page: Page, points: Pt[]): Promise<void> {
  for (const p of points) await click(page, p)
  await page.keyboard.press('Enter')
  await waitFrame(page, 4)
}

const walls = (page: Page) =>
  page.evaluate(() => {
    const s = (window as Any).__store.getState()
    return s.layers.find((l: Any) => l.id === s.ui.activeLayerId).standaloneWalls.map((w: Any) => ({ id: w.id, points: w.points }))
  })

async function openWalls(page: Page): Promise<void> {
  await openEditor(page)
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    st.setActiveLayerId(st.layers.find((x: Any) => x.type === 'dungeon').id)
  })
  await pickFromFlyout(page, 'Design', 'Wall')
}

const a: Pt = { x: OPEN_FLOOR.x - 3, y: OPEN_FLOOR.y }
const b: Pt = { x: OPEN_FLOOR.x + 1, y: OPEN_FLOOR.y }
const c: Pt = { x: OPEN_FLOOR.x + 1, y: OPEN_FLOOR.y + 4 }

// Item 6: with Auto-join on (the panel's default), a wall drawn from another's end joins
// it, so one wall remains; undo gives the first wall back alone.
test('auto-join: two walls drawn end to end leave one wall, and undo restores the first', { tag: '@design' }, async ({ page }) => {
  await openWalls(page)
  await expect(page.getByTestId('shell-slot').locator('[data-setting="wall.autoJoin"]')).toBeVisible()
  const before = (await walls(page)).length
  await drawWall(page, [a, b])
  await drawWall(page, [b, c])
  const after = await walls(page)
  expect(after).toHaveLength(before + 1)
  expect(after.at(-1).points).toHaveLength(3)
  await page.getByTestId('shell-top-actions').getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await walls(page)).at(-1).points.length).toBe(2)
})

// Item 6: with Auto-join off, two walls touch; picking both shows "2 walls" and Merge on the
// card and the bar; Merge leaves one wall with the first id; undo restores both.
test('merge: two touching walls picked merge into one, and undo restores both', { tag: '@design' }, async ({ page }) => {
  await openWalls(page)
  await page.getByTestId('shell-slot').locator('[data-setting="wall.autoJoin"]').getByRole('switch').click()
  const before = (await walls(page)).length
  await drawWall(page, [a, b])
  await drawWall(page, [b, c])
  const drawn = (await walls(page)).slice(-2)
  expect(drawn).toHaveLength(2)
  expect((await walls(page)).length).toBe(before + 2)

  await page.getByTestId('shell-rail').getByRole('button', { name: 'Select' }).click()
  await page.evaluate((ids) => (window as Any).__store.getState().setSelectedIds(ids), drawn.map((w: Any) => w.id))
  const card = page.getByTestId('shell-card')
  await expect(card).toContainText('2 walls')
  await expect(page.getByTestId('shell-floating-actions').getByRole('button', { name: 'Merge into one wall' })).toBeVisible()
  await card.getByRole('button', { name: 'Merge into one wall' }).click()
  await waitFrame(page, 4)
  const merged = await walls(page)
  expect(merged).toHaveLength(before + 1)
  expect(merged.find((w: Any) => w.id === drawn[0].id).points).toHaveLength(3)

  await page.getByTestId('shell-top-actions').getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await walls(page)).length).toBe(before + 2)
})
