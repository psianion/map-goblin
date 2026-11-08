import { readFileSync } from 'node:fs'
import { test, expect, type Locator, type Page } from '@playwright/test'
import { drawRect, firePointer, gotoApp, waitForBoot, waitFrame } from './helpers'
import { VIEWPORT, dockColumns, openEditor, pickFromFlyout, pickTool, shot } from './shell'

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

// The Text family: a room drawn with a texture from the strip and Walls set to
// None in the panel; a label placed in a style and typed; undo takes both back.
test('text: a room with the texture strip and a panel setting, a styled label, undo', { tag: '@text' }, async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openEditor(page)
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
test('text: the rooms list keys and reorders rooms, the zone sheet adds a trigger, undo', { tag: '@text' }, async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openEditor(page)
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

// ─── Shared by the label, room and zone tests below ──────────────────────────

type Pt = { x: number; y: number }
type Box = { x: number; y: number; width: number; height: number }

/**
 * Runs `fn` (source text) in the page with the store getter, the active dungeon layer and a
 * world to screen mapping. Source text, so the page needs nothing imported.
 */
async function inPage<T>(page: Page, fn: string, arg?: unknown): Promise<T> {
  return page.evaluate(
    ({ fn, arg }) => {
      const w = window as Any
      const s = () => w.__store.getState()
      const layer = () => s().layers.find((l: Any) => l.id === s().ui.activeLayerId && l.type === 'dungeon')
      const w2s = (x: number, y: number) => {
        const r = w.__pixiApp.canvas.getBoundingClientRect()
        const wd = w.__pixiApp.stage.children[0]
        return { x: r.left + x * wd.scale.x + wd.position.x, y: r.top + y * wd.scale.x + wd.position.y }
      }
      return new Function('s', 'layer', 'w2s', 'arg', `return (${fn})(s, layer, w2s, arg)`)(s, layer, w2s, arg)
    },
    { fn, arg },
  )
}

test.beforeEach(async ({ page }) => {
  // Reads the live WebGL buffer without disturbing the framebuffer the engine draws to.
  await page.addInitScript(() => {
    ;(window as Any).__readCanvas = (read: (gl: WebGL2RenderingContext) => void) => {
      const canvas = (window as Any).__pixiApp.canvas
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
      const gl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext
      const draw = gl.getParameter(gl.FRAMEBUFFER_BINDING)
      const readFb = gl2 ? gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) : null
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      try {
        read(gl)
      } finally {
        gl.bindFramebuffer(gl.FRAMEBUFFER, draw)
        if (gl2) gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFb)
      }
    }
  })
})

const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())

async function key(page: Page, combo: string) {
  await blur(page)
  await page.keyboard.press(combo)
  await waitFrame(page, 2)
}

const undo = (page: Page) => key(page, 'Control+z')

/** A fresh blank map: one level, one layer, Select in hand, chrome held. */
async function openBlank(page: Page): Promise<void> {
  await page.setViewportSize(VIEWPORT)
  await gotoApp(page)
  await inPage(page, `(s) => { s().setFocusMode('manual'); s().setActiveTool('select') }`)
  await waitFrame(page, 6)
}

/** The goblin warren with its rooms measured and its dungeon layer active, Select in hand. */
async function openWarren(page: Page): Promise<void> {
  await openEditor(page)
  await page.waitForFunction(() => {
    const l = (window as Any).__store.getState().layers.find((x: Any) => x.type === 'dungeon')
    return (l?.rooms ?? []).length > 0 && l.rooms.every((r: Any) => Array.isArray(r.face) && r.face.length > 2)
  })
  await inPage(page, `(s) => { const l = s().layers.find((x) => x.type === 'dungeon'); s().setActiveLayerId(l.id) }`)
  await waitFrame(page, 4)
}

const toScreen = (page: Page, p: Pt) => inPage<Pt>(page, `(s, layer, w2s, p) => w2s(p.x, p.y)`, p)
const zoomOf = (page: Page) => inPage<number>(page, `() => window.__pixiApp.stage.children[0].scale.x`)

async function clickWorld(page: Page, p: Pt) {
  const at = await toScreen(page, p)
  await firePointer(page, 'pointermove', at.x, at.y)
  await firePointer(page, 'pointerdown', at.x, at.y, 0.5, 1)
  await firePointer(page, 'pointerup', at.x, at.y)
  await waitFrame(page, 3)
}

/** A canvas-dispatched drag between two world points, in steps so the tool sees travel. */
async function dragWorld(page: Page, a: Pt, b: Pt, steps = 8) {
  const from = await toScreen(page, a)
  const to = await toScreen(page, b)
  await firePointer(page, 'pointermove', from.x, from.y)
  await firePointer(page, 'pointerdown', from.x, from.y, 0.5, 1)
  for (let i = 1; i <= steps; i++) {
    await firePointer(page, 'pointermove', from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps, 0.5, 1)
  }
  await firePointer(page, 'pointerup', to.x, to.y)
  await waitFrame(page, 3)
}

const selectIds = (page: Page, ids: string[]) =>
  page.evaluate((ids) => (window as Any).__store.getState().setSelectedIds(ids), ids)
const sel = (page: Page) => inPage<string[]>(page, `(s) => s().selection.selectedIds`)

const dock = (page: Page) => page.getByTestId('shell-dock')
const card = (page: Page) => page.getByTestId('shell-card')
const status = (page: Page) => page.getByTestId('shell-status')

/** Back to the home page after a reload and into the one map there. */
async function reopenMap(page: Page): Promise<void> {
  await page.reload()
  await waitForBoot(page)
  await page.getByTestId('v2-map-card').first().click()
  await expect(page.getByTestId('shell')).toBeVisible()
}

// ─── Labels ──────────────────────────────────────────────────────────────────

const room = (page: Page, name: string) =>
  inPage<Any>(page, `(s, layer, w2s, n) => layer().rooms.find((r) => r.name === n)`, name)
const labels = (page: Page) =>
  inPage<Any[]>(page, `(s) => s().layers.flatMap((l) => l.type === 'dungeon' ? l.children.filter((c) => c.childType === 'text') : [])`)
const labelById = async (page: Page, id: string) => (await labels(page)).find((c) => c.id === id)
const textField = (page: Page) => page.getByTestId('label-text')
const styleTile = (page: Page, name: string) => dock(page).getByTestId('label-styles').getByRole('button', { name, exact: true })

/** The Label tool in hand, with `style` picked on its tile. */
async function labelTool(page: Page, style?: string) {
  await pickTool(page, 'label')
  await expect(dock(page).getByTestId('label-styles')).toBeVisible()
  if (style) await styleTile(page, style).click()
}

/** Place a label at `p` with the Label tool; its id. */
async function place(page: Page, p: Pt): Promise<string> {
  const before = new Set((await labels(page)).map((c) => c.id))
  await clickWorld(page, p)
  const added = (await labels(page)).filter((c) => !before.has(c.id))
  expect(added).toHaveLength(1)
  return added[0].id
}

const addLabel = (page: Page, child: Record<string, unknown>) =>
  inPage<void>(page, `(s, layer, w2s, c) => { s().addChild(layer().id, c) }`, child)

const label = (id: string, at: Pt, extra: Record<string, unknown> = {}) => ({
  id, name: id, childType: 'text', visible: true, text: 'MMMM', position: at, rotation: 0, scale: 1,
  fontSize: 1.5, color: '#1b1b1b', width: 3.3, height: 1.8, ...extra,
})

const chiefDoor = (page: Page) =>
  inPage<Any>(page, `(s, layer) => layer().children.find((c) => c.name === 'Chief Door')`)

/** The pixels in a box around a world point, from the live drawing buffer. */
async function region(page: Page, world: Pt, half = 30): Promise<number[]> {
  return inPage<number[]>(
    page,
    `(s, layer, w2s, a) => {
      const canvas = window.__pixiApp.canvas
      const r = canvas.getBoundingClientRect()
      const p = w2s(a.world.x, a.world.y)
      const d = devicePixelRatio
      const cx = Math.round((p.x - r.left) * d), cy = Math.round((p.y - r.top) * d), h = Math.round(a.half * d)
      const w = 2 * h, out = new Uint8Array(w * w * 4)
      window.__readCanvas((gl) => gl.readPixels(cx - h, canvas.height - (cy + h), w, w, gl.RGBA, gl.UNSIGNED_BYTE, out))
      return Array.from(out)
    }`,
    { world, half },
  )
}

/** How many pixels differ by more than a little between two reads of the same box. */
function changed(a: number[], b: number[]): number {
  let n = 0
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 60) n++
  }
  return n
}

/** Export a PNG through the dialog with `labelsPick` picked, unlit, 64 px a square; the file's bytes, base64. */
async function exportPng(page: Page, labelsPick: 'None' | 'Players' | 'All'): Promise<string> {
  await key(page, 'Control+e')
  const modal = page.getByTestId('v2-export-modal')
  await expect(modal).toBeVisible()
  await modal.getByRole('button', { name: 'PNG', exact: true }).click()
  await modal.getByRole('button', { name: '64', exact: true }).click()
  const lit = modal.getByRole('switch', { name: 'Apply lighting' })
  if ((await lit.getAttribute('aria-checked')) === 'true') await lit.click()
  await modal.getByRole('group', { name: 'Labels', exact: true }).getByRole('button', { name: labelsPick, exact: true }).click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('v2-export-go').click()])
  const bytes = readFileSync(await download.path())
  await expect(modal).toBeHidden()
  return bytes.toString('base64')
}

/** Pixels that differ between two PNGs of the same size (-1 when the sizes differ). */
const pngDiff = (page: Page, a: string, b: string) =>
  page.evaluate(
    async ({ a, b }) => {
      const load = async (b64: string) => {
        const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
        const bmp = await createImageBitmap(new Blob([bin], { type: 'image/png' }))
        const c = new OffscreenCanvas(bmp.width, bmp.height)
        const ctx = c.getContext('2d')!
        ctx.drawImage(bmp, 0, 0)
        return ctx.getImageData(0, 0, bmp.width, bmp.height)
      }
      const [x, y] = await Promise.all([load(a), load(b)])
      if (x.width !== y.width || x.height !== y.height) return -1
      let n = 0
      for (let i = 0; i < x.data.length; i += 4) {
        const d = Math.abs(x.data[i] - y.data[i]) + Math.abs(x.data[i + 1] - y.data[i + 1]) + Math.abs(x.data[i + 2] - y.data[i + 2])
        if (d > 30) n++
      }
      return n
    },
    { a, b },
  )

test('label: a Room name placed in Warren Hall lands selected, its field focused, reading the room’s name', { tag: '@text' }, async ({ page }) => {
  await openWarren(page)
  await labelTool(page, 'Room name')
  await expect(dock(page).getByRole('group', { name: 'Size' })).toContainText('0.8')
  await expect(status(page)).toContainText('Click to place')
  const hall = await room(page, 'Warren Hall')
  const id = await place(page, { x: hall.anchor[0], y: hall.anchor[1] + 0.5 })
  expect(await sel(page)).toEqual([id])
  await expect(card(page)).toHaveAttribute('data-kind', 'text')
  await expect(textField(page)).toBeFocused()
  await expect(textField(page)).toHaveValue('Warren Hall')
  const c = await labelById(page, id)
  expect(c).toMatchObject({ style: 'room-name', weight: 'bold', backdrop: 'halo', bound: { kind: 'room', id: hall.id } })
  expect(c.players).toBeUndefined()
  await textField(page).press('Enter')
  await expect(textField(page)).not.toBeFocused()
  // The tool stays in hand for the next label.
  expect(await inPage(page, `(s) => s().tools.activeTool`)).toBe('text')
})

test('label: renaming the room in its card carries the label with it, and undo brings both back', { tag: '@text' }, async ({ page }) => {
  await openWarren(page)
  await labelTool(page, 'Room name')
  const hall = await room(page, 'Warren Hall')
  const id = await place(page, { x: hall.anchor[0], y: hall.anchor[1] + 0.5 })
  await key(page, 'v')
  await selectIds(page, [hall.id])
  const name = card(page).getByRole('textbox', { name: 'Name', exact: true })
  await name.fill('Great Hall')
  await name.press('Enter')
  await expect.poll(async () => (await labelById(page, id)).text).toBe('Great Hall')
  await undo(page)
  await expect.poll(async () => (await labelById(page, id)).text).toBe('Warren Hall')
})

test('label: a Number pin shows its room’s number; a Door tag by the Chief Door reads the door’s name', { tag: '@text' }, async ({ page }) => {
  await openWarren(page)
  await labelTool(page, 'Number pin')
  const nook = await room(page, 'Plunder Nook')
  const pin = await place(page, { x: nook.anchor[0], y: nook.anchor[1] })
  expect((await labelById(page, pin)).text).toBe(String(nook.number))
  await styleTile(page, 'Door tag').click()
  const door = await chiefDoor(page)
  const tag = await place(page, { x: door.position[0] + 0.3, y: door.position[1] + 0.3 })
  expect(await labelById(page, tag)).toMatchObject({ text: 'Chief Door', backdrop: 'pill', bound: { kind: 'door', id: door.id } })
})

test('label: a Door tag 1.1 sq from the Chief Door binds to it; with no door in reach it places nothing and the status bar says why', { tag: '@text' }, async ({ page }) => {
  await openWarren(page)
  await labelTool(page, 'Door tag')
  const door = await chiefDoor(page)
  const tag = await place(page, { x: door.position[0] + 1.1, y: door.position[1] })
  expect(await labelById(page, tag)).toMatchObject({ text: 'Chief Door', bound: { kind: 'door', id: door.id } })
  const before = (await labels(page)).length
  await clickWorld(page, { x: door.position[0] - 4, y: door.position[1] })
  expect(await labels(page)).toHaveLength(before)
  await expect(status(page)).toContainText('Click on a door to tag it')
  await expect(status(page)).not.toContainText('Click on a door to tag it', { timeout: 4000 })
})

test('label: a Door tag follows its door while the host wall is dragged, and stays with it after', { tag: '@text' }, async ({ page }) => {
  await openWarren(page)
  await labelTool(page, 'Door tag')
  const door = await chiefDoor(page)
  const tag = await place(page, { x: door.position[0] + 0.3, y: door.position[1] })
  const start = (await labelById(page, tag)).position
  await key(page, 'v')
  const wall = await inPage<Any>(page, `(s, layer, w2s, id) => layer().standaloneWalls.find((w) => w.id === id)`, door.wallId)
  const [a, b] = wall.points
  // Near one end of the wall, clear of the door in its middle.
  const grab = { x: a[0] + (b[0] - a[0]) * 0.15, y: a[1] + (b[1] - a[1]) * 0.15 }
  const from = await toScreen(page, grab)
  const z = await zoomOf(page)
  await firePointer(page, 'pointermove', from.x, from.y)
  await firePointer(page, 'pointerdown', from.x, from.y, 0.5, 1)
  await firePointer(page, 'pointerup', from.x, from.y)
  await waitFrame(page, 2)
  expect(await sel(page)).toEqual([door.wallId])
  await firePointer(page, 'pointermove', from.x, from.y)
  await firePointer(page, 'pointerdown', from.x, from.y, 0.5, 1)
  for (let i = 1; i <= 4; i++) await firePointer(page, 'pointermove', from.x - (2 * z * i) / 4, from.y, 0.5, 1)
  await waitFrame(page, 2)
  // Live, mid-drag: the tag has moved with the door as drawn already (the door slides to the
  // end of the moving wall until the drop re-hangs it, and the tag goes where it draws).
  expect((await labelById(page, tag)).position.x).toBeLessThan(start.x - 0.3)
  await firePointer(page, 'pointerup', from.x - 2 * z, from.y)
  await waitFrame(page, 3)
  // The drop re-hangs the door on the moved wall; the tag moved by what the door moved.
  const moved = await inPage<Any>(page, `(s, layer, w2s, id) => layer().children.find((c) => c.id === id)`, door.id)
  const now = (await labelById(page, tag)).position
  expect(Math.hypot(moved.position[0] - door.position[0], moved.position[1] - door.position[1])).toBeGreaterThan(0.3)
  expect(now.x - start.x).toBeCloseTo(moved.position[0] - door.position[0], 1)
  expect(now.y - start.y).toBeCloseTo(moved.position[1] - door.position[1], 1)
})

test('label: a small Number pin dragged by its centre moves, its size unchanged', { tag: '@text' }, async ({ page }) => {
  await openWarren(page)
  await labelTool(page, 'Number pin')
  const nook = await room(page, 'Plunder Nook')
  // Off the room's own anchor badge, which a press there would pick instead.
  const pin = await place(page, { x: nook.anchor[0] + 1.5, y: nook.anchor[1] + 1.5 })
  await key(page, 'v')
  const before = await labelById(page, pin)
  const z = await zoomOf(page)
  // Small on screen: the case the handles used to cover.
  expect(Math.min(before.width, before.height) * z).toBeLessThan(28)
  const from = await toScreen(page, before.position)
  await firePointer(page, 'pointermove', from.x, from.y)
  await firePointer(page, 'pointerdown', from.x, from.y, 0.5, 1)
  for (let i = 1; i <= 6; i++) await firePointer(page, 'pointermove', from.x + (2 * z * i) / 6, from.y, 0.5, 1)
  await firePointer(page, 'pointerup', from.x + 2 * z, from.y)
  await waitFrame(page, 3)
  const after = await labelById(page, pin)
  expect(after.position.x - before.position.x).toBeGreaterThan(1.5)
  expect([after.width, after.height, after.fontSize]).toEqual([before.width, before.height, before.fontSize])
})

test('label: a Custom label typed into and committed with Enter shows its text on the canvas', { tag: '@text' }, async ({ page }) => {
  await openBlank(page)
  await labelTool(page)
  await expect(styleTile(page, 'Custom')).toHaveAttribute('aria-pressed', 'true')
  const at = { x: 0, y: 0 }
  const bare = await region(page, at)
  const id = await place(page, at)
  await expect(textField(page)).toBeFocused()
  await page.keyboard.type('BEWARE')
  await page.keyboard.press('Enter')
  expect((await labelById(page, id)).text).toBe('BEWARE')
  await selectIds(page, [])
  await waitFrame(page, 6)
  expect(changed(bare, await region(page, at))).toBeGreaterThan(30)
})

test('label: Esc on a fresh placeholder takes the label back', { tag: '@text' }, async ({ page }) => {
  await openBlank(page)
  await labelTool(page)
  await place(page, { x: 0, y: 0 })
  await expect(textField(page)).toBeFocused()
  await page.keyboard.press('Escape')
  await waitFrame(page, 2)
  expect(await labels(page)).toHaveLength(0)
  await expect(card(page)).toHaveCount(0)
})

test('label: a Custom label placed by a real click takes the typing at once; Esc on a fresh one removes it', { tag: '@text' }, async ({ page }) => {
  await openBlank(page)
  // The world origin in the open canvas, clear of the panels, so a real mouse reaches it.
  await page.evaluate(() => {
    const w = window as Any
    const c = w.__pixiApp.canvas as HTMLCanvasElement
    const r = c.getBoundingClientRect()
    const wd = w.__pixiApp.stage.children[0]
    wd.position.set(700 - r.left, 400 - r.top)
  })
  await waitFrame(page, 3)
  await labelTool(page, 'Custom')
  await expect(styleTile(page, 'Custom')).toHaveAttribute('aria-pressed', 'true')
  // A real press (mousedown and its focus move included), then keys straight after it.
  const at = await toScreen(page, { x: 0, y: 0 })
  await page.mouse.click(at.x, at.y)
  await page.keyboard.type('Beware')
  await expect(textField(page)).toBeFocused()
  await expect(textField(page)).toHaveValue('Beware')
  await page.keyboard.press('Enter')
  expect((await labels(page)).map((c) => c.text)).toEqual(['Beware'])
  await expect(styleTile(page, 'Custom')).toHaveAttribute('aria-pressed', 'true')

  const next = await toScreen(page, { x: 4, y: 0 })
  await page.mouse.click(next.x, next.y)
  await expect(textField(page)).toBeFocused()
  await page.keyboard.press('Escape')
  await waitFrame(page, 2)
  expect((await labels(page)).map((c) => c.text)).toEqual(['Beware'])
})

test('label: the Layers sheet names a label row by its text', { tag: '@text' }, async ({ page }) => {
  await openBlank(page)
  await labelTool(page)
  const id = await place(page, { x: 0, y: 0 })
  await page.keyboard.type('Beware the pit')
  await page.keyboard.press('Enter')
  expect((await labelById(page, id)).name).toBe('Label 1')
  await page.getByTestId('shell-open-layers').click()
  const sheet = page.getByTestId('shell-layers-sheet')
  const expand = sheet.getByTestId('shell-layers-layer').first().getByRole('button', { name: 'Expand' })
  if (await expand.count()) await expand.click()
  const row = sheet.locator(`[data-object-id="${id}"]`)
  await expect(row).toContainText('Beware the pit')
  await expect(row).not.toContainText('Label 1')
})

test('label: a halo and a pill draw on the canvas around the letters', { tag: '@text' }, async ({ page }) => {
  await openBlank(page)
  // Light letters, so the halo's and the plate's dark shows on the paper.
  const light = { color: '#f2f2f2' }
  await addLabel(page, label('plain', { x: -6, y: 0 }, light))
  await addLabel(page, label('halo', { x: 0, y: 0 }, { ...light, backdrop: 'halo' }))
  await addLabel(page, label('pill', { x: 6, y: 0 }, { ...light, backdrop: 'pill', width: 4.35, height: 2.1 }))
  await waitFrame(page, 8)
  const ink = (px: number[]) => {
    let n = 0
    for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] < 300) n++
    return n
  }
  const plain = ink(await region(page, { x: -6, y: 0 }))
  const halo = ink(await region(page, { x: 0, y: 0 }))
  const pill = ink(await region(page, { x: 6, y: 0 }))
  expect(halo).toBeGreaterThan(plain + 50)
  expect(pill).toBeGreaterThan(halo)
})

test('label: the card’s Visible to players switch writes `players`', { tag: '@text' }, async ({ page }) => {
  await openBlank(page)
  await addLabel(page, label('t', { x: 0, y: 0 }))
  await selectIds(page, ['t'])
  const sw = card(page).getByRole('switch', { name: 'Visible to players' })
  await expect(sw).toHaveAttribute('aria-checked', 'false')
  await sw.click()
  expect((await labelById(page, 't')).players).toBe(true)
  await undo(page)
  expect((await labelById(page, 't')).players).toBeUndefined()
})

test('label: export with Labels = Players leaves out exactly the DM-only labels', { tag: '@text' }, async ({ page }) => {
  await openBlank(page)
  await addLabel(page, label('secret', { x: 0, y: 0 }))
  await waitFrame(page, 4)
  const all = await exportPng(page, 'All')
  const players = await exportPng(page, 'Players')
  expect(await pngDiff(page, all, players)).toBeGreaterThan(100)
  // Marked for players, it is in the Players file too: nothing else differs.
  await inPage(page, `(s, layer) => { s().updateChild(layer().id, 'secret', { players: true }) }`)
  await waitFrame(page, 4)
  expect(await pngDiff(page, all, await exportPng(page, 'Players'))).toBe(0)
  const none = await exportPng(page, 'None')
  expect(await pngDiff(page, all, none)).toBeGreaterThan(100)
})

test('label: the zone marks never reach an export (and did, before they were held back)', { tag: '@text' }, async ({ page }) => {
  await openBlank(page)
  const bare = await exportPng(page, 'All')
  await inPage(page, `(s, layer) => {
    s().addChild(layer().id, { id: 'z1', name: 'Trap', childType: 'zone', visible: true, shape: { kind: 'rect', x: -3, y: -3, width: 6, height: 6 } })
    s().setSelectedIds(['z1'])
  }`)
  await waitFrame(page, 6)
  // The marks are drawn, in the very container the file is rendered from.
  expect(
    await page.evaluate(() => {
      const world = (window as Any).__pixiApp.stage.children[0]
      const marks = world.children.find((c: Any) => c.label === 'zoneOverlay')
      return !!marks && marks.visible
    }),
  ).toBe(true)
  expect(await pngDiff(page, bare, await exportPng(page, 'All'))).toBe(0)
  // Unrecognised (the pipeline as it was), the same marks land in the file.
  await page.evaluate(() => {
    const world = (window as Any).__pixiApp.stage.children[0]
    world.children.find((c: Any) => c.label === 'zoneOverlay').label = 'zoneOverlay-unheld'
  })
  const leaked = await exportPng(page, 'All')
  await page.evaluate(() => {
    const world = (window as Any).__pixiApp.stage.children[0]
    world.children.find((c: Any) => c.label === 'zoneOverlay-unheld').label = 'zoneOverlay'
  })
  expect(await pngDiff(page, bare, leaked)).toBeGreaterThan(50)
})

test('label: the dock’s Size runs 0.2 to 6 sq, the card’s the same', { tag: '@text' }, async ({ page }) => {
  await openBlank(page)
  await labelTool(page)
  const size = dock(page).getByRole('group', { name: 'Size' })
  const setTool = (v: number) =>
    inPage(page, `(s, layer, w2s, v) => s().updateToolSettings({ label: { ...s().tools.settings.label, fontSize: v } })`, v)
  await setTool(0.2)
  await expect(size.getByRole('button', { name: 'Decrease Size' })).toBeDisabled()
  await expect(size.getByRole('button', { name: 'Increase Size' })).toBeEnabled()
  await setTool(6)
  await expect(size.getByRole('button', { name: 'Increase Size' })).toBeDisabled()
  await expect(size.getByRole('button', { name: 'Decrease Size' })).toBeEnabled()

  const id = await place(page, { x: 0, y: 0 })
  await page.keyboard.press('Enter')
  const setLabel = (v: number) =>
    inPage(page, `(s, layer, w2s, a) => s().updateChild(layer().id, a.id, { fontSize: a.v })`, { id, v })
  const cardSize = card(page).getByRole('group', { name: 'Size' })
  await setLabel(0.2)
  await expect(cardSize.getByRole('button', { name: 'Decrease Size' })).toBeDisabled()
  await expect(cardSize.getByRole('button', { name: 'Increase Size' })).toBeEnabled()
  await setLabel(6)
  await expect(cardSize.getByRole('button', { name: 'Increase Size' })).toBeDisabled()
  await expect(cardSize.getByRole('button', { name: 'Decrease Size' })).toBeEnabled()
})

test('label: the Zone tool shows no style tiles', { tag: '@text' }, async ({ page }) => {
  await openBlank(page)
  await labelTool(page)
  await pickTool(page, 'zone')
  expect(await inPage(page, `(s) => s().tools.activeTool`)).toBe('zone')
  await expect(dock(page).getByTestId('label-styles')).toHaveCount(0)
  expect(await dockColumns(page)).not.toContain('styles')
  await expect(page.getByText(/soon/)).toHaveCount(0)
})

// ─── Rooms ───────────────────────────────────────────────────────────────────

interface RoomRow {
  id: string
  name: string
  number?: number
  anchor: [number, number]
  areaId?: string
  look?: Any
}

const rooms = (page: Page) =>
  inPage<RoomRow[]>(
    page,
    `(s, layer) => (layer()?.rooms ?? []).map((r) => ({ id: r.id, name: r.name, number: r.number, anchor: r.anchor, areaId: r.areaId, look: r.look }))`,
  )

const roomSheet = (page: Page) => page.getByTestId('shell-rooms-sheet')

/** Pins a colour through a Tint swatch: open it, type the hex, give the debounced write time to land, close. */
async function pinColour(page: Page, section: Locator, hex: string): Promise<void> {
  await section.getByRole('button', { name: 'Tint', exact: true }).click()
  await page.getByLabel('Tint hex').fill(hex)
  // A picker reports no end: the look lands as one step after 400 ms of quiet.
  await page.waitForTimeout(600)
  await page.keyboard.press('Escape')
  await waitFrame(page, 2)
}

/** Pins the first installed wall set through a card's Walls section, so a wall tint has stones to colour. */
async function pinFirstWallSet(page: Page, section: Locator): Promise<void> {
  await section.getByRole('combobox', { name: 'Set' }).click()
  const options = page.getByRole('option')
  expect(await options.count()).toBeGreaterThan(1)
  await options.nth(1).click()
}

/** A box in canvas CSS px around a room's face (its bounding box), optionally grown by `pad` px. */
const roomBox = (page: Page, name: string, pad = 0) =>
  inPage<Box>(
    page,
    `(s, layer, w2s, arg) => {
      const r = layer().rooms.find((x) => x.name === arg.name)
      const xs = r.face.map((p) => p[0]); const ys = r.face.map((p) => p[1])
      const a = w2s(Math.min(...xs), Math.min(...ys)); const b = w2s(Math.max(...xs), Math.max(...ys))
      return { x: a.x - arg.pad, y: a.y - arg.pad, width: b.x - a.x + 2 * arg.pad, height: b.y - a.y + 2 * arg.pad }
    }`,
    { name, pad },
  )

/**
 * Keeps the WebGL canvas's pixels inside `box` (page CSS px) under `key`, in the page. Reads
 * the canvas itself, not a page screenshot, so cards and sheets over the map never count
 * (?e2e=1 keeps the drawing buffer for exactly this).
 */
async function grabCanvas(page: Page, key: string, box: Box): Promise<void> {
  await waitFrame(page, 3)
  await page.evaluate(
    ({ key, box }) => {
      const gl = document.querySelector('canvas') as HTMLCanvasElement
      const r = gl.getBoundingClientRect()
      const k = gl.width / r.width
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(box.width * k))
      c.height = Math.max(1, Math.round(box.height * k))
      const ctx = c.getContext('2d')!
      ctx.drawImage(gl, (box.x - r.left) * k, (box.y - r.top) * k, c.width, c.height, 0, 0, c.width, c.height)
      const w = window as Any
      w.__grabs ??= {}
      w.__grabs[key] = ctx.getImageData(0, 0, c.width, c.height).data
    },
    { key, box },
  )
}

/** How many pixels differ by more than `tol` (any channel) between two grabs of the same box. */
function grabDiff(page: Page, a: string, b: string, tol = 24): Promise<number> {
  return page.evaluate(
    ({ a, b, tol }) => {
      const g = (window as Any).__grabs
      const x: Uint8ClampedArray = g[a]
      const y: Uint8ClampedArray = g[b]
      let n = 0
      for (let i = 0; i < x.length; i += 4) {
        if (Math.abs(x[i] - y[i]) > tol || Math.abs(x[i + 1] - y[i + 1]) > tol || Math.abs(x[i + 2] - y[i + 2]) > tol) n++
      }
      return n
    },
    { a, b, tol },
  )
}

/** Pixels of two grabs that read as the pinned red (#ff2020) after and did not before. */
function newRedPixels(page: Page, before: string, after: string): Promise<number> {
  return page.evaluate(
    ({ before, after }) => {
      const g = (window as Any).__grabs
      const was: Uint8ClampedArray = g[before]
      const now: Uint8ClampedArray = g[after]
      const red = (d: Uint8ClampedArray, i: number) => d[i] > 150 && d[i + 1] < 90 && d[i + 2] < 90
      let n = 0
      for (let i = 0; i < now.length; i += 4) if (red(now, i) && !red(was, i)) n++
      return n
    },
    { before, after },
  )
}

/** Waits until the canvas inside `box` holds still for a second (late textures, thumbnails), up to 20 s. */
async function settleCanvas(page: Page, box: Box): Promise<void> {
  await grabCanvas(page, 'settle-a', box)
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1000)
    await grabCanvas(page, 'settle-b', box)
    if ((await grabDiff(page, 'settle-a', 'settle-b', 0)) === 0) return
    await grabCanvas(page, 'settle-a', box)
  }
}

/**
 * A point inside a room with nothing standing on it, on screen: the anchor when it is bare,
 * else the nearest bare spot round it. A click there lands on the room itself; one on a prop
 * takes the prop (every click picks at the raw pointer).
 */
const bareRoomScreen = (page: Page, name: string) =>
  inPage<Pt>(
    page,
    `(s, layer, w2s, name) => {
      const l = layer()
      const r = l.rooms.find((x) => x.name === name)
      const inFace = (x, y) => { let c = false; const f = r.face; for (let i = 0, j = f.length - 1; i < f.length; j = i++) { const [xi, yi] = f[i]; const [xj, yj] = f[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c } return c }
      const covered = (x, y) => l.children.some((c) => {
        if (c.childType === 'asset' || c.childType === 'text') { const hw = (c.width * c.scale) / 2 + 0.6, hh = (c.height * c.scale) / 2 + 0.6; return Math.abs(x - c.position.x) <= Math.max(hw, hh) && Math.abs(y - c.position.y) <= Math.max(hw, hh) }
        if (c.childType === 'light') return Math.hypot(x - c.position.x, y - c.position.y) < 1.2
        if (c.childType === 'door') return Math.hypot(x - c.position[0], y - c.position[1]) < 2
        return false
      }) || l.standaloneWalls.some((w) => w.points.some((p) => Math.hypot(x - p[0], y - p[1]) < 3))
      const [ax, ay] = r.anchor
      for (let ring = 0; ring < 12; ring++) for (let k = 0; k < Math.max(1, ring * 8); k++) {
        const a = (k / Math.max(1, ring * 8)) * Math.PI * 2
        const x = ax + Math.cos(a) * ring * 0.5, y = ay + Math.sin(a) * ring * 0.5
        if (inFace(x, y) && !covered(x, y)) return w2s(x, y)
      }
      return w2s(ax, ay)
    }`,
    name,
  )

/** The sheet's Close button for the Rooms list. */
const closeRooms = (page: Page) => roomSheet(page).getByRole('button', { name: 'Close Rooms' }).click()

test('rooms: the warren opens with seven numbered, named rooms and the room tools in the Text flyout, counted in the panel and listed in the sheet', { tag: '@text' }, async ({ page }) => {
  await openWarren(page)
  const list = await rooms(page)
  expect(list).toHaveLength(7)
  expect(list.every((r) => typeof r.number === 'number' && r.name.length > 0)).toBe(true)
  expect(new Set(list.map((r) => r.number))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7]))

  // The Text family holds the room tools beside Label and Zone.
  await page.getByTestId('shell-rail').getByRole('button', { name: 'Text' }).click()
  const flyout = page.getByTestId('shell-flyout')
  for (const tool of ['Label', 'Zone', 'Rectangle room', 'Polygon room', 'Divide']) {
    await expect(flyout.getByRole('button', { name: new RegExp(`^${tool}`) })).toBeVisible()
  }
  await flyout.getByRole('button', { name: /^Rectangle room/ }).click()
  await expect(page.getByTestId('rooms-suggest')).toContainText('7 rooms')

  // The list opens from the level's card: Level settings in the title card's menu, then Open list.
  await pickTool(page, 'select')
  await page.getByTestId('shell-title-level').click()
  await page.getByTestId('shell-level-menu').getByRole('menuitem', { name: 'Level settings' }).click()
  await expect(card(page)).toHaveAttribute('data-kind', 'level')
  await card(page).getByRole('button', { name: 'Open list' }).click()
  await expect(roomSheet(page).getByTestId('rooms-row')).toHaveCount(7)
  await expect(roomSheet(page).getByTestId('rooms-count')).toContainText('7')
  await closeRooms(page)
  await expect(roomSheet(page)).toHaveCount(0)
})

test('rooms: a click on Warren Hall selects it, the card renames it, and the name survives a reload', { tag: '@text' }, async ({ page }) => {
  await openWarren(page)
  await key(page, 'v')
  const at = await bareRoomScreen(page, 'Warren Hall')
  await firePointer(page, 'pointerdown', at.x, at.y, 0.5, 1)
  await firePointer(page, 'pointerup', at.x, at.y, 0, 0)
  await waitFrame(page, 2)
  await expect(card(page)).toHaveAttribute('data-kind', 'room')
  await expect(card(page).locator('b').first()).toHaveText('Warren Hall')
  await expect(status(page)).toContainText('1 room')

  const name = card(page).getByRole('textbox', { name: 'Name', exact: true })
  await name.fill('Great Hall')
  await name.press('Enter')
  expect((await rooms(page)).some((r) => r.name === 'Great Hall')).toBe(true)

  await undo(page)
  expect((await rooms(page)).some((r) => r.name === 'Warren Hall')).toBe(true)
  await key(page, 'Control+y')
  expect((await rooms(page)).some((r) => r.name === 'Great Hall')).toBe(true)

  await page.evaluate(() => (window as Any).__store.getState().saveCurrentMap())
  await reopenMap(page)
  await page.waitForFunction(() =>
    (window as Any).__store.getState().layers.some((l: Any) => (l.rooms ?? []).some((r: Any) => r.name === 'Great Hall')),
  )
})

test('rooms: a wall tint pinned on one room recolours that room only, and undoes', { tag: '@text' }, async ({ page }) => {
  await openWarren(page)
  const hall = (await rooms(page)).find((r) => r.name === 'Warren Hall')!
  const hallBox = await roomBox(page, 'Warren Hall')
  const denBox = await roomBox(page, "Chief's Den")
  await grabCanvas(page, 'hall-before', hallBox)
  await grabCanvas(page, 'den-before', denBox)
  await selectIds(page, [hall.id])
  const walls = card(page).getByTestId('look-walls')
  await expect(walls.getByTestId('look-walls-source')).toHaveText(/^Inherits/)
  await pinFirstWallSet(page, walls)
  await pinColour(page, walls, '#ff2020')
  await expect(walls.getByTestId('look-walls-source')).toHaveText('Pinned')
  expect((await rooms(page)).find((r) => r.id === hall.id)?.look).toMatchObject({ wallTextureTint: '#ff2020' })

  // Nothing picked, so no selection ring is in the shots.
  await selectIds(page, [])
  await page.waitForTimeout(400)
  await waitFrame(page, 4)
  await grabCanvas(page, 'hall-after', hallBox)
  await grabCanvas(page, 'den-after', denBox)
  expect(await grabDiff(page, 'hall-before', 'hall-after')).toBeGreaterThan(0)
  expect(await newRedPixels(page, 'hall-before', 'hall-after')).toBeGreaterThan(0)
  // The Warren's walls are the live cave band, walked round the whole floor ring, so the
  // hall's pin re-lays rock beyond the hall and the den's shot is not pixel-identical. The
  // tint is what must stay in the hall.
  expect(await newRedPixels(page, 'den-before', 'den-after')).toBe(0)

  // Undo takes the tint off; Reset clears every wall pin at once.
  await undo(page)
  expect((await rooms(page)).find((r) => r.id === hall.id)?.look?.wallTextureTint).toBeUndefined()
  await selectIds(page, [hall.id])
  await walls.getByRole('button', { name: 'Reset' }).click()
  await expect(walls.getByTestId('look-walls-source')).toHaveText(/^Inherits/)
})

test('rooms: Divide across Warren Hall opens the split dialog; Split makes eight rooms, undo seven', { tag: '@text' }, async ({ page }) => {
  await openWarren(page)
  await pickTool(page, 'divide')
  expect(await inPage(page, `(s) => s().tools.activeTool`)).toBe('divide')
  await expect(status(page)).toContainText('Drag across a floor: the ends snap to the walls')
  await expect(page.getByTestId('shell-tool-panel').getByRole('button', { name: 'Suggest rooms' })).toBeVisible()
  await expect(dock(page).getByRole('group', { name: 'Divider' }).getByRole('button', { name: 'Threshold' })).toHaveAttribute('aria-pressed', 'true')

  // A vertical cut through the hall's anchor, past its walls at both ends.
  const cut = await inPage<{ a: Pt; b: Pt }>(
    page,
    `(s, layer, w2s) => {
      const r = layer().rooms.find((x) => x.name === 'Warren Hall')
      const ys = r.face.map((p) => p[1]); const x = r.anchor[0]
      return { a: w2s(x, Math.min(...ys) - 0.5), b: w2s(x, Math.max(...ys) + 0.5) }
    }`,
  )
  await firePointer(page, 'pointerdown', cut.a.x, cut.a.y, 0.5, 1)
  for (let i = 1; i <= 8; i++) {
    await firePointer(page, 'pointermove', cut.a.x, cut.a.y + ((cut.b.y - cut.a.y) * i) / 8, 0.5, 1)
  }
  await firePointer(page, 'pointerup', cut.b.x, cut.b.y, 0, 0)
  await waitFrame(page, 2)

  const dialog = page.getByTestId('v2-split-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading')).toHaveText('Split Warren Hall')
  await expect(dialog.getByLabel('The other half becomes')).toHaveValue(/^Warren Hall, (east|west|north|south)$/)
  // The fog choice is a segmented choice: Copy explored state by default, Start hidden on a press.
  const fog = dialog.getByRole('group', { name: 'Its fog at the table' })
  await expect(fog.getByRole('button', { name: 'Copy explored state' })).toHaveAttribute('aria-pressed', 'true')
  await fog.getByRole('button', { name: 'Start hidden' }).click()
  await expect(fog.getByRole('button', { name: 'Start hidden' })).toHaveAttribute('aria-pressed', 'true')
  await expect(fog.getByRole('button', { name: 'Copy explored state' })).toHaveAttribute('aria-pressed', 'false')
  await page.getByTestId('v2-split-commit').click()
  await expect(dialog).toBeHidden()
  expect(await rooms(page)).toHaveLength(8)

  // Both halves keep their anchors by the cut, but their badges and name chips sit inside
  // their own halves: the two labels never overlap at the divider.
  await key(page, 'v')
  await selectIds(page, [])
  await page.waitForFunction(() => {
    const s = (window as Any).__store.getState()
    const l = s.layers.find((x: Any) => x.id === s.ui.activeLayerId)
    return l.rooms.filter((r: Any) => r.name.startsWith('Warren Hall')).every((r: Any) => Array.isArray(r.face) && r.face.length > 2)
  })
  // At 20 px a square, centred on the hall (at Fit the whole warren is a few hundred px across).
  await page.evaluate(() => {
    const w = window as Any
    const s = w.__store.getState()
    const l = s.layers.find((x: Any) => x.id === s.ui.activeLayerId)
    const pts = l.rooms.filter((r: Any) => r.name.startsWith('Warren Hall')).flatMap((r: Any) => r.face)
    const cx = (Math.min(...pts.map((p: Any) => p[0])) + Math.max(...pts.map((p: Any) => p[0]))) / 2
    const cy = (Math.min(...pts.map((p: Any) => p[1])) + Math.max(...pts.map((p: Any) => p[1]))) / 2
    const wd = w.__pixiApp.stage.children[0]
    const c = w.__pixiApp.canvas as HTMLCanvasElement
    wd.scale.set(20)
    wd.position.set(c.clientWidth / 2 - cx * 20, c.clientHeight / 2 - cy * 20)
  })
  await page.waitForTimeout(400)
  await waitFrame(page, 4)
  const halves = (await rooms(page)).filter((r) => r.name.startsWith('Warren Hall'))
  expect(halves).toHaveLength(2)
  const rects = await page.evaluate(
    (ids) => ids.map((id) => (window as Any).__roomOverlay.labelRect(id)),
    halves.map((h) => h.id),
  )
  expect(rects.every(Boolean)).toBe(true)
  const [p, q] = rects as Box[]
  const overlap = p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height
  expect(overlap).toBe(false)
  await undo(page)
  expect(await rooms(page)).toHaveLength(7)
})

test('rooms: the Polygon room tool closes a floor and its room with Enter, and undo takes both back', { tag: '@text' }, async ({ page }) => {
  await openBlank(page)
  await pickTool(page, 'roomPolygon')
  await expect(status(page)).toContainText('Click the corners')
  const before = await counts(page)
  for (const p of [{ x: 2, y: 2 }, { x: 9, y: 2 }, { x: 11, y: 7 }, { x: 5, y: 9 }]) await clickWorld(page, p)
  await key(page, 'Enter')
  await waitFrame(page, 4)
  const after = await counts(page)
  expect(after.rooms).toBe(before.rooms + 1)
  expect(after.lastFloor).not.toBeNull()
  await undo(page)
  expect((await counts(page)).rooms).toBe(before.rooms)
})

test('rooms: Suggest on a map with two floors and no rooms proposes two; Accept all adds them', { tag: '@text' }, async ({ page }) => {
  await openBlank(page)
  await inPage(page, `(s, layer) => {
    const rect = (id, x) => ({
      id, name: id, childType: 'shape', visible: true, shapeType: 'rectangle',
      contours: [[[x, 2], [x + 6, 2], [x + 6, 8], [x, 8]]],
      textureScale: 1, textureOffsetX: 0, textureOffsetY: 0, textureFillRotation: 0, textureTint: '#ffffff',
    })
    s().addChild(layer().id, rect('a', 2))
    s().addChild(layer().id, rect('b', 14))
  }`)
  await page.waitForFunction(() => {
    const l = (window as Any).__store.getState().layers.find((x: Any) => x.type === 'dungeon')
    return Array.isArray(l.mergedFloor) && l.mergedFloor.length === 2
  })
  await pickTool(page, 'roomRect')
  const suggest = page.getByTestId('rooms-suggest')
  await expect(suggest).toContainText('0 rooms')
  await suggest.getByRole('button', { name: 'Suggest rooms' }).click()
  await expect(suggest).toContainText('2 rooms suggested')
  await suggest.getByRole('button', { name: 'Accept all' }).click()
  await expect(suggest.getByRole('button', { name: 'Suggest rooms' })).toBeVisible()
  expect(await rooms(page)).toHaveLength(2)
  await undo(page)
  expect(await rooms(page)).toHaveLength(0)

  // Enter accepts all from the keyboard; Escape dismisses.
  await suggest.getByRole('button', { name: 'Suggest rooms' }).click()
  await key(page, 'Escape')
  await expect(suggest.getByRole('button', { name: 'Suggest rooms' })).toBeVisible()
  await suggest.getByRole('button', { name: 'Suggest rooms' }).click()
  await expect(suggest).toContainText('2 rooms suggested')
  await key(page, 'Enter')
  expect(await rooms(page)).toHaveLength(2)
})

test('rooms: a new area from two rooms groups them; its wall pin reaches both, a room pin wins', { tag: '@text' }, async ({ page }) => {
  await openWarren(page)
  const all = await rooms(page)
  const hall = all.find((r) => r.name === 'Warren Hall')!
  const gallery = all.find((r) => r.name === 'Web Gallery')!
  await selectIds(page, [hall.id, gallery.id])
  await page.evaluate(() => (window as Any).__store.getState().setRoomsSheetOpen(true))
  await roomSheet(page).getByTestId('rooms-new-area').click()
  // The new area's name is up for editing straight away.
  await page.keyboard.press('Control+a')
  await page.keyboard.type('Lower warren')
  await page.keyboard.press('Enter')
  const head = roomSheet(page).getByTestId('rooms-area-head').filter({ hasText: 'Lower warren' })
  await expect(head).toBeVisible()
  await expect(head).toContainText(/Lower warren\s*2/)

  // The header selects the area; close the sheet to see its card.
  await head.getByRole('button', { name: 'Lower warren' }).click()
  await closeRooms(page)
  await expect(card(page)).toHaveAttribute('data-kind', 'area')
  const areaWalls = card(page).getByTestId('look-walls')
  await pinFirstWallSet(page, areaWalls)
  await pinColour(page, areaWalls, '#2060ff')
  await expect(areaWalls.getByTestId('look-walls-source')).toHaveText('Pinned')

  // Both rooms now inherit the area's walls; a room's own pin wins over it.
  const sourceOf = async (id: string) => {
    await selectIds(page, [id])
    await waitFrame(page, 1)
    return card(page).getByTestId('look-walls-source').textContent()
  }
  expect(await sourceOf(gallery.id)).toBe('Inherits Lower warren')
  expect(await sourceOf(hall.id)).toBe('Inherits Lower warren')
  await pinColour(page, card(page).getByTestId('look-walls'), '#ff2020')
  expect(await sourceOf(hall.id)).toBe('Pinned')
  expect(await sourceOf(gallery.id)).toBe('Inherits Lower warren')
  const tints = await inPage<(string | undefined)[]>(
    page,
    `(s, layer, w2s, ids) => ids.map((id) => {
      const l = layer(); const r = l.rooms.find((x) => x.id === id); const a = (l.areas ?? []).find((x) => x.id === r.areaId)
      return r.look?.wallTextureTint ?? a?.look?.wallTextureTint
    })`,
    [hall.id, gallery.id],
  )
  expect(tints).toEqual(['#ff2020', '#2060ff'])

  // Undo the room pin: the hall is back on the area's walls.
  await undo(page)
  expect(await sourceOf(hall.id)).toBe('Inherits Lower warren')
})

test('rooms: a new level switches the dock to its first layer; a level floor tint pins on the level', { tag: '@text' }, async ({ page }) => {
  await openWarren(page)
  const title = page.getByTestId('shell-title-level')
  await expect(title).toContainText('Goblin Warren')
  const warrenLevel = await inPage<string>(page, `(s) => s().levels.find((l) => l.id === s().layers.find((x) => x.name === 'Warren').levelId).name`)
  await title.click()
  const menu = page.getByTestId('shell-level-menu')
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: 'New level' }).click()
  await expect(title).toContainText('Level 2')
  // Only the new level's one layer is in the dock (Background and Terrain are map-wide).
  const tiles = dock(page).locator('[data-layer-tile]')
  await expect(tiles).toHaveCount(1)
  await expect(dock(page).locator('[data-layer-tile][data-name="Warren"]')).toHaveCount(0)

  // Add layer lands on the new level.
  await dock(page).getByRole('button', { name: 'Add layer' }).click()
  // The new layer's name opens for typing; the default will do.
  await expect(page.getByRole('dialog', { name: 'Rename layer' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Rename layer' })).toHaveCount(0)
  const onLevel = await inPage<number>(
    page,
    `(s) => s().layers.filter((l) => l.type === 'dungeon' && l.levelId === s().ui.activeLevelId).length`,
  )
  expect(onLevel).toBe(2)

  // Level settings opens the Level card; a floor tint pinned there is the level's look.
  await title.click()
  await menu.getByRole('menuitem', { name: 'Level settings' }).click()
  await expect(card(page)).toHaveAttribute('data-kind', 'level')
  await expect(card(page).getByTestId('look-floor-source')).toHaveText('Inherits Map')
  await pinColour(page, card(page).getByTestId('look-floor'), '#20ff60')
  await expect(card(page).getByTestId('look-floor-source')).toHaveText('Pinned')
  const levelTint = await inPage<string | undefined>(
    page,
    `(s) => s().levels.find((l) => l.id === s().ui.activeLevelId)?.look?.floorTint`,
  )
  expect(levelTint).toBe('#20ff60')
  await undo(page)
  await expect(card(page).getByTestId('look-floor-source')).toHaveText('Inherits Map')

  // Switching back shows the warren again.
  await title.click()
  await menu.getByRole('menuitemradio', { name: new RegExp(warrenLevel) }).click()
  await expect(dock(page).locator('[data-layer-tile][data-name="Warren"]')).toHaveCount(1)
})

test('rooms: the room key writes field by field, each field undoes, and it reloads', { tag: '@text' }, async ({ page }) => {
  await openWarren(page)
  const hall = (await rooms(page)).find((r) => r.name === 'Warren Hall')!
  await selectIds(page, [hall.id])
  await card(page).getByRole('button', { name: 'Open room key' }).click()
  const editor = roomSheet(page).getByTestId('room-key-editor')
  await expect(editor).toBeVisible()
  await editor.getByRole('textbox', { name: 'Read-aloud' }).fill('A low, smoky hall.')
  await editor.getByRole('textbox', { name: 'DM notes' }).fill('Goblins are drunk.')
  // Each field writes as it loses focus: the next field's click is what lands the last.
  await editor.getByRole('textbox', { name: 'Treasure' }).click()
  await editor.getByRole('button', { name: 'Add monster' }).click()
  await editor.getByRole('textbox', { name: 'Monster name', exact: true }).fill('Goblin')
  await editor.getByRole('textbox', { name: 'Count', exact: true }).fill('x2')
  await editor.getByRole('textbox', { name: 'Treasure' }).click()

  const stored = () =>
    page.evaluate((id) => (window as Any).__store.getState().prep?.rooms.find((k: Any) => k.roomId === id) ?? null, hall.id)
  let k = await stored()
  expect(k.readAloud).toBe('A low, smoky hall.')
  expect(k.notes).toBe('Goblins are drunk.')
  expect(k.encounter.monsters).toEqual([expect.objectContaining({ name: 'Goblin', count: 2 })])

  // One step per field: the count, the name, the new row, then the notes.
  await undo(page)
  k = await stored()
  expect(k.encounter.monsters[0].count).toBe(1)
  await undo(page)
  await undo(page)
  await undo(page)
  k = await stored()
  expect(k.notes).toBe('')
  expect(k.readAloud).toBe('A low, smoky hall.')
  await key(page, 'Control+y')
  expect((await stored()).notes).toBe('Goblins are drunk.')

  await page.evaluate(() => (window as Any).__store.getState().saveCurrentMap())
  await reopenMap(page)
  await page.waitForFunction(
    (id) =>
      (window as Any).__store
        .getState()
        .prep?.rooms.some((k: Any) => k.roomId === id && k.readAloud === 'A low, smoky hall.' && k.notes === 'Goblins are drunk.'),
    hall.id,
  )
})

/**
 * Pixels the area's ring must change by more than 60 (of 255) over the gallery, lighting
 * on. Measured: the ring as it was (1.5 px ink dashes in the world, under the lighting)
 * changed 0; with its halo, above the lighting, about 600.
 */
const STRONG_MIN = 150

test('rooms: the room overlay draws above the lighting and the light icons; a selected area shows its extent', { tag: '@text' }, async ({ page }) => {
  // No light fade-in under the pixels being compared: the lights come up at once.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  // The lit preview on, as a DM checking the mood has it: the case the ring was lost in.
  await page.addInitScript(() => localStorage.setItem('mapbuilder-lit-preview', '1'))
  await openWarren(page)
  // The overlay is the last thing the screen overlay draws: over the lighting composite
  // (a multiply over the whole map) and over every light icon, so no bulb hides a badge.
  const order = await page.evaluate(() => {
    const screen = (window as Any).__pixiApp.stage.children[1]
    const labels: string[] = screen.children.map((c: Any) => String(c.label ?? ''))
    return {
      overlay: labels.indexOf('roomOverlay'),
      lights: labels.flatMap((l, i) => (l.startsWith('light-icon-') ? [i] : [])),
      composite: screen.children.findIndex((c: Any) => c.blendMode === 'multiply'),
    }
  })
  expect(order.lights.length).toBeGreaterThan(0)
  expect(order.overlay).toBeGreaterThan(Math.max(...order.lights))
  expect(order.overlay).toBeGreaterThan(order.composite)

  // An area of two rooms; with the area selected (as its header in the sheet does) the
  // gallery's face shows the dashed ring and wash, and deselecting takes them away again.
  const all = await rooms(page)
  const hall = all.find((r) => r.name === 'Warren Hall')!
  const gallery = all.find((r) => r.name === 'Web Gallery')!
  await selectIds(page, [hall.id, gallery.id])
  await page.evaluate(() => (window as Any).__store.getState().setRoomsSheetOpen(true))
  await roomSheet(page).getByTestId('rooms-new-area').click()
  await page.keyboard.press('Enter')
  const head = roomSheet(page).getByTestId('rooms-area-head').first()
  await expect(head).toBeVisible()
  const areaId = await head.getAttribute('data-area-id')
  await closeRooms(page)
  // Once round first: selecting the area opens its card, and the layer thumbnails
  // re-render after the new area; both settle before the pixels are compared.
  await selectIds(page, [areaId!])
  await selectIds(page, [])
  const box = await roomBox(page, 'Web Gallery', 4)
  // Textures stream in for a while after a map opens: compare only once the box holds still.
  await settleCanvas(page, box)
  await selectIds(page, [areaId!])
  await grabCanvas(page, 'area', box)
  await selectIds(page, [])
  await grabCanvas(page, 'after', box)
  // Pixels that change a lot (a line that reads), not just a shade: the dashed ring and its
  // halo. Compared with the frame right after, since only the selection differs between them.
  const strong = await grabDiff(page, 'after', 'area', 60)
  expect(strong).toBeGreaterThan(STRONG_MIN)
})

test('rooms: a prop drag with the room overlay on never redraws it', { tag: '@text' }, async ({ page }) => {
  await openWarren(page)
  await key(page, 'v')
  const prop = await inPage<{ id: string; x: number; y: number }>(
    page,
    `(s, layer, w2s) => {
      const a = layer().children.find((c) => c.name === 'firewood pile')
      const p = w2s(a.position.x, a.position.y)
      return { id: a.id, x: p.x, y: p.y }
    }`,
  )
  const before = await inPage<Pt>(page, `(s, layer, w2s, id) => layer().children.find((c) => c.id === id).position`, prop.id)
  await firePointer(page, 'pointerdown', prop.x, prop.y, 0.5, 1)
  await waitFrame(page, 3)
  const start = await page.evaluate(() => (window as Any).__roomOverlay.stats())
  for (let i = 1; i <= 50; i++) {
    await firePointer(page, 'pointermove', prop.x + i * 4, prop.y + i * 2, 0.5, 1)
    await waitFrame(page, 1)
  }
  const during = await page.evaluate(() => (window as Any).__roomOverlay.stats())
  await firePointer(page, 'pointerup', prop.x + 200, prop.y + 100, 0, 0)
  await waitFrame(page, 2)
  const after = await inPage<Pt>(page, `(s, layer, w2s, id) => layer().children.find((c) => c.id === id).position`, prop.id)
  expect(after).not.toEqual(before)
  expect(during.redraws - start.redraws).toBe(0)
  expect(during.shapes - start.shapes).toBe(0)

  // What one redraw costs here: all seven rooms retessellated (select all, then none).
  const ids = (await rooms(page)).map((r) => r.id)
  const s0 = await page.evaluate(() => (window as Any).__roomOverlay.stats())
  for (let i = 0; i < 10; i++) {
    await selectIds(page, i % 2 === 0 ? ids : [])
    await waitFrame(page, 2)
  }
  const s1 = await page.evaluate(() => (window as Any).__roomOverlay.stats())
  expect(s1.redraws - s0.redraws).toBeGreaterThan(0)
})

test('rooms: pinning a wall set on a room from the card and from the Wall tool’s dock, then Reset, leaves the layer and the other rooms alone', { tag: '@text' }, async ({ page }) => {
  await openWarren(page)
  const all = await rooms(page)
  const hall = all.find((r) => r.name === 'Warren Hall')!
  const looks = () =>
    inPage<string>(
      page,
      `(s, layer) => JSON.stringify({ style: layer().style, rooms: layer().rooms.map((r) => [r.id, r.look ?? null]) })`,
    )
  const before = await looks()
  const grotto = all.find((r) => r.name === 'Fungus Grotto')!
  const grottoSet = async () => {
    await selectIds(page, [grotto.id])
    const walls = card(page).getByTestId('look-walls')
    return [await walls.getByTestId('look-walls-source').textContent(), await walls.getByRole('combobox', { name: 'Set' }).textContent()]
  }
  const grottoBefore = await grottoSet()

  await selectIds(page, [hall.id])
  const walls = card(page).getByTestId('look-walls')
  await pinFirstWallSet(page, walls)
  await expect(walls.getByTestId('look-walls-source')).toHaveText('Pinned')
  // The Wall tool's dock acts on the picked room: picking the tool drops the selection, so the room is picked again after.
  await pickTool(page, 'wall')
  await selectIds(page, [hall.id])
  await dock(page).getByTestId('design-wall-look').locator('[data-composite="tile"]').last().click()
  await waitFrame(page, 2)
  expect((await rooms(page)).find((r) => r.id === hall.id)?.look?.wallTextureSetId).toBeTruthy()
  await key(page, 'v')
  await selectIds(page, [hall.id])
  await expect(walls.getByTestId('look-walls-source')).toHaveText('Pinned')
  await walls.getByRole('button', { name: 'Reset' }).click()
  await expect(walls.getByTestId('look-walls-source')).toHaveText(/^Inherits/)
  expect(await looks()).toBe(before)
  expect(await grottoSet()).toEqual(grottoBefore)
})

test('rooms: the rooms sheet - a mouse drag moves a row into an area, Shift and Ctrl clicks multi-select, a bare key icon opens the key', { tag: '@text' }, async ({ page }) => {
  await openWarren(page)
  const all = await rooms(page)
  const hall = all.find((r) => r.name === 'Warren Hall')!
  await selectIds(page, [hall.id])
  await page.evaluate(() => (window as Any).__store.getState().setRoomsSheetOpen(true))
  await roomSheet(page).getByTestId('rooms-new-area').click()
  await page.keyboard.press('Enter')
  const head = roomSheet(page).getByTestId('rooms-area-head').first()
  await expect(head).toBeVisible()
  const areaId = await head.getAttribute('data-area-id')

  // A real mouse drag (press, travel, release), from a row in "No area" onto the area's header.
  const row = (name: string) => roomSheet(page).getByTestId('rooms-row').filter({ hasText: name })
  const from = (await row('Web Gallery').boundingBox())!
  const to = (await head.boundingBox())!
  await page.mouse.move(from.x + 40, from.y + from.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(from.x + 40, from.y + from.height / 2 + ((to.y + to.height / 2 - from.y - from.height / 2) * i) / 8)
  }
  await page.mouse.up()
  await expect(head).toContainText(/2/)
  expect((await rooms(page)).find((r) => r.name === 'Web Gallery')?.areaId).toBe(areaId)
  await undo(page)
  expect((await rooms(page)).find((r) => r.name === 'Web Gallery')?.areaId).toBeUndefined()

  // Click, Shift-click: the run between; Ctrl-click: one more, or one less.
  const ids = async () => (await sel(page)).slice().sort()
  const rows = roomSheet(page).getByTestId('rooms-row')
  await rows.nth(1).click()
  await rows.nth(3).click({ modifiers: ['Shift'] })
  const order = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-room-id')!))
  expect(await ids()).toEqual(order.slice(1, 4).sort())
  await rows.nth(5).click({ modifiers: ['Control'] })
  expect(await ids()).toEqual([...order.slice(1, 4), order[5]].sort())
  await rows.nth(2).click({ modifiers: ['Control'] })
  expect(await ids()).toEqual([order[1], order[3], order[5]].sort())

  // The key icon of a room with no key opens its key editor.
  await roomSheet(page).locator('[data-testid="rooms-key-open"][data-keyed="false"]').first().click()
  await expect(roomSheet(page).getByTestId('room-key-editor')).toBeVisible()
})

// ─── Levels with rooms ───────────────────────────────────────────────────────

test('layers: Duplicate puts the copy on the tile right of the source; its rooms get new ids', { tag: '@text' }, async ({ page }) => {
  await openWarren(page)
  const tile = (name: string) => dock(page).locator(`[data-testid="shell-layer-tile"][data-name="${name}"]`)
  await tile('Warren').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Duplicate' }).click()
  await expect(tile('Warren copy')).toBeVisible()
  const names = await dock(page).locator('[data-layer-tile]').evaluateAll((els) => els.map((e) => e.getAttribute('data-name')))
  expect(names.indexOf('Warren copy')).toBe(names.indexOf('Warren') + 1)
  const ids = await inPage<{ src: string[]; copy: string[]; copyChildren: number; srcChildren: number }>(
    page,
    `(s) => { const src = s().layers.find((l) => l.name === 'Warren'); const copy = s().layers.find((l) => l.name === 'Warren copy');
      return { src: src.rooms.map((r) => r.id), copy: copy.rooms.map((r) => r.id), copyChildren: copy.children.length, srcChildren: src.children.length } }`,
  )
  expect(ids.copy).toHaveLength(ids.src.length)
  expect(ids.copy.some((id) => ids.src.includes(id))).toBe(false)
  expect(ids.copyChildren).toBe(ids.srcChildren)
  expect(await inPage<string>(page, `(s) => s().ui.activeLayerId`)).toBe(
    await inPage<string>(page, `(s) => s().layers.find((l) => l.name === 'Warren copy').id`),
  )
})

// ─── Zones ───────────────────────────────────────────────────────────────────

/** A 1x1 PNG, enough for the note image import. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

/** The warren, saved, with a circle zone selected on its dungeon layer and its card showing. */
async function openWithZone(page: Page): Promise<void> {
  await openWarren(page)
  await page.evaluate(async () => {
    const st = (window as Any).__store.getState()
    const l = st.layers.find((x: Any) => x.id === st.ui.activeLayerId)
    st.addChild(l.id, {
      id: 'zq', name: 'Ambush', childType: 'zone', visible: true, shape: { kind: 'circle', position: { x: 3, y: 3 }, radius: 2 },
    })
    await (window as Any).__store.getState().saveCurrentMap()
    ;(window as Any).__store.getState().setSelectedIds(['zq'])
  })
  await waitFrame(page, 3)
  await expect(card(page)).toHaveAttribute('data-kind', 'zone')
}

const zone = (page: Page) =>
  inPage<Any>(page, `(s) => s().layers.flatMap((l) => l.children ?? []).find((c) => c.id === 'zq') ?? null`)
const prep = (page: Page) => inPage<Any>(page, `(s) => s().prep ?? { triggers: [], notes: [] }`)
const zones = (page: Page) =>
  inPage<Any[]>(page, `(s, layer) => layer().children.filter((c) => c.childType === 'zone')`)

async function openSheet(page: Page) {
  await card(page).getByRole('button', { name: 'More…' }).click()
  const sheet = page.getByTestId('shell-zone-sheet')
  await expect(sheet).toBeVisible()
  return sheet
}

/** Types into a field and lets it go, the way a blur commits. */
async function fill(field: Locator, value: string) {
  await field.fill(value)
  await field.press('Enter')
}

test('zones: the Zone tool draws a point, a circle and a rectangle by the dock’s Shape, and undo takes the last back', { tag: '@text' }, async ({ page }) => {
  await openWarren(page)
  await pickTool(page, 'zone')
  expect(await dockColumns(page)).toEqual(['level', 'layers', 'Shape'])
  await expect(status(page)).toContainText('Click to place a point zone')
  const hall = await room(page, 'Warren Hall')
  const [x, y] = hall.anchor as [number, number]
  const before = (await zones(page)).length

  await clickWorld(page, { x, y })
  let list = await zones(page)
  expect(list).toHaveLength(before + 1)
  expect(list.at(-1).shape.kind).toBe('point')

  await dock(page).getByRole('button', { name: 'Circle', exact: true }).click()
  await expect(status(page)).toContainText('Drag to draw the zone')
  await dragWorld(page, { x: x + 1, y: y + 1 }, { x: x + 3, y: y + 1 })
  list = await zones(page)
  expect(list).toHaveLength(before + 2)
  expect(list.at(-1).shape).toMatchObject({ kind: 'circle' })
  expect(list.at(-1).shape.radius).toBeGreaterThan(0.5)

  await dock(page).getByRole('button', { name: 'Rect', exact: true }).click()
  await dragWorld(page, { x: x - 3, y: y - 3 }, { x: x - 1, y: y - 1 })
  list = await zones(page)
  expect(list).toHaveLength(before + 3)
  expect(list.at(-1).shape).toMatchObject({ kind: 'rect' })
  expect(list.at(-1).shape.width).toBeGreaterThan(0.5)

  await undo(page)
  expect(await zones(page)).toHaveLength(before + 2)
})

test('zones: More… opens the zone sheet with the shape, the explore lock and no stray styling', { tag: '@text' }, async ({ page }) => {
  await openWithZone(page)
  const sheet = await openSheet(page)
  await expect(sheet.getByTestId('zone-sheet')).toBeVisible()
  await expect(sheet.getByTestId('zone-shape')).toContainText('Circle')
  await expect(sheet.getByRole('switch', { name: 'Blocks auto-explore' })).toBeVisible()
})

test('zones: a rename in the sheet names the zone and the card follows', { tag: '@text' }, async ({ page }) => {
  await openWithZone(page)
  const sheet = await openSheet(page)
  await fill(sheet.getByRole('textbox', { name: 'Zone name' }), 'Wolf den')
  await expect.poll(async () => (await zone(page)).name).toBe('Wolf den')
  await expect(card(page).getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Wolf den')
})

test('zones: a trigger - Within radius shows Radius, Enabled appears once', { tag: '@text' }, async ({ page }) => {
  await openWithZone(page)
  const sheet = await openSheet(page)
  await sheet.getByRole('button', { name: 'Add trigger' }).click()
  const trig = sheet.getByRole('group', { name: 'Trigger 1' })
  await expect(trig.getByRole('switch', { name: 'Enabled' })).toHaveCount(1)
  await expect(trig.getByText('Enabled', { exact: true })).toHaveCount(0)
  await expect(trig.getByLabel('Trigger radius')).toHaveCount(0)
  await trig.getByRole('combobox', { name: 'Condition' }).click()
  await page.getByRole('option', { name: 'Within radius' }).click()
  await fill(trig.getByLabel('Trigger radius'), '12.5')
  await expect.poll(async () => (await zone(page)).shape.radius).toBe(12.5)
  expect((await prep(page)).triggers[0].when).toEqual({ kind: 'within-radius', zoneId: 'zq' })
  // Four characters show whole: nothing of "12.5" is clipped.
  const field = trig.getByLabel('Trigger radius')
  await expect(field).toHaveValue('12.5')
  const fit = await field.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }))
  expect(fit.scroll).toBeLessThanOrEqual(fit.client)
})

test('zones: the card’s Delete stays clickable with the Zone sheet open', { tag: '@text' }, async ({ page }) => {
  await openWithZone(page)
  await openSheet(page)
  await card(page).getByRole('button', { name: 'Delete' }).click()
  await expect.poll(async () => await zone(page)).toBeNull()
})

test('zones: a Show text action is added and its text written', { tag: '@text' }, async ({ page }) => {
  await openWithZone(page)
  const sheet = await openSheet(page)
  await sheet.getByRole('button', { name: 'Add trigger' }).click()
  const trig = sheet.getByRole('group', { name: 'Trigger 1' })
  await trig.getByRole('button', { name: 'Add action' }).click()
  await trig.getByRole('textbox', { name: 'Text', exact: true }).fill('The wolves wake.')
  await trig.getByLabel('Trigger name').click()
  await expect.poll(async () => (await prep(page)).triggers[0].actions).toEqual([
    { kind: 'show-text', text: 'The wolves wake.', toPlayers: true },
  ])
})

test('zones: a note with an image', { tag: '@text' }, async ({ page }) => {
  await openWithZone(page)
  const sheet = await openSheet(page)
  await sheet.getByRole('button', { name: 'Add note' }).click()
  const note = sheet.getByRole('group', { name: 'Note 1' })
  await fill(note.getByLabel('Note title'), 'Growling')
  const grown = sheet.getByRole('group', { name: 'Growling' })
  await grown.getByTestId('zone-note-file').setInputFiles({ name: 'growl.png', mimeType: 'image/png', buffer: PNG })
  await expect(grown.getByTestId('zone-note-image')).toHaveCount(1)
  const n = (await prep(page)).notes[0]
  expect(n.title).toBe('Growling')
  expect(n.imageKeys).toHaveLength(1)
  expect(await inPage(page, `(s, layer, w2s, k) => typeof s().assets.customImages[k]`, n.imageKeys[0])).toBe('string')
})

test('zones: a trigger saves within seconds and survives a reload', { tag: '@text' }, async ({ page }) => {
  await openWithZone(page)
  const sheet = await openSheet(page)
  await sheet.getByRole('button', { name: 'Add trigger' }).click()
  // Autosave alone: the stored map holds the trigger within seconds, read back from IndexedDB.
  // A string, so the page's own module loader resolves the imports, not the spec's transform.
  const stored = () =>
    page.evaluate<number>(`(async () => {
      const { getMapDB } = await import('/src/store/slices/maps.ts')
      const { deserializeFromBytes } = await import('/src/io/saveLoad.ts')
      const bytes = await (await getMapDB()).getMapBlob(window.__store.getState().activeMapId)
      return bytes ? ((await deserializeFromBytes(bytes)).prep?.triggers?.length ?? 0) : 0
    })()`)
  await expect.poll(stored, { timeout: 8000 }).toBe(1)
  await reopenMap(page)
  await expect.poll(async () => (await prep(page)).triggers.map((t: Any) => t.name)).toEqual(['Trigger 1'])
})

test('zones: Delete on a zone with a trigger warns that the trigger now references nothing', { tag: '@text' }, async ({ page }) => {
  await openWithZone(page)
  const sheet = await openSheet(page)
  await sheet.getByRole('button', { name: 'Add trigger' }).click()
  await sheet.getByRole('button', { name: 'Close Zone' }).click()
  await card(page).getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByLabel('Notifications alt+T').getByText(/1 trigger now references nothing/)).toBeVisible()
  expect(await zone(page)).toBeNull()
})

test('zones: the zone card’s X and Y still move the zone', { tag: '@text' }, async ({ page }) => {
  await openWithZone(page)
  await fill(card(page).getByRole('textbox', { name: 'X', exact: true }), '6')
  await fill(card(page).getByRole('textbox', { name: 'Y', exact: true }), '7.5')
  await expect.poll(async () => (await zone(page)).shape.position).toEqual({ x: 6, y: 7.5 })
})
