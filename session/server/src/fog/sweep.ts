// The server's half of token vision (S3 P1): what a claimed token can actually see, as a
// polygon, from the scene's walls and its live doors.
//
// None of the geometry is written here. `clockwiseSweep` and `extractWallSegments` already
// exist in @dnd/core and are pure — the same shadowcasting the editor's lighting runs — so
// this file's whole job is to hand them the *live* door states the map file knows nothing
// about, and to remember the answers until something moves.

import { seedDoor, type DoorLiveState } from '@dnd/mechanics/doors'
import { pointInPolygon } from '@dnd/mechanics/fog'
import type { Token } from '@dnd/mechanics/tokens'
// D3's runtime waivers, in the same targeted per-line style redactMap.ts uses for
// shared/mapBounds: the sweep subtree (ClockwiseSweep → raycaster → occlusion, wallResolve,
// wallSnap) is pure segment math, pixi-free by design, and re-implementing shadowcasting
// server-side to satisfy the ban would be the second copy of it in this repo.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design (see above)
import { clockwiseSweep } from '@dnd/core/src/engine/lighting/ClockwiseSweep'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design (see above)
import { extractWallSegments } from '@dnd/core/src/engine/lighting/raycaster'
import type { Segment } from '@dnd/core/src/engine/lighting/raycaster'
import type { DoorChild, ZoneChild, ZoneShape } from '@dnd/core/src/shared/types'
import type { DungeonLayer } from '@dnd/core/src/store/types'
import { childrenOf, isDungeon, type SceneMap } from './sceneMap'

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
  segments: Segment[]
  polygons: Map<string, Polygon>
}

export interface Sweeps {
  /**
   * The party's live sight: one polygon per claimed, non-hidden, sighted token in the scene.
   * Empty when nobody is looking, which is a party that sees nothing rather than everything.
   */
  partySight(map: SceneMap, tokens: Record<string, Token>, doors: Doors): Polygon[]
}

/**
 * Keyed on the parsed map *object*, not its scene id: `createSceneMaps` mints a new one
 * whenever a scene's map is invalidated or re-published, so a stale entry is unreachable by
 * construction and there is no invalidate call anywhere to forget.
 */
export function createSweeps(): Sweeps {
  const cache = new WeakMap<SceneMap, SceneSweeps>()

  function sweepsFor(map: SceneMap, doors: Doors): SceneSweeps {
    const doorKey = map.doors.map((door) => sightState(door, doors)).join('')
    const hit = cache.get(map)
    if (hit && hit.doorKey === doorKey) return hit
    const next: SceneSweeps = { doorKey, segments: segmentsOf(map, doors), polygons: new Map() }
    cache.set(map, next)
    return next
  }

  return {
    partySight(map, tokens, doors) {
      const claimed = Object.values(tokens).filter(
        (token) => token.ownerId !== null && !token.hidden && (token.sight?.range ?? 0) > 0,
      )
      if (claimed.length === 0) return []
      const scene = sweepsFor(map, doors)
      if (scene.polygons.size > SWEEP_CAP) scene.polygons.clear()
      const seen: Polygon[] = []
      for (const token of claimed) {
        const range = token.sight!.range
        // P1 is purely geometric: `visionMode: 'darkvision'` sweeps identically to normal
        // and `sight.angle` is ignored — the light gate is P3, cones are a v1 non-goal.
        const key = `${token.x},${token.y},${range}`
        let polygon = scene.polygons.get(key)
        if (!polygon) {
          polygon = clockwiseSweep([token.x, token.y], range, scene.segments).map((v) => v.point)
          scene.polygons.set(key, polygon)
        }
        seen.push(polygon)
      }
      return seen
    },
  }
}

/** Inside any one of the party's sight polygons. */
export function sightContains(polygons: readonly Polygon[], x: number, y: number): boolean {
  return polygons.some((polygon) => pointInPolygon(polygon, x, y))
}

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
function segmentsOf(map: SceneMap, doors: Doors): Segment[] {
  const layers: DungeonLayer[] = map.data.layers.filter(isDungeon).map((layer) => ({
    ...layer,
    children: childrenOf(layer).map((child) =>
      child.childType === 'door' ? live(child, doors) : child,
    ),
  }))
  return extractWallSegments(layers)
}

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
