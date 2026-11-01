import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { firePointer, waitForBoot, waitFrame } from './helpers'

/**
 * Free-standing doors in /v2, on a copy of the goblin warren: a door placed on open floor
 * lands on a piece of wall of its own, turns a quarter from its card (the piece reads
 * vertical), goes with its piece when deleted and comes back with it on undo; the dock's
 * angle places it turned; a click on the door picks the door and Alt+click steps to its
 * piece; a click on a drawn wall still hangs the door on that wall; W draws a wall by
 * clicks and Enter; a double-click cycles a hung door closed, open, locked (an archway only
 * opens and shuts); and Secret, from the dock and on the card, with Locked on the card.
 */

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any
type Pt = { x: number; y: number }

const WARREN = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../session/testdata/goblin-warren.mapbuilder', import.meta.url)), 'utf8'),
)

/** Open floor in the warren: inside the cave, well clear of its edges and of every drawn wall. */
const OPEN_FLOOR: Pt = { x: 34, y: 10 }

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

async function openWarren(page: Page): Promise<void> {
  await page.goto('/v2?e2e=1')
  await waitForBoot(page)
  await page.getByTestId('v2-new-map-card').click()
  await page.getByTestId('v2-new-map-submit').click()
  await expect(page.getByTestId('v2-editor')).toBeVisible()
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
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const l = st.layers.find((x: Any) => x.type === 'dungeon')
    st.setActiveLayerId(l.id)
    st.setGridVisible(true)
  })
  await page.keyboard.press('Control+0')
  await waitFrame(page, 6)
}

const screenOf = (page: Page, p: Pt) => inPage<Pt>(page, `(s, layer, w2s, p) => w2s(p.x, p.y)`, p)
const doors = (page: Page) => inPage<Any[]>(page, `(s, layer) => layer().children.filter((c) => c.childType === 'door')`)
const walls = (page: Page) => inPage<Any[]>(page, `(s, layer) => layer().standaloneWalls`)
const sel = (page: Page) => inPage<string[]>(page, `(s) => s().selection.selectedIds`)
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())

async function click(page: Page, world: Pt, mods: { alt?: boolean } = {}): Promise<void> {
  const at = await screenOf(page, world)
  await firePointer(page, 'pointermove', at.x, at.y, 0, 0, mods)
  await firePointer(page, 'pointerdown', at.x, at.y, 0.5, 1, mods)
  await firePointer(page, 'pointerup', at.x, at.y, 0, 0, mods)
  await waitFrame(page, 3)
}

/**
 * `n` down/up pairs at one point, dispatched in one go after a real move there: a driver
 * round trip per event is slower than the tool's double-click window.
 */
async function tap(page: Page, world: Pt, n: number): Promise<void> {
  const at = await screenOf(page, world)
  await page.mouse.move(at.x, at.y)
  await waitFrame(page, 1)
  await page.evaluate(
    ({ x, y, n }) => {
      const canvas = document.querySelector('canvas')!
      for (let i = 0; i < n; i++) {
        for (const type of ['pointerdown', 'pointerup']) {
          canvas.dispatchEvent(
            new PointerEvent(type, {
              clientX: x,
              clientY: y,
              pointerId: 1,
              pointerType: 'mouse',
              bubbles: true,
              cancelable: true,
              buttons: type === 'pointerdown' ? 1 : 0,
              pressure: type === 'pointerdown' ? 0.5 : 0,
            }),
          )
        }
      }
    },
    { x: at.x, y: at.y, n },
  )
  await waitFrame(page, 3)
}

async function undo(page: Page): Promise<void> {
  await blur(page)
  await page.keyboard.press('Control+z')
  await waitFrame(page, 3)
}

/** The Door tool out, snap off so the door lands exactly where clicked. */
async function doorTool(page: Page): Promise<void> {
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    st.setSnapEnabled(false)
    st.setActiveTool('door')
  })
  await waitFrame(page, 2)
}

/** The new door (the last one) and the piece it stands on. */
async function freeDoor(page: Page): Promise<{ door: Any; piece: Any }> {
  const door = (await doors(page)).at(-1)
  const piece = (await walls(page)).find((w: Any) => w.id === door.wallId)
  return { door, piece }
}

test('a door on open floor stands on its own piece; Turn 90° on its card makes it vertical', async ({ page }) => {
  await openWarren(page)
  const [doorsBefore, wallsBefore] = [(await doors(page)).length, (await walls(page)).length]
  await doorTool(page)
  await click(page, OPEN_FLOOR)
  expect(await doors(page)).toHaveLength(doorsBefore + 1)
  expect(await walls(page)).toHaveLength(wallsBefore + 1)
  const { door, piece } = await freeDoor(page)
  expect(piece).toBeDefined()
  const [a, b] = piece.points
  expect(Math.abs(b[0] - a[0])).toBeCloseTo(door.width)
  expect(b[1]).toBeCloseTo(a[1])
  expect(await sel(page)).toEqual([door.id])

  const card = page.getByTestId('v2-selection-card')
  await expect(card.getByRole('spinbutton', { name: 'Door angle' })).toHaveValue('0')
  await card.getByRole('button', { name: 'Turn 90°' }).click()
  await waitFrame(page, 3)
  const turned = await freeDoor(page)
  const [c, d] = turned.piece.points
  expect(c[0]).toBeCloseTo(d[0])
  expect(Math.abs(d[1] - c[1])).toBeCloseTo(door.width)
  expect(turned.door.angle).toBeCloseTo(Math.PI / 2)
  await expect(card.getByRole('spinbutton', { name: 'Door angle' })).toHaveValue('90')
  // One undo step for the turn, one for the placing.
  await undo(page)
  expect((await freeDoor(page)).piece.points).toEqual(piece.points)
  await undo(page)
  expect(await doors(page)).toHaveLength(doorsBefore)
  expect(await walls(page)).toHaveLength(wallsBefore)
})

test('deleting a free door takes its piece with it; one undo brings both back', async ({ page }) => {
  await openWarren(page)
  const wallsBefore = (await walls(page)).length
  await doorTool(page)
  await click(page, OPEN_FLOOR)
  const { door, piece } = await freeDoor(page)
  await page.getByTestId('v2-selection-card').getByRole('button', { name: 'Delete' }).click()
  await waitFrame(page, 3)
  expect((await doors(page)).some((x: Any) => x.id === door.id)).toBe(false)
  expect(await walls(page)).toHaveLength(wallsBefore)
  await undo(page)
  const back = await freeDoor(page)
  expect(back.door.id).toBe(door.id)
  expect(back.piece.id).toBe(piece.id)
})

test('the dock’s Angle 90 places the next free door vertical; a click on it picks the door, Alt+click steps to its piece', async ({ page }) => {
  await openWarren(page)
  await doorTool(page)
  const field = page.getByRole('textbox', { name: 'Door angle' })
  await field.fill('90')
  await field.press('Enter')
  expect(await inPage<number>(page, `(s) => s().tools.settings.doorAngle`)).toBe(90)
  await click(page, OPEN_FLOOR)
  const { door, piece } = await freeDoor(page)
  expect(piece.points[0][0]).toBeCloseTo(piece.points[1][0])
  expect(door.angle).toBeCloseTo(Math.PI / 2)

  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    st.setActiveTool('select')
    st.setSelectedIds([])
  })
  await waitFrame(page, 2)
  await click(page, OPEN_FLOOR)
  expect(await sel(page)).toEqual([door.id])
  await click(page, OPEN_FLOOR, { alt: true })
  const seen = new Set<string>([(await sel(page))[0]])
  for (let i = 0; i < 4 && !seen.has(piece.id); i++) {
    await click(page, OPEN_FLOOR, { alt: true })
    seen.add((await sel(page))[0])
  }
  expect(seen.has(piece.id)).toBe(true)
})

test('a click on a drawn wall still hangs the door on that wall, at the wall’s angle', async ({ page }) => {
  await openWarren(page)
  const wallsBefore = (await walls(page)).length
  // wall-003, the Timber Door's piece, longer than the door: not a piece of its own.
  const w = (await walls(page)).find((x: Any) => x.id === 'wall-003')
  await page.evaluate(() => (window as Any).__store.getState().updateToolSettings({ doorAngle: 90 }))
  await doorTool(page)
  // Remove the wall's own door first, so the click places rather than picks.
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    st.removeChild(st.ui.activeLayerId, 'door-03-timber-door')
  })
  const [a, b] = w.points
  await click(page, { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 })
  const placed = (await doors(page)).at(-1)
  expect(placed.wallId).toBe('wall-003')
  expect(placed.angle).toBeCloseTo(Math.atan2(b[1] - a[1], b[0] - a[0]))
  expect(await walls(page)).toHaveLength(wallsBefore)
})

test('W draws a wall by click, click, Enter: a normal wall, and one undo takes it away', async ({ page }) => {
  await openWarren(page)
  const before = (await walls(page)).length
  await page.evaluate(() => (window as Any).__store.getState().setSnapEnabled(false))
  await blur(page)
  await page.keyboard.press('w')
  await waitFrame(page, 2)
  expect(await inPage<string>(page, `(s) => s().tools.activeTool`)).toBe('wall')
  await click(page, { x: OPEN_FLOOR.x - 3, y: OPEN_FLOOR.y })
  await click(page, { x: OPEN_FLOOR.x + 3, y: OPEN_FLOOR.y })
  await page.keyboard.press('Enter')
  await waitFrame(page, 4)
  const after = await walls(page)
  expect(after).toHaveLength(before + 1)
  const drawn = after.at(-1)
  expect(drawn.wallType).toBe('normal')
  expect(drawn.points[0][0]).toBeCloseTo(OPEN_FLOOR.x - 3)
  expect(drawn.points.at(-1)[0]).toBeCloseTo(OPEN_FLOOR.x + 3)
  await undo(page)
  expect(await walls(page)).toHaveLength(before)
})

test('a double-click on a hung door cycles closed → open → locked → closed; an archway has no state to cycle', async ({ page }) => {
  await openWarren(page)
  const w = (await walls(page)).find((x: Any) => x.id === 'wall-003')
  await doorTool(page)
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    st.removeChild(st.ui.activeLayerId, 'door-03-timber-door')
  })
  const [a, b] = w.points
  const mid = { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 }
  await click(page, mid)
  const placed = (await doors(page)).at(-1)
  expect(placed.wallId).toBe('wall-003')
  expect(placed.state).toBe('closed')
  const state = async () => (await doors(page)).find((d: Any) => d.id === placed.id).state
  const at = { x: placed.position[0], y: placed.position[1] }
  for (const want of ['open', 'locked', 'closed']) {
    await page.waitForTimeout(500)
    await tap(page, at, 2)
    expect(await state()).toBe(want)
  }

  // A permanent opening has no state to cycle: a double-click leaves it as it is.
  await page.getByTestId('v2-selection-card').getByRole('combobox', { name: 'Style' }).selectOption('archway')
  await waitFrame(page, 2)
  const arch = await state()
  for (let i = 0; i < 2; i++) {
    await page.waitForTimeout(500)
    await tap(page, at, 2)
    expect(await state()).toBe(arch)
  }
})

test('the dock’s Secret places a secret door; the card’s Secret and Locked each land as one undo step', async ({ page }) => {
  await openWarren(page)
  await doorTool(page)
  const dock = page.getByTestId('v2-dock')
  await dock.getByRole('switch', { name: 'Secret' }).click()
  expect(await inPage<boolean>(page, `(s) => s().tools.settings.doorSecret`)).toBe(true)
  await click(page, OPEN_FLOOR)
  const { door } = await freeDoor(page)
  expect(door.isSecret).toBe(true)
  const now = async () => (await doors(page)).find((d: Any) => d.id === door.id)

  const card = page.getByTestId('v2-selection-card')
  await expect(card.getByRole('switch', { name: 'Secret' })).toHaveAttribute('aria-checked', 'true')
  await card.getByRole('switch', { name: 'Secret' }).click()
  expect((await now()).isSecret).toBe(false)
  await undo(page)
  expect((await now()).isSecret).toBe(true)

  await card.getByRole('button', { name: 'Locked' }).click()
  expect((await now()).state).toBe('locked')
  await expect(card.getByRole('button', { name: 'Locked' })).toHaveAttribute('aria-pressed', 'true')
  await undo(page)
  expect((await now()).state).toBe('closed')
  // The door is still there after both undos: each was one step.
  expect(await now()).toBeDefined()
})
