import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { firePointer, waitForBoot, waitFrame } from './helpers'

/**
 * Selection and editing in /v2, end to end, on a copy of the goblin warren: every kind
 * through one pick (water, zones, drawn walls with their doors), the one box for walls
 * (move, rotate, resize, with a pixel check that the band moved), duplicate and copy of
 * walls, Shift and Alt marquees, the level and whole-face rules, the kind filter chip,
 * per-object locks, the mixed card, the header's verbs, Alt-click cycling and Alt-drag
 * copies, nudges folding into one undo step, undo handing the selection back, the Esc
 * steps, the key guard in the label's text field, no accent colour, and no floating bar.
 */

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any
type Pt = { x: number; y: number }

const WARREN = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../session/testdata/goblin-warren.mapbuilder', import.meta.url)), 'utf8'),
)

/** Run `fn` (source text) in the page with the store getter, the active layer and a world → screen mapping. */
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
const sel = (page: Page) => inPage<string[]>(page, `(s) => s().selection.selectedIds`)
const select = (page: Page, ids: string[]) => inPage<void>(page, `(s, l, w, ids) => s().setSelectedIds(ids)`, ids)
const zoom = (page: Page) => inPage<number>(page, `() => window.__pixiApp.stage.children[0].scale.x`)
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())

async function key(page: Page, combo: string) {
  await blur(page)
  await page.keyboard.press(combo)
  await waitFrame(page, 2)
}

const undo = (page: Page) => key(page, 'Control+z')

type Mods = { shift?: boolean; ctrl?: boolean; alt?: boolean }

async function click(page: Page, at: Pt, mods: Mods = {}) {
  await firePointer(page, 'pointermove', at.x, at.y, 0, 0, mods)
  await firePointer(page, 'pointerdown', at.x, at.y, 0.5, 1, mods)
  await firePointer(page, 'pointerup', at.x, at.y, 0, 0, mods)
  await waitFrame(page, 2)
}

/** A drag in screen px, in steps so every tool sees travel. */
async function drag(page: Page, from: Pt, to: Pt, mods: Mods = {}, steps = 6) {
  await firePointer(page, 'pointermove', from.x, from.y, 0, 0, mods)
  await firePointer(page, 'pointerdown', from.x, from.y, 0.5, 1, mods)
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    await firePointer(page, 'pointermove', from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, 0.5, 1, mods)
  }
  await firePointer(page, 'pointerup', to.x, to.y, 0, 0, mods)
  await waitFrame(page, 3)
}

async function rightClick(page: Page, at: Pt) {
  await page.evaluate((at) => {
    const canvas = document.querySelector('canvas')!
    canvas.dispatchEvent(new MouseEvent('contextmenu', { clientX: at.x, clientY: at.y, button: 2, bubbles: true, cancelable: true }))
  }, at)
  await waitFrame(page, 2)
}

/** Into the /v2 editor on a fresh blank map. */
async function openEditor(page: Page): Promise<void> {
  await page.goto('/v2?e2e=1')
  await waitForBoot(page)
  await page.getByTestId('v2-new-map-card').click()
  await page.getByTestId('v2-new-map-submit').click()
  await expect(page.getByTestId('v2-editor')).toBeVisible()
}

/** A copy of the goblin warren, framed, its rooms measured, the Select tool in hand. */
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
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const l = st.layers.find((x: Any) => x.type === 'dungeon')
    st.setActiveLayerId(l.id)
    st.setActiveTool('select')
    st.setMarqueeFilter('all')
  })
  await page.keyboard.press('Control+0')
  await waitFrame(page, 6)
}

/** A room's anchor, world units. */
const roomAnchor = (page: Page, name: string) =>
  inPage<Pt>(page, `(s, layer, w2s, name) => { const r = layer().rooms.find((x) => x.name === name); return { x: r.anchor[0], y: r.anchor[1] } }`, name)

/** A room's face box, world units. */
const roomBox = (page: Page, name: string) =>
  inPage<{ x0: number; y0: number; x1: number; y1: number; id: string }>(
    page,
    `(s, layer, w2s, name) => { const r = layer().rooms.find((x) => x.name === name); const xs = r.face.map((p) => p[0]); const ys = r.face.map((p) => p[1]); return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), id: r.id } }`,
    name,
  )

/** Takes every prop, light and zone within `r` of `p` off the active layer, so a click there lands on what a test puts down. */
const clearAround = (page: Page, p: Pt, r: number) =>
  inPage<void>(
    page,
    `(s, layer, w2s, a) => window.__store.setState((st) => {
      const l = st.layers.find((x) => x.id === st.ui.activeLayerId)
      l.children = l.children.filter((c) => {
        if (c.childType !== 'asset' && c.childType !== 'light' && c.childType !== 'zone') return true
        const pos = c.childType === 'zone' ? (c.shape.position ?? { x: c.shape.x, y: c.shape.y }) : c.position
        return Math.hypot(pos.x - a.p.x, pos.y - a.p.y) > a.r
      })
    })`,
    { p, r },
  )

const addChild = (page: Page, child: Record<string, unknown>) =>
  inPage<void>(page, `(s, layer, w2s, c) => s().addChild(layer().id, c)`, child)

const child = (page: Page, id: string) => inPage<Any>(page, `(s, layer, w2s, id) => layer().children.find((c) => c.id === id)`, id)
const wallOf = (page: Page, id: string) => inPage<Any>(page, `(s, layer, w2s, id) => layer().standaloneWalls.find((w) => w.id === id)`, id)

const prop = (id: string, at: Pt, extra: Record<string, unknown> = {}) => ({
  id, name: id, childType: 'asset', visible: true, objectType: 'asset', assetId: 'gg-demo:storage_crates_1_dark_1x1_object_A',
  position: at, rotation: 0, scale: 1, width: 1, height: 1, tint: '#ffffff', flipX: false, flipY: false, ...extra,
})
const light = (id: string, at: Pt) => ({
  id, name: id, childType: 'light', visible: true, color: '#ffcc66', radius: 2, featherRadius: 1, intensity: 0.8,
  falloff: 'linear', position: at,
})
const pool = (id: string, c: Pt, r = 1.2) => ({
  id, name: 'Pool', childType: 'water', visible: true, waterType: 'lake', textureId: 'water-still-a-01', tint: '#9aa0a6',
  opacity: 0.85, bankTextureId: '', bankWidth: 0.5,
  contours: [[[c.x - r, c.y - r], [c.x + r, c.y - r], [c.x + r * 1.4, c.y + r], [c.x - r, c.y + r]]],
})

/** wall-001's point at `t` along its line, world units. */
async function onWall(page: Page, id: string, t: number): Promise<Pt> {
  const w = await wallOf(page, id)
  const [a, b] = w.points
  return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t }
}

/** The gizmo box of a single wall on screen: its band box. */
async function wallScreenBox(page: Page, id: string) {
  return inPage<{ x0: number; y0: number; x1: number; y1: number }>(
    page,
    `(s, layer, w2s, id) => {
      const w = layer().standaloneWalls.find((x) => x.id === id)
      const reach = 0.75
      const xs = w.points.map((p) => p[0]); const ys = w.points.map((p) => p[1])
      const a = w2s(Math.min(...xs) - reach, Math.min(...ys) - reach)
      const b = w2s(Math.max(...xs) + reach, Math.max(...ys) + reach)
      return { x0: a.x, y0: a.y, x1: b.x, y1: b.y }
    }`,
    id,
  )
}

const distToLine = (p: Pt, a: number[], b: number[]) => {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  return Math.abs(dx * (p.y - a[1]) - dy * (p.x - a[0])) / Math.hypot(dx, dy)
}

// ─── Every kind through one pick ────────────────────────────────────────────

test('a click on water selects it and its card shows Banks', async ({ page }) => {
  await openWarren(page)
  const c = await roomAnchor(page, 'Warren Hall')
  const at = { x: c.x + 1, y: c.y + 1 }
  await clearAround(page, at, 3)
  await addChild(page, pool('pool', at))
  await click(page, await screenOf(page, at))
  expect(await sel(page)).toEqual(['pool'])
  await expect(page.getByTestId('v2-selection-card')).toContainText('Banks')
})

test('a click on a zone’s outline selects it; the corner handle drags its radius and the card follows', async ({ page }) => {
  await openWarren(page)
  const c = await roomAnchor(page, 'Warren Hall')
  await clearAround(page, c, 4)
  await addChild(page, { id: 'z', name: 'Ambush', childType: 'zone', visible: true, shape: { kind: 'circle', position: { x: c.x, y: c.y }, radius: 1.5 } })
  // Inside a room a zone answers by its line (the room has the inside); here, its east edge.
  await click(page, await screenOf(page, { x: c.x + 1.5, y: c.y }))
  expect(await sel(page)).toEqual(['z'])
  await expect(page.getByLabel('Zone radius')).toHaveValue('1.5')
  const z = await zoom(page)
  const corner = await screenOf(page, { x: c.x + 1.5, y: c.y + 1.5 })
  await drag(page, corner, { x: corner.x + z, y: corner.y + z })
  const r = (await child(page, 'z')).shape.radius
  expect(r).toBeGreaterThan(1.9)
  await expect(page.getByLabel('Zone radius')).toHaveValue(String(Math.round(r * 100) / 100))
})

// ─── Drawn walls take the box ───────────────────────────────────────────────

test('a drawn wall gets the box: a drag moves the wall and its door, the door stays on its line', async ({ page }) => {
  await openWarren(page)
  const grab = await onWall(page, 'wall-001', 0.15)
  await clearAround(page, grab, 2)
  const before = await wallOf(page, 'wall-001')
  const doorId = (await inPage<Any>(page, `(s, layer) => layer().children.find((c) => c.childType === 'door' && c.wallId === 'wall-001')`)).id
  const z = await zoom(page)
  const from = await screenOf(page, grab)
  await click(page, from)
  expect(await sel(page)).toEqual(['wall-001'])
  // The box has handles: the corner shows a resize cursor.
  const box = await wallScreenBox(page, 'wall-001')
  await firePointer(page, 'pointermove', box.x1, box.y1, 0, 0)
  await waitFrame(page, 2)
  expect(await page.evaluate(() => document.querySelector('canvas')!.style.cursor)).toMatch(/resize/)

  const to = { x: from.x + 0.6 * z, y: from.y + 1.6 * z }
  await drag(page, from, to)
  const after = await wallOf(page, 'wall-001')
  const dx = after.points[0][0] - before.points[0][0]
  const dy = after.points[0][1] - before.points[0][1]
  expect(Math.hypot(dx, dy)).toBeGreaterThan(1)
  const door = await child(page, doorId)
  // The door rode along and still hangs on the wall's line (its jambs closed on it).
  expect(distToLine({ x: door.position[0], y: door.position[1] }, after.points[0], after.points[1])).toBeLessThan(0.05)
  await undo(page)
  expect((await wallOf(page, 'wall-001')).points).toEqual(before.points)
})

test('the rotate stem turns a wall about its centre', async ({ page }) => {
  await openWarren(page)
  const grab = await onWall(page, 'wall-003', 0.15)
  await clearAround(page, grab, 2)
  const before = await wallOf(page, 'wall-003')
  await click(page, await screenOf(page, grab))
  expect(await sel(page)).toEqual(['wall-003'])
  const box = await wallScreenBox(page, 'wall-003')
  const cx = (box.x0 + box.x1) / 2
  const cy = (box.y0 + box.y1) / 2
  const stem = { x: cx, y: box.y0 - 20.5 }
  // Round to the right of the centre: a quarter turn clockwise.
  await drag(page, stem, { x: cx + (cy - stem.y), y: cy }, {}, 10)
  const after = await wallOf(page, 'wall-003')
  const ang = (w: Any) => Math.atan2(w.points[1][1] - w.points[0][1], w.points[1][0] - w.points[0][0])
  let turn = ang(after) - ang(before)
  turn = Math.atan2(Math.sin(turn), Math.cos(turn))
  expect(Math.abs(Math.abs(turn) - Math.PI / 2)).toBeLessThan(0.3)
})

test('a corner handle resizes a wall', async ({ page }) => {
  await openWarren(page)
  const grab = await onWall(page, 'wall-002', 0.15)
  await clearAround(page, grab, 2)
  const before = await wallOf(page, 'wall-002')
  await click(page, await screenOf(page, grab))
  const box = await wallScreenBox(page, 'wall-002')
  const z = await zoom(page)
  await drag(page, { x: box.x1, y: box.y1 }, { x: box.x1 + 2 * z, y: box.y1 + 2 * z })
  const after = await wallOf(page, 'wall-002')
  const len = (w: Any) => Math.hypot(w.points[1][0] - w.points[0][0], w.points[1][1] - w.points[0][1])
  expect(len(after)).toBeGreaterThan(len(before) + 0.5)
})

test('Ctrl+D on a wall adds a wall and its door; Ctrl+C then Ctrl+V pastes a wall onto the active layer', async ({ page }) => {
  await openWarren(page)
  const counts = () => inPage<{ walls: number; doors: number }>(page, `(s, layer) => ({ walls: layer().standaloneWalls.length, doors: layer().children.filter((c) => c.childType === 'door').length })`)
  const start = await counts()
  await select(page, ['wall-004'])
  await key(page, 'Control+d')
  expect(await counts()).toEqual({ walls: start.walls + 1, doors: start.doors + 1 })
  await select(page, ['wall-005'])
  await key(page, 'Control+c')
  await key(page, 'Control+v')
  expect((await counts()).walls).toBe(start.walls + 2)
  // The paste is selected: the new wall, not the one it was copied from.
  const pasted = await sel(page)
  expect(pasted).toHaveLength(1)
  expect(pasted[0]).not.toBe('wall-005')
  expect(await wallOf(page, pasted[0])).toBeTruthy()
})

// ─── Marquee ────────────────────────────────────────────────────────────────

test('Shift+marquee adds to the selection; Alt+marquee takes away', async ({ page }) => {
  await openWarren(page)
  const c = await roomAnchor(page, 'Warren Hall')
  await clearAround(page, c, 5)
  await addChild(page, prop('a', { x: c.x - 3, y: c.y }))
  await addChild(page, prop('b', { x: c.x + 2, y: c.y }))
  await addChild(page, prop('c', { x: c.x + 3, y: c.y }))
  await select(page, ['a'])
  const z = await zoom(page)
  const p = await screenOf(page, { x: c.x + 1.2, y: c.y - 1 })
  await drag(page, p, { x: p.x + 2.6 * z, y: p.y + 2 * z }, { shift: true })
  expect([...(await sel(page))].sort()).toEqual(['a', 'b', 'c'])
  // Well clear of the box's handles, which Alt would grab to resize about the centre.
  const q = await screenOf(page, { x: c.x + 2.6, y: c.y - 2.5 })
  await drag(page, q, { x: q.x + 1.2 * z, y: q.y + 3.2 * z }, { alt: true })
  expect([...(await sel(page))].sort()).toEqual(['a', 'b'])
})

test('a marquee never collects a layer on another level', async ({ page }) => {
  await openWarren(page)
  const c = await roomAnchor(page, 'Warren Hall')
  await clearAround(page, c, 4)
  await inPage<void>(page, `(s, layer, w2s, c) => {
    s().addLevel({ id: 'lvl-2', name: 'Upstairs' })
    const up = { ...structuredClone(layer()), id: 'up', name: 'Up', levelId: 'lvl-2', children: [], standaloneWalls: [], rooms: [] }
    s().addLayer(up)
    s().addChild('up', { id: 'upstairs', name: 'up', childType: 'light', visible: true, color: '#fff', radius: 1, featherRadius: 1, intensity: 1, falloff: 'linear', position: c })
    s().setActiveLayerId(layer().id)
  }`, c)
  await addChild(page, light('here', { x: c.x + 0.5, y: c.y }))
  const z = await zoom(page)
  const p = await screenOf(page, { x: c.x - 1, y: c.y - 1 })
  await drag(page, p, { x: p.x + 2.5 * z, y: p.y + 2 * z })
  expect(await sel(page)).toContain('here')
  expect(await sel(page)).not.toContain('upstairs')
})

test('a room joins a marquee only when the marquee covers its whole face', async ({ page }) => {
  await openWarren(page)
  const box = await roomBox(page, 'Warren Hall')
  const a = await screenOf(page, { x: box.x0 + 1, y: box.y0 + 1 })
  const b = await screenOf(page, { x: box.x1 - 1, y: box.y1 - 1 })
  await drag(page, a, b)
  expect(await sel(page)).not.toContain(box.id)
  const a2 = await screenOf(page, { x: box.x0 - 0.5, y: box.y0 - 0.5 })
  const b2 = await screenOf(page, { x: box.x1 + 0.5, y: box.y1 + 0.5 })
  await drag(page, a2, b2)
  expect(await sel(page)).toContain(box.id)
})

test('the chip “This tab’s kind” keeps the marquee to the Lights tab’s lights', async ({ page }) => {
  await openWarren(page)
  const c = await roomAnchor(page, 'Warren Hall')
  await clearAround(page, c, 4)
  await addChild(page, prop('crate', { x: c.x - 1, y: c.y }))
  await addChild(page, light('torch', { x: c.x + 1, y: c.y }))
  await page.getByTestId('v2-marquee-chip').click()
  await page.getByRole('menuitemradio', { name: /This tab’s kind/ }).click()
  await expect(page.getByTestId('v2-marquee-chip')).toContainText('This tab’s kind')
  await page.getByTestId('v2-dock-tab-lights').click()
  await inPage<void>(page, `(s) => s().setActiveTool('select')`)
  const z = await zoom(page)
  const p = await screenOf(page, { x: c.x - 2, y: c.y - 1 })
  await drag(page, p, { x: p.x + 4 * z, y: p.y + 2 * z })
  expect(await sel(page)).toEqual(['torch'])
})

// ─── Locks ──────────────────────────────────────────────────────────────────

test('a locked prop selects with its badge, never moves, and Delete refuses with a toast', async ({ page }) => {
  await openWarren(page)
  const c = await roomAnchor(page, 'Warren Hall')
  await clearAround(page, c, 3)
  await addChild(page, prop('rug', c, { locked: true }))
  const at = await screenOf(page, c)
  const z = await zoom(page)
  await drag(page, at, { x: at.x + 2 * z, y: at.y })
  expect(await sel(page)).toEqual(['rug'])
  expect((await child(page, 'rug')).position).toEqual(c)
  await expect(page.getByTestId('v2-selection-card')).toContainText('locked')
  const glyphs = await page.evaluate(() => {
    const find = (n: Any): number => (n.label === 'selectionLock' ? 1 : 0) + (n.children ?? []).reduce((s: number, k: Any) => s + find(k), 0)
    return find((window as Any).__pixiApp.stage)
  })
  expect(glyphs).toBe(1)
  await key(page, 'Delete')
  expect(await child(page, 'rug')).toBeTruthy()
  // The toast, and the card's own lock line saying the same.
  await expect(page.getByLabel('Notifications alt+T').getByText('Locked: unlock to edit')).toBeVisible()
  await expect(page.getByTestId('v2-sel-locked-note')).toHaveText('Locked: unlock to edit')
})

test('a locked wall selects and refuses Delete the same way', async ({ page }) => {
  await openWarren(page)
  const grab = await onWall(page, 'wall-006', 0.15)
  await clearAround(page, grab, 2)
  await inPage<void>(page, `(s, layer) => s().updateWall(layer().id, 'wall-006', { locked: true })`)
  await click(page, await screenOf(page, grab))
  expect(await sel(page)).toEqual(['wall-006'])
  await expect(page.getByTestId('v2-sel-kind')).toHaveText('Wall · locked')
  await key(page, 'Delete')
  expect(await wallOf(page, 'wall-006')).toBeTruthy()
})

test('a lock and a hide save within seconds and survive a reload', async ({ page }) => {
  await openWarren(page)
  const c = await roomAnchor(page, 'Warren Hall')
  await clearAround(page, c, 4)
  await addChild(page, prop('rug', c))
  await addChild(page, pool('pool', { x: c.x + 3, y: c.y + 3 }))
  const savedAt = () => inPage<number>(page, `(s) => s().mapIndex.find((m) => m.id === s().activeMapId)?.updatedAt ?? 0`)
  // Let the adds' own save land first, so the stamp that moves next is the lock and the hide.
  await page.evaluate(() => (window as Any).__store.getState().saveCurrentMap())
  const before = await savedAt()
  await select(page, ['rug'])
  await key(page, 'Control+Shift+l')
  await select(page, ['pool'])
  await key(page, 'Control+Shift+h')
  await page.waitForFunction((t) => {
    const s = (window as Any).__store.getState()
    return (s.mapIndex.find((m: Any) => m.id === s.activeMapId)?.updatedAt ?? 0) > t
  }, before, { timeout: 5000 })
  await page.reload()
  await waitForBoot(page)
  await page.getByTestId('v2-map-card').first().click()
  await expect(page.getByTestId('v2-editor')).toBeVisible()
  const anyChild = (id: string) =>
    inPage<Any>(page, `(s, layer, w2s, id) => s().layers.flatMap((l) => l.children ?? []).find((c) => c.id === id)`, id)
  await expect.poll(async () => (await anyChild('rug'))?.locked).toBe(true)
  expect((await anyChild('pool')).visible).toBe(false)
})

// ─── The mixed card and the header ──────────────────────────────────────────

test('a light and a wall get the mixed card, and Align left lines them up', async ({ page }) => {
  await openWarren(page)
  const c = await roomAnchor(page, 'Warren Hall')
  await addChild(page, light('torch', { x: c.x + 6, y: c.y }))
  await select(page, ['torch', 'wall-001'])
  await expect(page.getByTestId('v2-mixed-title')).toHaveText('1 light · 1 wall')
  const w = await wallOf(page, 'wall-001')
  const wallLeft = Math.min(w.points[0][0], w.points[1][0]) - 0.75
  await page.getByTestId('v2-mixed-align-left').click()
  const t = await child(page, 'torch')
  // The light lines up by its marker square, not its radius.
  expect(t.position.x - 0.5).toBeCloseTo(wallLeft, 1)
})

test('the header’s Flip H mirrors a water body', async ({ page }) => {
  await openWarren(page)
  const c = await roomAnchor(page, 'Warren Hall')
  await addChild(page, pool('pool', c))
  await select(page, ['pool'])
  const before = (await child(page, 'pool')).contours[0].map((p: number[]) => p[0]).sort()
  await page.getByTestId('v2-sel-act-flipH').click()
  const after = (await child(page, 'pool')).contours[0].map((p: number[]) => p[0])
  const xs = before
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  expect([...after].sort().map((x: number) => +x.toFixed(6))).toEqual(xs.map((x: number) => +(2 * cx - x).toFixed(6)).sort())
})

// ─── Alt ────────────────────────────────────────────────────────────────────

test('Alt+click steps from a prop to what lies under it and back round', async ({ page }) => {
  await openWarren(page)
  const c = await roomAnchor(page, 'Warren Hall')
  await clearAround(page, c, 3)
  // Big enough that the box's handles sit well clear of the middle of it.
  await addChild(page, prop('crate', c, { width: 3, height: 3 }))
  const at = await screenOf(page, c)
  await click(page, at, { alt: true })
  expect(await sel(page)).toEqual(['crate'])
  await click(page, at, { alt: true })
  const second = await sel(page)
  expect(second).toHaveLength(1)
  expect(second[0]).not.toBe('crate')
  for (let i = 0; i < 4 && (await sel(page))[0] !== 'crate'; i++) await click(page, at, { alt: true })
  expect(await sel(page)).toEqual(['crate'])
})

test('Alt+drag copies a prop and moves the copy, one undo step', async ({ page }) => {
  await openWarren(page)
  const c = await roomAnchor(page, 'Warren Hall')
  await clearAround(page, c, 4)
  await addChild(page, prop('crate', c))
  const n = () => inPage<number>(page, `(s, layer) => layer().children.filter((x) => x.childType === 'asset').length`)
  const before = await n()
  const at = await screenOf(page, c)
  const z = await zoom(page)
  await drag(page, at, { x: at.x + 2 * z, y: at.y }, { alt: true })
  expect(await n()).toBe(before + 1)
  expect((await child(page, 'crate')).position).toEqual(c)
  await undo(page)
  expect(await n()).toBe(before)
})

// ─── Undo ───────────────────────────────────────────────────────────────────

test('ten fast arrow presses undo in one step', async ({ page }) => {
  await openWarren(page)
  const c = await roomAnchor(page, 'Warren Hall')
  await addChild(page, prop('crate', c))
  await select(page, ['crate'])
  await blur(page)
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight')
  await waitFrame(page, 2)
  expect((await child(page, 'crate')).position.x).toBeCloseTo(c.x + 10)
  await undo(page)
  expect((await child(page, 'crate')).position.x).toBeCloseTo(c.x)
})

test('undo of a delete hands the objects back selected', async ({ page }) => {
  await openWarren(page)
  const c = await roomAnchor(page, 'Warren Hall')
  for (const [i, id] of ['a', 'b', 'c', 'd'].entries()) await addChild(page, prop(id, { x: c.x + i, y: c.y }))
  await select(page, ['a', 'b', 'c', 'd'])
  await key(page, 'Delete')
  expect(await child(page, 'a')).toBeUndefined()
  await undo(page)
  expect([...(await sel(page))].sort()).toEqual(['a', 'b', 'c', 'd'])
  await expect(page.getByTestId('v2-selection-card')).toBeVisible()
})

test('Esc does one thing per press: drops the drag, then the selection, then solo', async ({ page }) => {
  await openWarren(page)
  const c = await roomAnchor(page, 'Warren Hall')
  await clearAround(page, c, 3)
  await addChild(page, prop('crate', c))
  await inPage<void>(page, `(s, layer) => s().toggleSoloLayer(layer().id)`)
  const at = await screenOf(page, c)
  const z = await zoom(page)
  await firePointer(page, 'pointermove', at.x, at.y, 0, 0)
  await firePointer(page, 'pointerdown', at.x, at.y, 0.5, 1)
  await firePointer(page, 'pointermove', at.x + z, at.y, 0.5, 1)
  await firePointer(page, 'pointermove', at.x + 2 * z, at.y, 0.5, 1)
  await key(page, 'Escape')
  expect((await child(page, 'crate')).position).toEqual(c)
  expect(await sel(page)).toEqual(['crate'])
  await firePointer(page, 'pointerup', at.x + 2 * z, at.y, 0, 0)
  await key(page, 'Escape')
  expect(await sel(page)).toEqual([])
  expect(await inPage<unknown>(page, `(s) => s().ui.solo`)).not.toBeNull()
  await key(page, 'Escape')
  expect(await inPage<unknown>(page, `(s) => s().ui.solo`)).toBeNull()
})

// ─── Keys ───────────────────────────────────────────────────────────────────

test('Ctrl+X in the label’s text field cuts text, never the label', async ({ page }) => {
  await openWarren(page)
  const c = await roomAnchor(page, 'Warren Hall')
  await addChild(page, {
    id: 'lbl', name: 'Rat nest', childType: 'text', visible: true, text: 'Rat nest', position: c, rotation: 0, scale: 1,
    width: 3, height: 1, fontSize: 1, color: '#1b1b1b', fontFamily: 'serif', textStyle: 'room',
  })
  await select(page, ['lbl'])
  const area = page.getByTestId('v2-selection-card').locator('textarea').first()
  await area.click()
  await area.press('Control+a')
  await area.press('Control+x')
  await area.press('Control+z')
  await waitFrame(page, 2)
  expect(await child(page, 'lbl')).toBeTruthy()
  expect(await sel(page)).toEqual(['lbl'])
})

test('no accent colour in the new CSS: every colour it names is a grey', () => {
  for (const file of ['selection-actions.css']) {
    const css = readFileSync(fileURLToPath(new URL(`../../src/v2/editor/${file}`, import.meta.url)), 'utf8')
    for (const hex of css.match(/#[0-9a-f]{3,8}\b/gi) ?? []) {
      const h = hex.slice(1)
      const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6)
      expect(full.slice(0, 2) === full.slice(2, 4) && full.slice(2, 4) === full.slice(4, 6), `${hex} is not a grey`).toBe(true)
    }
    for (const m of css.matchAll(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/g)) {
      expect(m[1] === m[2] && m[2] === m[3], `${m[0]} is not a grey`).toBe(true)
    }
    expect(css).not.toMatch(/hsla?\(|oklch\(/)
  }
})

test('the floating action bar is gone on /v2 and stays on /', async ({ page }) => {
  await openWarren(page)
  const c = await roomAnchor(page, 'Warren Hall')
  await addChild(page, prop('crate', c))
  await select(page, ['crate'])
  await waitFrame(page, 4)
  await expect(page.locator('.gg-grain[role="toolbar"]')).toHaveCount(0)
  await expect(page.getByTestId('v2-sel-actions')).toBeVisible()

  await page.goto('/?e2e=1')
  await waitForBoot(page)
  await page.evaluate(() => {
    const st = (window as Any).__store.getState()
    const l = st.layers.find((x: Any) => x.type === 'dungeon')
    st.addChild(l.id, {
      id: 'v1crate', name: 'crate', childType: 'asset', visible: true, objectType: 'asset', assetId: 'x', position: { x: 4, y: 4 },
      rotation: 0, scale: 1, width: 1, height: 1, tint: '#ffffff', flipX: false, flipY: false,
    })
    st.setActiveTool('select')
    st.setSelectedIds(['v1crate'])
  })
  await waitFrame(page, 6)
  await expect(page.getByRole('toolbar', { name: 'Selection actions' })).toBeVisible()
})

test('the right-click menu on a wall offers Duplicate, flips, Rotate, Lock, Hide and Select behind', async ({ page }) => {
  await openWarren(page)
  const grab = await onWall(page, 'wall-001', 0.15)
  // Something under the wall, so there is a stack to choose from (the wall's end runs into rock).
  await addChild(page, pool('pool', grab, 0.8))
  await rightClick(page, await screenOf(page, grab))
  for (const label of ['Duplicate', 'Flip horizontal', 'Rotate 90°', 'Lock', 'Hide', 'Select behind']) {
    await expect(page.getByRole('menuitem', { name: new RegExp(`^${label}`) }).first()).toBeVisible()
  }
})
