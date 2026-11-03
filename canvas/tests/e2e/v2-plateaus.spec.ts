import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { getPixelColor, waitForBoot, waitFrame } from './helpers'
import { installStubs } from './publishStubs'

/**
 * Plateaus in the editor, on the authored test maps (session/testdata/plateau-test and
 * tower-test): plan §0 scenarios 2, 3 and 4, the hill's card readouts, and both maps and the
 * goblin warren opening, exporting a PNG and publishing. Every map's plateaus are taken off it
 * on open and drawn again with the Plateau tool (`openMap`). Then the tool itself, its card,
 * its ring editing, and how a plateau draws over terrain paint.
 */

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any
type Pt = { x: number; y: number }

const read = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../../session/testdata/${name}.mapbuilder`, import.meta.url)), 'utf8'))
const PLATEAU = read('plateau-test')
const TOWER = read('tower-test')
const WARREN = read('goblin-warren')

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

const screenOf = (page: Page, p: Pt) => inPage<Pt>(page, `(s, layer, w2s, p) => w2s(p.x, p.y)`, p)
const child = (page: Page, id: string) => inPage<Any>(page, `(s, layer, w2s, id) => layer().children.find((c) => c.id === id)`, id)
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())

/** The labels under one band's container in the plateaus sublayer (`plateau-band-<height>`). */
const bandLabels = (page: Page, height: number) =>
  page.evaluate((h) => {
    const w = window as Any
    const find = (c: Any, label: string): Any => (c.label === label ? c : (c.children ?? []).map((k: Any) => find(k, label)).find(Boolean))
    const band = find(w.__pixiApp.stage, `plateau-band-${h}`)
    const out: { label: string; children: number }[] = []
    const walk = (c: Any) => {
      for (const k of c.children ?? []) {
        if (k.label) out.push({ label: k.label, children: k.children?.length ?? 0 })
        walk(k)
      }
    }
    if (band) walk(band)
    return out
  }, height)

/** The fields of a plateau the tool's dock does not set: the card's, written after. */
const CARD_FIELDS = ['name', 'edgeArt', 'slopeWidth', 'contourLines', 'sightOverride', 'crossingId'] as const

/**
 * Draws `plateau` with the Plateau tool on its own layer, as a hand would: its level and layer
 * active, its height and edge in the dock, E, a click on each corner and one on the first to
 * close. The card's fields follow, and its openings are pointed at the new plateau. Resolves
 * to the new plateau's id.
 */
async function drawWithTool(page: Page, plateau: Any, layer: { id: string; levelId?: string }): Promise<string> {
  await page.evaluate(({ layer, plateau }) => {
    const st = (window as Any).__store.getState()
    if (layer.levelId) st.setActiveLevelId(layer.levelId)
    st.setActiveLayerId(layer.id)
    st.updateToolSettings({ plateau: { height: plateau.height, edge: plateau.edge } })
    st.setSelectedIds([])
  }, { layer, plateau })
  await page.keyboard.press('Control+0')
  await waitFrame(page, 4)
  await blur(page)
  await page.keyboard.press('e')
  const count = () => inPage<number>(page, `(s) => s().layers.flatMap((l) => l.children ?? []).filter((c) => c.childType === 'plateau').length`)
  const before = await count()
  const ring: [number, number][] = plateau.contours[0]
  for (const [x, y] of [...ring, ring[0]]) {
    const at = await screenOf(page, { x, y })
    await page.mouse.click(at.x, at.y)
    await page.waitForTimeout(350)
  }
  await expect.poll(count).toBe(before + 1)
  return page.evaluate(({ old, layerId, plateau, fields }) => {
    const st = (window as Any).__store.getState()
    const made = st.selection.selectedIds[0]
    const patch: Any = {}
    for (const k of fields) if (plateau[k] !== undefined) patch[k] = plateau[k]
    st.updateChild(layerId, made, patch)
    const l = st.layers.find((x: Any) => x.id === layerId)
    for (const c of l.children) if (c.childType === 'opening' && c.hostId === old) st.updateChild(layerId, c.id, { hostId: made })
    return made
  }, { old: plateau.id, layerId: layer.id, plateau, fields: CARD_FIELDS })
}

/**
 * Opens `doc` with its plateaus taken off, then draws every one of them again with the tool.
 * `ids` maps each plateau's id in the file to the one the tool gave it.
 */
async function openMap(page: Page, doc: Any): Promise<{ errors: string[]; ids: Record<string, string> }> {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/v2?e2e=1')
  await waitForBoot(page)
  await page.getByTestId('v2-new-map-card').click()
  await page.getByTestId('v2-new-map-submit').click()
  await expect(page.getByTestId('v2-editor')).toBeVisible()
  const bare = structuredClone(doc)
  const drawn: { plateau: Any; layer: { id: string; levelId?: string } }[] = []
  for (const l of bare.layers) {
    if (l.type !== 'dungeon') continue
    for (const c of l.children) if (c.childType === 'plateau') drawn.push({ plateau: c, layer: { id: l.id, levelId: l.levelId } })
    l.children = l.children.filter((c: Any) => c.childType !== 'plateau')
  }
  await page.evaluate(async (data) => {
    const st = (window as Any).__store.getState()
    st.loadFromFile(structuredClone(data))
    st.setRoomsSheetOpen?.(false)
    st.setSelectedIds([])
    await st.saveCurrentMap()
  }, bare)
  const ids: Record<string, string> = {}
  for (const { plateau, layer } of drawn) ids[plateau.id] = await drawWithTool(page, plateau, layer)
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const l = st.layers.find((x: Any) => x.type === 'dungeon' && x.children.some((c: Any) => c.childType === 'shape'))
    if (l.levelId) st.setActiveLevelId(l.levelId)
    st.setActiveLayerId(l.id)
    st.setActiveTool('select')
    st.setSelectedIds([])
  })
  await page.keyboard.press('Control+0')
  await waitFrame(page, 6)
  return { errors, ids }
}

/** The canvas luminance at world `p`: the median of three reads a frame apart. */
async function lum(page: Page, p: Pt): Promise<number> {
  const at = await screenOf(page, p)
  const r = await page.evaluate(() => (window as Any).__pixiApp.canvas.getBoundingClientRect())
  const reads: number[] = []
  for (let k = 0; k < 3; k++) {
    const c = await getPixelColor(page, at.x - r.left, at.y - r.top)
    reads.push(0.299 * c.r + 0.587 * c.g + 0.114 * c.b)
    await waitFrame(page, 1)
  }
  return reads.sort((a, b) => a - b)[1]
}

// sharp comes in with the workspace's own tools (vault-engine), as the sheet scripts take it.
const sharp = createRequire(fileURLToPath(new URL('../../../packages/vault-engine/package.json', import.meta.url)))('sharp')

/** The luminance of the page as shown at world `p`: a 5 x 5 px screenshot's mean. */
async function shownLum(page: Page, p: Pt): Promise<number> {
  const at = await screenOf(page, p)
  const png = await page.screenshot({ clip: { x: at.x - 2, y: at.y - 2, width: 5, height: 5 } })
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  let sum = 0
  for (let i = 0; i < data.length; i += info.channels) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  return sum / (data.length / info.channels)
}

/** The sun at a fixed hour of the editor's preview clock. */
async function sunAt(page: Page, hour: number): Promise<void> {
  await page.evaluate((h) => {
    ;(window as Any).__store.setState((s: Any) => {
      s.mapSettings.environment = 'outdoor'
      s.mapSettings.naturalLight = true
      s.ui.previewClock = h * 60
    })
  }, hour)
  await waitFrame(page, 8)
}

async function select(page: Page, id: string): Promise<void> {
  await page.evaluate((i) => (window as Any).__store.getState().setSelectedIds([i]), id)
  await waitFrame(page, 2)
}

test.describe('plateau-test in the editor', () => {
  test('opens with every named object and draws every band without an error', async ({ page }) => {
    const { errors } = await openMap(page, PLATEAU)
    for (const id of ['ground', 'outcrop', 'outcrop-stairs', 'hill', 'summit', 'pit', 'far-mesa', 'torch-top', 'torch-ground']) {
      expect(await child(page, id), id).toBeTruthy()
    }
    await expect.poll(async () => (await bandLabels(page, 2)).length).toBeGreaterThan(0)
    for (const h of [-2, 1, 2, 3]) expect((await bandLabels(page, h)).length, `band ${h}`).toBeGreaterThan(0)
    expect(errors).toEqual([])
  })

  test('scenario 2: the outcrop is laid with rock and throws a shadow the clock swings', async ({ page }) => {
    await openMap(page, PLATEAU)
    // The outcrop is the only +2 band: rock along its edge, and a top line.
    await expect
      .poll(async () => (await bandLabels(page, 2)).find((l) => l.label === 'plateau-cliff')?.children ?? 0)
      .toBeGreaterThan(4)
    // Morning: the shadow falls west, off the outcrop's west cliff; late afternoon, east.
    const west = { x: 3.5, y: 10 }
    const east = { x: 12.5, y: 9.75 }
    await sunAt(page, 9)
    const [w9, e9] = [await lum(page, west), await lum(page, east)]
    await sunAt(page, 17)
    const [w17, e17] = [await lum(page, west), await lum(page, east)]
    expect(w9, 'west of the cliff is darker in the morning').toBeLessThan(w17 - 2)
    expect(e17, 'east of the cliff is darker in the afternoon').toBeLessThan(e9 - 2)
  })

  test('scenario 3: the hill reads 1 and the summit 3, with contours on the slope and a 2-cell drop', async ({ page }) => {
    const { ids } = await openMap(page, PLATEAU)
    const hill = await bandLabels(page, 1)
    expect(hill.some((l) => l.label === 'plateau-slope')).toBe(true)
    expect(hill.some((l) => l.label === 'plateau-contours')).toBe(true)
    expect((await bandLabels(page, 3)).some((l) => l.label === 'plateau-cliff')).toBe(true)

    await select(page, ids['hill-plateau'])
    await expect(page.getByTestId('v2-plateau-height')).toContainText('+1')
    await expect(page.getByTestId('v2-plateau-standing')).toHaveText('+1 · drop 1')
    await select(page, ids['summit-plateau'])
    await expect(page.getByTestId('v2-plateau-height')).toContainText('+2')
    await expect(page.getByTestId('v2-plateau-standing')).toHaveText('+3 · drop 2')
    await expect(page.getByRole('button', { name: 'Auto (hides)' })).toBeVisible()
  })

  test('scenario 4: the stairs part the rock, and the Opening tool places more in one undo step', async ({ page }) => {
    const { ids } = await openMap(page, PLATEAU)
    const outcrop = await bandLabels(page, 2)
    expect(outcrop.some((l) => l.label === 'opening-outcrop-stairs')).toBe(true)
    // No rock sprite sits over the stairs' gap at (12, 7.5).
    const overGap = await page.evaluate(() => {
      const w = window as Any
      const find = (c: Any, label: string): Any => (c.label === label ? c : (c.children ?? []).map((k: Any) => find(k, label)).find(Boolean))
      const rock = find(find(w.__pixiApp.stage, 'plateau-band-2'), 'plateau-cliff')
      return rock.children.filter((s: Any) => Math.hypot(s.position.x - 12, s.position.y - 7.5) < 0.6).length
    })
    expect(overGap).toBe(0)

    // S, then a click on the far mesa's north edge.
    await blur(page)
    await page.keyboard.press('s')
    const at = await screenOf(page, { x: 10, y: 26.1 })
    await page.mouse.move(at.x, at.y)
    await waitFrame(page, 2)
    await page.mouse.click(at.x, at.y)
    await waitFrame(page, 2)
    const openings = () => inPage<Any[]>(page, `(s, layer) => layer().children.filter((c) => c.childType === 'opening')`)
    await expect.poll(async () => (await openings()).length).toBe(2)
    expect((await openings()).find((o) => o.id !== 'outcrop-stairs').hostId).toBe(ids['far-mesa-plateau'])
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await openings()).length).toBe(1)
  })
})

/** A fresh map with one 20 x 16 field floor on its layer, the layer active, the view fitted. */
async function openField(page: Page): Promise<string[]> {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/v2?e2e=1')
  await waitForBoot(page)
  await page.getByTestId('v2-new-map-card').click()
  await page.getByTestId('v2-new-map-submit').click()
  await expect(page.getByTestId('v2-editor')).toBeVisible()
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const l = st.layers.find((x: Any) => x.type === 'dungeon')
    st.setActiveLayerId(l.id)
    st.addChild(l.id, {
      id: 'field', name: 'Field', childType: 'shape', visible: true, shapeType: 'rectangle',
      contours: [[[0, 0], [20, 0], [20, 16], [0, 16]]],
      textureScale: 1, textureOffsetX: 0, textureOffsetY: 0, textureFillRotation: 0, textureTint: '#ffffff',
    })
    st.setSelectedIds([])
  })
  await page.keyboard.press('Control+0')
  await waitFrame(page, 6)
  return errors
}

const plateausOf = (page: Page) => inPage<Any[]>(page, `(s, layer) => layer().children.filter((c) => c.childType === 'plateau')`)

/** A real mouse drag through world points, a few moves per stretch. */
async function dragThrough(page: Page, pts: Pt[]): Promise<void> {
  const first = await screenOf(page, pts[0])
  await page.mouse.move(first.x, first.y)
  await page.mouse.down()
  for (const p of pts.slice(1)) {
    const at = await screenOf(page, p)
    await page.mouse.move(at.x, at.y, { steps: 6 })
  }
  await page.mouse.up()
  await waitFrame(page, 3)
}

const rectAround = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 },
]

test.describe('the Plateau tool', () => {
  test('its tab holds the Plateau tool alone: no Path tool, no lake, no path materials, and A and U pick nothing', async ({ page }) => {
    const errors = await openField(page)
    await page.getByTestId('v2-dock-tab-plateaus').click()
    await expect(page.getByTestId('v2-tool-plateau')).toBeVisible()
    await expect(page.getByTestId('v2-tool-path')).toHaveCount(0)
    await expect(page.getByTestId('v2-tool-lake')).toHaveCount(0)
    await expect(page.getByTestId('v2-strip-paths')).toHaveCount(0)
    await expect(page.getByTestId('v2-strip-lakes')).toHaveCount(0)
    await blur(page)
    for (const key of ['a', 'u']) {
      await page.keyboard.press(key)
      await waitFrame(page, 2)
      expect(await inPage(page, `(s) => s().tools.activeTool`), key).not.toMatch(/^(path|lake)$/)
    }
    expect(errors).toEqual([])
  })

  test('E, then a dragged rectangle on the field: one plateau at +1 with a cliff ledge, selected', async ({ page }) => {
    const errors = await openField(page)
    await blur(page)
    await page.keyboard.press('e')
    expect(await inPage(page, `(s) => s().tools.activeTool`)).toBe('plateau')
    await dragThrough(page, rectAround(4, 4, 10, 9))
    await expect.poll(async () => (await plateausOf(page)).length).toBe(1)
    const [p] = await plateausOf(page)
    expect(p).toMatchObject({ height: 1, edge: 'cliff' })
    expect(await inPage(page, `(s) => s().selection.selectedIds`)).toEqual([p.id])
    // The floor is untouched: one shape, no new walls, its ring the same.
    expect(await inPage(page, `(s, layer) => layer().children.filter((c) => c.childType === 'shape').length`)).toBe(1)
    await expect.poll(async () => (await bandLabels(page, 1)).find((l) => l.label === 'plateau-cliff')?.children ?? 0).toBeGreaterThan(4)
    expect(errors).toEqual([])
  })

  test('clicks place the points and a click on the first closes the ring', async ({ page }) => {
    await openField(page)
    await blur(page)
    await page.keyboard.press('e')
    for (const p of [{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 7 }, { x: 2, y: 7 }, { x: 2, y: 2 }]) {
      const at = await screenOf(page, p)
      await page.mouse.click(at.x, at.y)
      await page.waitForTimeout(350)
    }
    await expect.poll(async () => (await plateausOf(page)).length).toBe(1)
    expect((await plateausOf(page))[0].contours[0]).toEqual([[2, 2], [8, 2], [8, 7], [2, 7]])
  })

  test('a plateau drawn on void is refused with the toast, and nothing is added', async ({ page }) => {
    await openField(page)
    await blur(page)
    await page.keyboard.press('e')
    await dragThrough(page, rectAround(26, 4, 32, 9))
    await expect(page.getByLabel('Notifications alt+T').getByText('A plateau needs ground under it')).toBeVisible()
    expect(await plateausOf(page)).toHaveLength(0)
  })

  test('a node drag reshapes it, and a move that leaves the ground is put back', async ({ page }) => {
    await openField(page)
    await blur(page)
    await page.keyboard.press('e')
    await dragThrough(page, rectAround(4, 4, 10, 9))
    await expect.poll(async () => (await plateausOf(page)).length).toBe(1)
    await page.keyboard.press('v')
    const id = (await plateausOf(page))[0].id
    await select(page, id)
    // The corner nearest (10, 9), wherever simplifying put it.
    const corner = await inPage<Pt>(page, `(s, layer, w2s, id) => {
      const ring = layer().children.find((c) => c.id === id).contours[0]
      const [x, y] = ring.reduce((b, p) => (Math.hypot(p[0] - 10, p[1] - 9) < Math.hypot(b[0] - 10, b[1] - 9) ? p : b))
      return { x, y }
    }`, id)
    await dragThrough(page, [corner, { x: 14, y: 12 }])
    await expect
      .poll(async () => (await child(page, id)).contours[0].some((p: number[]) => Math.hypot(p[0] - 14, p[1] - 12) < 0.3))
      .toBe(true)
    // The whole plateau dragged east, most of it past the field's edge.
    await dragThrough(page, [{ x: 7, y: 6 }, { x: 15, y: 6 }, { x: 25, y: 6 }])
    await expect(page.getByLabel('Notifications alt+T').getByText('A plateau needs ground under it')).toBeVisible()
    await expect
      .poll(async () => (await child(page, id)).contours[0].some((p: number[]) => Math.hypot(p[0] - 14, p[1] - 12) < 0.3))
      .toBe(true)
  })

  test('the card changes height, edge and contours; the floor card has no Height or Edge row; the layers panel lists it', async ({ page }) => {
    await openField(page)
    await blur(page)
    await page.keyboard.press('e')
    await dragThrough(page, rectAround(4, 4, 10, 9))
    await expect.poll(async () => (await plateausOf(page)).length).toBe(1)
    const id = (await plateausOf(page))[0].id
    await page.keyboard.press('v')
    await select(page, id)
    const card = page.getByTestId('v2-selection-card')
    await expect(card.getByTestId('v2-sel-kind')).toHaveText('Plateau')
    await card.getByRole('button', { name: 'Raise' }).click()
    await expect.poll(async () => (await child(page, id)).height).toBe(2)
    await card.getByRole('button', { name: 'Slope' }).click()
    await expect.poll(async () => (await child(page, id)).edge).toBe('slope')
    await expect.poll(async () => (await bandLabels(page, 2)).some((l) => l.label === 'plateau-contours')).toBe(true)
    await card.getByRole('switch', { name: 'Contour lines' }).click()
    await expect.poll(async () => (await child(page, id)).contourLines).toBe(false)
    await expect.poll(async () => (await bandLabels(page, 2)).some((l) => l.label === 'plateau-contours')).toBe(false)

    await select(page, 'field')
    await expect(card.getByTestId('v2-sel-kind')).toHaveText('Floor')
    await expect(card.getByTestId('v2-plateau-height')).toHaveCount(0)
    await expect(card.getByRole('group', { name: 'Edge' })).toHaveCount(0)

    await page.getByTestId('v2-open-layers').click()
    const sheet = page.getByTestId('v2-layers-sheet')
    const expand = sheet.getByTestId('v2-layers-layer').first().getByRole('button', { name: 'Expand' })
    if (await expand.count()) await expand.click()
    await expect(sheet.locator(`[data-object-id="${id}"]`)).toContainText('Plateau 1')
  })

  test('delete takes its openings with it, and undo brings both back', async ({ page }) => {
    await openField(page)
    await blur(page)
    await page.keyboard.press('e')
    await dragThrough(page, rectAround(4, 4, 10, 9))
    await expect.poll(async () => (await plateausOf(page)).length).toBe(1)
    const id = (await plateausOf(page))[0].id
    await inPage(page, `(s, layer, w2s, id) => s().addChild(layer().id, {
      id: 'st', name: 'Stairs 1', childType: 'opening', visible: true, kind: 'stairs', hostId: id, t: 0.1, width: 2,
    })`, id)
    await page.keyboard.press('v')
    await select(page, id)
    await blur(page)
    await page.keyboard.press('Delete')
    await expect.poll(async () => (await plateausOf(page)).length).toBe(0)
    expect(await child(page, 'st')).toBeFalsy()
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await plateausOf(page)).length).toBe(1)
    expect(await child(page, 'st')).toBeTruthy()
  })
})

test.describe('how a plateau draws', () => {
  test('its top is a lift over whatever is beneath: terrain paint shows through a +1 plateau', async ({ page }) => {
    await openField(page)
    // Paint terrain on the void east of the field, then draw the plateau on the paint.
    await inPage(page, `(s) => s().setTerrainData({ palette: ['gg-demo:floor_small_8x8_floor_A', null, null, null, null, null] })`)
    await waitFrame(page, 6)
    await blur(page)
    await page.keyboard.press('t')
    for (const y of [5, 6, 7, 8, 9]) await dragThrough(page, [{ x: 25, y }, { x: 29, y }, { x: 33, y }])
    await expect.poll(() => inPage(page, `(s) => s().mapSettings.terrain?.bounds?.maxX ?? 0`)).toBeGreaterThan(30)
    // The view out to the paint as well.
    await page.keyboard.press('Control+0')
    await waitFrame(page, 10)
    const painted = await shownLum(page, { x: 29, y: 7 })
    const bare = await shownLum(page, { x: 29, y: 13 })
    expect(Math.abs(painted - bare), 'the paint is on the canvas').toBeGreaterThan(10)
    await inPage(page, `(s) => s().setActiveLayerId(s().layers.find((l) => l.type === 'dungeon').id)`)
    await blur(page)
    await page.keyboard.press('e')
    await dragThrough(page, rectAround(27, 5.5, 31, 8.5))
    await expect.poll(async () => (await plateausOf(page)).length).toBe(1)
    await waitFrame(page, 10)
    const lifted = await shownLum(page, { x: 29, y: 7 })
    // Lifted a few percent, the paint still there under it: not a fill of its own.
    expect(lifted).toBeGreaterThanOrEqual(painted - 2)
    expect(lifted - painted).toBeLessThan(25)
    expect(Math.abs(lifted - bare)).toBeGreaterThan(10)
  })

})

test.describe('the test maps export and publish', () => {
  for (const [name, doc] of [['plateau-test', PLATEAU], ['tower-test', TOWER], ['goblin-warren', WARREN]] as const) {
    test(`${name} exports a PNG and publishes`, async ({ page }) => {
      const { errors } = await openMap(page, doc)
      if (name === 'tower-test') {
        expect(await page.evaluate(() => (window as Any).__store.getState().levels.map((l: Any) => l.name))).toEqual([
          'Cellar',
          'Ground',
          'First floor',
        ])
      }

      await blur(page)
      await page.keyboard.press('Control+e')
      const modal = page.getByTestId('v2-export-modal')
      await expect(modal).toBeVisible()
      const [png] = await Promise.all([page.waitForEvent('download'), modal.getByTestId('v2-export-go').click()])
      expect(png.suggestedFilename()).toMatch(/\.png$/)
      expect([...readFileSync(await png.path()).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])

      const calls = await installStubs(page, [
        { method: 'GET', path: /^\/api\/campaigns$/, respond: () => ({ json: { campaigns: [] } }) },
        { method: 'POST', path: /^\/api\/campaigns$/, respond: () => ({ json: { campaignId: 'camp-1', identityId: 'id-1', token: 'tok-1' } }) },
        {
          method: 'POST',
          path: /^\/api\/campaigns\/camp-1\/maps$/,
          respond: () => ({ json: { mapId: 'map-1', sceneId: 'scene-1', name: doc.mapSettings.name, sizeBytes: 1 } }),
        },
      ])
      await page.getByTestId('v2-publish').click()
      const dialog = page.getByTestId('v2-publish-dialog')
      await dialog.getByLabel('Admin pass').fill('adminpass')
      await dialog.getByLabel('Admin pass').press('Enter')
      await dialog.getByLabel('Create new campaign').fill('Plateaus')
      await dialog.getByRole('button', { name: 'Create' }).click()
      await expect(dialog).toBeHidden({ timeout: 10_000 })
      const upload = calls.find((c) => c.method === 'POST' && /\/maps$/.test(c.path))
      expect(upload?.bodyBuffer?.length ?? 0).toBeGreaterThan(100)
      expect(errors).toEqual([])
    })
  }
})
