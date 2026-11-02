import { test, expect, type Page } from '@playwright/test'
import { firePointer, getPixelColor, waitForBoot, waitFrame } from './helpers'

/**
 * The Path tool in /v2, end to end on a blank map (scenario 1 without junctions): a road
 * by clicks and one by a freehand drag, the wheel setting the next point's width,
 * Backspace, closing on the first point, Alt's straight segment, the lake preset and the
 * card's Fill switch, and undo: one entry per path, one per point drag. A path draws as its
 * outline filled with its kit's fill tile, paths of one material unioned into one fill, and
 * the kit's edge units walked along that one outline.
 */

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any
type Pt = { x: number; y: number }

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

const screenOf = (page: Page, p: Pt) => inPage<Pt>(page, `(s, layer, w2s, p) => w2s(p.x, p.y)`, p)
const paths = (page: Page) => inPage<Any[]>(page, `(s, layer) => layer().children.filter((c) => c.childType === 'path')`)
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())

async function key(page: Page, combo: string) {
  await blur(page)
  await page.keyboard.press(combo)
  await waitFrame(page, 2)
}

type Mods = { shift?: boolean; alt?: boolean }

/** A click at world `p`, spaced past the double-click window from the one before. */
async function click(page: Page, p: Pt, mods: Mods = {}) {
  await page.waitForTimeout(350)
  const at = await screenOf(page, p)
  await firePointer(page, 'pointermove', at.x, at.y, 0, 0, mods)
  await firePointer(page, 'pointerdown', at.x, at.y, 0.5, 1, mods)
  await firePointer(page, 'pointerup', at.x, at.y, 0, 0, mods)
  await waitFrame(page, 2)
}

async function wheel(page: Page, p: Pt, deltaY: number) {
  const at = await screenOf(page, p)
  await page.evaluate(
    ({ at, deltaY }) => {
      document.querySelector('canvas')!.dispatchEvent(
        new WheelEvent('wheel', { clientX: at.x, clientY: at.y, deltaY, bubbles: true, cancelable: true }),
      )
    },
    { at, deltaY },
  )
  await waitFrame(page, 2)
}

/** Into /v2 on a blank map, grid snap off. */
async function openEditor(page: Page): Promise<void> {
  await page.goto('/v2?e2e=1')
  await waitForBoot(page)
  await page.getByTestId('v2-new-map-card').click()
  await page.getByTestId('v2-new-map-submit').click()
  await expect(page.getByTestId('v2-editor')).toBeVisible()
  await page.evaluate(() => {
    const w = window as Any
    w.__store.setState((s: Any) => {
      s.grid.snapEnabled = false
    })
  })
  await waitFrame(page, 2)
}

/** The drawn fills' bounds, in world cells. */
const fillBounds = (page: Page) =>
  page.evaluate(() => {
    const w = window as Any
    const find = (c: Any): Any => (c.label === 'sublayer-paths' ? c : (c.children ?? []).map(find).find(Boolean))
    const fill = find(w.__pixiApp.stage)?.children.find((c: Any) => c.label === 'path-fill')
    const b = fill?.getLocalBounds?.()
    return b ? { width: b.width, height: b.height } : null
  })

test('a road drawn by clicks: one path, its fill on the canvas, one undo step', async ({ page }) => {
  await openEditor(page)
  await key(page, 'a')
  await click(page, { x: -4, y: 0 })
  await click(page, { x: 0, y: 1 })
  await click(page, { x: 4, y: 0 })
  await key(page, 'Enter')
  const [road] = await paths(page)
  expect(road.points).toHaveLength(3)
  expect(road).toMatchObject({ closed: false, materialId: 'gg-forge:road-dirt', width: 1.5 })
  const b = await fillBounds(page)
  expect(b!.width).toBeGreaterThan(8)
  await key(page, 'Control+z')
  expect(await paths(page)).toHaveLength(0)
})

test('a road drawn by a freehand drag becomes a few points along the stroke', async ({ page }) => {
  await openEditor(page)
  await key(page, 'a')
  const from = await screenOf(page, { x: -4, y: 0 })
  await firePointer(page, 'pointermove', from.x, from.y)
  await firePointer(page, 'pointerdown', from.x, from.y, 0.5, 1)
  for (let i = 1; i <= 40; i++) {
    const at = await screenOf(page, { x: -4 + i * 0.2, y: Math.sin(i / 8) })
    await firePointer(page, 'pointermove', at.x, at.y, 0.5, 1)
  }
  const end = await screenOf(page, { x: 4, y: Math.sin(5) })
  await firePointer(page, 'pointerup', end.x, end.y)
  await key(page, 'Enter')
  const [road] = await paths(page)
  expect(road.points.length).toBeGreaterThanOrEqual(3)
  expect(road.points.length).toBeLessThan(20)
  expect(road.points[road.points.length - 1].x).toBeCloseTo(4, 0)
})

test('the wheel widens the next point; Backspace takes the last point back', async ({ page }) => {
  await openEditor(page)
  await key(page, 'a')
  await click(page, { x: -4, y: 0 })
  await wheel(page, { x: 0, y: 0 }, -100)
  await wheel(page, { x: 0, y: 0 }, -100)
  await click(page, { x: 0, y: 0 })
  await click(page, { x: 4, y: 3 })
  await key(page, 'Backspace')
  await key(page, 'Enter')
  const [road] = await paths(page)
  expect(road.points).toHaveLength(2)
  expect(road.points[0].width).toBeUndefined()
  expect(road.points[1].width).toBe(2)
})

test('clicking the first point closes the path; Alt draws a straight segment', async ({ page }) => {
  await openEditor(page)
  await key(page, 'a')
  await click(page, { x: -3, y: -3 })
  await click(page, { x: 3, y: -3 })
  await click(page, { x: 3, y: 3 }, { alt: true })
  await click(page, { x: -3, y: -3 })
  const [ring] = await paths(page)
  expect(ring.closed).toBe(true)
  expect(ring.points).toHaveLength(3)
  expect(ring.points[1].handles).toBeNull()
  expect(ring.points[2].handles).toBeNull()
})

test('U draws a lake; its card’s Fill switch empties it, one undo step', async ({ page }) => {
  await openEditor(page)
  await key(page, 'u')
  await click(page, { x: -3, y: -2 })
  await click(page, { x: 3, y: -2 })
  await click(page, { x: 0, y: 3 })
  await key(page, 'Enter')
  const [lake] = await paths(page)
  expect(lake).toMatchObject({ closed: true, fill: true, materialId: 'gg-forge:water' })
  await inPage(page, `(s, l, w, id) => { s().setActiveTool('select'); s().setSelectedIds([id]) }`, lake.id)
  const card = page.getByTestId('v2-sel-path')
  await expect(card).toBeVisible()
  await card.getByRole('switch', { name: 'Fill' }).click()
  expect((await paths(page))[0].fill).toBe(false)
  await key(page, 'Control+z')
  expect((await paths(page))[0].fill).toBe(true)
})

test('dragging a selected path’s point is one undo step', async ({ page }) => {
  await openEditor(page)
  await key(page, 'a')
  await click(page, { x: -4, y: 0 })
  await click(page, { x: 0, y: 0 })
  await click(page, { x: 4, y: 0 })
  await key(page, 'Enter')
  const [road] = await paths(page)
  await inPage(page, `(s, l, w, id) => { s().setActiveTool('select'); s().setSelectedIds([id]) }`, road.id)
  await waitFrame(page, 2)
  const from = await screenOf(page, { x: 0, y: 0 })
  const to = await screenOf(page, { x: 0, y: 2 })
  await firePointer(page, 'pointermove', from.x, from.y)
  await firePointer(page, 'pointerdown', from.x, from.y, 0.5, 1)
  for (let i = 1; i <= 5; i++) await firePointer(page, 'pointermove', from.x, from.y + ((to.y - from.y) * i) / 5, 0.5, 1)
  await firePointer(page, 'pointerup', to.x, to.y)
  await waitFrame(page, 2)
  expect((await paths(page))[0].points[1].y).toBeCloseTo(2, 1)
  await key(page, 'Control+z')
  expect((await paths(page))[0].points[1]).toEqual({ x: 0, y: 0 })
  await key(page, 'Control+z')
  expect(await paths(page)).toHaveLength(0)
})

/** A dirt road through the given points, added straight to the store (the tool is covered above). */
const dirtRoad = (id: string, points: Pt[]) => ({
  id, name: id, childType: 'path', visible: true, points, closed: false, width: 2, heightMode: 'ground',
  materialId: 'gg-forge:road-dirt', tint: '#ffffff', opacity: 1, offset: 0, flip: false, edge: 'soft',
  ends: { start: 'cut', end: 'cut', length: 1 }, sort: 'under',
})

/** Luminance of the canvas pixel under world point `p`. */
async function lum(page: Page, p: Pt): Promise<number> {
  const at = await screenOf(page, p)
  const r = await page.evaluate(() => (window as Any).__pixiApp.canvas.getBoundingClientRect())
  // The median of three reads a frame apart: a single read now and then lands mid-present.
  const reads: number[] = []
  for (let k = 0; k < 3; k++) {
    const c = await getPixelColor(page, at.x - r.left, at.y - r.top)
    reads.push(0.299 * c.r + 0.587 * c.g + 0.114 * c.b)
    await waitFrame(page, 1)
  }
  return reads.sort((a, b) => a - b)[1]
}

/** Waits until the paths sublayer holds `count` drawn fills (their art arrives with the pack). */
async function drawn(page: Page, count: number) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const w = window as Any
        const find = (c: Any): Any => (c.label === 'sublayer-paths' ? c : (c.children ?? []).map(find).find(Boolean))
        return find(w.__pixiApp.stage)?.children.length ?? 0
      }),
    )
    .toBeGreaterThanOrEqual(count)
  // And the camera at rest: a new map may still be easing to its frame.
  const camera = () =>
    page.evaluate(() => {
      const wd = (window as Any).__pixiApp.stage.children[0]
      return [wd.position.x, wd.position.y, wd.scale.x].map((v: number) => v.toFixed(2)).join(',')
    })
  let last = ''
  await expect
    .poll(async () => {
      await waitFrame(page, 3)
      const now = await camera()
      const still = now === last
      last = now
      return still
    })
    .toBe(true)
}

/** What the paths sublayer holds: one entry per drawn fill, whether it is masked to an outline. */
const fills = (page: Page) =>
  page.evaluate(() => {
    const w = window as Any
    const find = (c: Any): Any => (c.label === 'sublayer-paths' ? c : (c.children ?? []).map(find).find(Boolean))
    return (find(w.__pixiApp.stage)?.children ?? []).filter((c: Any) => c.label === 'path-fill').map((c: Any) => ({ masked: !!c.mask }))
  })

/** Where the edge units of the paths sublayer stand, in world cells. */
const units = (page: Page) =>
  page.evaluate(() => {
    const w = window as Any
    const find = (c: Any): Any => (c.label === 'sublayer-paths' ? c : (c.children ?? []).map(find).find(Boolean))
    const pools = (find(w.__pixiApp.stage)?.children ?? []).filter((c: Any) => c.label === 'path-units')
    return pools.flatMap((p: Any) => p.children.map((s: Any) => ({ x: s.position.x, y: s.position.y })))
  })

const addRoad = (page: Page, road: unknown) => inPage(page, `(s, layer, w2s, r) => s().addChild(layer().id, r)`, road)

test('two dirt roads crossing show no seam: across the junction the road reads as it does alone', async ({ page }) => {
  await openEditor(page)
  await addRoad(page, dirtRoad('a', [{ x: -6, y: 0 }, { x: 6, y: 0 }]))
  await drawn(page, 1)
  // A line across where the second road's edges will run, inside the first road.
  // Off the edges by more than an edge unit reaches (half its diagonal, 0.64).
  const line = Array.from({ length: 17 }, (_, i) => ({ x: -2 + i * 0.25, y: 0.2 }))
  const alone: number[] = []
  for (const p of line) alone.push(await lum(page, p))
  const background = await lum(page, { x: 0, y: 5 })
  await addRoad(page, dirtRoad('b', [{ x: 0, y: -5 }, { x: 0, y: 5 }]))
  // One material, one fill: the two outlines are unioned before they are painted.
  await expect.poll(() => fills(page)).toEqual([{ masked: true }])
  // From y = -5 to 5 and a half width round each end.
  await expect.poll(() => fillBounds(page).then((b) => b && Math.round(b.height))).toBe(12)
  for (let i = 0; i < line.length; i++) {
    const now = await lum(page, line[i])
    // Still road, nowhere near the ground showing through, and close to what it was.
    expect(Math.abs(now - background), `at x = ${line[i].x}`).toBeGreaterThan(60)
    expect(Math.abs(now - alone[i]), `at x = ${line[i].x}`).toBeLessThan(40)
  }
})

test('two crossing dirt roads wear one border of edge units: round the junction, none inside it', async ({ page }) => {
  await openEditor(page)
  await addRoad(page, dirtRoad('a', [{ x: -8, y: 0 }, { x: 8, y: 0 }]))
  await addRoad(page, dirtRoad('b', [{ x: 0, y: -8 }, { x: 0, y: 8 }]))
  await expect.poll(async () => (await units(page)).length).toBeGreaterThan(40)
  const laid = await units(page)
  // Every unit on the one unioned outline: none where either road's own edge ran across the other.
  for (const u of laid) {
    const inA = Math.abs(u.y) < 0.99 && Math.abs(u.x) < 8
    const inB = Math.abs(u.x) < 0.99 && Math.abs(u.y) < 8
    expect(inA || inB, `unit at ${u.x.toFixed(2)}, ${u.y.toFixed(2)}`).toBe(false)
  }
  // And the border runs on round each inside corner of the junction.
  for (const [x, y] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    expect(laid.some((u) => Math.hypot(u.x - x, u.y - y) < 1.6), `corner ${x}, ${y}`).toBe(true)
  }
  // An edit re-lays the same pool: the units move, the sprites stay.
  const before = await page.evaluate(() => {
    const w = window as Any
    const find = (c: Any): Any => (c.label === 'path-units' ? c : (c.children ?? []).map(find).find(Boolean))
    ;(w as Any).__unitPool = find(w.__pixiApp.stage)
    return (w as Any).__unitPool.children.length
  })
  expect(before).toBeGreaterThan(0)
  await inPage(page, `(s, layer) => s().updateChild(layer().id, 'b', { points: [{ x: 0.5, y: -8 }, { x: 0.5, y: 8 }] })`)
  await waitFrame(page, 3)
  const same = await page.evaluate(() => {
    const w = window as Any
    const find = (c: Any): Any => (c.label === 'path-units' ? c : (c.children ?? []).map(find).find(Boolean))
    return find(w.__pixiApp.stage) === (w as Any).__unitPool
  })
  expect(same).toBe(true)
})

test('a road is its outline filled: road inside, ground just outside, the end round', async ({ page }) => {
  await openEditor(page)
  // Width 2: the outline runs 1 cell either side of the centreline and round the end at (6, 0).
  // The edge units straddle the outline, reaching 0.64 either side of it: samples stay clear.
  await addRoad(page, dirtRoad('a', [{ x: -6, y: 0 }, { x: 6, y: 0 }]))
  await drawn(page, 1)
  expect(await fills(page)).toEqual([{ masked: true }])
  // Every sample off the grid lines, which cross road and ground alike.
  const background = await lum(page, { x: 0.5, y: -2.5 })
  for (const x of [-3.5, 0.5, 3.5]) {
    expect(Math.abs((await lum(page, { x, y: 0.3 })) - background), `inside at x = ${x}`).toBeGreaterThan(60)
    expect(Math.abs((await lum(page, { x, y: 1.75 })) - background), `outside at x = ${x}`).toBeLessThan(12)
  }
  const around = (r: number, deg: number) => ({ x: 6 + r * Math.cos((deg * Math.PI) / 180), y: r * Math.sin((deg * Math.PI) / 180) })
  for (const deg of [-60, -30, 30, 60]) {
    expect(Math.abs((await lum(page, around(0.3, deg))) - background), `cap at ${deg}°`).toBeGreaterThan(60)
    expect(Math.abs((await lum(page, around(1.75, deg))) - background), `past the cap at ${deg}°`).toBeLessThan(12)
  }
})

test('two materials draw two fills, two roads of one material one', async ({ page }) => {
  await openEditor(page)
  await addRoad(page, dirtRoad('a', [{ x: -6, y: 0 }, { x: 6, y: 0 }]))
  await addRoad(page, dirtRoad('b', [{ x: -6, y: 6 }, { x: 6, y: 6 }]))
  await drawn(page, 1)
  expect(await fills(page)).toEqual([{ masked: true }])
  await addRoad(page, { ...dirtRoad('c', [{ x: -6, y: -6 }, { x: 6, y: -6 }]), materialId: 'gg-forge:road-cobble' })
  await expect.poll(() => fills(page)).toEqual([{ masked: true }, { masked: true }])
})

test('no ground shows inside a hairpin, sharp or curved', async ({ page }) => {
  await openEditor(page)
  // A sharp V (37° inside angle) and a curved U whose legs overlap, bending far tighter than its width.
  await addRoad(page, dirtRoad('v', [{ x: -6, y: -9 }, { x: 3, y: -6, handles: null }, { x: -6, y: -3 }]))
  await addRoad(page, dirtRoad('u', [{ x: -6, y: 4.2 }, { x: 2, y: 4.2 }, { x: 3, y: 5 }, { x: 2, y: 5.8 }, { x: -6, y: 5.8 }]))
  await drawn(page, 1)
  const background = await lum(page, { x: 8, y: 0 })
  // Along the V's bisector into the bend, every point within a half width of a leg.
  for (let t = 0.1; t <= 3; t += 0.15) {
    expect(Math.abs((await lum(page, { x: 3 - t, y: -6 })) - background), `V, ${t.toFixed(2)} into the bend`).toBeGreaterThan(60)
  }
  // Between the U's legs and round its bend: all of it is road.
  for (const x of [-4, -1, 1, 2, 2.6, 3.1]) {
    for (const y of [4.5, 5, 5.5]) {
      expect(Math.abs((await lum(page, { x, y })) - background), `U at ${x}, ${y}`).toBeGreaterThan(60)
    }
  }
})

test('a lake too tight for its shore band draws it narrower and says so on the card', async ({ page }) => {
  await openEditor(page)
  // A C whose arms are 1.6 thick, its mouth 0.8 wide, under a 1.75 shore band.
  const c = [[-4, 6], [2, 6], [2.4, 7.2], [-2.2, 7.6], [-2.2, 8.4], [2, 8.6], [2, 10], [-4, 10]]
  await addRoad(page, {
    ...dirtRoad('lake', c.map(([x, y]) => ({ x, y }))),
    materialId: 'gg-forge:water', closed: true, fill: true, width: 1.75,
  })
  await inPage(page, `(s) => { s().setActiveTool('select'); s().setSelectedIds(['lake']) }`)
  const note = page.getByTestId('v2-path-narrowed')
  await expect(note).toBeVisible()
  const shown = Number((await note.textContent())?.match(/[\d.]+/)?.[0])
  expect(shown).toBeGreaterThan(0)
  expect(shown).toBeLessThan(1.75)
  // A road with room for its width says nothing.
  await addRoad(page, dirtRoad('a', [{ x: -6, y: 0 }, { x: 6, y: 0 }]))
  await inPage(page, `(s) => s().setSelectedIds(['a'])`)
  await expect(page.getByTestId('v2-sel-path')).toBeVisible()
  await expect(note).toHaveCount(0)
})

test('twenty roads on a layer: one fill, and how long a redraw takes', async ({ page }) => {
  await openEditor(page)
  for (let i = 0; i < 10; i++) {
    const at = i * 3 - 15
    await addRoad(page, dirtRoad(`h${i}`, [{ x: -20, y: at }, { x: 0, y: at + 2 }, { x: 20, y: at }]))
    await addRoad(page, dirtRoad(`v${i}`, [{ x: at, y: -20 }, { x: at + 2, y: 0 }, { x: at, y: 20 }]))
  }
  await drawn(page, 1)
  expect(await fills(page)).toEqual([{ masked: true }])
  const times: number[] = []
  for (let k = 0; k < 5; k++) {
    await inPage(
      page,
      `(s, layer, w2s, k) => s().updateChild(layer().id, 'h0', { points: [{ x: -20, y: -15 }, { x: 0, y: -13 + (k + 1) * 0.1 }, { x: 20, y: -15 }] })`,
      k,
    )
    await waitFrame(page, 2)
    times.push(await page.evaluate(() => (window as Any).__pathRedrawMs))
  }
  const median = [...times].sort((a, b) => a - b)[2]
  console.log(`20 roads: layer redraw ${median.toFixed(2)} ms (median of 5)`)
  expect(median).toBeGreaterThan(0)
  expect(median).toBeLessThan(50)
})

test('the path card fits its width and every control takes a real click', async ({ page }) => {
  await openEditor(page)
  await addRoad(page, dirtRoad('a', [{ x: -6, y: 0 }, { x: 6, y: 0 }]))
  await inPage(page, `(s) => { s().setActiveTool('select'); s().setSelectedIds(['a']) }`)
  const card = page.getByTestId('v2-sel-path')
  await expect(card).toBeVisible()
  const fits = await card.evaluate((el) => {
    const host = el.closest('[data-testid="v2-selection-card"]') as HTMLElement
    return { card: host.scrollWidth <= host.clientWidth + 1, rows: el.scrollWidth <= el.clientWidth + 1 }
  })
  expect(fits).toEqual({ card: true, rows: true })
  // Real clicks: Playwright refuses one that would land on something covering the control.
  await card.getByRole('button', { name: 'Set' }).click()
  await expect(card.getByTestId('v2-path-heights')).toBeVisible()
  await card.getByRole('button', { name: 'Taper' }).first().click()
  await card.getByRole('button', { name: 'Overhead' }).click()
  await card.getByRole('button', { name: 'Blocked' }).click()
  await card.getByRole('combobox', { name: 'Crossing' }).selectOption('climb')
  await card.getByRole('switch', { name: 'Flip' }).click()
  const [road] = await paths(page)
  expect(road).toMatchObject({ heightMode: 'set', sort: 'overhead', under: 'blocked', crossingId: 'climb', flip: true })
  expect(road.ends.start).toBe('taper')
})


/** A rectangular floor painted with `textureId`, as the store holds one. */
const floorRect = (id: string, x0: number, x1: number, textureId: string) => ({
  id, name: id, childType: 'shape', visible: true, shapeType: 'rectangle',
  contours: [[[x0, 0], [x1, 0], [x1, 10], [x0, 10]]], textureId,
  textureScale: 1, textureOffsetX: 0, textureOffsetY: 0, textureFillRotation: 0, textureTint: '#ffffff',
})

/** What the floor sublayer draws along the borders between floors. */
const floorBorder = (page: Page) =>
  page.evaluate(() => {
    const w = window as Any
    const find = (c: Any): Any => (c.label === 'sublayer-floor' ? c : (c.children ?? []).map(find).find(Boolean))
    const all: Any[] = []
    const walk = (c: Any) => {
      all.push(c)
      for (const k of c.children ?? []) walk(k)
    }
    walk(find(w.__pixiApp.stage))
    const holder = all.find((c) => c.label === 'floor-edge-units')
    return {
      units: (holder?.children ?? []).map((s: Any) => ({ x: s.position.x, y: s.position.y })),
      blends: all.filter((c) => c.label === 'floor-edge-blend').length,
    }
  })

test('two floors meet with the top floor’s kit units along their shared edge, not a strip; a kitless pair blends', async ({ page }) => {
  await openEditor(page)
  await addRoad(page, floorRect('cave', 0, 10, 'gg-forge:cave_floor_8x8_floor_A'))
  await addRoad(page, floorRect('dirt', 10, 20, 'gg-forge:road-dirt-fill'))
  // Ten cells of shared edge, a unit every 0.6 to 1.5 cells.
  await expect.poll(async () => (await floorBorder(page)).units.length).toBeGreaterThanOrEqual(8)
  const { units, blends } = await floorBorder(page)
  expect(blends).toBe(0)
  for (const u of units) {
    expect(Math.abs(u.x - 10), `unit at ${u.x.toFixed(2)}, ${u.y.toFixed(2)}`).toBeLessThan(0.01)
    expect(u.y).toBeGreaterThanOrEqual(0)
    expect(u.y).toBeLessThanOrEqual(10)
  }
  // The top floor in a texture no kit claims: the colour blend, and no units.
  await inPage(page, `(s, layer) => s().updateChild(layer().id, 'dirt', { textureId: 'gg-demo:floor_small_8x8_floor_A' })`)
  await expect.poll(async () => (await floorBorder(page)).blends).toBeGreaterThan(0)
  expect((await floorBorder(page)).units).toHaveLength(0)
})

const attached = (page: Page) =>
  inPage<Any[]>(page, `(s, layer) => layer().children.filter((c) => c.childType === 'asset' && c.attachedTo)`)

test('a dirt road lays its trees on draw, moves them with it, Detach keeps one as a plain prop, undo and delete', async ({ page }) => {
  await openEditor(page)
  await addRoad(page, dirtRoad('r', [{ x: -10, y: 0 }, { x: 10, y: 0 }]))
  await expect.poll(async () => (await attached(page)).length).toBeGreaterThan(3)
  const first = await attached(page)
  for (const t of first) {
    expect(t.attachedTo).toMatchObject({ kind: 'path', id: 'r', side: 1 })
    expect(t.assetId).toContain('tree')
  }
  // The trees are drawn as props.
  const drawnTrees = () =>
    page.evaluate((ids: string[]) => {
      const w = window as Any
      const all: Any[] = []
      const walk = (c: Any) => {
        all.push(c)
        for (const k of c.children ?? []) walk(k)
      }
      walk(w.__pixiApp.stage)
      return ids.filter((id) => all.some((c) => c.label === 'placed-' + id)).length
    }, first.map((t: Any) => t.id))
  await expect.poll(drawnTrees).toBe(first.length)

  // The road moves 3 cells down: its trees go with it.
  await inPage(page, `(s, layer) => s().updateChild(layer().id, 'r', { points: [{ x: -10, y: 3 }, { x: 10, y: 3 }] })`)
  const meanY = (list: Any[]) => list.reduce((s: number, t: Any) => s + t.position.y, 0) / list.length
  await expect.poll(async () => meanY(await attached(page)) - meanY(first)).toBeCloseTo(3, 1)
  const moved = await attached(page)
  expect(moved.length).toBe(first.length)

  // Detach one from its card: it stays where it is, a plain prop.
  const one = moved[0]
  await inPage(page, `(s, layer, w2s, id) => s().setSelectedIds([id])`, one.id)
  await page.getByTestId('v2-prop-detach').click()
  await waitFrame(page, 2)
  const plain = await inPage<Any>(page, `(s, layer, w2s, id) => layer().children.find((c) => c.id === id)`, one.id)
  expect(plain.attachedTo).toBeUndefined()
  expect(plain.position).toEqual(one.position)
  // Undo: attached again.
  await key(page, 'Control+z')
  await expect.poll(async () => (await inPage<Any>(page, `(s, layer, w2s, id) => layer().children.find((c) => c.id === id)`, one.id))?.attachedTo?.id).toBe('r')

  // Deleting the road takes its trees.
  await inPage(page, `(s, layer) => s().setSelectedIds([])`)
  await inPage(page, `(s, layer) => s().removeChild(layer().id, 'r')`)
  await expect.poll(async () => (await attached(page)).length).toBe(0)
})
