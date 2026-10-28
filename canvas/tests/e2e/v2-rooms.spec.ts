import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, type Locator, type Page } from '@playwright/test'
import { firePointer, waitForBoot, waitFrame } from './helpers'

/**
 * Rooms in /v2, end to end: the warren copy opens with its seven rooms, a room selects
 * and renames, a room's wall pin recolours only that room, Divide splits one in two,
 * Suggest finds the floors with no room, areas group and pin, levels switch the strip,
 * and the room key writes and reloads. Each map edit undoes.
 */

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any

const WARREN = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../session/testdata/goblin-warren.mapbuilder', import.meta.url)), 'utf8'),
)


/**
 * Run `fn` (source text) in the page with the store getter, the active dungeon layer and
 * a world → screen mapping. Source text, so the page needs nothing imported.
 */
async function inPage<T>(page: Page, fn: string, arg?: unknown): Promise<T> {
  return page.evaluate(
    ({ fn, arg }) => {
      const w = window as Any
      const s = () => w.__store.getState()
      const layer = () => s().layers.find((l: Any) => l.id === s().ui.activeLayerId && l.type === 'dungeon')
      const world = () => w.__pixiApp.stage.children[0]
      const w2s = (x: number, y: number) => {
        const r = w.__pixiApp.canvas.getBoundingClientRect()
        const wd = world()
        return { x: r.left + x * wd.scale.x + wd.position.x, y: r.top + y * wd.scale.x + wd.position.y }
      }
      return new Function('s', 'layer', 'w2s', 'arg', `return (${fn})(s, layer, w2s, arg)`)(s, layer, w2s, arg)
    },
    { fn, arg },
  )
}

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

const select = (page: Page, ids: string[]) =>
  page.evaluate((ids) => (window as Any).__store.getState().setSelectedIds(ids), ids)

const undo = async (page: Page) => {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await page.keyboard.press('Control+z')
  await waitFrame(page, 2)
}

/** Pin a colour through a card's swatch: open it, type the hex, close it (one undo step). */
async function pinColour(page: Page, section: Locator, hex: string): Promise<void> {
  await section.getByRole('button', { name: /^Tint colour/ }).click()
  const hexField = page.getByLabel('Hex colour')
  await hexField.fill(hex)
  await hexField.press('Enter')
  await page.keyboard.press('Escape')
  await waitFrame(page, 2)
}

/** Pin the first installed wall set through a card's Walls section, so a wall tint has stones to colour. */
async function pinFirstWallSet(section: Locator): Promise<void> {
  const set = section.getByLabel('Wall set')
  const options = await set
    .locator('option')
    .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean))
  expect(options.length).toBeGreaterThan(0)
  await set.selectOption(options[0])
}

/** A box in canvas CSS px around a room's face (its bounding box), optionally grown by `pad` px. */
async function roomBox(page: Page, name: string, pad = 0): Promise<{ x: number; y: number; width: number; height: number }> {
  return inPage(
    page,
    `(s, layer, w2s, arg) => {
      const r = layer().rooms.find((x) => x.name === arg.name)
      const xs = r.face.map((p) => p[0]); const ys = r.face.map((p) => p[1])
      const a = w2s(Math.min(...xs), Math.min(...ys)); const b = w2s(Math.max(...xs), Math.max(...ys))
      return { x: a.x - arg.pad, y: a.y - arg.pad, width: b.x - a.x + 2 * arg.pad, height: b.y - a.y + 2 * arg.pad }
    }`,
    { name, pad },
  )
}

/**
 * Keep the WebGL canvas's pixels inside `box` (page CSS px) under `key`, in the page.
 * Reads the canvas itself, not a page screenshot, so cards and sheets over the map never
 * count (?e2e=1 keeps the drawing buffer for exactly this).
 */
async function grabCanvas(page: Page, key: string, box: { x: number; y: number; width: number; height: number }): Promise<void> {
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

/** Wait until the canvas inside `box` holds still for a second (late textures, thumbnails), up to 20 s. */
async function settleCanvas(page: Page, box: { x: number; y: number; width: number; height: number }): Promise<void> {
  await grabCanvas(page, 'settle-a', box)
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1000)
    await grabCanvas(page, 'settle-b', box)
    if ((await grabDiff(page, 'settle-a', 'settle-b', 0)) === 0) return
    await grabCanvas(page, 'settle-a', box)
  }
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

/** Into the /v2 editor on a fresh blank map. */
async function openEditor(page: Page): Promise<void> {
  await page.goto('/v2?e2e=1')
  await waitForBoot(page)
  await page.getByTestId('v2-new-map-card').click()
  await page.getByTestId('v2-new-map-submit').click()
  await expect(page.getByTestId('v2-editor')).toBeVisible()
}

/** Open a copy of the goblin warren, framed, its rooms measured. */
async function openWarren(page: Page): Promise<void> {
  await openEditor(page)
  await page.evaluate(async (data) => {
    const st = (window as Any).__store.getState()
    st.loadFromFile(structuredClone(data))
    st.setRoomsSheetOpen(false)
    st.setSelectedIds([])
    await st.saveCurrentMap()
  }, WARREN)
  await page.waitForFunction(() => {
    const s = (window as Any).__store.getState()
    const l = s.layers.find((x: Any) => x.type === 'dungeon')
    return (l?.rooms ?? []).length > 0 && l.rooms.every((r: Any) => Array.isArray(r.face) && r.face.length > 2)
  })
  await page.keyboard.press('Control+0')
  await waitFrame(page, 6)
}

async function roomScreen(page: Page, name: string): Promise<{ x: number; y: number }> {
  return inPage(
    page,
    `(s, layer, w2s, name) => { const r = layer().rooms.find((x) => x.name === name); return w2s(r.anchor[0], r.anchor[1]) }`,
    name,
  )
}

/** A screenshot of a room's box, for "this room changed, that one did not". */
async function roomShot(page: Page, name: string): Promise<Buffer> {
  const box = await inPage<{ x: number; y: number; width: number; height: number }>(
    page,
    `(s, layer, w2s, name) => {
      const r = layer().rooms.find((x) => x.name === name)
      const xs = r.face.map((p) => p[0]); const ys = r.face.map((p) => p[1])
      const a = w2s(Math.min(...xs), Math.min(...ys)); const b = w2s(Math.max(...xs), Math.max(...ys))
      return { x: a.x, y: a.y, width: Math.max(4, b.x - a.x), height: Math.max(4, b.y - a.y) }
    }`,
    name,
  )
  return page.screenshot({ clip: box })
}

test('the warren opens with seven numbered, named rooms and the Rooms tab', async ({ page }) => {
  await openWarren(page)
  const list = await rooms(page)
  expect(list).toHaveLength(7)
  expect(list.every((r) => typeof r.number === 'number' && r.name.length > 0)).toBe(true)
  expect(new Set(list.map((r) => r.number))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7]))

  // The tab sits between Walls and Props, with the mock's tools.
  const tabs = await page.getByRole('tablist', { name: 'Tool families' }).getByRole('tab').allTextContents()
  expect(tabs.slice(0, 4)).toEqual(['Floors', 'Walls', 'Rooms', 'Props'])
  await page.getByTestId('v2-dock-tab-rooms').click()
  await expect(page.getByTestId('v2-tool-roomRect')).toBeVisible()
  await expect(page.getByTestId('v2-tool-roomPolygon')).toBeVisible()
  await expect(page.getByTestId('v2-tool-divide')).toBeVisible()
  await expect(page.getByTestId('v2-room-count')).toHaveText('7 rooms')
  await page.screenshot({ path: test.info().outputPath('rooms-tab.png') })

  // The list shows them all, numbered.
  await page.getByTestId('v2-rooms-list-toggle').click()
  await expect(page.getByTestId('v2-room-row')).toHaveCount(7)
  await page.screenshot({ path: test.info().outputPath('rooms-list.png') })
})

test('a click on Warren Hall selects it, the card renames it, and the name survives a reload', async ({ page }) => {
  await openWarren(page)
  await page.keyboard.press('v')
  const at = await roomScreen(page, 'Warren Hall')
  await firePointer(page, 'pointerdown', at.x, at.y, 0.5, 1)
  await firePointer(page, 'pointerup', at.x, at.y, 0, 0)
  await waitFrame(page, 2)
  const card = page.getByTestId('v2-selection-card')
  await expect(card).toHaveAttribute('data-room-kind', 'room')
  await expect(card.locator('.v2-sel__name')).toHaveText('Warren Hall')
  await expect(page.getByTestId('v2-status-hint')).toContainText('delete room, keep floor')
  await page.screenshot({ path: test.info().outputPath('room-card.png') })

  const name = card.getByLabel('Room name')
  await name.fill('Great Hall')
  await name.press('Enter')
  expect((await rooms(page)).some((r) => r.name === 'Great Hall')).toBe(true)

  await undo(page)
  expect((await rooms(page)).some((r) => r.name === 'Warren Hall')).toBe(true)
  await page.keyboard.press('Control+y')
  await waitFrame(page, 2)
  expect((await rooms(page)).some((r) => r.name === 'Great Hall')).toBe(true)

  await page.evaluate(() => (window as Any).__store.getState().saveCurrentMap())
  await page.reload()
  await waitForBoot(page)
  await page.getByTestId('v2-map-card').first().click()
  await expect(page.getByTestId('v2-editor')).toBeVisible()
  await page.waitForFunction(() =>
    (window as Any).__store.getState().layers.some((l: Any) => (l.rooms ?? []).some((r: Any) => r.name === 'Great Hall')),
  )
})

test('a wall tint pinned on one room recolours that room only, and undoes', async ({ page }) => {
  await openWarren(page)
  const hall = (await rooms(page)).find((r) => r.name === 'Warren Hall')!
  const hallBefore = await roomShot(page, 'Warren Hall')
  const denBefore = await roomShot(page, "Chief's Den")
  await select(page, [hall.id])
  const walls = page.getByTestId('v2-look-walls')
  await expect(walls.getByTestId('v2-look-walls-source')).toHaveText(/^Inherits/)
  await pinFirstWallSet(walls)
  await pinColour(page, walls, '#ff2020')
  await expect(walls.getByTestId('v2-look-walls-source')).toHaveText('Pinned')
  expect((await rooms(page)).find((r) => r.id === hall.id)?.look).toMatchObject({ wallTextureTint: '#ff2020' })

  // Out of the way of the shots: nothing selected, the card gone.
  await select(page, [])
  await page.waitForTimeout(400)
  await waitFrame(page, 4)
  const hallAfter = await roomShot(page, 'Warren Hall')
  const denAfter = await roomShot(page, "Chief's Den")
  expect(hallAfter.equals(hallBefore)).toBe(false)
  expect(denAfter.equals(denBefore)).toBe(true)

  // Undo takes the tint off; Reset clears every wall pin at once.
  await undo(page)
  expect((await rooms(page)).find((r) => r.id === hall.id)?.look?.wallTextureTint).toBeUndefined()
  await select(page, [hall.id])
  await walls.getByRole('button', { name: 'Reset' }).click()
  await expect(walls.getByTestId('v2-look-walls-source')).toHaveText(/^Inherits/)
})

test('Divide across Warren Hall opens the split dialog; Split makes eight rooms, undo seven', async ({ page }) => {
  await openWarren(page)
  await page.getByTestId('v2-dock-tab-rooms').click()
  await page.keyboard.press('x')
  expect(await inPage(page, `(s) => s().tools.activeTool`)).toBe('divide')
  await expect(page.getByTestId('v2-status-hint')).toContainText('drag across a floor: ends snap to the walls')

  // A vertical cut through the hall's anchor, past its walls at both ends.
  const cut = await inPage<{ a: { x: number; y: number }; b: { x: number; y: number } }>(
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
  await page.screenshot({ path: test.info().outputPath('split-dialog.png') })
  await page.getByTestId('v2-split-commit').click()
  await expect(dialog).toBeHidden()
  expect(await rooms(page)).toHaveLength(8)

  // Both halves keep their anchors by the cut, but their badges and name chips sit inside
  // their own halves: the two labels never overlap at the divider.
  await page.keyboard.press('v')
  await select(page, [])
  await page.waitForFunction(() => {
    const s = (window as Any).__store.getState()
    const l = s.layers.find((x: Any) => x.id === s.ui.activeLayerId)
    return l.rooms.filter((r: Any) => r.name.startsWith('Warren Hall')).every((r: Any) => Array.isArray(r.face) && r.face.length > 2)
  })
  // At 100%, centred on the hall (at Fit the whole warren is a few hundred px across).
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
  const [p, q] = rects as { x: number; y: number; width: number; height: number }[]
  const overlap = p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height
  await page.screenshot({ path: test.info().outputPath('split-labels.png') })
  expect(overlap).toBe(false)
  await undo(page)
  expect(await rooms(page)).toHaveLength(7)
})

test('Suggest on a map with two floors and no rooms proposes two; Accept all adds them', async ({ page }) => {
  await openEditor(page)
  await page.evaluate(() => {
    const s = (window as Any).__store.getState()
    const l = s.layers.find((x: Any) => x.type === 'dungeon')
    const rect = (id: string, x: number) => ({
      id,
      name: id,
      childType: 'shape',
      visible: true,
      shapeType: 'rectangle',
      contours: [[[x, 2], [x + 6, 2], [x + 6, 8], [x, 8]]],
      textureScale: 1,
      textureOffsetX: 0,
      textureOffsetY: 0,
      textureFillRotation: 0,
      textureTint: '#ffffff',
    })
    s.addChild(l.id, rect('a', 2))
    s.addChild(l.id, rect('b', 14))
  })
  await page.waitForFunction(() => {
    const l = (window as Any).__store.getState().layers.find((x: Any) => x.type === 'dungeon')
    return Array.isArray(l.mergedFloor) && l.mergedFloor.length === 2
  })
  await page.getByTestId('v2-dock-tab-rooms').click()
  await page.getByTestId('v2-suggest-rooms').click()
  await expect(page.getByTestId('v2-suggest-bar')).toContainText('2 rooms suggested')
  await expect(page.getByTestId('v2-room-count')).toHaveText('0 rooms · 2 suggested')
  await expect(page.getByTestId('v2-status-hint')).toContainText('enclosed floor with no room yet')
  await page.screenshot({ path: test.info().outputPath('suggest.png') })
  await page.getByTestId('v2-suggest-accept').click()
  await expect(page.getByTestId('v2-suggest-bar')).toBeHidden()
  expect(await rooms(page)).toHaveLength(2)
  await undo(page)
  expect(await rooms(page)).toHaveLength(0)

  // Enter accepts all from the keyboard; Escape dismisses.
  await page.getByTestId('v2-suggest-rooms').click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('v2-suggest-bar')).toBeHidden()
  await page.getByTestId('v2-suggest-rooms').click()
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await page.keyboard.press('Enter')
  expect(await rooms(page)).toHaveLength(2)
})

test('a new area from two rooms groups them; its wall pin reaches both, a room pin wins', async ({ page }) => {
  await openWarren(page)
  const all = await rooms(page)
  const hall = all.find((r) => r.name === 'Warren Hall')!
  const gallery = all.find((r) => r.name === 'Web Gallery')!
  await select(page, [hall.id, gallery.id])
  await page.evaluate(() => (window as Any).__store.getState().setRoomsSheetOpen(true))
  await page.getByTestId('v2-new-area').click()
  // The new area's name is up for editing straight away.
  await page.keyboard.press('Control+a')
  await page.keyboard.type('Lower warren')
  await page.keyboard.press('Enter')
  const head = page.getByTestId('v2-area-head').filter({ hasText: 'Lower warren' })
  await expect(head).toBeVisible()
  await expect(head.locator('.v2-rarea__cnt')).toHaveText('2')
  await page.screenshot({ path: test.info().outputPath('areas.png') })

  // The header selects the area; close the sheet to see its card.
  await head.locator('.v2-rarea__name').click()
  await page.evaluate(() => (window as Any).__store.getState().setRoomsSheetOpen(false))
  const card = page.getByTestId('v2-selection-card')
  await expect(card).toHaveAttribute('data-room-kind', 'area')
  const areaWalls = card.getByTestId('v2-look-walls')
  await pinFirstWallSet(areaWalls)
  await pinColour(page, areaWalls, '#2060ff')
  await expect(card.getByTestId('v2-look-walls-source')).toHaveText('Pinned')

  // Both rooms now inherit the area's walls; a room's own pin wins over it.
  const sourceOf = async (id: string) => {
    await select(page, [id])
    await waitFrame(page, 1)
    return page.getByTestId('v2-look-walls-source').textContent()
  }
  expect(await sourceOf(gallery.id)).toBe('Inherits Lower warren')
  expect(await sourceOf(hall.id)).toBe('Inherits Lower warren')
  await pinColour(page, page.getByTestId('v2-look-walls'), '#ff2020')
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

test('a new level switches the strip to its first layer; a level floor tint pins on the level', async ({ page }) => {
  await openWarren(page)
  await expect(page.getByTestId('v2-level-picker')).toContainText('1 of 1 level')
  await page.getByTestId('v2-level-button').click()
  await expect(page.getByRole('menu', { name: 'Levels' })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('level-menu.png') })
  await page.getByTestId('v2-level-new').click()
  await expect(page.getByTestId('v2-level-picker')).toContainText('2 of 2 levels')
  // Only the new level's one layer is in the strip (Background and Terrain are map-wide).
  const tile = (name: string | RegExp) =>
    page.getByTestId('v2-film-tile').filter({ has: page.getByRole('button', { name }) })
  await expect(tile(/^Draw on Layer/)).toHaveCount(1)
  await expect(tile('Draw on Warren')).toHaveCount(0)

  // Add layer lands on the new level.
  await page.getByTestId('v2-filmstrip').getByRole('button', { name: 'Add layer' }).click()
  const onLevel = await inPage<number>(
    page,
    `(s) => s().layers.filter((l) => l.type === 'dungeon' && l.levelId === s().ui.activeLevelId).length`,
  )
  expect(onLevel).toBe(2)

  // Level settings → the Level card; a floor tint pinned there is the level's look.
  await page.getByTestId('v2-level-button').click()
  await page.getByTestId('v2-level-settings').click()
  const card = page.getByTestId('v2-selection-card')
  await expect(card).toHaveAttribute('data-room-kind', 'level')
  await expect(card.getByTestId('v2-look-floor-source')).toHaveText('Inherits Map')
  await page.screenshot({ path: test.info().outputPath('level-card.png') })
  await pinColour(page, card.getByTestId('v2-look-floor'), '#20ff60')
  await expect(card.getByTestId('v2-look-floor-source')).toHaveText('Pinned')
  const levelTint = await inPage<string | undefined>(
    page,
    `(s) => s().levels.find((l) => l.id === s().ui.activeLevelId)?.look?.floorTint`,
  )
  expect(levelTint).toBe('#20ff60')
  await undo(page)
  await expect(card.getByTestId('v2-look-floor-source')).toHaveText('Inherits Map')

  // Switching back shows the warren again.
  await page.getByTestId('v2-level-button').click()
  await page.getByRole('menuitemradio').first().click()
  await expect(tile('Draw on Warren')).toHaveCount(1)
})

test('the room key writes field by field, each field undoes, and it reloads', async ({ page }) => {
  await openWarren(page)
  const hall = (await rooms(page)).find((r) => r.name === 'Warren Hall')!
  await select(page, [hall.id])
  await page.getByTestId('v2-selection-card').getByRole('button', { name: 'Open room key' }).click()
  const key = page.getByTestId('v2-room-key')
  await expect(key).toBeVisible()
  await key.getByLabel('Read-aloud').fill('A low, smoky hall.')
  await key.getByLabel('DM notes').fill('Goblins are drunk.')
  await key.getByLabel('Treasure').click()
  await key.getByRole('button', { name: 'Add monster' }).click()
  await key.getByLabel('Monster name', { exact: true }).fill('Goblin')
  await key.getByLabel('Count', { exact: true }).fill('x2')
  await key.getByLabel('Treasure').click()
  await page.screenshot({ path: test.info().outputPath('room-key.png') })

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
  await page.keyboard.press('Control+y')
  await waitFrame(page, 2)
  expect((await stored()).notes).toBe('Goblins are drunk.')

  await page.evaluate(() => (window as Any).__store.getState().saveCurrentMap())
  await page.reload()
  await waitForBoot(page)
  await page.getByTestId('v2-map-card').first().click()
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

test('the room overlay draws above the lighting and the light icons; a selected area shows its extent', async ({ page }) => {
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
  await page.screenshot({ path: test.info().outputPath('overlay-over-lights.png') })

  // An area of two rooms; with the area selected (as its header in the sheet does) the
  // gallery's face shows the dashed ring and wash, and deselecting takes them away again.
  const all = await rooms(page)
  const hall = all.find((r) => r.name === 'Warren Hall')!
  const gallery = all.find((r) => r.name === 'Web Gallery')!
  await select(page, [hall.id, gallery.id])
  await page.evaluate(() => (window as Any).__store.getState().setRoomsSheetOpen(true))
  await page.getByTestId('v2-new-area').click()
  await page.keyboard.press('Enter')
  const head = page.getByTestId('v2-area-head').first()
  await expect(head).toBeVisible()
  const areaId = await head.getAttribute('data-area-id')
  await page.evaluate(() => (window as Any).__store.getState().setRoomsSheetOpen(false))
  // Once round first: selecting the area opens its card, and the filmstrip re-renders its
  // thumbnails after the new area; both settle before the pixels are compared.
  await select(page, [areaId!])
  await select(page, [])
  const box = await roomBox(page, 'Web Gallery', 4)
  // Textures stream in for a while after a map opens: compare only once the box holds still.
  await settleCanvas(page, box)
  await select(page, [areaId!])
  await grabCanvas(page, 'area', box)
  await page.screenshot({ path: test.info().outputPath('area-extent.png') })
  await select(page, [])
  await grabCanvas(page, 'after', box)
  // Pixels that change a lot (a line that reads), not just a shade: the dashed ring and its
  // halo. Compared with the frame right after, since only the selection differs between them.
  const changed = await grabDiff(page, 'after', 'area')
  const strong = await grabDiff(page, 'after', 'area', 60)
  console.log(`[rooms] area extent: ${changed} px changed, ${strong} by more than 60, over the gallery's box (${Math.round(box.width)}×${Math.round(box.height)})`)
  expect(strong).toBeGreaterThan(STRONG_MIN)
})

test('a prop drag with the room overlay on never redraws it', async ({ page }) => {
  await openWarren(page)
  await page.keyboard.press('v')
  const prop = await inPage<{ id: string; x: number; y: number }>(
    page,
    `(s, layer, w2s) => {
      const l = layer()
      const a = l.children.find((c) => c.name === 'firewood pile')
      const p = w2s(a.position.x, a.position.y)
      return { id: a.id, x: p.x, y: p.y }
    }`,
  )
  const before = await inPage<{ x: number; y: number }>(page, `(s, layer, w2s, id) => layer().children.find((c) => c.id === id).position`, prop.id)
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
  const after = await inPage<{ x: number; y: number }>(page, `(s, layer, w2s, id) => layer().children.find((c) => c.id === id).position`, prop.id)
  expect(after).not.toEqual(before)
  expect(during.redraws - start.redraws).toBe(0)
  expect(during.shapes - start.shapes).toBe(0)

  // What one redraw costs here: all seven rooms retessellated (select all, then none).
  const ids = (await rooms(page)).map((r) => r.id)
  const s0 = await page.evaluate(() => (window as Any).__roomOverlay.stats())
  for (let i = 0; i < 10; i++) {
    await select(page, i % 2 === 0 ? ids : [])
    await waitFrame(page, 2)
  }
  const s1 = await page.evaluate(() => (window as Any).__roomOverlay.stats())
  const n = s1.redraws - s0.redraws
  const ms = (s1.ms - s0.ms) / Math.max(1, n)
  console.log(`[rooms] overlay redraw: ${ms.toFixed(2)} ms each over ${n} redraws, ${(s1.shapes - s0.shapes) / Math.max(1, n)} outlines each`)
  test.info().annotations.push({ type: 'overlay redraw ms', description: ms.toFixed(2) })
  expect(n).toBeGreaterThan(0)
})

test('pinning a wall set on a room from the card and the Walls tab, then Reset, leaves the layer and the other rooms alone', async ({ page }) => {
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
    await select(page, [grotto.id])
    const walls = page.getByTestId('v2-look-walls')
    return [await walls.getByTestId('v2-look-walls-source').textContent(), await walls.getByLabel('Wall set').inputValue()]
  }
  const grottoBefore = await grottoSet()

  await select(page, [hall.id])
  const walls = page.getByTestId('v2-look-walls')
  await pinFirstWallSet(walls)
  // The Walls tab acts on the selected room: its first style swatch included.
  await page.getByTestId('v2-dock-tab-walls').click()
  await page.getByTestId('v2-swatches').getByRole('button').first().click()
  await waitFrame(page, 2)
  await expect(walls.getByTestId('v2-look-walls-source')).toHaveText('Pinned')
  await walls.getByRole('button', { name: 'Reset' }).click()
  await expect(walls.getByTestId('v2-look-walls-source')).toHaveText(/^Inherits/)
  expect(await looks()).toBe(before)
  expect(await grottoSet()).toEqual(grottoBefore)
})

test('the rooms sheet: a mouse drag moves a row into an area, Shift and Ctrl clicks multi-select, a bare key icon opens the key', async ({ page }) => {
  await openWarren(page)
  const all = await rooms(page)
  const hall = all.find((r) => r.name === 'Warren Hall')!
  await select(page, [hall.id])
  await page.evaluate(() => (window as Any).__store.getState().setRoomsSheetOpen(true))
  await page.getByTestId('v2-new-area').click()
  await page.keyboard.press('Enter')
  const head = page.getByTestId('v2-area-head').first()
  await expect(head).toBeVisible()
  const areaId = await head.getAttribute('data-area-id')

  // A real mouse drag (press, travel, release), from a row in "No area" onto the area's header.
  const row = (name: string) => page.getByTestId('v2-room-row').filter({ hasText: name })
  const from = (await row('Web Gallery').boundingBox())!
  const to = (await head.boundingBox())!
  await page.mouse.move(from.x + 40, from.y + from.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(from.x + 40, from.y + from.height / 2 + ((to.y + to.height / 2 - from.y - from.height / 2) * i) / 8)
  }
  await page.mouse.up()
  await expect(head.locator('.v2-rarea__cnt')).toHaveText('2')
  expect((await rooms(page)).find((r) => r.name === 'Web Gallery')?.areaId).toBe(areaId)
  await undo(page)
  expect((await rooms(page)).find((r) => r.name === 'Web Gallery')?.areaId).toBeUndefined()

  // Click, Shift-click: the run between; Ctrl-click: one more, or one less.
  const ids = async () => ((await page.evaluate(() => (window as Any).__store.getState().selection.selectedIds)) as string[]).slice().sort()
  const rows = page.getByTestId('v2-room-row')
  await rows.nth(1).click()
  await rows.nth(3).click({ modifiers: ['Shift'] })
  const order = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-room-id')!))
  expect(await ids()).toEqual(order.slice(1, 4).sort())
  await rows.nth(5).click({ modifiers: ['Control'] })
  expect(await ids()).toEqual([...order.slice(1, 4), order[5]].sort())
  await rows.nth(2).click({ modifiers: ['Control'] })
  expect(await ids()).toEqual([order[1], order[3], order[5]].sort())

  // The key icon of a room with no key opens its key editor.
  const bare = page.locator('[data-testid="v2-room-key-open"][data-keyed="false"]').first()
  await bare.click()
  await expect(page.getByTestId('v2-room-key')).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('sheet-key-from-icon.png') })
})
