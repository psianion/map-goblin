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

/** The warren's rooms in list order (by number), and a room's key. */
const roomOrder = (page: Page) =>
  page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const layer = st.layers.find((l: Any) => l.type === 'dungeon' && (l.rooms?.length ?? 0) > 1)
    return [...layer.rooms].sort((a: Any, b: Any) => (a.number ?? 0) - (b.number ?? 0)).map((r: Any) => r.id as string)
  })
const readAloud = (page: Page, roomId: string) =>
  page.evaluate((id) => {
    const prep = (window as Any).__store.getState().prep
    return (prep?.rooms ?? []).find((k: Any) => k.roomId === id)?.readAloud ?? ''
  }, roomId)

// The Text family's sheets: a room's key opened from its card and written, then the Rooms
// list behind it with two rooms reordered by dragging, each undone; a zone's sheet from More
// on its card, a trigger added, and the zone renamed there and undone (triggers are prep,
// outside the undo stack).
test('text: the rooms list keys and reorders rooms, the zone sheet adds a trigger, undo', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openNext(page)
  const undo = page.getByTestId('shell-top-actions').getByRole('button', { name: 'Undo' })
  const order = await roomOrder(page)
  expect(order.length).toBeGreaterThan(2)

  // The room's card opens its key in the Rooms sheet; the read-aloud writes on leaving the field.
  await page.evaluate((id) => (window as Any).__store.getState().setSelectedIds([id]), order[0])
  await page.getByRole('button', { name: 'Open room key' }).click()
  const sheet = page.getByTestId('shell-rooms-sheet')
  await expect(sheet.getByTestId('room-key-editor')).toBeVisible()
  const field = sheet.getByRole('textbox', { name: 'Read-aloud' })
  await field.fill('Spores hang in the air.')
  await field.blur()
  await expect.poll(() => readAloud(page, order[0])).toBe('Spores hang in the air.')
  await undo.click()
  await expect.poll(() => readAloud(page, order[0])).toBe('')
  await expect(field).toHaveValue('')

  // Back to the list: every room on the level, in number order.
  await sheet.getByRole('button', { name: 'Back to rooms' }).click()
  const rows = sheet.getByTestId('rooms-row')
  await expect(rows).toHaveCount(order.length)

  // Drag the first row below the second: a pointer drag, the second row's lower half.
  const first = await rows.nth(0).boundingBox()
  const second = await rows.nth(1).boundingBox()
  await page.mouse.move(first!.x + 60, first!.y + first!.height / 2)
  await page.mouse.down()
  await page.mouse.move(first!.x + 60, first!.y + first!.height / 2 + 8, { steps: 2 })
  await page.mouse.move(second!.x + 60, second!.y + second!.height * 0.8, { steps: 4 })
  await page.mouse.up()
  await expect.poll(() => roomOrder(page)).toEqual([order[1], order[0], ...order.slice(2)])
  await expect(rows.nth(0)).toHaveAttribute('data-room-id', order[1])
  await page.mouse.move(700, 900)
  await shot(page, '14b-rooms-sheet')
  await undo.click()
  await expect.poll(() => roomOrder(page)).toEqual(order)
  await expect(rows.nth(0)).toHaveAttribute('data-room-id', order[0])
  await sheet.getByRole('button', { name: 'Close Rooms' }).click()
  await expect(sheet).toHaveCount(0)

  // The zone's sheet from More on its card: add a trigger, rename the zone, undo the name.
  const zone = await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const z = st.layers.flatMap((l: Any) => l.children ?? []).find((c: Any) => c.childType === 'zone')
    st.setSelectedIds([z.id])
    return { id: z.id as string, name: z.name as string }
  })
  await page.getByRole('button', { name: 'More…' }).click()
  const zoneSheet = page.getByTestId('shell-zone-sheet')
  await expect(zoneSheet).toBeVisible()
  await zoneSheet.getByRole('button', { name: 'Add trigger' }).click()
  const trigger = zoneSheet.getByTestId('zone-trigger')
  await expect(trigger).toHaveCount(1)
  await expect(trigger.getByRole('textbox', { name: 'Trigger name' })).toBeVisible()
  expect(
    await page.evaluate((id) => {
      const prep = (window as Any).__store.getState().prep
      return (prep?.triggers ?? []).filter((t: Any) => t.when.zoneId === id).length
    }, zone.id),
  ).toBe(1)
  await page.mouse.move(700, 900)
  await shot(page, '14b-zone-sheet')

  const name = zoneSheet.getByRole('textbox', { name: 'Zone name' })
  await name.fill('Ore seam')
  await name.press('Enter')
  const zoneName = () =>
    page.evaluate((id) => (window as Any).__store.getState().layers.flatMap((l: Any) => l.children ?? []).find((c: Any) => c.id === id).name, zone.id)
  await expect.poll(zoneName).toBe('Ore seam')
  await undo.click()
  await expect.poll(zoneName).toBe(zone.name)
  await expect(name).toHaveValue(zone.name)
  expect(errors).toEqual([])
})
