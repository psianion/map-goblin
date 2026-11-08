import { test, expect, type Page } from '@playwright/test'
import { waitFrame } from './helpers'
import { dockColumns, openEditor, pickFromFlyout, shot } from './shell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

/** The paths on the layer in hand, and how many unit sprites each has drawn. */
const drawn = (page: Page) =>
  page.evaluate(() => {
    const s = (window as Any).__store.getState()
    const layer = s.layers.find((l: Any) => l.id === s.ui.activeLayerId)
    const find = (node: Any, label: string): Any =>
      node.label === label ? node : (node.children ?? []).map((c: Any) => find(c, label)).find(Boolean)
    return layer.children
      .filter((c: Any) => c.childType === 'pathway')
      .map((p: Any) => {
        const piece = find((window as Any).__pixiApp.stage, `path-${p.id}`)
        const units = piece?.children ?? []
        return { id: p.id, nodes: p.contours[0].length, width: p.width, units: units.length, scale: Math.abs(units[0]?.scale?.y ?? 0) }
      })
  })

// The Path tool: three clicks and Enter lay a path of units along the line; its card changes
// the width after placing, which lays fewer, larger units; undo puts the width back.
test('path: draw a path with three nodes, then change its width', { tag: '@terrain' }, async ({ page }) => {
  await openEditor(page)
  await pickFromFlyout(page, 'Terrain', 'Path')
  await waitFrame(page, 4)

  expect(await dockColumns(page)).toEqual(['level', 'layers', 'Width', 'Smoothness', 'Edit', 'pieces'])
  await expect(page.getByTestId('terrain-path-pieces').getByRole('button', { name: 'Fieldstone' })).toBeVisible()
  const panel = page.getByTestId('shell-tool-panel')
  for (const id of ['path.transitionIn', 'path.transitionOut', 'grid.snap', 'path.blocksLight']) {
    await expect(panel.locator(`[data-setting="${id}"]`)).toBeVisible()
  }
  await expect(page.getByTestId('shell-status-hint')).toContainText('Click points')

  for (const [x, y] of [[480, 360], [760, 360], [860, 520]] as const) await page.mouse.click(x, y)
  await page.keyboard.press('Enter')
  await waitFrame(page, 10)
  await expect.poll(async () => (await drawn(page))[0]?.units ?? 0, { message: 'units are laid along the line' }).toBeGreaterThan(1)
  const before = (await drawn(page))[0]
  expect(before.nodes).toBe(3)
  await shot(page, '14-path')

  // Pick it and widen it on its card.
  await page.keyboard.press('v')
  await page.mouse.click(620, 360)
  const card = page.getByTestId('shell-tool-panel')
  await expect(card.locator('[data-setting="card.path.width"]')).toBeVisible()
  await card.locator('[data-setting="card.path.width"]').getByRole('button', { name: /increase|\+/i }).click()
  await card.locator('[data-setting="card.path.width"]').getByRole('button', { name: /increase|\+/i }).click()
  await waitFrame(page, 8)
  const after = (await drawn(page))[0]
  expect(after.width).toBe(before.width + 0.5)
  expect(after.scale, 'the units scale with the width').toBeGreaterThan(before.scale)
  expect(after.units, 'larger units: no more of them than before').toBeLessThanOrEqual(before.units)

  const undo = page.getByTestId('shell-top-actions').getByRole('button', { name: 'Undo' })
  await undo.click()
  await undo.click()
  await expect.poll(async () => (await drawn(page))[0]?.width).toBe(before.width)
})
