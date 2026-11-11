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

  expect(await dockColumns(page)).toEqual(['level', 'layers', 'family', 'Size', 'materials'])
  const swatch = page.getByTestId('terrain-materials').getByRole('button', { name: 'Cave ink' })
  await expect(swatch).toBeVisible()
  const panel = page.getByTestId('shell-tool-panel')
  for (const id of ['terrain.mode', 'material.smooth', 'material.border', 'material.wall']) {
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

// Edge is a wall (on by default): the patch's outline blocks light and sight, and a door
// clicked onto its edge hangs there and opens it.
test('material brush: a patch whose edge is a wall takes a door on it', { tag: '@terrain' }, async ({ page }) => {
  await openEditor(page)
  await pickFromFlyout(page, 'Terrain', 'Material brush')
  await waitFrame(page, 4)
  await expect(page.getByTestId('shell-tool-panel').locator('[data-setting="material.wall"]').getByRole('switch')).toHaveAttribute('aria-checked', 'true')

  await page.mouse.move(560, 400)
  await page.mouse.down()
  await page.mouse.move(760, 400, { steps: 12 })
  await page.mouse.up()
  await waitFrame(page, 8)

  // The patch carries the flag; its middle and the top of its outline, in world cells.
  const first = await page.evaluate(() => {
    const s = (window as Any).__store.getState()
    const p = s.layers.find((l: Any) => l.id === s.ui.activeLayerId).materials[0]
    const xs = p.rings[0].map((q: number[]) => q[0])
    const ys = p.rings[0].map((q: number[]) => q[1])
    return { wall: p.wall, mid: [(Math.min(...xs) + Math.max(...xs)) / 2, 0], top: Math.min(...ys) }
  })
  expect(first.wall).toBe(true)

  // A door clicked on the patch's top edge hangs on it as a wall door (light and sight through
  // the edge are covered by the unit tests): it keeps no wall id and stands on no piece.
  await pickFromFlyout(page, 'Design', 'Door')
  await page.evaluate(() => (window as Any).__store.getState().setSnapEnabled(false))
  const at = await page.evaluate((p) => {
    const w = window as Any
    const r = w.__pixiApp.canvas.getBoundingClientRect()
    const wd = w.__pixiApp.stage.children[0]
    return { x: r.left + p[0] * wd.scale.x + wd.position.x, y: r.top + p[1] * wd.scale.x + wd.position.y }
  }, [first.mid[0], first.top])
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  await page.mouse.up()
  await waitFrame(page, 6)
  const door = await page.evaluate(() => {
    const s = (window as Any).__store.getState()
    return s.layers.find((l: Any) => l.id === s.ui.activeLayerId).children.filter((c: Any) => c.childType === 'door').at(-1)
  })
  expect(door).toBeTruthy()
  expect(door.wallId).toBe('')
  expect(door.freestanding).toBeUndefined()
})
