import { test, expect, type Page } from '@playwright/test'
import { drawRect, waitFrame } from './helpers'
import { box, dockColumns, expectFrameGeometry, expectSlot, openEditor, pickFromFlyout, shot } from './shell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const tools = (page: Page) =>
  page.evaluate(() => {
    const t = (window as Any).__store.getState().tools
    return { active: t.activeTool as string, sides: t.settings.regularPolygon.sides as number }
  })

/** Floors on every dungeon layer, and whether the active layer blends its floors' edges. */
const map = (page: Page) =>
  page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const floors = st.layers
      .filter((l: Any) => l.type === 'dungeon')
      .reduce((n: number, l: Any) => n + l.children.filter((c: Any) => c.childType === 'shape').length, 0)
    const active = st.layers.find((l: Any) => l.id === st.ui.activeLayerId)
    return { floors: floors as number, blend: active?.style?.showEdgeTransitions as boolean }
  })

async function frameB(page: Page) {
  await pickFromFlyout(page, 'Design', 'Floor')
  await expect(page.getByTestId('shell-tool-panel')).toBeVisible()
  await expect(page.getByTestId('shell-flyout')).toBeHidden()
  // Polygon, as the frame is drawn.
  await page.getByTestId('shell-dock').getByRole('button', { name: 'Polygon', exact: true }).click()
  expect((await tools(page)).active).toBe('polygon')
}

// Frame B (plan 5.2) with the real Design family: the Floor tool's panel in the slot, its
// dock columns, and a floor drawn, a dock control and a panel setting changed, undone.
test('frame B: the Floor tool draws, its dock and panel settings act, undo takes them back', { tag: '@shell' }, async ({ page }) => {
  await openEditor(page)
  await frameB(page)
  const panel = page.getByTestId('shell-tool-panel')
  const dock = page.getByTestId('shell-dock')

  const header = panel.locator('[data-composite="panel-header"]')
  await expect(header).toContainText('Design / Floor')
  await expect(header.getByRole('button')).toHaveCount(4)
  await expect(header.getByRole('button', { name: 'Floor' })).toHaveAttribute('aria-pressed', 'true')

  // Setup only. No Mode until Carve out lands, no Defaults until floor opacity renders.
  const captions = await panel.locator('[data-section]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.section))
  expect(captions).toEqual(['Placement', 'Edge'])
  await expect(panel.getByText('Snap to grid')).toBeVisible()
  await expect(panel.getByText('Blend with neighbours')).toBeVisible()
  // Nothing in both, and the floor tools no longer carry the wall width.
  await expect(panel.locator('[data-setting="floor.shape"], [data-setting="edit.nodeMode"], [data-setting="wall.width"]')).toHaveCount(0)
  await expect(dock.locator('[data-setting="wall.width"], [data-setting="grid.snap"]')).toHaveCount(0)

  expect(await dockColumns(page)).toEqual(['level', 'layers', 'Shape', 'Edit', 'look'])
  const look = dock.locator('[data-column="look"]')
  await expect(look.getByRole('button', { name: 'Colour' })).toBeVisible()
  await expect(look.getByRole('button', { name: /^Style presets/ })).toBeVisible()
  await expect(look.getByRole('button', { name: 'From library' })).toBeVisible()

  const hint = page.getByTestId('shell-status-hint')
  await expect(hint).toContainText('Click points')
  await expect(hint.locator('kbd')).toHaveText(['Enter', 'Shift', 'Esc'])

  await expectFrameGeometry(page)
  await expectSlot(page)
  await shot(page, '10-b')

  // Draw a floor with the rectangle, on the first dungeon layer that takes edits.
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const l = st.layers.find((x: Any) => x.type === 'dungeon' && !x.locked && x.visible !== false)
    st.setActiveLayerId(l.id)
  })
  await dock.getByRole('button', { name: 'Rectangle', exact: true }).click()
  await expect(hint.locator('kbd')).toHaveText(['Shift', 'Esc'])
  const before = await map(page)
  await drawRect(page, 1120, 220, 1240, 320)
  await waitFrame(page, 4)
  expect((await map(page)).floors).toBe(before.floors + 1)

  // A dock control: Sides shows for Regular only and steps from 6; the dock keeps its height.
  await expect(dock.locator('[data-setting="floor.sides"]')).toHaveCount(0)
  await dock.getByRole('button', { name: 'Regular polygon' }).click()
  expect((await tools(page)).active).toBe('regularPolygon')
  await expect(dock.locator('[data-setting="floor.sides"]')).toHaveCount(1)
  await dock.getByRole('button', { name: 'Increase Sides' }).click()
  expect((await tools(page)).sides).toBe(7)
  expect((await box(dock)).height).toBe(112)

  // A panel setting: Blend with neighbours is the layer's own switch, so it undoes.
  expect(before.blend).toBe(true)
  await panel.locator('[data-setting="floor.blend"]').getByRole('switch').click()
  expect((await map(page)).blend).toBe(false)

  // Undo takes back the switch, then the floor.
  await page.getByTestId('shell-top-actions').getByRole('button', { name: 'Undo' }).click()
  expect((await map(page)).blend).toBe(true)
  await page.getByTestId('shell-top-actions').getByRole('button', { name: 'Undo' }).click()
  await waitFrame(page, 2)
  expect((await map(page)).floors).toBe(before.floors)

  // The panel stays open; the switcher changes tool without the flyout.
  await panel.getByRole('button', { name: 'Wall' }).click()
  expect((await tools(page)).active).toBe('wall')
  await expect(page.getByTestId('shell-tool-panel')).toHaveAttribute('data-tool', 'wall')
  expect(await dockColumns(page)).toEqual(['level', 'layers', 'Type', 'Width', 'Edit', 'look'])
})

test('frame B in the dark theme', { tag: '@shell' }, async ({ page }) => {
  await openEditor(page, 'dark')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await frameB(page)
  await expectFrameGeometry(page)
})
