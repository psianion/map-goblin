import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { waitForBoot, waitFrame } from './helpers'

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

/** Screen pixels a cell while measuring. */
const ZOOM = 60

const box = (id: string, x0: number, y0: number, x1: number, y1: number, height: number, edge: string, extra: Any = {}) => ({
  id,
  name: id,
  childType: 'plateau',
  visible: true,
  contours: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
  height,
  edge,
  ...extra,
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
  await page.goto('/v2?e2e=1')
  await waitForBoot(page)
  await page.getByTestId('v2-new-map-card').click()
  await page.getByTestId('v2-new-map-submit').click()
  await expect(page.getByTestId('v2-editor')).toBeVisible()
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
  test('Edge None darkens the ground below it, and wider for a taller drop', async ({ page }) => {
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

  test('the sun shadow starts on the edge and only lightens outward', async ({ page }) => {
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

  test('a slope is a smooth ramp in a band outside its outline, with one contour a cell of drop', async ({ page }) => {
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

  test('a slope is its card width wide at +1 and +3, one contour a cell of drop inside it', async ({ page }) => {
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

  test('a 4 x 3.5 slope at +3 on a 9 x 9 floor leaves its top as Edge None does and the floor round it bare', async ({ page }) => {
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

// ─── The ink set ───

type Rgb = [number, number, number]
const lumOf = ([r, g, b]: Rgb) => 0.299 * r + 0.587 * g + 0.114 * b
/** Ink: the set's neutral greys. The floor is tan (red well over blue) even under the drop shade. */
const isInk = (c: Rgb) => c[0] - c[2] < 12 && lumOf(c) < 170
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

/** Signed distance outside the axis-aligned square x0..x1, y0..y1 (negative inside). */
const outOfBox = (p: Pt, x0: number, y0: number, x1: number, y1: number) => {
  const dx = Math.max(x0 - p.x, p.x - x1)
  const dy = Math.max(y0 - p.y, p.y - y1)
  return dx > 0 || dy > 0 ? Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) : Math.max(dx, dy)
}

test.describe('the ink set', () => {
  test('Foot rubble adds ink on the low side within 1.2 cells of a cliff and nothing on its top', async ({ page }) => {
    const read = async (footRubble: boolean) => {
      const errors = await open(page, mapWith([box('p', 10, 10, 18, 18, 2, 'cliff', { footRubble })]))
      // Lifted clear of the dock along the bottom of the canvas.
      await lookAt(page, { x: 14, y: 15 }, 36)
      const at = await grab(page, { x: 8, y: 8 }, { x: 20, y: 20 })
      if (footRubble) await page.screenshot({ path: test.info().outputPath('foot-rubble.png') })
      expect(errors).toEqual([])
      return at
    }
    const off = await read(false)
    const on = await read(true)
    const zones = { foot: [0, 0, 0], beyond: [0, 0, 0], top: [0, 0, 0] }
    for (let y = 8.2; y <= 19.8; y += 1 / 36) {
      for (let x = 8.2; x <= 19.8; x += 1 / 36) {
        const d = outOfBox({ x, y }, 10, 10, 18, 18)
        const zone = d > 0.3 && d <= 1.2 ? zones.foot : d > 1.35 && d <= 1.8 ? zones.beyond : d < -0.45 ? zones.top : null
        if (!zone) continue
        const a = on({ x, y })
        const b = off({ x, y })
        zone[0] += isInk(a) ? 1 : 0
        zone[1] += isInk(b) ? 1 : 0
        zone[2]++
      }
    }
    const pct = (z: number[]) => `${((z[0] / z[2]) * 100).toFixed(2)} % on, ${((z[1] / z[2]) * 100).toFixed(2)} % off`
    console.log(`ink: 0.3 to 1.2 cell out ${pct(zones.foot)}; 1.35 to 1.8 out ${pct(zones.beyond)}; top ${pct(zones.top)}`)
    expect((zones.foot[0] - zones.foot[1]) / zones.foot[2]).toBeGreaterThan(0.1)
    expect(Math.abs(zones.beyond[0] - zones.beyond[1]) / zones.beyond[2]).toBeLessThan(0.01)
    expect(zones.top[0] - zones.top[1]).toBe(0)
  })
})
