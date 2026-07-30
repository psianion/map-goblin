/**
 * 28-doors-walls.spec.ts
 * Doors, driven by the pointer.
 *
 * The previous version of this file injected every door with `store.addChild`,
 * which proved the store and nothing else (door-overhaul spec, DR11). The rows
 * below place, select, cycle, drag, re-anchor and delete doors with the mouse,
 * on standalone walls and on floor-ring edges alike, and read the result off
 * the store *and* off the scene graph — a door that renders nowhere fails here
 * even when the store is perfect.
 *
 * Scene *setup* is still store-side: authoring a dungeon through the shape
 * tools would be a test of the shape tools. Every door interaction is pointer
 * or keyboard.
 *
 * Two things about driving this app from a test, both learned the hard way:
 *
 *  - `data-clipper-ready` is set long before the engine is up (the bundled
 *    asset pack installs into IndexedDB first), and until it is, an
 *    "Initializing…" overlay covers the canvas and swallows every click.
 *    `waitForEngine` is not optional.
 *  - A pointer gesture is real mouse *movement* plus dispatched down/up pairs.
 *    Movement has to be real: `onPointerMove` reads `getCoalescedEvents()`,
 *    which is empty on a synthesized event, so a synthetic move never reaches
 *    the tool. Clicks have to be dispatched: a round trip through the driver
 *    costs ~350ms on this box, which is past the tool's 300ms double-click
 *    window, so a driver-issued double-click could never be one.
 */
import { test, expect, type Page } from '@playwright/test'
import { gotoApp, waitForEngine, waitFrame } from './helpers'

// ── The test kit that lives in the page ────────────────────────────────────

interface DoorRec {
  id: string
  name: string
  wallId: string
  position: [number, number]
  angle: number
  width: number
  style: string
  state: string
  isSecret: boolean
  roomA: string | null
  roomB: string | null
}

interface SceneSpec {
  floors?: { id: string; contours: [number, number][][] }[]
  walls?: { id: string; points: [number, number][] }[]
  lights?: { id: string; x: number; y: number; radius: number; intensity: number }[]
  doors?: Partial<DoorRec>[]
  /** What the door tool will place, when a row needs something other than 1. */
  doorWidth?: number
}

interface Drawn {
  sprites: number
  graphics: number
  total: number
}

interface Kit {
  build(spec: SceneSpec): void
  doors(): DoorRec[]
  selected(): string[]
  activeTool(): string
  toolSettings(): Record<string, unknown>
  rooms(): { id: string }[]
  mergedFloor(): [number, number][][] | null
  style(): Record<string, unknown>
  standaloneWalls(): { id: string; wallType: string; direction: string }[]
  w2s(wx: number, wy: number): { x: number; y: number }
  /** Census of the walls sublayer within `r` world units of a point. */
  drawnAt(wx: number, wy: number, r: number): Drawn
  overlayCount(): number
  save(): unknown
  load(data: unknown): void
  removeChild(id: string): void
  updateWall(id: string, patch: Record<string, unknown>): void
}

declare global {
  interface Window {
    __t: Kit
  }
}

function installKit(page: Page): Promise<void> {
  return page.addInitScript(() => {
    type Any = Record<string, unknown>
    const app = () =>
      (window as unknown as { __pixiApp: unknown }).__pixiApp as {
        stage: { children: Any[] }
        canvas: HTMLCanvasElement
      }
    const world = () =>
      app().stage.children[0] as unknown as {
        position: { x: number; y: number }
        scale: { x: number }
      }
    const state = () =>
      (window as unknown as { __store: { getState: () => unknown } }).__store.getState() as {
        ui: { activeLayerId: string }
        tools: { activeTool: string; settings: Any }
        selection: { selectedIds: string[] }
        layers: {
          id: string
          type: string
          style: Any
          mergedFloor: [number, number][][] | null
          rooms?: { id: string }[]
          children: Any[]
          standaloneWalls: { id: string; wallType: string; direction: string }[]
        }[]
        addChild(lid: string, child: Any): void
        removeChild(lid: string, id: string): void
        addWall(lid: string, wall: Any): void
        updateWall(lid: string, id: string, patch: Any): void
        updateLayer(lid: string, patch: Any): void
        updateToolSettings(patch: Any): void
        setSnapEnabled(on: boolean): void
        loadFromFile(data: Any): void
        getSerializableState(): Any
      }
    const layer = () => state().layers.find((l) => l.type === 'dungeon')!

    const kit: Any = {
      build(spec: {
        floors?: { id: string; contours: number[][][] }[]
        walls?: { id: string; points: number[][] }[]
        lights?: { id: string; x: number; y: number; radius: number; intensity: number }[]
        doors?: Any[]
        doorWidth?: number
      }) {
        const s = state()
        const lid = s.ui.activeLayerId
        if (spec.doorWidth) s.updateToolSettings({ doorWidth: spec.doorWidth })
        // Snapping off, so a drag lands where the row aimed instead of on the
        // nearest half cell — the grid has its own spec.
        s.setSnapEnabled(false)
        // A wall set, because a bare layer has none and `renderNodeWalls`
        // returns early without one: no stones to gap, nothing to look at.
        s.updateLayer(lid, {
          style: { ...(layer().style as Any), wallTextureSetId: 'stone-slate' },
        })
        for (const wall of spec.walls ?? []) {
          s.addWall(lid, {
            id: wall.id,
            points: wall.points,
            wallType: 'normal',
            direction: 'both',
            color: '#1a1a1a',
            width: 0.5,
            roughness: 0,
          })
        }
        for (const floor of spec.floors ?? []) {
          s.addChild(lid, {
            id: floor.id,
            name: floor.id,
            childType: 'shape',
            visible: true,
            shapeType: 'polygon',
            contours: floor.contours,
            roughnessEnabled: false,
            textureScale: 1,
            textureOffsetX: 0,
            textureOffsetY: 0,
            textureFillRotation: 0,
            textureTint: '#ffffff',
          })
        }
        for (const light of spec.lights ?? []) {
          s.addChild(lid, {
            id: light.id,
            name: light.id,
            childType: 'light',
            visible: true,
            color: '#ffddaa',
            radius: light.radius,
            featherRadius: 1,
            intensity: light.intensity,
            falloff: 'quadratic',
            position: { x: light.x, y: light.y },
          })
        }
        for (const door of spec.doors ?? []) {
          s.addChild(lid, {
            name: 'Injected',
            childType: 'door',
            visible: true,
            angle: 0,
            width: 1,
            style: 'single',
            state: 'closed',
            isSecret: false,
            ...door,
          })
        }
      },
      doors: () => layer().children.filter((c) => c.childType === 'door'),
      selected: () => state().selection.selectedIds,
      activeTool: () => state().tools.activeTool,
      toolSettings: () => state().tools.settings,
      rooms: () => layer().rooms ?? [],
      mergedFloor: () => layer().mergedFloor,
      style: () => layer().style,
      standaloneWalls: () => layer().standaloneWalls,
      w2s(wx: number, wy: number) {
        const w = world()
        const rect = app().canvas.getBoundingClientRect()
        return {
          x: rect.left + wx * w.scale.x + w.position.x,
          y: rect.top + wy * w.scale.x + w.position.y,
        }
      },
      drawnAt(wx: number, wy: number, r: number) {
        const w = world()
        const zoom = w.scale.x
        const containers: Any[] = []
        const walk = (node: Any) => {
          if (node.label === 'sublayer-walls') containers.push(node)
          for (const kid of (node.children as Any[]) ?? []) walk(kid)
        }
        for (const child of app().stage.children) walk(child)
        let sprites = 0
        let graphics = 0
        for (const container of containers) {
          for (const child of (container.children as Any[]) ?? []) {
            const node = child as unknown as {
              getBounds(): { x: number; y: number; width: number; height: number }
            }
            const b = node.getBounds()
            if (b.width === 0 && b.height === 0) continue
            const cx = (b.x + b.width / 2 - w.position.x) / zoom
            const cy = (b.y + b.height / 2 - w.position.y) / zoom
            if (Math.hypot(cx - wx, cy - wy) > r) continue
            // Wall stones are Sprites (they have an anchor); the door glyphs
            // are Graphics. Both are "drawn", only one is a stone.
            if ('anchor' in child) sprites++
            else graphics++
          }
        }
        return { sprites, graphics, total: sprites + graphics }
      },
      overlayCount: () => ((app().stage.children[1] as Any).children as Any[]).length,
      save: () => state().getSerializableState(),
      load: (data: Any) => state().loadFromFile(data),
      removeChild: (id: string) => state().removeChild(state().ui.activeLayerId, id),
      updateWall: (id: string, patch: Any) =>
        state().updateWall(state().ui.activeLayerId, id, patch),
    }
    ;(window as unknown as { __t: unknown }).__t = kit
  })
}

// ── Node-side helpers ──────────────────────────────────────────────────────

async function open(page: Page, spec: SceneSpec = {}): Promise<void> {
  await installKit(page)
  await gotoApp(page)
  await waitForEngine(page)
  await page.evaluate((s) => window.__t.build(s as never), spec as never)
  await waitFrame(page, 10)
}

/** Move the mouse to a world point, converted through the live camera. */
async function moveTo(page: Page, [wx, wy]: [number, number]): Promise<void> {
  const p = await page.evaluate(([x, y]) => window.__t.w2s(x, y), [wx, wy])
  await page.mouse.move(p.x, p.y)
}

/** `n` down/up pairs at the cursor, dispatched together so they are one gesture. */
async function tap(page: Page, [wx, wy]: [number, number], n = 1): Promise<void> {
  const p = await page.evaluate(([x, y]) => window.__t.w2s(x, y), [wx, wy])
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
    { x: p.x, y: p.y, n },
  )
  await waitFrame(page, 3)
}

async function clickAt(page: Page, world: [number, number]): Promise<void> {
  await moveTo(page, world)
  await waitFrame(page, 1)
  await tap(page, world, 1)
}

async function doubleClickAt(page: Page, world: [number, number]): Promise<void> {
  await moveTo(page, world)
  await waitFrame(page, 1)
  await tap(page, world, 2)
}

async function dragTo(
  page: Page,
  from: [number, number],
  to: [number, number],
  steps = 6,
): Promise<void> {
  await moveTo(page, from)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    await moveTo(page, [
      from[0] + ((to[0] - from[0]) * i) / steps,
      from[1] + ((to[1] - from[1]) * i) / steps,
    ])
  }
  await waitFrame(page, 2)
  await page.mouse.up()
  await waitFrame(page, 3)
}

const doors = (page: Page) => page.evaluate(() => window.__t.doors())
const selection = (page: Page) => page.evaluate(() => window.__t.selected())
const drawnAt = (page: Page, at: [number, number], r: number): Promise<Drawn> =>
  page.evaluate(([x, y, radius]) => window.__t.drawnAt(x, y, radius), [at[0], at[1], r])

async function onlyDoor(page: Page): Promise<DoorRec> {
  const list = await doors(page)
  expect(list).toHaveLength(1)
  return list[0]
}

async function selectDoorTool(page: Page): Promise<void> {
  await page.keyboard.press('d')
  await waitFrame(page, 2)
}

/** On the canvas, in range of no wall: a click here only clears the selection. */
const NOWHERE: [number, number] = [11, 7]

const WALL: [number, number][] = [
  [-8, -6],
  [8, -6],
]

async function placeOnWall(page: Page, at: [number, number] = [2, -6]): Promise<DoorRec> {
  await selectDoorTool(page)
  await clickAt(page, at)
  return onlyDoor(page)
}

// ── Pointer editing ────────────────────────────────────────────────────────

test.describe('Doors — pointer editing', () => {
  // A gesture is a dozen driver round trips and this box charges ~350ms for each,
  // so a two-drag row lands inside a couple of seconds of the default budget.
  test.slow()

  test('a click selects a placed door and changes nothing about it', async ({ page }) => {
    await open(page, { walls: [{ id: 'w1', points: WALL }] })
    const placed = await placeOnWall(page)

    // Placement leaves the door selected — drop that, or the row below proves
    // nothing.
    await clickAt(page, NOWHERE)
    expect(await selection(page)).toEqual([])

    await clickAt(page, [placed.position[0], placed.position[1]])

    expect(await selection(page)).toEqual([placed.id])
    await expect(page.getByText('Door Properties')).toBeVisible()
    const after = await onlyDoor(page)
    expect(after.state).toBe('closed') // DR10: inspecting is not mutating
    expect(after.position).toEqual(placed.position)
    expect(after.width).toBe(placed.width)
  })

  test('a double-click cycles closed → open → locked → closed', async ({ page }) => {
    await open(page, { walls: [{ id: 'w1', points: WALL }] })
    const placed = await placeOnWall(page)
    const at: [number, number] = [placed.position[0], placed.position[1]]

    await doubleClickAt(page, at)
    expect((await onlyDoor(page)).state).toBe('open')
    await doubleClickAt(page, at)
    expect((await onlyDoor(page)).state).toBe('locked')
    await doubleClickAt(page, at)
    expect((await onlyDoor(page)).state).toBe('closed')
  })

  test('an archway cycles closed ↔ open and never locks', async ({ page }) => {
    await open(page, {
      walls: [{ id: 'w1', points: WALL }],
      doors: [{ id: 'arch', wallId: 'w1', position: [2, -6], style: 'archway', width: 2 }],
    })
    await selectDoorTool(page)
    const at: [number, number] = [2, -6]

    await doubleClickAt(page, at)
    expect((await onlyDoor(page)).state).toBe('open')
    await doubleClickAt(page, at)
    expect((await onlyDoor(page)).state).toBe('closed')
    await doubleClickAt(page, at)
    expect((await onlyDoor(page)).state).toBe('open')
  })

  test('four rapid clicks advance the state exactly twice', async ({ page }) => {
    await open(page, { walls: [{ id: 'w1', points: WALL }] })
    const placed = await placeOnWall(page)
    const at: [number, number] = [placed.position[0], placed.position[1]]

    await moveTo(page, at)
    await tap(page, at, 4)

    // closed → open → locked. A tool where every click mutated would be back at
    // 'open' (four advances); one that never cycled would still be shut.
    expect((await onlyDoor(page)).state).toBe('locked')
  })

  test('a drag slides the door along its wall and clamps half a width from the end', async ({
    page,
  }) => {
    await open(page, { walls: [{ id: 'w1', points: WALL }] })
    const placed = await placeOnWall(page)

    await dragTo(page, [placed.position[0], placed.position[1]], [-3, -6])
    const moved = await onlyDoor(page)
    expect(moved.position[0]).toBeCloseTo(-3, 1)
    expect(moved.position[1]).toBeCloseTo(-6, 1)
    expect(moved.wallId).toBe('w1')

    // Dragged past the end: the resolver keeps the whole leaf on the wall.
    await dragTo(page, [-3, -6], [7.9, -6])
    expect((await onlyDoor(page)).position[0]).toBeCloseTo(7.5, 2)
  })

  test('Escape mid-drag puts the door back and writes no undo entry', async ({ page }) => {
    await open(page, { walls: [{ id: 'w1', points: WALL }] })
    const placed = await placeOnWall(page)

    await moveTo(page, [placed.position[0], placed.position[1]])
    await page.mouse.down()
    await moveTo(page, [-4, -6])
    await waitFrame(page, 2)
    expect((await onlyDoor(page)).position[0]).toBeCloseTo(-4, 1)

    await page.keyboard.press('Escape')
    await waitFrame(page, 2)
    await page.mouse.up()
    await waitFrame(page, 2)
    expect((await onlyDoor(page)).position).toEqual(placed.position)

    // The only thing on the stack is the placement — one undo empties the map,
    // which it could not do if the cancelled drag had pushed an entry.
    await page.keyboard.press('Control+z')
    await waitFrame(page, 3)
    expect(await doors(page)).toHaveLength(0)
  })

  test('one undo press puts a dragged door back where it was picked up', async ({ page }) => {
    await open(page, { walls: [{ id: 'w1', points: WALL }] })
    const placed = await placeOnWall(page)

    await dragTo(page, [placed.position[0], placed.position[1]], [-5, -6])
    expect((await onlyDoor(page)).position[0]).toBeCloseTo(-5, 1)

    await page.keyboard.press('Control+z')
    await waitFrame(page, 3)
    expect((await onlyDoor(page)).position).toEqual(placed.position)
  })

  test('Delete removes the selected door, and hover is the fallback target', async ({ page }) => {
    await open(page, { walls: [{ id: 'w1', points: WALL }] })
    await placeOnWall(page, [2, -6])
    await page.keyboard.press('Delete')
    await waitFrame(page, 3)
    expect(await doors(page)).toHaveLength(0)

    // …and again with nothing selected: the door under the cursor is the target.
    await placeOnWall(page, [-2, -6])
    await clickAt(page, NOWHERE)
    expect(await selection(page)).toEqual([])
    await moveTo(page, [-2, -6])
    await waitFrame(page, 2)
    await page.keyboard.press('Delete')
    await waitFrame(page, 3)
    expect(await doors(page)).toHaveLength(0)
  })

  test('width is a panel field, and selecting a door adds no canvas handles', async ({ page }) => {
    await open(page, { walls: [{ id: 'w1', points: WALL }] })
    const bare = await page.evaluate(() => window.__t.overlayCount())
    const placed = await placeOnWall(page)
    await clickAt(page, [placed.position[0], placed.position[1]])

    const width = page.locator('input[type="number"]').first()
    await width.fill('2.5')
    await width.blur()
    await waitFrame(page, 3)

    expect((await onlyDoor(page)).width).toBeCloseTo(2.5, 2)
    // DD6: width is a field, not a handle. The overlay holds exactly what it
    // held before a door was ever selected.
    expect(await page.evaluate(() => window.__t.overlayCount())).toBe(bare)
  })
})

// ── Floor-ring doors ───────────────────────────────────────────────────────

const ROOM: [number, number][] = [
  [-6, 0],
  [6, 0],
  [6, 8],
  [-6, 8],
]

test.describe('Doors — floor-ring edges', () => {
  test.slow() // drags, and a round trip per move (see the note above)

  test('a door placed on a floor edge renders, gaps the stones and drags', async ({ page }) => {
    // A 3-cell doorway: stones on this ring sit more than a cell apart, so a
    // hairline door can honestly gap nothing at all.
    await open(page, { floors: [{ id: 'floor', contours: [ROOM] }], doorWidth: 3 })
    expect(await page.evaluate(() => window.__t.mergedFloor())).not.toBeNull()

    const before = await drawnAt(page, [1, 0], 1.5)
    expect(before.sprites).toBeGreaterThan(0) // stones run through the doorway

    await selectDoorTool(page)
    await clickAt(page, [1, 0])

    const door = await onlyDoor(page)
    // Floor rings are rebuilt on every union, so a floor door stores no wall id:
    // its position plus the projection is the whole anchor (P1/DD1).
    expect(door.wallId).toBe('')
    expect(door.position[1]).toBeCloseTo(0, 2)

    const after = await drawnAt(page, [1, 0], 1.5)
    expect(after.graphics).toBeGreaterThan(0) // the glyph draws at all (DR2)
    expect(after.sprites).toBe(0) // …and the doorway is clear of stones (DR3)

    await dragTo(page, [1, 0], [-3, 0])
    expect((await onlyDoor(page)).position[0]).toBeCloseTo(-3, 1)
    expect((await drawnAt(page, [-3, 0], 0.8)).graphics).toBeGreaterThan(0)
    expect((await drawnAt(page, [-3, 0], 1.4)).sprites).toBe(0) // the gap came along

    // …and it survives the round trip through a file.
    const saved = await page.evaluate(() => window.__t.save())
    await page.evaluate((data) => window.__t.load(data as never), saved as never)
    await waitFrame(page, 10)
    const reloaded = await onlyDoor(page)
    expect(reloaded.wallId).toBe('')
    expect(reloaded.position[0]).toBeCloseTo(-3, 1)
    expect((await drawnAt(page, [-3, 0], 0.8)).graphics).toBeGreaterThan(0)
  })

  test('a drag around a corner re-anchors the door and rebinds its rooms', async ({ page }) => {
    // One floor split by a standalone wall: two rooms, and a wall running into
    // the ring, so a door can be dragged off one kind of wall onto the other.
    await open(page, {
      floors: [{ id: 'floor', contours: [ROOM] }],
      walls: [{ id: 'divider', points: [[0, 0], [0, 8]] }],
    })
    await page.waitForTimeout(800) // room detection is debounced
    expect((await page.evaluate(() => window.__t.rooms())).length).toBeGreaterThanOrEqual(2)

    await selectDoorTool(page)
    await clickAt(page, [0, 4])
    const inner = await onlyDoor(page)
    expect(inner.wallId).toBe('divider')
    expect(inner.roomA).toBeTruthy()
    expect(inner.roomB).toBeTruthy()

    await dragTo(page, [0, 4], [2.5, 0])
    const moved = await onlyDoor(page)
    expect(moved.wallId).toBe('') // …now anchored to the ring
    expect(moved.position[1]).toBeCloseTo(0, 1)
    expect(Math.abs(moved.angle)).toBeCloseTo(0, 2) // the ring's top edge runs along x
    // An outer wall has one room inside it and nothing outside: the pair was
    // re-derived at the new anchor, not carried over from the divider (P6).
    expect(moved.roomA).toBeTruthy()
    expect(moved.roomB).toBeNull()
  })

  test('a door whose floor is deleted becomes a detached marker, still selectable', async ({
    page,
  }) => {
    await open(page, { floors: [{ id: 'floor', contours: [ROOM] }] })
    await selectDoorTool(page)
    await clickAt(page, [1, 0])
    const door = await onlyDoor(page)

    await page.evaluate(() => window.__t.removeChild('floor'))
    await waitFrame(page, 10)
    expect(await page.evaluate(() => window.__t.mergedFloor())).toBeNull()

    // Still listed, and still drawn — the broken-bar marker, at the position
    // the door was authored on.
    expect((await onlyDoor(page)).id).toBe(door.id)
    expect((await drawnAt(page, [1, 0], 0.8)).graphics).toBeGreaterThan(0)

    await clickAt(page, NOWHERE)
    await clickAt(page, [1, 0])
    expect(await selection(page)).toEqual([door.id])

    await page.keyboard.press('Delete')
    await waitFrame(page, 3)
    expect(await doors(page)).toHaveLength(0)
  })

  test('a door follows the wall under it when the geometry moves', async ({ page }) => {
    await open(page, { walls: [{ id: 'w1', points: WALL }] })
    await selectDoorTool(page)
    await clickAt(page, [2, -6])
    expect((await drawnAt(page, [2, -6], 0.8)).graphics).toBeGreaterThan(0)

    // Node editing is its own pointer surface (spec 27). What this row is about
    // is that the drawn position is derived from the wall rather than read off
    // the child, so the edit is applied at the store and the door has to move.
    await page.evaluate(() => window.__t.updateWall('w1', { points: [[-8, -3], [8, -3]] }))
    await waitFrame(page, 10)

    const followed = await onlyDoor(page)
    expect(followed.position).toEqual([2, -6]) // authored intent, untouched
    expect((await drawnAt(page, [2, -3], 0.8)).graphics).toBeGreaterThan(0)
    expect((await drawnAt(page, [2, -6], 0.5)).graphics).toBe(0)
  })

  test('a legacy floor-* door re-anchors on load and answers a click', async ({ page }) => {
    await open(page)
    const style = await page.evaluate(() => window.__t.style())
    const legacy = {
      version: '3.0',
      mapSettings: { name: 'Legacy', ambientLight: '#1a1a24' },
      grid: { visible: true, snapEnabled: false, snapDivision: 2, style: 'clean' },
      customImages: {},
      layers: [
        {
          id: 'legacy-dungeon',
          name: 'Layer 1',
          type: 'dungeon',
          visible: true,
          locked: false,
          opacity: 1,
          mergedFloor: [ROOM],
          style,
          sublayerVisibility: {},
          standaloneWalls: [],
          children: [
            {
              id: 'legacy-floor',
              name: 'Floor',
              childType: 'shape',
              visible: true,
              shapeType: 'polygon',
              contours: [ROOM],
              roughnessEnabled: false,
              textureScale: 1,
              textureOffsetX: 0,
              textureOffsetY: 0,
              textureFillRotation: 0,
              textureTint: '#ffffff',
            },
            {
              id: 'legacy-door',
              name: 'Old Door',
              childType: 'door',
              visible: true,
              // The synthetic id old saves carry (DR1). It matches no wall the
              // resolver knows, so the door has to re-anchor by projection.
              wallId: 'floor-0-2',
              position: [2, 0.4],
              angle: 1.2,
              width: 1.5,
              style: 'single',
              state: 'closed',
              isSecret: false,
            },
          ],
        },
      ],
    }
    await page.evaluate((data) => window.__t.load(data as never), legacy as never)
    await waitFrame(page, 12)

    const loaded = await onlyDoor(page)
    expect(loaded.wallId).toBe('floor-0-2') // the file is not rewritten…
    // …but the door draws on the ring edge, not 0.4 units inside the room.
    expect((await drawnAt(page, [2, 0], 0.8)).graphics).toBeGreaterThan(0)

    await selectDoorTool(page)
    await clickAt(page, [2, 0])
    expect(await selection(page)).toEqual(['legacy-door'])
  })
})

// ── Light through a hallway door ───────────────────────────────────────────

/**
 * What fraction of the canvas moved between two shots. The mean is too blunt
 * for a local change: light through one doorway is a fraction of a percent of
 * the frame. Same instrument the table's fog spec uses, and every row that
 * reads it takes its own no-op sample first, so the threshold is a measured
 * floor rather than a guess.
 */
function changed(page: Page, before: Buffer, after: Buffer): Promise<number> {
  return page.evaluate(
    async ([a, b]: string[]) => {
      const pixels = async (base64: string) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const surface = new OffscreenCanvas(bitmap.width, bitmap.height)
        const ctx = surface.getContext('2d')!
        ctx.drawImage(bitmap, 0, 0)
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
      }
      const [x, y] = await Promise.all([pixels(a), pixels(b)])
      let moved = 0
      for (let i = 0; i < x.length; i += 4) {
        const d =
          Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2])
        if (d > 8) moved++
      }
      return moved / (x.length / 4)
    },
    [before.toString('base64'), after.toString('base64')],
  )
}

const shoot = (page: Page) => page.locator('canvas').screenshot()

test.describe('Doors — light', () => {
  // Five screenshots of a lit map, decoded in the page: past the default budget.
  test.setTimeout(150_000)

  test('a mid-hallway door blocks light shut and passes it open', async ({ page }) => {
    // Two rooms joined by a corridor. The union erases the shared edges, so the
    // corridor's long side is a plain ring edge with no standalone wall
    // anywhere near it — the door a DM could not place before (§2, DR1/DR6).
    await open(page, {
      floors: [
        { id: 'west', contours: [[[-18, -8], [-6, -8], [-6, 8], [-18, 8]]] },
        { id: 'hall', contours: [[[-6, -2], [6, -2], [6, 2], [-6, 2]]] },
        { id: 'east', contours: [[[6, -8], [18, -8], [18, 8], [6, 8]]] },
      ],
      lights: [{ id: 'torch', x: 0, y: 0, radius: 14, intensity: 1 }],
    })
    await waitFrame(page, 15)

    await selectDoorTool(page)
    await clickAt(page, [0, -2])
    const door = await onlyDoor(page)
    expect(door.wallId).toBe('')
    expect(door.position[1]).toBeCloseTo(-2, 2)

    // The instrument's own floor: two shots of the same shut door.
    const shut = await shoot(page)
    await waitFrame(page, 6)
    const shutAgain = await shoot(page)
    const noise = await changed(page, shut, shutAgain)

    await doubleClickAt(page, [0, -2])
    expect((await onlyDoor(page)).state).toBe('open')
    await waitFrame(page, 15)
    const opened = await shoot(page)
    const spill = await changed(page, shutAgain, opened)
    console.log(
      `[metric] hallway door light: ${(spill * 100).toFixed(3)}% of the canvas moved on open ` +
        `(instrument noise ${(noise * 100).toFixed(3)}%)`,
    )
    expect(spill).toBeGreaterThan(Math.max(noise * 4, 0.0005))

    // …and shutting it takes the light back.
    await doubleClickAt(page, [0, -2])
    await doubleClickAt(page, [0, -2])
    expect((await onlyDoor(page)).state).toBe('closed')
    await waitFrame(page, 15)
    const reshut = await shoot(page)
    expect(await changed(page, opened, reshut)).toBeGreaterThan(Math.max(noise * 4, 0.0005))
  })
})

// ── Tool wiring, kept from the store-level version of this file ────────────

test.describe('Doors — tool wiring', () => {
  test('D activates the door tool and A still activates the path tool', async ({ page }) => {
    await open(page)
    await page.keyboard.press('d')
    await waitFrame(page, 2)
    expect(await page.evaluate(() => window.__t.activeTool())).toBe('door')
    await page.keyboard.press('a')
    await waitFrame(page, 2)
    expect(await page.evaluate(() => window.__t.activeTool())).toBe('path')
  })

  test('the wall tool draws a wall with a type and a direction', async ({ page }) => {
    await open(page)
    await page.keyboard.press('w')
    await waitFrame(page, 2)
    // Click-chain then commit — the wall tool stopped being a drag tool when a
    // chain became one segment (#19).
    await clickAt(page, [-6, 4])
    await clickAt(page, [4, 4])
    await page.keyboard.press('Enter')
    await waitFrame(page, 4)

    const walls = await page.evaluate(() => window.__t.standaloneWalls())
    expect(walls.length).toBeGreaterThanOrEqual(1)
    expect(walls[walls.length - 1].wallType).toBe('normal')
    expect(walls[walls.length - 1].direction).toBe('both')
  })

  test('the toolbar has a door button and the tool defaults are the authored ones', async ({
    page,
  }) => {
    await open(page)
    await expect(page.getByRole('button', { name: /door/i })).toBeVisible()
    const settings = await page.evaluate(() => window.__t.toolSettings())
    expect(settings.doorStyle).toBe('single')
    expect(settings.doorSecret).toBe(false)
    expect(settings.doorWidth).toBe(1)
    expect(settings.wallType).toBe('normal')
    expect(settings.wallDirection).toBe('both')
  })

  test('a saved map is version 3.0', async ({ page }) => {
    await open(page)
    expect(await page.evaluate(() => (window.__t.save() as { version: string }).version)).toBe('3.0')
  })
})
