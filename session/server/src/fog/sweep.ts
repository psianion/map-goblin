// The server's half of token vision (S3 P1): what a claimed token can actually see, as a
// polygon, from the scene's walls and its live doors.
//
// None of the geometry is written here. `clockwiseSweep` and `extractWallSegments` already
// exist in @dnd/core and are pure — the same shadowcasting the editor's lighting runs — so
// this file's whole job is to hand them the *live* door states the map file knows nothing
// about, and to remember the answers until something moves.

import { seedDoor, type DoorLiveState } from '@dnd/mechanics/doors'
import { carriedCone, pointInPolygon, type LightCone } from '@dnd/mechanics/fog'
import { eyes as partyEyes, type Token } from '@dnd/mechanics/tokens'
// D3's runtime waivers, in the same targeted per-line style redactMap.ts uses for
// shared/mapBounds: the sweep subtree (ClockwiseSweep → raycaster → occlusion, wallResolve,
// wallSnap) is pure segment math, pixi-free by design, and re-implementing shadowcasting
// server-side to satisfy the ban would be the second copy of it in this repo.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design (see above)
import { clockwiseSweep } from '@dnd/core/src/engine/lighting/ClockwiseSweep'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design (see above)
import { extractWallSegments } from '@dnd/core/src/engine/lighting/raycaster'
import type { Segment } from '@dnd/core/src/engine/lighting/raycaster'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the Lighting pass's level rules, pure
import { firstLevelId, layersOnLevel, onLevel } from '@dnd/core/src/shared/visionGate'
import type { DoorChild, ZoneChild, ZoneShape } from '@dnd/core/src/shared/types'
import type { DungeonLayer } from '@dnd/core/src/store/types'
import { childrenOf, type SceneMap } from './sceneMap'

/** A closed ring in world units (grid cells). */
export type Polygon = [number, number][]

type Doors = Record<string, DoorLiveState>

/**
 * ponytail: one memo entry per scene, holding the sweeps taken since the doors last moved.
 * Cleared wholesale when the door key changes, and capped so a party walking a long corridor
 * cannot grow it without bound. A per-token LRU is the upgrade if a table ever measures one.
 */
const SWEEP_CAP = 256

interface SceneSweeps {
  /** One char per authored door — `sightState`, so a reveal is never mistaken for a no-op. */
  doorKey: string
  /** The level these occluders are on. */
  levelId: string
  /** What stops sight (windows pass it; props block it). */
  sightSegments: Segment[]
  polygons: Map<string, Polygon>
}

/** One pair of eyes and what it reaches: its line of sight, swept out to its own range. */
export interface Eye {
  x: number
  y: number
  polygon: Polygon
}

export interface PartyVision {
  eyes: Eye[]
}

export interface Sweeps {
  /**
   * The party's live sight: one eye per claimed, non-hidden, sighted token in the scene. Empty
   * when nobody is looking, which is a party that sees nothing rather than everything.
   */
  partyVision(
    map: SceneMap,
    tokens: Record<string, Token>,
    doors: Doors,
    /**
     * The level the sweep is taken on: its walls, props and rooms, and only the eyes
     * standing on it. Omitted is the map's first level (a one-level map is all of it).
     */
    levelId?: string,
  ): PartyVision
}

/**
 * Keyed on the parsed map *object*, not its scene id: `createSceneMaps` mints a new one
 * whenever a scene's map is invalidated or re-published, so a stale entry is unreachable by
 * construction and there is no invalidate call anywhere to forget.
 */
export function createSweeps(): Sweeps {

  const cache = new WeakMap<SceneMap, Map<string, SceneSweeps>>()

  function sweepsFor(map: SceneMap, doors: Doors, levelId: string): SceneSweeps {
    const doorKey = map.doors.map((door) => sightState(door, doors)).join('')
    let byLevel = cache.get(map)
    if (!byLevel) cache.set(map, (byLevel = new Map()))
    const hit = byLevel.get(levelId)
    if (hit && hit.doorKey === doorKey) return hit
    const layers = liveLayers(map, doors, levelId)
    const next: SceneSweeps = {
      doorKey,
      levelId,
      // The map's own drop threshold: cliffs at least that tall hide their tops from below.
      sightSegments: extractWallSegments(layers, 'sight', { sightDropCells: map.data.mapSettings.sightDropCells }),
      polygons: new Map(),
    }
    byLevel.set(levelId, next)
    return next
  }

  return {
    partyVision(map, tokens, doors, levelId) {
      const level = levelId ?? firstLevelId(map.data)
      // P4 §4 — the party's eyes are the sight-link closure of the claimed tokens, not the
      // claimed tokens alone: an unclaimed familiar the DM linked to a scout is looking for
      // them. `sightParty` drops hidden tokens itself (hidden trumps links); a token with no
      // sight is in the party but is not an eye.
      // Table fix pass §2.4: `partyEyes` gives every player-owned token and PC sight of its own.
      // Levels: only the eyes standing on this level look at it.
      const claimed = partyEyes(Object.values(tokens)).filter((token) => onLevel(map.data, token, level))
      if (claimed.length === 0) return { eyes: [] }
      const scene = sweepsFor(map, doors, level)
      if (scene.polygons.size > SWEEP_CAP) scene.polygons.clear()
      // Origin, reach and wedge are the whole key: the occluders are the level's own.
      const sweep = (x: number, y: number, radius: number, cone: LightCone | undefined): Polygon => {
        const key = `${x},${y},${radius}|${cone ? `${cone.angle}/${cone.direction}` : ''}`
        let polygon = scene.polygons.get(key)
        if (!polygon) {
          polygon = clockwiseSweep([x, y], radius, scene.sightSegments, cone).map((v) => v.point)
          scene.polygons.set(key, polygon)
        }
        return polygon
      }

      // Fog rework pass 2: every eye is swept at its own `sight.range` and no further, a carried
      // torch included, and walls and closed doors bound it inside that. Light, darkness
      // sources and darkvision play no part, so a token clears at night what it clears by day.
      // `sight.angle` is the eye's cone (facing east: tokens carry no facing yet).
      const eyes = claimed.map((token) => ({
        x: token.x,
        y: token.y,
        polygon: sweep(token.x, token.y, token.sight!.range, carriedCone(token.sight!.angle)),
      }))
      return { eyes }
    },
  }
}

function boxOf(polygon: Polygon): [number, number, number, number] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [x, y] of polygon) {
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  return [x0, y0, x1, y1]
}

/**
 * Whether some eye of the party sees a point: it is inside that eye's line of sight, which the
 * sweep has already cut at the eye's range. Lit or dark makes no difference.
 */
export function seen(vision: PartyVision, x: number, y: number): boolean {
  // Per cell, so no allocation here: each eye's box is tested before its polygon.
  for (const eye of vision.eyes) {
    if (inBox(boxFor(eye.polygon), x, y) && pointInPolygon(eye.polygon, x, y)) return true
  }
  return false
}

/** Bounding boxes of swept polygons, computed once per polygon (polygons are memoized). */
const boxes = new WeakMap<Polygon, [number, number, number, number]>()
function boxFor(polygon: Polygon): [number, number, number, number] {
  let box = boxes.get(polygon)
  if (!box) boxes.set(polygon, (box = boxOf(polygon)))
  return box
}
const inBox = (box: [number, number, number, number], x: number, y: number): boolean =>
  x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3]

/**
 * How this door stands in the segment build right now — three states, not two, and each one
 * a *different* set of occluders (see `segmentsOf`). Collapsing the last two into "does not
 * let sight through" is what let a `reveal-secret` on a shut door read as no change at all
 * and hand back the cached sweep: the wall it sits on goes from unsplit to split, which
 * matters wherever the wall's own type does not block light (window, terrain, invisible) and
 * the door span therefore does.
 */
function sightState(door: DoorChild, doors: Doors): 'o' | 's' | 'c' {
  const live = doors[door.id] ?? seedDoor(door)
  if (door.isSecret && !live.revealed) return 's' // still a wall: the span is not even split
  return live.open ? 'o' : 'c'
}

/**
 * The scene's occluders, live. `extractWallSegments` already splits every wall at its doors
 * and keeps only the spans that block light — it reads the state off the door child, so the
 * live overlay is applied by handing it a copy of the layers with the door children updated:
 *
 *  - open ⇒ authored `open`, and the span it covers stops occluding.
 *  - closed or locked ⇒ authored `closed`, and the span occludes.
 *  - an unfound secret door ⇒ `visible: false`, which drops it from the resolve entirely, so
 *    the wall it sits on is never split and occludes end to end. That is exactly what a
 *    secret door is: a wall until someone finds it.
 */
export function liveLayers(map: SceneMap, doors: Doors, levelId: string): DungeonLayer[] {
  return layersOnLevel(map.data, map.data.layers, levelId).map((layer) => ({
    ...layer,
    children: childrenOf(layer).map((child) => (child.childType === 'door' ? live(child, doors) : child)),
  }))
}

/** A door child with the table's live state laid over its authored one. */
function live(door: DoorChild, doors: Doors): DoorChild {
  const state = doors[door.id] ?? seedDoor(door)
  if (door.isSecret && !state.revealed) return { ...door, visible: false }
  return { ...door, state: state.open ? 'open' : 'closed' }
}

/**
 * §5 — the zones that beat a sweep. Point zones are left out: a lock needs an area, and a
 * point zone is a trigger anchor pinned at one coordinate.
 */
export function exploreLocks(zones: readonly ZoneChild[]): ZoneShape[] {
  return zones
    .filter((zone) => zone.blocksAutoExplore && zone.shape.kind !== 'point')
    .map((zone) => zone.shape)
}

export function inAnyLock(locks: readonly ZoneShape[], x: number, y: number): boolean {
  return locks.some((shape) => {
    if (shape.kind === 'circle') {
      return Math.hypot(x - shape.position.x, y - shape.position.y) <= shape.radius
    }
    if (shape.kind === 'rect') {
      return x >= shape.x && x <= shape.x + shape.width && y >= shape.y && y <= shape.y + shape.height
    }
    return false
  })
}
