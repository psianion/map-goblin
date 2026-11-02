import { test, expect, type Page } from '@playwright/test'
import { firePointer, waitForBoot, waitFrame } from './helpers'

/**
 * The Path tool in /v2, end to end on a blank map (scenario 1 without junctions): a road
 * by clicks and one by a freehand drag, the wheel setting the next point's width,
 * Backspace, closing on the first point, Alt's straight segment, the lake preset and the
 * card's Fill switch, and undo: one entry per path, one per point drag. Paths draw as flat
 * ribbons for now; the textured renderer comes after.
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

/** The flat ribbons' bounds, in world cells. */
const ribbonBounds = (page: Page) =>
  page.evaluate(() => {
    const w = window as Any
    const find = (c: Any): Any => (c.label === 'sublayer-paths' ? c : (c.children ?? []).map(find).find(Boolean))
    const sub = find(w.__pixiApp.stage)
    const b = sub?.getLocalBounds?.()
    return b ? { width: b.width, height: b.height } : null
  })

test('a road drawn by clicks: one path, a ribbon on the canvas, one undo step', async ({ page }) => {
  await openEditor(page)
  await key(page, 'a')
  await click(page, { x: -4, y: 0 })
  await click(page, { x: 0, y: 1 })
  await click(page, { x: 4, y: 0 })
  await key(page, 'Enter')
  const [road] = await paths(page)
  expect(road.points).toHaveLength(3)
  expect(road).toMatchObject({ closed: false, materialId: 'gg-forge:road-dirt', width: 1.5 })
  const b = await ribbonBounds(page)
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
