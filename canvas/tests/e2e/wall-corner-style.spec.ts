import { test, expect, type Page } from '@playwright/test'
import { firePointer, getPixelColor, waitFrame } from './helpers'
import { openEditor, pickFromFlyout } from './shell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

type Pt = { x: number; y: number }

/** Open floor in the warren, clear of its edges and of every drawn wall. */
const OPEN_FLOOR: Pt = { x: 34, y: 10 }

async function screenOf(page: Page, p: Pt): Promise<Pt> {
  return page.evaluate(([x, y]) => {
    const w = window as Any
    const r = w.__pixiApp.canvas.getBoundingClientRect()
    const wd = w.__pixiApp.stage.children[0]
    return { x: r.left + x * wd.scale.x + wd.position.x, y: r.top + y * wd.scale.x + wd.position.y }
  }, [p.x, p.y])
}

async function click(page: Page, world: Pt): Promise<void> {
  const at = await screenOf(page, world)
  await firePointer(page, 'pointermove', at.x, at.y)
  await firePointer(page, 'pointerdown', at.x, at.y, 0.5, 1)
  await firePointer(page, 'pointerup', at.x, at.y)
  await waitFrame(page, 3)
}

const lum = (c: { r: number; g: number; b: number }) => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b

/** Luminance just outside the L's turn, on the bisector, where a sharp corner has stone and a rounded one floor. */
async function cornerLum(page: Page, corner: Pt): Promise<number> {
  const at = await screenOf(page, { x: corner.x + 0.2, y: corner.y - 0.2 })
  const c = await getPixelColor(page, at.x, at.y)
  return lum(c)
}

// Item 5: the dock's Corner style switches the pieces at a wall's turns; the corner is
// sampled both ways, and undo puts the first look back.
test('wall corner style: Rounded and Sharp lay different corner pieces, and undo restores', { tag: '@design' }, async ({ page }) => {
  await openEditor(page)
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const l = st.layers.find((x: Any) => x.type === 'dungeon')
    st.setActiveLayerId(l.id)
  })
  await pickFromFlyout(page, 'Design', 'Wall')

  const corner = { x: OPEN_FLOOR.x + 3, y: OPEN_FLOOR.y }
  const floor = await cornerLum(page, corner)
  await click(page, { x: OPEN_FLOOR.x - 3, y: OPEN_FLOOR.y })
  await click(page, corner)
  await click(page, { x: corner.x, y: corner.y + 4 })
  await page.keyboard.press('Enter')
  await waitFrame(page, 4)

  // A stone set, so the turn is laid with authored corner pieces rather than a cave band.
  const id = await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const l = st.layers.find((x: Any) => x.id === st.ui.activeLayerId)
    const w = l.standaloneWalls.at(-1)
    st.updateWall(l.id, w.id, { textureSetId: 'GG_Fieldstone' })
    return w.id as string
  })
  await waitFrame(page, 6)

  const dock = page.getByTestId('shell-dock').locator('[data-setting="wall.cornerStyle"]')
  await expect(dock).toBeVisible()
  // The set's art decodes on first use: wait for the sharp corner's stone to cover the sample.
  await expect.poll(async () => Math.abs((await cornerLum(page, corner)) - floor), { message: 'the sharp corner lays stone' }).toBeGreaterThan(8)
  const sharp = await cornerLum(page, corner)

  await page.evaluate((wallId) => (window as Any).__store.getState().setSelectedIds([wallId]), id)
  await dock.getByText('Rounded').click()
  await waitFrame(page, 6)
  const style = await page.evaluate((wallId) => {
    const st = (window as Any).__store.getState()
    for (const l of st.layers) {
      const w = l.type === 'dungeon' ? l.standaloneWalls.find((x: Any) => x.id === wallId) : null
      if (w) return w.cornerStyle
    }
    return null
  }, id)
  expect(style).toBe('rounded')
  const rounded = await cornerLum(page, corner)
  expect(Math.abs(rounded - sharp), 'the outer corner reads differently rounded').toBeGreaterThan(8)

  await page.getByTestId('shell-top-actions').getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => Math.abs((await cornerLum(page, corner)) - sharp)).toBeLessThan(3)
})
