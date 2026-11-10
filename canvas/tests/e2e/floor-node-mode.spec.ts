import { test, expect, type Page } from '@playwright/test'
import { drawRect, firePointer, waitFrame } from './helpers'
import { openEditor, pickFromFlyout } from './shell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

/** A floor's outer ring, read off the store. */
const ring = (page: Page, id: string) =>
  page.evaluate((fid) => {
    const st = (window as Any).__store.getState()
    for (const l of st.layers) {
      const c = l.type === 'dungeon' ? l.children.find((x: Any) => x.id === fid) : null
      if (c) return c.contours[0] as [number, number][]
    }
    return null
  }, id)

/** A world point as a client point on the canvas. */
const toScreen = (page: Page, x: number, y: number) =>
  page.evaluate(([wx, wy]) => {
    const app = (window as Any).__pixiApp
    const r = app.canvas.getBoundingClientRect()
    // The camera is the world container's transform, not the stage's.
    const world = app.stage.children[0]
    return { x: r.left + wx * world.scale.x + world.position.x, y: r.top + wy * world.scale.y + world.position.y }
  }, [x, y])

// Item 4: draw a floor, open node mode from its card, drag the top edge's midpoint up so it
// becomes a fifth node, read Nodes 5 on the card, undo back to four.
test('node mode: dragging a midpoint inserts a node in one undo step', { tag: '@design' }, async ({ page }) => {
  await openEditor(page)
  // On an empty layer of its own: drawn over the warren's floor, the rectangle would join its
  // outline, which node mode edits as one ring.
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const l = structuredClone(st.layers.find((x: Any) => x.type === 'dungeon'))
    l.id = crypto.randomUUID(); l.name = 'Nodes'; l.children = []; l.standaloneWalls = []; l.mergedFloor = null
    delete l.rooms; delete l.areas; delete l.thresholds; delete l.floorWallEdits; delete l.groups
    st.addLayer(l)
    st.setActiveLayerId(l.id)
  })
  await pickFromFlyout(page, 'Design', 'Floor')
  await drawRect(page, 400, 300, 640, 540)
  const id = await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const layer = st.layers.find((l: Any) => l.id === st.ui.activeLayerId)
    const shapes = layer.children.filter((c: Any) => c.childType === 'shape')
    const last = shapes[shapes.length - 1]
    st.setActiveTool('select')
    st.setSelectedIds([last.id])
    return last.id as string
  })
  await waitFrame(page, 4)

  const card = page.getByTestId('shell-card')
  await card.getByRole('button', { name: 'Node mode' }).click()
  await expect(card.getByRole('button', { name: 'Node mode' })).toHaveAttribute('aria-pressed', 'true')
  await expect(card.locator('[data-setting="card.floor.nodes"]')).toContainText('4')
  await expect(page.getByTestId('shell-status-hint')).toContainText('drag a midpoint to add')

  const before = (await ring(page, id))!
  expect(before).toHaveLength(4)
  const [a, b] = [before[0], before[1]]
  const mid = await toScreen(page, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
  await firePointer(page, 'pointerdown', mid.x, mid.y, 0.5, 1)
  await firePointer(page, 'pointermove', mid.x, mid.y - 40, 0.5, 1)
  await firePointer(page, 'pointerup', mid.x, mid.y - 40, 0, 0)
  await waitFrame(page, 4)
  expect(await ring(page, id)).toHaveLength(5)
  await expect(card.locator('[data-setting="card.floor.nodes"]')).toContainText('5')

  await page.getByTestId('shell-top-actions').getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await ring(page, id))?.length).toBe(4)
})
