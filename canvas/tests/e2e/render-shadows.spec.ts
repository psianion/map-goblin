import { test, expect } from '@playwright/test'
import { drawRect, gotoApp, shapeCount, waitFrame } from './helpers'
import { pickTool } from './shell'

test.describe('shadow render', () => {
  test('decorative shadow renders without crash', { tag: '@render' }, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await gotoApp(page)
    await pickTool(page, 'rectangle')
    const canvas = page.locator('canvas').first()
    const box = await canvas.boundingBox()
    const cx = box!.x + box!.width / 2
    const cy = box!.y + box!.height / 2

    const before = await shapeCount(page)
    await drawRect(page, cx - 100, cy - 80, cx + 100, cy + 80)
    await page.waitForTimeout(800)
    await waitFrame(page, 5)

    expect(await shapeCount(page)).toBe(before + 1)
    await expect(canvas).toBeVisible()
    expect(errors).toEqual([])
  })
})
