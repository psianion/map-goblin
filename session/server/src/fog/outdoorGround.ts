// R2 (rca-live.md) — one definition of outdoor ground, for every rule that asks "is this outside?".
//
// Outdoors used to mean "in no room polygon". Rooms are inset half a wall band inside their
// floor, so the gap between a room and its rock, and the rock itself, counted as Outdoors: once
// Outdoors was revealed, they counted as known, and whatever stood near a cave's inside edge
// went to a player standing outside. Outdoor ground is a ground cell outside every walled floor
// and cave outline of its level. Whether a cell is ground at all stays the walk grid's question.
//
// One exception keeps an unzoned floor playable: a walled floor or cave with no room anchored in
// it has no fog row of its own, so it stays part of Outdoors, as it always was. Only an outline
// that holds a room takes its inside (rock gap included) out of Outdoors.

// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: floor-piece predicates, pure
import { baseGroundOf, inRingsEvenOdd, isGroundPiece, pieceRings } from '@dnd/core/src/shared/pieces'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the Lighting pass's level rules
import { layersOnLevel } from '@dnd/core/src/shared/visionGate'
import type { ShapeChild } from '@dnd/core/src/shared/types'
import type { SerializedMapData } from '@dnd/core/src/store/types'
import type { SceneMap } from './sceneMap'

type Ring = [number, number][]

const groundCache = new WeakMap<SerializedMapData, boolean>()

/**
 * R3 — whether a map has ground to hide even with no room on it: a ground piece, or base ground
 * on the map or any level. A map with neither and no rooms is an imported picture, the one map
 * that carries no fog in By hand mode (table fix pass §2.1 rule 1). Memoised per document.
 */
export function hasHiddenGround(data: SerializedMapData): boolean {
  const hit = groundCache.get(data)
  if (hit !== undefined) return hit
  const settings = data.mapSettings
  const out =
    !!baseGroundOf(settings) ||
    (data.levels ?? []).some((level) => baseGroundOf(settings, level)) ||
    data.layers.some((layer) => layer.type === 'dungeon' && (layer.children ?? []).some((c) => isGroundPiece(c)))
  groundCache.set(data, out)
  return out
}

/**
 * A level's walled floors and caves, as sets of rings each read even-odd: a layer's
 * `mergedFloor`, or, where that is null (no Clipper yet), each floor shape of the layer on its own.
 */
export function enclosureRings(map: SceneMap, levelId: string): Ring[][] {
  return enclosuresOn(map, levelId).map((e) => e.rings)
}

function enclosuresOn(map: SceneMap, levelId: string): { rings: Ring[]; anchors: [number, number][] }[] {
  return layersOnLevel(map.data, map.data.layers, levelId).flatMap((layer) => {
    const anchors = (layer.rooms ?? []).map((room) => room.anchor)
    if (layer.mergedFloor?.length) return [{ rings: layer.mergedFloor as Ring[], anchors }]
    return (layer.children ?? [])
      .filter((c): c is ShapeChild => c.childType === 'shape' && c.visible !== false && c.ground !== true)
      .map((shape) => ({ rings: pieceRings(shape) as Ring[], anchors }))
  })
}

interface Enclosure {
  rings: Ring[]
  /** The rings that hold a room's anchor: only these take their inside out of Outdoors. */
  zoned: Ring[]
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const cache = new WeakMap<SceneMap, Map<string, (x: number, y: number) => boolean>>()

/** Whether a point lies inside a zoned walled floor or cave outline of the level. Memoised per map. */
export function enclosedOn(map: SceneMap, levelId: string): (x: number, y: number) => boolean {
  let byLevel = cache.get(map)
  if (!byLevel) cache.set(map, (byLevel = new Map()))
  const hit = byLevel.get(levelId)
  if (hit) return hit
  const sets: Enclosure[] = enclosuresOn(map, levelId).map(({ rings, anchors }) => {
    const zoned = rings.filter((ring) => anchors.some(([x, y]) => inRingsEvenOdd(x, y, [ring])))
    const box = { rings, zoned, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
    for (const ring of rings) {
      for (const [x, y] of ring) {
        box.minX = Math.min(box.minX, x)
        box.minY = Math.min(box.minY, y)
        box.maxX = Math.max(box.maxX, x)
        box.maxY = Math.max(box.maxY, y)
      }
    }
    return box
  })
  const test = (x: number, y: number): boolean =>
    sets.some(
      (s) =>
        x >= s.minX &&
        x <= s.maxX &&
        y >= s.minY &&
        y <= s.maxY &&
        inRingsEvenOdd(x, y, s.rings) &&
        s.zoned.some((ring) => inRingsEvenOdd(x, y, [ring])),
    )
  byLevel.set(levelId, test)
  return test
}
