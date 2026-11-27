// The owner's own rooms flow in the editor (rooms plan, section 8): find Rooms on the rail;
// brush a cave of two chambers and a passage, with brush strokes; Suggest; take one dividing
// line away; Accept all as one undo step; then outline a room on open ground.

import { test, expect, type Page } from '@playwright/test'
import { gotoApp, waitFrame } from './helpers'
import { VIEWPORT, lookAt, pickFromFlyout } from './shell'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
type Pt = { x: number; y: number }

/** Runs `fn` (source text) in the page with the store getter, the active map layer and a world to screen mapping. */
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

const toScreen = (page: Page, p: Pt) => inPage<Pt>(page, `(s, layer, w2s, p) => w2s(p.x, p.y)`, p)

/** One brush stroke through world points, pressed the whole way, as a hand paints. */
async function stroke(page: Page, points: Pt[]): Promise<void> {
  const [first, ...rest] = await Promise.all(points.map((p) => toScreen(page, p)))
  await page.mouse.move(first.x, first.y)
  await page.mouse.down()
  for (const p of rest) await page.mouse.move(p.x, p.y, { steps: 10 })
  await page.mouse.up()
  await waitFrame(page, 6)
}

const setBrush = (page: Page, radius: number) =>
  inPage(page, `(s, layer, w2s, r) => window.__store.setState((d) => { d.tools.settings.material.radius = r })`, radius)

/** What the layer and the proposals hold. */
const state = (page: Page) =>
  inPage<{ rooms: Any[]; thresholds: number; floors: number; ghosts: Any[]; lines: Any[] }>(
    page,
    `(s, layer) => ({
      rooms: (layer().rooms ?? []).map((r) => ({ id: r.id, name: r.name, number: r.number, boundary: r.boundary ?? null, face: (r.face ?? []).length })),
      thresholds: (layer().thresholds ?? []).length,
      floors: layer().children.filter((c) => c.childType === 'shape').length,
      ghosts: (s().ui.roomSuggestions?.rooms ?? []).map((r) => ({ id: r.id, name: r.name, anchor: r.anchor })),
      lines: (s().ui.roomSuggestions?.divides ?? []).map((t) => ({ id: t.id, points: t.points })),
    })`,
  )

test('rooms: find Rooms on the rail, Suggest on a brushed cave, take a line away, accept, then outline open ground', { tag: '@text' }, async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  await gotoApp(page)
  await inPage(page, `(s) => {
    s().setFocusMode('manual')
    s().setActiveTool('select')
    s().setActiveLayerId(s().layers.find((l) => l.type === 'dungeon' && !l.locked).id)
  }`)
  await lookAt(page, { x: 12, y: 8 }, 40)

  // Rooms is on the rail, not under Text: a click lands on Outline with Suggest showing, no flyout.
  const railRooms = page.getByTestId('shell-rail').getByRole('button', { name: 'Rooms', exact: true })
  await expect(railRooms).toBeVisible()
  await railRooms.click()
  await expect(page.getByTestId('shell-flyout')).toHaveCount(0)
  const panel = page.getByTestId('shell-tool-panel')
  await expect(panel).toHaveAttribute('data-tool', 'roomOutline')
  await expect(page.getByTestId('rooms-suggest-button')).toBeVisible()
  for (const tool of ['Outline', 'Divide', 'Draw room']) await expect(panel.getByRole('button', { name: new RegExp(`^${tool}`) })).toBeVisible()
  await page.keyboard.press('Escape')

  // A cave of brush strokes: two wide chambers, a narrow passage between them.
  await pickFromFlyout(page, 'Terrain', 'Material brush')
  await waitFrame(page, 4)
  await setBrush(page, 2)
  await stroke(page, [{ x: 4, y: 6 }, { x: 8, y: 6 }, { x: 8, y: 9 }, { x: 4, y: 9 }, { x: 4, y: 6 }])
  await stroke(page, [{ x: 17, y: 6 }, { x: 21, y: 6 }, { x: 21, y: 9 }, { x: 17, y: 9 }, { x: 17, y: 6 }])
  await setBrush(page, 0.5)
  await stroke(page, [{ x: 8, y: 7.5 }, { x: 17, y: 7.5 }])
  await expect.poll(async () => (await state(page)).floors, { message: 'the strokes landed as floor' }).toBeGreaterThan(0)

  // Suggest: chambers and the passage come up as separate ghosts, with the lines between them.
  await pickFromFlyout(page, 'Rooms', 'Outline')
  await expect(page.getByTestId('shell-status-hint')).toContainText('Drag a rectangle, or click the corners')
  const suggest = page.getByTestId('rooms-suggest')
  await suggest.getByRole('button', { name: 'Suggest rooms' }).click()
  await expect(page.getByTestId('rooms-suggest-count')).toContainText('suggested')
  const before = await state(page)
  expect(before.ghosts.length).toBeGreaterThanOrEqual(3)
  expect(before.lines.length).toBeGreaterThanOrEqual(2)
  expect(before.ghosts.some((g: Any) => /^Passage \d+$/.test(g.name))).toBe(true)
  await expect(page.getByTestId('rooms-suggest-lines')).toContainText(`${before.lines.length} dividing line`)

  // Take one line away by its ✕, past one end of the line and clear of every ghost's chip: the spaces either side join.
  const line = before.lines[0]
  const at = await page.evaluate((id) => (window as Any).__roomOverlay.lineMarkAt(id) as [number, number] | null, line.id)
  expect(at).toBeTruthy()
  const a = line.points[0]
  const b = line.points[line.points.length - 1]
  const offMiddle = Math.hypot(at![0] - (a[0] + b[0]) / 2, at![1] - (a[1] + b[1]) / 2)
  expect(offMiddle).toBeGreaterThanOrEqual(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2)
  const mark = await toScreen(page, { x: at![0], y: at![1] })
  await page.mouse.click(mark.x, mark.y)
  await waitFrame(page, 4)
  const after = await state(page)
  expect(after.lines).toHaveLength(before.lines.length - 1)
  expect(after.lines.some((l: Any) => l.id === line.id)).toBe(false)
  expect(after.ghosts).toHaveLength(before.ghosts.length - 1)
  expect((await state(page)).rooms).toHaveLength(0)

  // Accept all: the lines left, then the rooms, as one undo step.
  await suggest.getByRole('button', { name: 'Accept all' }).click()
  await waitFrame(page, 6)
  let now = await state(page)
  expect(now.ghosts).toHaveLength(0)
  expect(now.rooms).toHaveLength(after.ghosts.length)
  expect(now.thresholds).toBe(after.lines.length)
  await expect.poll(async () => (await state(page)).rooms.every((r: Any) => r.face > 2), { message: 'every accepted room keeps its own face' }).toBe(true)
  const undo = page.getByTestId('shell-top-actions').getByRole('button', { name: 'Undo' })
  await undo.click()
  await waitFrame(page, 4)
  now = await state(page)
  expect(now.rooms).toHaveLength(0)
  expect(now.thresholds).toBe(0)
  await page.getByTestId('shell-top-actions').getByRole('button', { name: 'Redo' }).click()
  await waitFrame(page, 4)
  now = await state(page)
  expect(now.rooms).toHaveLength(after.ghosts.length)
  expect(now.thresholds).toBe(after.lines.length)

  // Outline a room on open ground, below the cave: a drag makes a numbered room, no floor.
  const floors = now.floors
  const from = await toScreen(page, { x: 6, y: 13 })
  const to = await toScreen(page, { x: 11, y: 16 })
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
  await waitFrame(page, 6)
  now = await state(page)
  const outlined = now.rooms.find((r: Any) => r.boundary)
  expect(outlined).toBeTruthy()
  expect(outlined.boundary).toHaveLength(4)
  expect(outlined.name).toBe(`Room ${outlined.number}`)
  expect(now.rooms).toHaveLength(after.ghosts.length + 1)
  expect(now.floors).toBe(floors)
  await undo.click()
  await waitFrame(page, 4)
  expect((await state(page)).rooms).toHaveLength(after.ghosts.length)
})
