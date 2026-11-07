import { test, expect, type Page } from '@playwright/test'
import { getPixelColor, waitFrame } from './helpers'
import { openEditor, pickFromFlyout } from './shell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

/** The canvas colour at a world point. */
async function rgbAt(page: Page, wx: number, wy: number): Promise<{ r: number; g: number; b: number }> {
  const at = await page.evaluate(([x, y]) => {
    const app = (window as Any).__pixiApp
    const stage = app.stage
    return { x: x * stage.scale.x + stage.position.x, y: y * stage.scale.y + stage.position.y }
  }, [wx, wy])
  const c = await getPixelColor(page, at.x, at.y)
  return { r: c.r, g: c.g, b: c.b }
}

const lum = (c: { r: number; g: number; b: number }) => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b

// Item 2: a floor at 50% opacity lets the ground under it show through; its card's Opacity
// row is what sets it, the Edge band row sits under Edge, and undo puts it back.
test('floor opacity: 50% on the card shows the ground through the floor, and undo restores it', { tag: '@design' }, async ({ page }) => {
  await openEditor(page)
  await pickFromFlyout(page, 'Design', 'Floor')
  await page.getByTestId('shell-rail').getByRole('button', { name: 'Select' }).click()

  const picked = await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    for (const l of st.layers) {
      if (l.type !== 'dungeon' || l.locked) continue
      const shape = l.children.find((c: Any) => c.childType === 'shape' && c.visible !== false && !c.locked)
      if (shape) {
        st.setActiveLayerId(l.id)
        st.setSelectedIds([shape.id])
        const [x, y] = shape.contours[0][0]
        const [x2, y2] = shape.contours[0][2]
        return { id: shape.id as string, cx: (x + x2) / 2, cy: (y + y2) / 2 }
      }
    }
    return null
  })
  expect(picked).not.toBeNull()
  await waitFrame(page, 4)

  const card = page.getByTestId('shell-card')
  await expect(card.locator('[data-setting="card.floor.edgeBand"]')).toBeVisible()
  const before = await rgbAt(page, picked!.cx, picked!.cy)

  const slider = card.locator('[data-setting="card.floor.opacity"]').getByRole('slider')
  await slider.focus()
  // 100% down to 50% in 5% steps.
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowLeft')
  await expect(card.locator('[data-setting="card.floor.opacity"]')).toContainText('50%')
  const opacity = await page.evaluate((id) => {
    const st = (window as Any).__store.getState()
    for (const l of st.layers) {
      const c = l.type === 'dungeon' ? l.children.find((x: Any) => x.id === id) : null
      if (c) return c.opacity
    }
    return null
  }, picked!.id)
  expect(opacity).toBe(0.5)
  await waitFrame(page, 6)
  const half = await rgbAt(page, picked!.cx, picked!.cy)
  expect(Math.abs(lum(half) - lum(before)), 'the ground shows through a 50% floor').toBeGreaterThan(8)

  await page.getByTestId('shell-top-actions').getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => Math.abs(lum(await rgbAt(page, picked!.cx, picked!.cy)) - lum(before))).toBeLessThan(3)
})
