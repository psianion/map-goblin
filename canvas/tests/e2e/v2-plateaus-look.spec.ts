import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { waitForBoot, waitFrame } from './helpers'

/**
 * How a plateau darkens the ground below it, read off the screen: the drop shade every edge
 * kind lays on its low side, and the sun shadow that starts on the edge itself. Indoors, so
 * the shadows come from the fixed top-left sun; on a flat floor colour with the grid off, so
 * the pixels are the shade alone.
 */

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any
type Pt = { x: number; y: number }

const sharp = createRequire(fileURLToPath(new URL('../../../packages/vault-engine/package.json', import.meta.url)))('sharp')

const TEMPLATE = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../session/testdata/plateau-test.mapbuilder', import.meta.url)), 'utf8'),
)

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
function mapWith(plateaus: Any[]): Any {
  const map = structuredClone(TEMPLATE)
  map.grid = { ...map.grid, visible: false }
  map.mapSettings = { ...map.mapSettings, ambientLight: '#ffffff', environment: 'indoor' }
  const layer = map.layers.find((l: Any) => l.type === 'dungeon')
  const ground = layer.children.find((c: Any) => c.id === 'ground')
  layer.children = [
    { ...ground, contours: [[[0, 0], [60, 0], [60, 60], [0, 60]]], styleOverrides: { floorColor: '#c8b89a' } },
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
})
