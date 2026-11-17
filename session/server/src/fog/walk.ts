// The walk grid of a scene's level (table fix pass §2.1): which cells are ground, which are
// solid, and which steps between cells a wall, a shut door or a refusing raised edge stops. The
// flood and the refusal order are mechanics' (`@dnd/mechanics/tokens` walk.ts); this file reads
// the map into the grid they run on.
//
// Kept per parsed map object and level, rebuilt when a door's live state or a crossing rule
// changes: the key is the door states and the crossing overrides, read the same way the sight
// sweep reads its own (`sweep.ts`).

import { seedDoor, type DoorLiveState } from '@dnd/mechanics/doors'
import { crossingRefusalMessage, sceneCrossings, type CrossingsState } from '@dnd/mechanics/crossings'
import { buildWalkGrid, type WalkBlocker, type WalkGrid } from '@dnd/mechanics/tokens'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the same wall split the sight sweep runs (see sweep.ts)
import { extractMoveSegments } from '@dnd/core/src/engine/lighting/raycaster'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: floor-piece predicates, pure
import { baseGroundOf, inRingsEvenOdd, isGroundPiece, pieceRings } from '@dnd/core/src/shared/pieces'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the plateau model is pure
import { crossingIdOf, hasPlateaus, layerPlateaus } from '@dnd/core/src/shared/plateaus'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design, as above
import { defaultCrossingKinds } from '@dnd/core/src/shared/crossingKinds'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: a cave's own outline, pure
import { caveEdges } from '@dnd/core/src/shared/caveFloor'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the WASM Clipper the scene map already boots
import { clipper2Engine } from '@dnd/core/src/geometry/Clipper2Engine'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the Lighting pass's level rules
import { firstLevelId } from '@dnd/core/src/shared/visionGate'
import type { ShapeChild } from '@dnd/core/src/shared/types'
import type { DungeonLayer } from '@dnd/core/src/store/types'
import type { SceneMap } from './sceneMap'
import { liveLayers } from './sweep'
import { hasHiddenGround } from './outdoorGround'

type Doors = Record<string, DoorLiveState>
type Ring = [number, number][]

/** A wall's reach into the cells beside it: half its width, never a whole cell (§2.1 rule 3). */
const wallReach = (width: number): number => Math.min(width / 2, 0.45)
/** The cave rock's drawn half-width (`max(width, 0.15) / 2`), the same on both sides of its outline (S4). */
const rockReach = (width: number): number => Math.max(width, 0.15) / 2

export interface WalkGrids {
  /** The grid of one level, or null for a scene with no frame. */
  gridFor(map: SceneMap, doors: Doors, crossings: CrossingsState | undefined, sceneId: string, levelId?: string): WalkGrid | null
}

export function createWalkGrids(): WalkGrids {
  const cache = new WeakMap<SceneMap, Map<string, { key: string; grid: WalkGrid }>>()
  return {
    gridFor(map, doors, crossings, sceneId, levelId) {
      if (!map.frame) return null
      const level = levelId || firstLevelId(map.data)
      const live = sceneCrossings(crossings, sceneId)
      const key = `${map.doors.map((door) => walkState(door.id, door, doors)).join('')}|${JSON.stringify(live)}`
      let byLevel = cache.get(map)
      if (!byLevel) cache.set(map, (byLevel = new Map()))
      const hit = byLevel.get(level)
      if (hit && hit.key === key) return hit.grid
      const grid = buildLevelGrid(map, doors, live, level)
      byLevel.set(level, { key, grid })
      return grid
    },
  }
}

function walkState(id: string, door: SceneMap['doors'][number], doors: Doors): string {
  const state = doors[id] ?? seedDoor(door)
  if (door.isSecret && !state.revealed) return 's'
  return state.open ? 'o' : 'c'
}

function buildLevelGrid(
  map: SceneMap,
  doors: Doors,
  live: ReturnType<typeof sceneCrossings>,
  levelId: string,
): WalkGrid {
  const layers = liveLayers(map, doors, levelId)
  return buildWalkGrid(map.frame!, groundOf(map, layers, levelId), [
    ...wallBlockers(layers),
    ...crossingBlockers(map, layers, live),
  ])
}

/**
 * §2.1 rule 1 — ground: the level's base ground, a visible ground piece, the level's walled
 * floor, or, on a map with no rooms, no ground pieces and no base ground (an imported picture),
 * the whole frame.
 */
function groundOf(map: SceneMap, layers: readonly DungeonLayer[], levelId: string): (x: number, y: number) => boolean {
  const settings = map.data.mapSettings
  const level = map.data.levels?.find((l) => l.id === levelId) ?? null
  if (baseGroundOf(settings, level)) return () => true
  const pieces = layers.flatMap((layer) =>
    (layer.children ?? [])
      .filter((c): c is ShapeChild => isGroundPiece(c) && c.visible !== false)
      .map((shape) => ({ rings: pieceRings(shape), box: boxOf(pieceRings(shape)), kept: shape.keptToFloors ? layer.mergedFloor : null })),
  )
  const floors = layers
    .map((layer) => layer.mergedFloor ?? [])
    .filter((rings) => rings.length > 0)
    .map((rings) => ({ rings, box: boxOf(rings) }))
  if (map.rooms.length === 0 && !hasHiddenGround(map.data)) return () => true
  return (x, y) =>
    floors.some((f) => inBox(f.box, x, y) && inRingsEvenOdd(x, y, f.rings)) ||
    pieces.some(
      (p) =>
        inBox(p.box, x, y) &&
        inRingsEvenOdd(x, y, p.rings) &&
        (!p.kept || p.kept.length === 0 || inRingsEvenOdd(x, y, p.kept)),
    )
}

/** §2.1 rules 2 and 3 — wall spans (solid reach) and shut doors (named, no reach). */
function wallBlockers(layers: readonly DungeonLayer[]): WalkBlocker[] {
  const out: WalkBlocker[] = []
  for (const layer of layers) {
    // The floor a cave's rock is drawn round is the cave's own outline, not the layer's union.
    const caves = caveEdges({ id: layer.id, children: layer.children ?? [] })
    const outside = (x: number, y: number) => !caves.some((cave) => inRingsEvenOdd(x, y, cave.rings))
    const rings = caves.flatMap((cave) => cave.rings)
    const opens = new Map<number, (x: number, y: number) => boolean>()
    const openFor = (reach: number) => {
      let open = opens.get(reach)
      if (!open) opens.set(reach, (open = narrowFloor(rings, reach)))
      return open
    }
    for (const seg of extractMoveSegments([layer])) {
      const line = { x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2 }
      if (seg.doorId) {
        out.push({ ...line, doorId: seg.doorId })
        continue
      }
      const width = seg.width ?? 0.5
      if (seg.wallKind !== 'cave' || caves.length === 0) {
        out.push({ ...line, reach: wallReach(width) })
        continue
      }
      // S4: the rock is drawn this deep into the floor too, so a token stops at its face. A
      // cell is solid when its centre lies in the drawn band, except on the floor side where
      // the floor between the rock is too narrow for the grid (`narrowFloor`) or the cell is
      // the only way between two stretches of floor (the walk grid's `settleRock`).
      const reach = rockReach(width)
      out.push({ ...line, reach, outerReach: reach, outside, open: openFor(reach) })
    }
  }
  return out
}

/**
 * Which cave floor centres the rock's reach covers stay standable all the same: those with no
 * spot within `reach` + half a cell of them that lies that far clear of the outline.
 *
 * The walk grid holds one centre per cell. A floor wide enough to hold a spot `reach` + half a
 * cell clear of the rock holds a clear strip at least a cell wide, so the grid keeps a centre in
 * it in every row or column it crosses, and the centres under the rock can be solid without
 * closing the way. A tunnel drawn open but narrower than that may have no centre clear of the
 * rock at all (testing-cave's mouth tunnel, under a cell wide), and marking its centres solid
 * closed a corridor the map plainly draws as floor. There the rule favours passing: a centre
 * on the cave floor stands, even with rock within half a cell of it.
 */
function narrowFloor(rings: readonly Ring[], reach: number): (x: number, y: number) => boolean {
  const clear = reach + 0.5
  // The floor shrunk by `clear`: every spot that far from the outline. Without Clipper it is
  // handed back whole, so every centre is near it and the reach holds as before.
  const core = clipper2Engine.inflate([...rings], -clear)
  return (x, y) => {
    if (inRingsEvenOdd(x, y, core)) return false
    for (const ring of core) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        if (distanceToSegment(x, y, ring[j], ring[i]) <= clear) return false
      }
    }
    return true
  }
}

function distanceToSegment(x: number, y: number, [ax, ay]: readonly number[], [bx, by]: readonly number[]): number {
  const dx = bx - ax
  const dy = by - ay
  const len = dx * dx + dy * dy
  const t = len > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0
  return Math.hypot(x - (ax + dx * t), y - (ay + dy * t))
}

/** §2.1 rule 2 — every raised edge whose crossing kind refuses right now, with its refusal. */
function crossingBlockers(
  map: SceneMap,
  layers: readonly DungeonLayer[],
  live: ReturnType<typeof sceneCrossings>,
): WalkBlocker[] {
  const kinds = map.data.mapSettings.crossingKinds ?? defaultCrossingKinds()
  const out: WalkBlocker[] = []
  for (const layer of layers) {
    if (!hasPlateaus(layer)) continue
    for (const band of layerPlateaus(layer).bands) {
      band.rings.forEach((ring, ri) => {
        band.edges[ri].forEach((e, i) => {
          if (e.drop === 0 || !e.owner) return
          const kindId = live.edges[e.owner.id] ?? crossingIdOf(e.owner)
          const kind = kinds.find((k) => k.id === kindId) ?? null
          if (!(live.blocks[kindId] ?? kind?.blocks ?? false)) return
          const a = ring[i]
          const b = ring[(i + 1) % ring.length]
          out.push({
            x1: a[0],
            y1: a[1],
            x2: b[0],
            y2: b[1],
            crossing: crossingRefusalMessage(kind ?? { id: kindId, name: kindId }),
          })
        })
      })
    }
  }
  return out
}

interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function boxOf(rings: readonly Ring[]): Box {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const ring of rings) {
    for (const [x, y] of ring) {
      box.minX = Math.min(box.minX, x)
      box.minY = Math.min(box.minY, y)
      box.maxX = Math.max(box.maxX, x)
      box.maxY = Math.max(box.maxY, y)
    }
  }
  return box
}

const inBox = (b: Box, x: number, y: number): boolean => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY
