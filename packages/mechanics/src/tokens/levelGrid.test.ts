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
import { walkRefusal } from './walk'
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
  const view = { grid, known: () => true, heldDoor: () => true, doorLocked: (id: string) => !!doors[id]?.locked }
  return (from: { x: number; y: number }, to: { x: number; y: number }) => walkRefusal(view, from, to, 1)
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

  it('a secret door nobody found is wall', () => {
    const secret = walk((map) => {
      const layer = map.layers.find((l) => l.type === 'dungeon') as DungeonLayer
      ;(layer.children.find((c) => c.id === 'door-hall') as DoorChild).isSecret = true
    })
    expect(secret({ x: 13.5, y: 5.5 }, { x: 11.5, y: 5.5 })).toMatch(new RegExp(`^${MOVE_BLOCKED}:`))
  })
})
