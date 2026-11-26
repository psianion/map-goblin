// The level reader gives the table's grid: the server's walk cases (session/server's
// fog/walk.test.ts) on the same outdoor-cave fixture, asked of the grid directly. The map is
// read the way the server reads it: rooms migrated, the merged floor healed with Clipper.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { setClipperModule } from '@dnd/core/src/geometry/Clipper2Engine'
import { computeMergedFloor } from '@dnd/core/src/engine/mergedFloor'
import { computeMapFrame } from '@dnd/core/src/shared/mapBounds'
import { layersOnLevel } from '@dnd/core/src/shared/visionGate'
import { migrateRooms } from '@dnd/core/src/store/roomMigration'
import type { DoorChild } from '@dnd/core/src/shared/types'
import type { DungeonLayer, SerializedMapData } from '@dnd/core/src/store/types'
import { CROSSING_BLOCKED, sceneCrossings } from '../crossings/module'
import { seedDoor } from '../doors/types'
import { MOVE_BLOCKED, OUTSIDE_MAP, SOLID_GROUND } from './types'
import { STANDABLE, walkRefusal } from './walk'
import { levelWalkGrid, mapHasHiddenGround } from './levelGrid'

beforeAll(async () => {
  // Clipper2 comes with core; its UMD build takes the binary directly, as the server boots it.
  const require = createRequire(join(import.meta.dirname, '../../../core/package.json'))
  const path = require.resolve('clipper2-wasm/dist/umd/clipper2z.js')
  const factory = require(path) as (opts: { wasmBinary: ArrayBuffer }) => Promise<Parameters<typeof setClipperModule>[0]>
  setClipperModule(await factory({ wasmBinary: new Uint8Array(readFileSync(path.replace(/\.js$/, '.wasm'))).buffer }))
}, 30_000)

const MAP = readFileSync(join(import.meta.dirname, '../../../../session/testdata/outdoor-cave.ggvtt'), 'utf8')

type DoorState = { open?: boolean; locked?: boolean; revealed?: boolean }

/** The fixture, read into one level's grid with the doors in `doors` (else as saved). */
function walk(edit: (map: SerializedMapData) => void = () => {}, doors: Record<string, DoorState> = {}) {
  const grid = gridOf(edit, doors)
  const view = { grid, known: () => true, heldDoor: () => true, doorLocked: (id: string) => !!doors[id]?.locked }
  return (from: { x: number; y: number }, to: { x: number; y: number }) => walkRefusal(view, from, to, 1)
}

/** The fixture's walk grid, as `walk` reads it. */
function gridOf(edit: (map: SerializedMapData) => void = () => {}, doors: Record<string, DoorState> = {}) {
  const raw = JSON.parse(MAP) as SerializedMapData
  edit(raw)
  const data = migrateRooms(raw)
  for (const layer of data.layers) {
    if (layer.type !== 'dungeon' || layer.mergedFloor != null) continue
    const merged = computeMergedFloor({ ...layer, children: layer.children ?? [] })
    if (merged !== null) layer.mergedFloor = merged
  }
  const level = data.levels?.[0] ?? null
  const layers = layersOnLevel(data, data.layers, level?.id ?? '').map((layer): DungeonLayer => ({
    ...layer,
    children: (layer.children ?? []).map((child) => {
      if (child.childType !== 'door') return child
      const state = { ...seedDoor(child as DoorChild), ...doors[child.id] }
      if ((child as DoorChild).isSecret && !state.revealed) return { ...child, visible: false }
      return { ...child, state: state.open ? 'open' : 'closed' }
    }),
  }))
  const grid = levelWalkGrid({
    frame: computeMapFrame(data.layers, data.mapSettings.terrain?.bounds ?? null, data.mapSettings.fixedSize ?? null)!,
    settings: data.mapSettings,
    level,
    layers,
    hasRooms: data.layers.some((l) => l.type === 'dungeon' && (l.rooms ?? []).length > 0),
    hiddenGround: mapHasHiddenGround(data),
    crossings: sceneCrossings(undefined, null),
  })
  return grid
}

const FORWARD = [[1, 0], [-1, 1], [0, 1], [1, 1]]
/** Whether the one straight step from the cell holding `a` to the one holding `b` is open, both cells standable. */
function stepOpen(grid: ReturnType<typeof levelWalkGrid>, a: [number, number], b: [number, number]): boolean {
  const at = ([x, y]: [number, number]) => Math.floor(y - grid.minY) * grid.cols + Math.floor(x - grid.minX)
  const [ia, ib] = [at(a), at(b)]
  if (grid.cell[ia] !== STANDABLE || grid.cell[ib] !== STANDABLE) return false
  const d = [Math.floor(b[0]) - Math.floor(a[0]), Math.floor(b[1]) - Math.floor(a[1])]
  let k = FORWARD.findIndex(([x, y]) => x === d[0] && y === d[1])
  let from = ia
  if (k < 0) {
    k = FORWARD.findIndex(([x, y]) => x === -d[0] && y === -d[1])
    from = ib
  }
  return grid.edge[from * 4 + k] === 0
}

/** The fixture with one more ring on its layer: a plateau of the given outline. */
const withPlateau = (contour: [number, number][]) => (map: SerializedMapData) => {
  const layer = map.layers.find((l) => l.type === 'dungeon') as DungeonLayer
  layer.children.push({
    id: 'ridge',
    name: 'Ridge',
    childType: 'plateau',
    visible: true,
    contours: [contour],
    height: 3,
    edge: 'cliff',
    crossingId: 'impassable',
  } as unknown as DungeonLayer['children'][number])
}

describe('the level reader, on the table’s walk cases', () => {
  it('1: stands on base ground outside every room, not past the frame', () => {
    const go = walk()
    expect(go({ x: 15.5, y: 7.5 }, { x: 15.5, y: 12.5 })).toBeNull()
    expect(go({ x: 15.5, y: 7.5 }, { x: 2.5, y: 17.5 })).toBeNull()
    expect(go({ x: 15.5, y: 7.5 }, { x: 31.5, y: 7.5 })).toMatch(new RegExp(`^${OUTSIDE_MAP}`))
  })

  it('2 and S4: the cave’s rock fills the cell outside its edge and the floor-side cell it is drawn over', () => {
    const go = walk()
    expect(go({ x: 15.5, y: 7.5 }, { x: 17.5, y: 5.5 })).toMatch(new RegExp(`^${SOLID_GROUND}`))
    expect(go({ x: 15.5, y: 7.5 }, { x: 16.5, y: 5.5 })).toBeNull()
    expect(go({ x: 22.5, y: 6.5 }, { x: 18.5, y: 5.5 })).toMatch(new RegExp(`^${SOLID_GROUND}`))
    expect(go({ x: 22.5, y: 6.5 }, { x: 19.5, y: 5.5 })).toBeNull()
  })

  it('walks into the cave through its mouth', () => {
    expect(walk()({ x: 15.5, y: 9.5 }, { x: 22.5, y: 6.5 })).toBeNull()
  })

  it('3 to 5: a shut door stops the way into the hall, an open one lets it through, a locked one says so', () => {
    expect(walk()({ x: 13.5, y: 5.5 }, { x: 11.5, y: 5.5 })).toBe('door-closed door-hall: that space cannot be occupied')
    expect(walk(undefined, { 'door-hall': { open: true } })({ x: 13.5, y: 5.5 }, { x: 11.5, y: 5.5 })).toBeNull()
    expect(walk(undefined, { 'door-hall': { locked: true } })({ x: 22.5, y: 6.5 }, { x: 6.5, y: 8.5 })).toBe(
      'door-locked door-hall: that space cannot be occupied',
    )
  })

  it('6: a refusing cliff refuses when there is no way round, and allows a path round it', () => {
    const wall = walk(withPlateau([[14, 0], [15, 0], [15, 20], [14, 20]]))
    expect(wall({ x: 13.5, y: 15.5 }, { x: 15.5, y: 15.5 })).toMatch(new RegExp(`^${CROSSING_BLOCKED} impassable`))
    const short = walk(withPlateau([[14, 12], [15, 12], [15, 19], [14, 19]]))
    expect(short({ x: 13.5, y: 15.5 }, { x: 15.5, y: 15.5 })).toBeNull()
  })

  it('lets a move down a flight of stairs through a refusing cliff, and only there', () => {
    const ridge = (stairs: { id: string; ring: number; from: number; to: number }[]) => (map: SerializedMapData) => {
      withPlateau([[14, 0], [15, 0], [15, 20], [14, 20]])(map)
      const layer = map.layers.find((l) => l.type === 'dungeon') as DungeonLayer
      Object.assign(layer.children[layer.children.length - 1], { stairs })
    }
    // Stairs up its west side and down its east side at y 15 to 16.
    const both = walk(ridge([{ id: 'w', ring: 0, from: 26, to: 27 }, { id: 'e', ring: 0, from: 16, to: 17 }]))
    expect(both({ x: 13.5, y: 15.5 }, { x: 15.5, y: 15.5 })).toBeNull()
    // Up the west stairs, then the east side has none: its cliff refuses as ever.
    const west = walk(ridge([{ id: 'w', ring: 0, from: 26, to: 27 }]))
    expect(west({ x: 13.5, y: 15.5 }, { x: 15.5, y: 15.5 })).toMatch(new RegExp(`^${CROSSING_BLOCKED} impassable`))  })

  it('walks through a cave mouth into the room behind it, and not without the room', () => {
    // A refusing block, x 14 to 20, with a mouth in its west side at y 17 to 14, its hollow y 16 to 15.
    const block = (den: boolean, mouth = { id: 'm', ring: 0, from: 35, to: 38, mouth: [36, 37] }) => (map: SerializedMapData) => {
      withPlateau([[14, 0], [20, 0], [20, 20], [14, 20]])(map)
      const layer = map.layers.find((l) => l.type === 'dungeon') as DungeonLayer
      Object.assign(layer.children[layer.children.length - 1], { entrances: [mouth] })
      // The room on top, its west wall on the cliff.
      if (den) {
        layer.children.push({
          id: 'den',
          name: 'Den',
          childType: 'shape',
          visible: true,
          shapeType: 'rectangle',
          contours: [[[14, 13], [18, 13], [18, 18], [14, 18]]],
          textureScale: 1,
          textureOffsetX: 0,
          textureOffsetY: 0,
          textureFillRotation: 0,
          textureTint: '#ffffff',
        } as unknown as DungeonLayer['children'][number])
      }
    }
    expect(walk(block(true))({ x: 13.5, y: 15.5 }, { x: 15.5, y: 15.5 })).toBeNull()
    // A 2-wide mouth, y 17 to 15, its hollow over the line between its cells: in through either.
    const two = walk(block(true, { id: 'm', ring: 0, from: 35, to: 37, mouth: [35.68, 36.36] }))
    for (const y of [15.5, 16.5]) expect(two({ x: 13.5, y }, { x: 15.5, y })).toBeNull()
    expect(walk(block(false))({ x: 13.5, y: 15.5 }, { x: 15.5, y: 15.5 })).toMatch(new RegExp(`^${CROSSING_BLOCKED} impassable`))
  })

  describe('a token gets in through a cave mouth, cell by cell', () => {
    // A refusing block (or pit), x 14 to 20, a mouth in its west side; the west edge runs north from
    // (14, 20), so ring length s is y 52 - s. The den behind: on the block, or for the pit outside it.
    type Case = { from: number; to: number; mouth: [number, number] }
    const A1: Case = { from: 35, to: 37, mouth: [35.676, 36.36] } // 2 wide, y 17 to 15: both cells
    const A2: Case = { from: 35, to: 37, mouth: [35.71, 36.23] } // covers 0.29 and 0.23: the cell it covers most, y 16 to 17
    const WIDE: Case = { from: 35, to: 38, mouth: [36.05, 36.914] } // 3 wide, y 17 to 14: the middle cell, y 15 to 16
    const map = (c: Case, den: 'set back' | 'flush' | 'none', pit: boolean) => (data: SerializedMapData) => {
      withPlateau([[14, 0], [20, 0], [20, 20], [14, 20]])(data)
      const layer = data.layers.find((l) => l.type === 'dungeon') as DungeonLayer
      Object.assign(layer.children[layer.children.length - 1], { entrances: [{ id: 'm', ring: 0, ...c }], ...(pit && { height: -3 }) })
      if (den === 'none') return
      const inset = den === 'set back' ? 0.4 : 0
      const ring = pit ? [[9, 12], [14 - inset, 12], [14 - inset, 19], [9, 19]] : [[14 + inset, 12], [18, 12], [18, 19], [14 + inset, 19]]
      layer.children.push({
        id: 'den', name: 'Den', childType: 'shape', visible: true, shapeType: 'polygon', contours: [ring],
        textureScale: 1, textureOffsetX: 0, textureOffsetY: 0, textureFillRotation: 0, textureTint: '#ffffff',
      } as unknown as DungeonLayer['children'][number])
    }
    const through = (y: number): [[number, number], [number, number]] => [[13.5, y], [14.5, y]]

    for (const pit of [false, true]) {
      for (const den of ['set back', 'flush'] as const) {
        it(`${pit ? 'into a pit, the room outside it' : 'on a plateau'}, the room ${den}: each freed cell steps through, the rest of the span and beside it do not`, () => {
          const open = (c: Case) => {
            const grid = gridOf(map(c, den, pit))
            return [14.5, 15.5, 16.5, 17.5].map((y) => stepOpen(grid, ...through(y)))
          }
          // y 14.5, 15.5, 16.5, 17.5: the last always beside the span.
          expect(open(A1)).toEqual([false, true, true, false])
          expect(open(A2)).toEqual([false, false, true, false])
          expect(open(WIDE)).toEqual([false, true, false, false])
        })
      }
      it(`${pit ? 'into a pit' : 'on a plateau'}, with nothing behind, the mouth stays shut`, () => {
        const grid = gridOf(map(A1, 'none', pit))
        expect([15.5, 16.5].map((y) => stepOpen(grid, ...through(y)))).toEqual([false, false])
      })
    }
  })

  it('a secret door nobody found is wall', () => {
    const secret = walk((map) => {
      const layer = map.layers.find((l) => l.type === 'dungeon') as DungeonLayer
      ;(layer.children.find((c) => c.id === 'door-hall') as DoorChild).isSecret = true
    })
    expect(secret({ x: 13.5, y: 5.5 }, { x: 11.5, y: 5.5 })).toMatch(new RegExp(`^${MOVE_BLOCKED}:`))
  })
})
