import { test, expect, type Page } from '@playwright/test'
import { drawRect, waitFrame } from './helpers'
import { dockColumns, openNext, pickFromFlyout, shot } from './nextShell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

/** Rooms and labels on every dungeon layer, and the newest of each. */
const counts = (page: Page) =>
  page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const dungeons = st.layers.filter((l: Any) => l.type === 'dungeon')
    const rooms = dungeons.flatMap((l: Any) => l.rooms ?? [])
    const labels = dungeons.flatMap((l: Any) => l.children.filter((c: Any) => c.childType === 'text'))
    const floors = dungeons.flatMap((l: Any) => l.children.filter((c: Any) => c.childType === 'shape'))
    const walls = dungeons.reduce((n: number, l: Any) => n + (l.standaloneWalls?.length ?? 0), 0)
    return { rooms: rooms.length as number, labels: labels.length as number, lastLabel: labels.at(-1) ?? null, lastFloor: floors.at(-1) ?? null, walls }
  })

// The Text family on /next: a room drawn with a texture from the strip and Walls set to
// None in the panel; a label placed in a style and typed; undo takes both back.
test('text: a room with the texture strip and a panel setting, a styled label, undo', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openNext(page)
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    st.setActiveLayerId(st.layers.find((l: Any) => l.type === 'dungeon' && !l.locked).id)
  })

  await pickFromFlyout(page, 'Text', 'Rectangle room')
  expect(await dockColumns(page)).toEqual(['level', 'layers', 'look'])
  const dock = page.getByTestId('shell-dock')
  const panel = page.getByTestId('shell-tool-panel')
  await expect(panel.getByRole('button', { name: 'Suggest rooms' })).toBeVisible()

  // A dock control: the texture the room's floor lands in. A panel setting: no walls.
  const tiles = dock.locator('[data-column="look"] [data-composite="tile"]')
  const texture = tiles.nth(1)
  await texture.click()
  const picked = await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    return st.layers.find((l: Any) => l.id === st.ui.activeLayerId).style.defaultTextureId as string
  })
  await panel.getByRole('button', { name: 'None', exact: true }).click()
  expect(await page.evaluate(() => (window as Any).__store.getState().ui.roomWalls)).toBe('none')

  const before = await counts(page)
  await drawRect(page, 1180, 180, 1300, 280)
  await waitFrame(page, 4)
  const drawn = await counts(page)
  expect(drawn.rooms).toBe(before.rooms + 1)
  expect(drawn.walls).toBe(before.walls)
  expect(drawn.lastFloor?.textureId).toBe(picked)

  // A label in the GM note style, typed in the card.
  await page.getByTestId('shell-tool-panel').getByRole('button', { name: 'Label' }).click()
  expect(await dockColumns(page)).toEqual(['level', 'layers', 'Size', 'Colour', 'styles'])
  await dock.getByRole('button', { name: 'GM note' }).click()
  expect(await page.evaluate(() => (window as Any).__store.getState().tools.settings.label.style)).toBe('gm-note')
  await dock.getByRole('button', { name: 'Increase Size' }).click()
  await page.mouse.click(560, 460)
  await waitFrame(page, 4)
  const text = page.getByTestId('label-text')
  await expect(text).toBeFocused()
  await page.keyboard.type('Trap door')
  await page.keyboard.press('Enter')
  const placed = await counts(page)
  expect(placed.labels).toBe(drawn.labels + 1)
  expect(placed.lastLabel).toMatchObject({ style: 'gm-note', text: 'Trap door', backdrop: 'pill' })
  await page.mouse.move(1390, 700)
  await shot(page, '14-text')

  // Undo: the label with its first text (one step, as a fresh label is), then the room.
  const undo = page.getByTestId('shell-top-actions').getByRole('button', { name: 'Undo' })
  await undo.click()
  await expect.poll(async () => (await counts(page)).labels).toBe(drawn.labels)
  await undo.click()
  await expect.poll(async () => (await counts(page)).rooms).toBe(before.rooms)
  expect(errors).toEqual([])
})
