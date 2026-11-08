import { test, expect } from '@playwright/test'
import { waitFrame } from './helpers'
import { dockColumns, openEditor, pickFromFlyout, shot } from './shell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

// The Material brush: a stroke closes into one patch of cave ink on the layer in hand, and on
// release the band's border units are laid round it; Border off takes them away on the next
// patch; undo takes the patches back.
test('material brush: paint a patch, its border is drawn', { tag: '@terrain' }, async ({ page }) => {
  await openEditor(page)
  await pickFromFlyout(page, 'Terrain', 'Material brush')
  await waitFrame(page, 4)

  expect(await dockColumns(page)).toEqual(['level', 'layers', 'Size', 'materials'])
  const swatch = page.getByTestId('terrain-materials').getByRole('button', { name: 'Cave ink' })
  await expect(swatch).toBeVisible()
  const panel = page.getByTestId('shell-tool-panel')
  for (const id of ['terrain.mode', 'material.smooth', 'material.border']) {
    await expect(panel.locator(`[data-setting="${id}"]`)).toBeVisible()
  }
  await expect(page.getByTestId('shell-status-hint')).toContainText('Paint a patch')

  await page.mouse.move(560, 400)
  await page.mouse.down()
  await page.mouse.move(720, 440, { steps: 12 })
  await page.mouse.up()
  await page.mouse.move(1390, 700)
  await waitFrame(page, 12)

  /** The patches on the layer in hand, and how many border sprites each has drawn. */
  const drawn = () =>
    page.evaluate(() => {
      const s = (window as Any).__store.getState()
      const layer = s.layers.find((l: Any) => l.id === s.ui.activeLayerId)
      const find = (node: Any, label: string): Any =>
        node.label === label ? node : (node.children ?? []).map((c: Any) => find(c, label)).find(Boolean)
      return (layer.materials ?? []).map((p: Any) => {
        const piece = find((window as Any).__pixiApp.stage, `material-${p.id}`)
        // Border units are plain sprites; the fill is a tiling sprite, which has a tile position.
        const sprites = (piece?.children ?? []).filter((c: Any) => c.texture && !c.tilePosition).length
        return { material: p.material, border: p.border, sprites }
      })
    })
  await expect.poll(async () => (await drawn())[0]?.sprites ?? 0, { message: 'the border units are laid' }).toBeGreaterThan(4)
  expect((await drawn())[0]).toMatchObject({ material: 'GG_Cave_Ink', border: true })
  await shot(page, '13-material')

  // Border off: the next patch, well away from the first, has none.
  await panel.locator('[data-setting="material.border"]').getByRole('switch').click()
  await page.mouse.move(1000, 220)
  await page.mouse.down()
  await page.mouse.move(1060, 220, { steps: 6 })
  await page.mouse.up()
  await waitFrame(page, 8)
  const two = await drawn()
  expect(two).toHaveLength(2)
  expect(two[1]).toMatchObject({ border: false, sprites: 0 })

  const undo = page.getByTestId('shell-top-actions').getByRole('button', { name: 'Undo' })
  await undo.click()
  await undo.click()
  await expect.poll(async () => (await drawn()).length).toBe(0)
})
