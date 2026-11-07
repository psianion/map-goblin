import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { gotoApp, waitFrame } from './helpers'

/**
 * How a plateau darkens the ground below it, read off the screen: the drop shade every edge
 * kind lays on its low side, the sun shadow that starts on the edge itself, and the slope's
 * band outside its outline, graded, with one contour a cell of drop. Indoors, so the shadows come from the fixed
 * top-left sun; on a flat floor colour with the grid off, so the pixels are the shade alone.
 */

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any
type Pt = { x: number; y: number }

const sharp = createRequire(fileURLToPath(new URL('../../../packages/vault-engine/package.json', import.meta.url)))('sharp')

const TEMPLATE = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../session/testdata/plateau-test.mapbuilder', import.meta.url)), 'utf8'),
)

const WARREN = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../session/testdata/goblin-warren.mapbuilder', import.meta.url)), 'utf8'),
)
/** The warren's band as drawn before the ink set (15bc487), floors and doors only, 16 px a cell, indoors. */
const BAND_BEFORE = fileURLToPath(new URL('./fixtures/warren-cave-band.png', import.meta.url))

/** Screen pixels a cell while measuring. */
const ZOOM = 60

const box = (id: string, x0: number, y0: number, x1: number, y1: number, height: number, edge: string) => ({
  id,
  name: id,
  childType: 'plateau',
  visible: true,
  contours: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
  height,
  edge,
})

/** One flat field, the grid off, white ambient light, indoors, with `plateaus` on it. */
function mapWith(plateaus: Any[], size = 60): Any {
  const map = structuredClone(TEMPLATE)
  map.grid = { ...map.grid, visible: false }
  map.mapSettings = { ...map.mapSettings, ambientLight: '#ffffff', environment: 'indoor' }
  const layer = map.layers.find((l: Any) => l.type === 'dungeon')
  const ground = layer.children.find((c: Any) => c.id === 'ground')
  layer.children = [
    { ...ground, contours: [[[0, 0], [size, 0], [size, size], [0, size]]], styleOverrides: { floorColor: '#c8b89a' } },
    ...plateaus,
  ]
  layer.mergedFloor = null
  layer.rooms = []
  return map
}

async function open(page: Page, map: Any): Promise<string[]> {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await gotoApp(page)
  await page.evaluate(async (data) => {
    const st = (window as Any).__store.getState()
    st.loadFromFile(structuredClone(data))
    st.setRoomsSheetOpen?.(false)
    st.setSelectedIds([])
    await st.saveCurrentMap()
    ;(window as Any).__store.setState((s: Any) => {
      s.mapSettings.environment = 'indoor'
      s.grid.visible = false
    })
  }, map)
  await page.waitForTimeout(3000)
  return errors
}

/** The camera at ZOOM px a cell with world `p` at the canvas centre. */
async function look(page: Page, p: Pt): Promise<void> {
  await page.evaluate(
    ({ p, zoom }) => {
      const app = (window as Any).__pixiApp
      const world = app.stage.children[0]
      const r = app.canvas.getBoundingClientRect()
      world.scale.set(zoom)
      world.position.set(r.width / 2 - p.x * zoom, r.height / 2 - p.y * zoom)
    },
    { p, zoom: ZOOM },
  )
  await waitFrame(page, 10)
  await page.waitForTimeout(500)
  await waitFrame(page, 4)
}

/** World `p` on the page. */
const screenOf = (page: Page, p: Pt) =>
  page.evaluate((p) => {
    const app = (window as Any).__pixiApp
    const r = app.canvas.getBoundingClientRect()
    const w = app.stage.children[0]
    return { x: r.left + p.x * w.scale.x + w.position.x, y: r.top + p.y * w.scale.x + w.position.y }
  }, p)

/**
 * The luminance along a line of world points, one screenshot for all of them: each the mean
 * of a 3 x 3 px patch.
 */
async function lums(page: Page, pts: Pt[]): Promise<number[]> {
  const at = await Promise.all(pts.map((p) => screenOf(page, p)))
  const x0 = Math.floor(Math.min(...at.map((a) => a.x))) - 2
  const y0 = Math.floor(Math.min(...at.map((a) => a.y))) - 2
  const x1 = Math.ceil(Math.max(...at.map((a) => a.x))) + 3
  const y1 = Math.ceil(Math.max(...at.map((a) => a.y))) + 3
  const png = await page.screenshot({ clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } })
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  return at.map((a) => {
    const cx = Math.round(a.x - x0)
    const cy = Math.round(a.y - y0)
    let sum = 0
    let n = 0
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const i = ((cy + dy) * info.width + (cx + dx)) * info.channels
        sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
        n++
      }
    }
    return sum / n
  })
}

/** Samples `step` cells apart from `from` along `dir`, `count` of them. */
const ray = (from: Pt, dir: Pt, step: number, count: number): Pt[] =>
  Array.from({ length: count }, (_, i) => ({ x: from.x + dir.x * step * (i + 0.5), y: from.y + dir.y * step * (i + 0.5) }))

test.describe('the plateau look', () => {
  test('Edge None darkens the ground below it, and wider for a taller drop', { tag: '@render' }, async ({ page }) => {
    const errors = await open(page, mapWith([box('none-1', 10, 10, 16, 16, 1, 'none'), box('none-3', 30, 10, 36, 16, 3, 'none')]))
    const west = { x: -1, y: 0 }
    const read = async (x: number) => {
      await look(page, { x: x - 1, y: 13 })
      // West of the west edge: the side the sun lights, so the drop shade alone.
      return lums(page, ray({ x, y: 13 }, west, 0.05, 50))
    }
    const one = await read(10)
    const three = await read(30)
    const at = (row: number[], d: number) => row[Math.round(d / 0.05 - 0.5)]
    console.log(`+1: 0.2 out ${at(one, 0.2).toFixed(1)}, 1.5 out ${at(one, 1.5).toFixed(1)}; +3: 0.2 out ${at(three, 0.2).toFixed(1)}, 1.5 out ${at(three, 1.5).toFixed(1)}`)
    expect(at(one, 1.5) - at(one, 0.2), '+1: 0.2 cell out against 1.5 out').toBeGreaterThanOrEqual(25)
    // Where the band gives out: the first sample within 3 of the far ground.
    const width = (row: number[]) => {
      const far = row[row.length - 1]
      return (row.findIndex((v) => far - v < 3) + 0.5) * 0.05
    }
    console.log(`band width +1 ${width(one).toFixed(2)}, +3 ${width(three).toFixed(2)}`)
    expect(width(three)).toBeGreaterThan(width(one) + 0.3)
    expect(errors).toEqual([])
  })

  test('the sun shadow starts on the edge and only lightens outward', { tag: '@render' }, async ({ page }) => {
    const errors = await open(page, mapWith([box('edge-2', 10, 10, 16, 16, 2, 'none'), box('edge-1', 30, 10, 36, 16, 1, 'none')]))
    // The indoor sun stands at the top left: the shadow runs down and to the right.
    const sun = { x: Math.SQRT1_2, y: Math.SQRT1_2 }
    for (const [x, name] of [[16, '+2'], [36, '+1']] as const) {
      await look(page, { x: x + 1, y: 14 })
      const row = await lums(page, ray({ x, y: 13 }, sun, 0.03, 100))
      console.log(`${name} along the sun from the east edge: ${row.filter((_, i) => i % 10 === 0).map((v) => v.toFixed(0)).join(' ')}`)
      // Dark at the edge: the first sample is among the darkest of the shadow.
      expect(row[0]).toBeLessThanOrEqual(Math.min(...row) + 2)
      // No sample within 0.3 cell of the edge (or anywhere) lighter than the one further out.
      for (let i = 0; i + 1 < row.length; i++) expect(row[i], `${name} at ${(i * 0.03).toFixed(2)} cell`).toBeLessThanOrEqual(row[i + 1] + 1.5)
      expect(row[row.length - 1] - row[0]).toBeGreaterThan(20)
    }
    expect(errors).toEqual([])
  })

  /** The luminance across a slope's east band at `height`, from its outline out, a sample a pixel, over `reach` cells. */
  const across = async (page: Page, height: number, reach: number) => {
    await open(page, mapWith([box('slope', 10, 10, 16, 16, height, 'slope')]))
    await look(page, { x: 17, y: 13 })
    const step = 1 / ZOOM
    return { step, row: await lums(page, ray({ x: 16, y: 13 }, { x: 1, y: 0 }, step, Math.round(reach / step))) }
  }
  /** The contours across a row: samples darker by 10 than the ramp 3 px either side, as sample indices. */
  const dipsOf = (row: number[]) => {
    const dips: number[] = []
    for (let i = 3; i < row.length - 3; i++) {
      if (row[i] < Math.max(row[i - 3], row[i + 3]) - 10 && row[i] <= Math.min(...row.slice(i - 2, i + 3))) {
        if (dips.length === 0 || i - dips[dips.length - 1] > 3) dips.push(i)
      }
    }
    return dips
  }

  test('a slope is a smooth ramp in a band outside its outline, with one contour a cell of drop', { tag: '@render' }, async ({ page }) => {
    const { step, row } = await across(page, 2, 1)
    const dips = dipsOf(row)
    console.log(`ramp: ${row.filter((_, i) => i % 6 === 0).map((v) => v.toFixed(0)).join(' ')}; contours ${dips.length}`)
    expect(dips.length).toBe(2)
    // Off the contours, the ramp only darkens toward its outer edge, never by 12 or more a pixel.
    const near = (i: number) => dips.some((d) => Math.abs(d - i) <= 4) || i >= row.length - 8
    let worst = 0
    for (let i = 0; i + 1 < row.length; i++) {
      if (near(i) || near(i + 1)) continue
      expect(row[i + 1], `at ${(i * step).toFixed(2)} cell`).toBeLessThanOrEqual(row[i] + 1.5)
      worst = Math.max(worst, Math.abs(row[i + 1] - row[i]))
    }
    console.log(`largest step between neighbours ${worst.toFixed(1)}`)
    expect(worst).toBeLessThan(12)
    expect(row[0] - row[row.length - 10]).toBeGreaterThan(20)
  })

  test('a slope is its card width wide at +1 and +3, one contour a cell of drop inside it', { tag: '@render' }, async ({ page }) => {
    for (const height of [1, 3]) {
      const { step, row } = await across(page, height, 2)
      const bare = row[row.length - 1]
      const dips = dipsOf(row)
      const off = row.filter((_, i) => !dips.some((d) => Math.abs(d - i) <= 4))
      // The band ends where its darkening falls to half of its darkest, off the contours.
      const peak = bare - Math.min(...off)
      let edge = 0
      for (let i = 0; i < row.length; i++) if (!dips.some((d) => Math.abs(d - i) <= 4) && bare - row[i] >= peak / 2) edge = i
      const width = (edge + 1) * step
      console.log(`+${height}: band width ${width.toFixed(2)}, contours ${dips.length}, 0.5 past it ${row[Math.round((1.5) / step)].toFixed(1)} against bare ${bare.toFixed(1)}`)
      expect(Math.abs(width - 1)).toBeLessThanOrEqual(0.1)
      expect(dips.length).toBe(height)
      // Nothing past the band: 0.5 cell beyond its outer edge is the bare floor.
      expect(Math.abs(row[Math.round(1.5 / step)] - bare)).toBeLessThanOrEqual(3)
    }
  })

  test('a 4 x 3.5 slope at +3 on a 9 x 9 floor leaves its top as Edge None does and the floor round it bare', { tag: '@render' }, async ({ page }) => {
    const plateau = (edge: string) => [box('small', 2.5, 2.75, 6.5, 6.25, 3, edge)]
    // The floor's outer frame, 1.25 cells deep (the band ends 1.5 cells in), and the top's centre.
    const frame: Pt[] = []
    for (let k = 0.5; k < 9; k += 1) frame.push({ x: k, y: 0.6 }, { x: k, y: 8.4 }, { x: 0.6, y: k }, { x: 8.4, y: k })
    const centre = { x: 4.5, y: 4.5 }
    const read = async (plateaus: Any[]) => {
      const errors = await open(page, mapWith(plateaus, 9))
      await look(page, { x: 4.5, y: 4.5 })
      const out = await lums(page, [centre, ...frame])
      expect(errors).toEqual([])
      return out
    }
    const bare = await read([])
    const slope = await read(plateau('slope'))
    const none = await read(plateau('none'))
    console.log(`top centre: slope ${slope[0].toFixed(1)}, Edge None ${none[0].toFixed(1)}, bare floor ${bare[0].toFixed(1)}`)
    expect(Math.abs(slope[0] - none[0])).toBeLessThanOrEqual(3)
    const worst = Math.max(...frame.map((_, i) => Math.abs(slope[i + 1] - bare[i + 1])))
    console.log(`outer frame: largest difference from the bare floor ${worst.toFixed(1)}`)
    expect(worst).toBeLessThanOrEqual(3)
  })
})

// ─── The ink set: both cliff arts, the contours, and the cave band left alone ───

type Rgb = [number, number, number]
const lumOf = ([r, g, b]: Rgb) => 0.299 * r + 0.587 * g + 0.114 * b
/** Ink: the set's neutral greys. The floor is tan (red well over blue) even under the drop shade. */
const isInk = (c: Rgb) => c[0] - c[2] < 12 && lumOf(c) < 170
/**
 * Cave rock: its stones and the half-clear grounds round them, greyer than the floor at the same
 * darkness. The drop shade keeps the floor's red-over-blue in step with its darkness (about a
 * quarter of it), the rock row falls well under that.
 */
const isRock = (c: Rgb) => c[0] - c[2] < 0.15 * lumOf(c) + 4 && lumOf(c) < 170
/** What a cliff art's pixels are, by its `edgeArt`: the rock row or the ink line. */
const artTest = (edgeArt: string | undefined) => (edgeArt ? isInk : isRock)

/** The camera at `zoom` px a cell with world `p` at the canvas centre. */
async function lookAt(page: Page, p: Pt, zoom: number): Promise<void> {
  await page.evaluate(
    ({ p, zoom }) => {
      const app = (window as Any).__pixiApp
      const world = app.stage.children[0]
      const r = app.canvas.getBoundingClientRect()
      world.scale.set(zoom)
      world.position.set(r.width / 2 - p.x * zoom, r.height / 2 - p.y * zoom)
    },
    { p, zoom },
  )
  await waitFrame(page, 10)
  await page.waitForTimeout(500)
  await waitFrame(page, 4)
}

/** One screenshot of the world box a..b, read back as the colour at any world point inside it. */
async function grab(page: Page, a: Pt, b: Pt): Promise<(p: Pt) => Rgb> {
  const t = await page.evaluate(() => {
    const app = (window as Any).__pixiApp
    const r = app.canvas.getBoundingClientRect()
    const w = app.stage.children[0]
    return { left: r.left + w.position.x, top: r.top + w.position.y, k: w.scale.x }
  })
  const x0 = Math.floor(t.left + a.x * t.k)
  const y0 = Math.floor(t.top + a.y * t.k)
  const x1 = Math.ceil(t.left + b.x * t.k)
  const y1 = Math.ceil(t.top + b.y * t.k)
  const png = await page.screenshot({ clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } })
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  return (p: Pt) => {
    const cx = Math.max(0, Math.min(info.width - 1, Math.round(t.left + p.x * t.k - x0)))
    const cy = Math.max(0, Math.min(info.height - 1, Math.round(t.top + p.y * t.k - y0)))
    const i = (cy * info.width + cx) * info.channels
    return [data[i], data[i + 1], data[i + 2]]
  }
}

const ring = (id: string, pts: [number, number][], height: number, edge: string) => ({
  id,
  name: id,
  childType: 'plateau',
  visible: true,
  contours: [pts],
  height,
  edge,
})

/** A row's contour crossings: samples darker by 10 than the ramp 3 px either side, as sample indices. */
const contourDips = (row: number[]) => {
  const dips: number[] = []
  for (let i = 3; i < row.length - 3; i++) {
    if (row[i] < Math.max(row[i - 3], row[i + 3]) - 10 && row[i] <= Math.min(...row.slice(i - 2, i + 3))) {
      if (dips.length === 0 || i - dips[dips.length - 1] > 3) dips.push(i)
    }
  }
  return dips
}

test.describe('the ink set', () => {
  /**
   * The width of the ledge across 25 transects of a +1 cliff's west edge, cells: on each, the run
   * of the art nearest the edge, runs closer than `mergeGap` taken as one (the gaps between stones).
   */
  const ledgeWidths = async (page: Page, edgeArt: string | undefined, mergeGap = 0, isArt = artTest(edgeArt)) => {
    const errors = await open(page, mapWith([{ ...box('c1', 10, 10, 16, 16, 1, 'cliff'), edgeArt }]))
    await lookAt(page, { x: 10, y: 13 }, ZOOM)
    const at = await grab(page, { x: 9, y: 10.4 }, { x: 11, y: 15.6 })
    const step = 1 / ZOOM
    const widths: number[] = []
    for (let y = 10.6; y <= 15.4; y += 0.2) {
      const runs: [number, number][] = []
      let from = -1
      for (let x = 9.2; x <= 10.8; x += step) {
        const ink = isArt(at({ x, y }))
        if (ink && from < 0) from = x
        if (!ink && from >= 0) {
          const last = runs[runs.length - 1]
          if (last && from - last[1] < mergeGap) last[1] = x
          else runs.push([from, x])
          from = -1
        }
      }
      if (from >= 0) runs.push([from, 10.8])
      if (runs.length === 0) continue
      const near = runs.reduce((a, b) => (Math.abs((a[0] + a[1]) / 2 - 10) <= Math.abs((b[0] + b[1]) / 2 - 10) ? a : b))
      widths.push(near[1] - near[0])
    }
    widths.sort((a, b) => a - b)
    expect(errors).toEqual([])
    expect(widths.length).toBeGreaterThanOrEqual(20)
    return { median: widths[Math.floor(widths.length / 2)], min: widths[0], max: widths[widths.length - 1], n: widths.length }
  }

  test('Cave rock, the default, lays a stone row 0.3 to 0.5 cell wide on a +1 cliff', { tag: '@render' }, async ({ page }) => {
    // The stones themselves (ink and grey fill), not the half-clear grounds round them.
    const w = await ledgeWidths(page, undefined, 0.08, isInk)
    console.log(`Cave rock across ${w.n} transects: median ${w.median.toFixed(3)} cell, ${w.min.toFixed(3)} to ${w.max.toFixed(3)}`)
    expect(w.median).toBeGreaterThanOrEqual(0.3)
    expect(w.median).toBeLessThanOrEqual(0.5)
  })

  test('Cave ink line lays an ink ribbon 0.12 to 0.30 cell wide on a +1 cliff', { tag: '@render' }, async ({ page }) => {
    const w = await ledgeWidths(page, 'GG_Cave_Ink:ledge')
    console.log(`Cave ink line across ${w.n} transects: median ${w.median.toFixed(3)} cell, ${w.min.toFixed(3)} to ${w.max.toFixed(3)}`)
    expect(w.median).toBeGreaterThanOrEqual(0.12)
    expect(w.median).toBeLessThanOrEqual(0.3)
  })

  /**
   * The stretches of the ring `pts` with no ink across it, from 0.8 cell in (as far as a bend
   * cuts a corner: a 90 degree bend bows 0.64 off its chord) to 0.4 out, over 0.05 cell; and the
   * longest bare stretch. A tip sharper than any bend (the walk lays it as two runs crossing)
   * is judged apart: the stretch within TIP_NEAR of it is left out, and the tip is bare when no
   * ink lies within TIP_NEAR of the point.
   */
  const TIP_NEAR = 0.45
  const ledgeHoles = async (page: Page, pts: [number, number][], centre: Pt, edgeArt: string | undefined) => {
    const isArt = artTest(edgeArt)
    const at = await grab(page, { x: centre.x - 7, y: centre.y - 7 }, { x: centre.x + 7, y: centre.y + 7 })
    const STEP = 0.02
    const holes: string[] = []
    let open = 0
    let longest = 0
    let last: Pt = centre
    const tips = pts.filter((q, i) => {
      const a = pts[(i - 1 + pts.length) % pts.length]
      const b = pts[(i + 1) % pts.length]
      const u = [q[0] - a[0], q[1] - a[1]]
      const v = [b[0] - q[0], b[1] - q[1]]
      const turn = Math.acos((u[0] * v[0] + u[1] * v[1]) / (Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1])))
      return (turn * 180) / Math.PI > 110
    })
    const nearTip = (p: Pt) => tips.some((t) => Math.hypot(p.x - t[0], p.y - t[1]) < TIP_NEAR)
    let bareTips = 0
    for (const t of tips) {
      let inked = false
      for (let y = -TIP_NEAR; y <= TIP_NEAR && !inked; y += 0.02)
        for (let x = -TIP_NEAR; x <= TIP_NEAR && !inked; x += 0.02)
          if (Math.hypot(x, y) <= TIP_NEAR) inked = isArt(at({ x: t[0] + x, y: t[1] + y }))
      if (!inked) bareTips++
    }
    const closeHole = () => {
      if (open * STEP > 0.05) holes.push(`${(open * STEP).toFixed(2)} cell ending at ${last.x.toFixed(2)},${last.y.toFixed(2)}`)
      longest = Math.max(longest, open * STEP)
      open = 0
    }
    for (let i = 0; i < pts.length; i++) {
      const a = { x: pts[i][0], y: pts[i][1] }
      const b = { x: pts[(i + 1) % pts.length][0], y: pts[(i + 1) % pts.length][1] }
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      let n = { x: (b.y - a.y) / len, y: -(b.x - a.x) / len }
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      if (n.x * (mid.x - centre.x) + n.y * (mid.y - centre.y) < 0) n = { x: -n.x, y: -n.y }
      for (let s = 0; s < len; s += STEP) {
        const p = { x: a.x + ((b.x - a.x) * s) / len, y: a.y + ((b.y - a.y) * s) / len }
        if (nearTip(p)) {
          closeHole()
          continue
        }
        let hit = false
        for (let d = -0.8; d <= 0.4 && !hit; d += 0.5 / ZOOM) hit = isArt(at({ x: p.x + n.x * d, y: p.y + n.y * d }))
        if (hit) closeHole()
        else open++
        last = p
      }
    }
    closeHole()
    return { holes, longest, tips: tips.length, bareTips }
  }

  test('a 12-gon and a five-point star plateau show no ledge hole over 0.05 cell round the ring, in either cliff art', { tag: '@render' }, async ({ page }) => {
    const c = { x: 20, y: 20 }
    const gon = Array.from({ length: 12 }, (_, k): [number, number] => [c.x + 5 * Math.cos((k * Math.PI) / 6), c.y + 5 * Math.sin((k * Math.PI) / 6)])
    const star = Array.from({ length: 10 }, (_, k): [number, number] => {
      const r = k % 2 === 0 ? 5.5 : 2.6
      const t = -Math.PI / 2 + (k * Math.PI) / 5
      return [c.x + r * Math.cos(t), c.y + r * Math.sin(t)]
    })
    for (const [name, pts, edgeArt] of [
      ['12-gon Cave rock', gon, undefined],
      ['star Cave rock', star, undefined],
      ['12-gon Cave ink line', gon, 'GG_Cave_Ink:ledge'],
      ['star Cave ink line', star, 'GG_Cave_Ink:ledge'],
    ] as const) {
      const errors = await open(page, mapWith([{ ...ring(name, [...pts], 1, 'cliff'), edgeArt }]))
      // Lifted clear of the dock along the bottom of the canvas.
      await lookAt(page, { x: c.x, y: c.y + 1 }, 40)
      const { holes, longest, tips, bareTips } = await ledgeHoles(page, [...pts], c, edgeArt)
      await page.screenshot({ path: test.info().outputPath(`${name.replace(/ /g, '-')}.png`) })
      console.log(`${name}: ${holes.length} holes over 0.05 cell, longest bare stretch ${longest.toFixed(2)} cell; ${bareTips} of ${tips} sharp tips bare`)
      expect(holes, name).toEqual([])
      expect(bareTips, name).toBe(0)
      expect(errors).toEqual([])
    }
  })

  test("leaves the warren's cave wall band as it was drawn before the ink set", { tag: '@render' }, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const map = structuredClone(WARREN)
    map.grid = { ...map.grid, visible: false }
    map.mapSettings = { ...map.mapSettings, ambientLight: '#ffffff', environment: 'indoor' }
    // Floors and doors only: the band, with nothing that flickers or moves over it.
    for (const l of map.layers) if (l.children) l.children = l.children.filter((c: Any) => c.childType === 'shape' || c.childType === 'door')
    const errors = await open(page, map)
    // The shell's panels float over the map; the picture is of the band alone.
    await page.addStyleTag({ content: '[data-chrome] { visibility: hidden !important; }' })
    await page.waitForTimeout(1000)
    await lookAt(page, { x: 30, y: 23.6 }, 16)
    await page.waitForTimeout(1000)
    const box = (await page.locator('canvas').first().boundingBox())!
    const png = await page.screenshot({
      clip: { x: Math.round(box.x + box.width / 2 - 440), y: Math.round(box.y + box.height / 2 - 360), width: 880, height: 630 },
    })
    await sharp(png).toFile(test.info().outputPath('warren-band.png'))
    const now = await sharp(png).raw().toBuffer({ resolveWithObject: true })
    const was = await sharp(BAND_BEFORE).raw().toBuffer({ resolveWithObject: true })
    expect([now.info.width, now.info.height]).toEqual([was.info.width, was.info.height])
    let off = 0
    let sum = 0
    const px = now.info.width * now.info.height
    for (let i = 0; i < px; i++) {
      let worst = 0
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(now.data[i * now.info.channels + c] - was.data[i * was.info.channels + c])
        worst = Math.max(worst, d)
        sum += d
      }
      if (worst > 24) off++
    }
    console.log(`warren band against the drawing before the ink set: ${off} of ${px} pixels off by more than 24, mean difference ${(sum / px / 3).toFixed(3)}`)
    expect(off / px).toBeLessThan(0.002)
    expect(errors).toEqual([])
  })

  test('a +2 slope shows exactly 2 walked contour rings across its band', { tag: '@render' }, async ({ page }) => {
    const errors = await open(page, mapWith([box('slope', 10, 10, 16, 16, 2, 'slope')]))
    await lookAt(page, { x: 17, y: 13 }, ZOOM)
    const at = await grab(page, { x: 15.5, y: 10.5 }, { x: 17.5, y: 15.5 })
    const counts: number[] = []
    for (let y = 11; y <= 15; y += 0.2) {
      const row = ray({ x: 16, y }, { x: 1, y: 0 }, 1 / ZOOM, ZOOM).map((p) => lumOf(at(p)))
      counts.push(contourDips(row).length)
    }
    const tally = new Map<number, number>()
    for (const n of counts) tally.set(n, (tally.get(n) ?? 0) + 1)
    const mode = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0]
    console.log(`contours crossed on ${counts.length} rows: ${[...tally.entries()].map(([n, k]) => `${n} rings x${k}`).join(', ')}`)
    expect(mode).toBe(2)
    expect((tally.get(2) ?? 0) / counts.length).toBeGreaterThanOrEqual(0.5)
    expect(Math.max(...counts)).toBeLessThanOrEqual(2)
    expect(errors).toEqual([])
  })
})
