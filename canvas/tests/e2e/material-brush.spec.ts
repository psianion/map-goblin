import { test, expect } from '@playwright/test'
import { gotoApp, waitFrame } from './helpers'
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

  expect(await dockColumns(page)).toEqual(['level', 'layers', 'family', 'setup', 'Size', 'materials'])
  const swatch = page.getByTestId('terrain-materials').getByRole('button', { name: 'Cave ink' })
  await expect(swatch).toBeVisible()
  const panel = page.getByTestId('shell-tool-panel')
  for (const id of ['terrain.mode', 'material.smooth', 'material.border', 'material.floor']) {
    await expect(panel.locator(`[data-setting="${id}"]`)).toBeVisible()
  }
  await expect(page.getByTestId('shell-status-hint')).toContainText('Paint a cave floor')
  // Paint a real floor off: these strokes are paint-only patches.
  await panel.locator('[data-setting="material.floor"]').getByRole('switch').click()
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

// Paint a real floor (on by default): the strokes land as one cave floor pinned to the
// material's band, no patch, and Suggest rooms proposes a room for it.
test('material brush: a painted cave is a real floor that Suggest rooms proposes a room for', { tag: '@terrain' }, async ({ page }) => {
  await gotoApp(page)
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    st.setActiveLayerId(st.layers.find((l: Any) => l.type === 'dungeon').id)
  })
  await pickFromFlyout(page, 'Terrain', 'Material brush')
  await waitFrame(page, 4)
  await expect(page.getByTestId('shell-tool-panel').locator('[data-setting="material.floor"]').getByRole('switch')).toHaveAttribute('aria-checked', 'true')

  // Two overlapping strokes: one floor, not two.
  for (const [a, b] of [[[560, 400], [760, 420]], [[740, 420], [820, 520]]]) {
    await page.mouse.move(a[0], a[1])
    await page.mouse.down()
    await page.mouse.move(b[0], b[1], { steps: 12 })
    await page.mouse.up()
    await waitFrame(page, 6)
  }
  const layer = () =>
    page.evaluate(() => {
      const s = (window as Any).__store.getState()
      const l = s.layers.find((x: Any) => x.id === s.ui.activeLayerId)
      return {
        floors: l.children.filter((c: Any) => c.childType === 'shape').map((c: Any) => ({ name: c.name, edge: c.edgeMaterial })),
        patches: (l.materials ?? []).length,
        rings: (l.mergedFloor ?? []).length,
      }
    })
  await expect.poll(async () => (await layer()).rings).toBe(1)
  expect(await layer()).toMatchObject({ floors: [{ name: 'Cave 1', edge: 'GG_Cave_Ink' }], patches: 0 })

  // Suggest rooms sees the cave.
  await pickFromFlyout(page, 'Text', 'Rooms')
  const suggest = page.getByTestId('rooms-suggest')
  await suggest.getByRole('button', { name: 'Suggest rooms' }).click()
  await expect(suggest).toContainText('1 room suggested')
  await suggest.getByRole('button', { name: 'Accept all' }).click()
  expect(await page.evaluate(() => {
    const s = (window as Any).__store.getState()
    return s.layers.find((x: Any) => x.id === s.ui.activeLayerId).rooms?.length ?? 0
  })).toBe(1)
})

// A cave painted on top of a floor owns its edge: its rock is laid along its own outline
// (the materials sublayer), though no union ring runs there, and Suggest rooms proposes it.
test('material brush: a cave painted on top of a rectangle floor keeps its border and is proposed as a room', { tag: '@terrain' }, async ({ page }) => {
  await gotoApp(page)
  // A big rectangle floor under the whole view.
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const l = st.layers.find((x: Any) => x.type === 'dungeon')
    st.setActiveLayerId(l.id)
    st.addChild(l.id, {
      id: 'base', name: 'Base', childType: 'shape', visible: true, shapeType: 'rectangle',
      contours: [[[-60, -60], [60, -60], [60, 60], [-60, 60]]],
      textureScale: 1, textureOffsetX: 0, textureOffsetY: 0, textureFillRotation: 0, textureTint: '#ffffff',
    })
  })
  await pickFromFlyout(page, 'Terrain', 'Material brush')
  await waitFrame(page, 4)
  await page.mouse.move(560, 400)
  await page.mouse.down()
  await page.mouse.move(760, 440, { steps: 12 })
  await page.mouse.up()
  await waitFrame(page, 8)

  const state = () =>
    page.evaluate(() => {
      const s = (window as Any).__store.getState()
      const l = s.layers.find((x: Any) => x.id === s.ui.activeLayerId)
      const find = (node: Any, label: string): Any =>
        node.label === label ? node : (node.children ?? []).map((c: Any) => find(c, label)).find(Boolean)
      const rock = find((window as Any).__pixiApp.stage, 'cave-GG_Cave_Ink')
      return {
        caves: l.children.filter((c: Any) => c.childType === 'shape' && c.edgeMaterial === 'GG_Cave_Ink').length,
        // Border units are plain sprites; the strip under them is drawn, not a texture.
        sprites: (rock?.children ?? []).filter((c: Any) => c.texture && !c.tilePosition).length,
      }
    })
  await expect.poll(async () => (await state()).caves).toBe(1)
  await expect.poll(async () => (await state()).sprites, { message: 'the cave’s rock is laid round it' }).toBeGreaterThan(4)

  await pickFromFlyout(page, 'Text', 'Rooms')
  const suggest = page.getByTestId('rooms-suggest')
  await suggest.getByRole('button', { name: 'Suggest rooms' }).click()
  // The cave, and the rest of the floor round it.
  await expect(suggest).toContainText('rooms suggested')
  const proposals = await page.evaluate(() => (window as Any).__store.getState().ui.roomSuggestions?.rooms.length ?? 0)
  expect(proposals).toBeGreaterThanOrEqual(2)
})
