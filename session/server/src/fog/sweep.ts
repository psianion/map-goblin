// The server's half of token vision (S3 P1): what a claimed token can actually see, as a
// polygon, from the scene's walls and its live doors.
//
// None of the geometry is written here. `clockwiseSweep` and `extractWallSegments` already
// exist in @dnd/core and are pure — the same shadowcasting the editor's lighting runs — so
// this file's whole job is to hand them the *live* door states the map file knows nothing
// about, and to remember the answers until something moves.

import { seedDoor, type DoorLiveState } from '@dnd/mechanics/doors'
import { lightSources, pointInPolygon } from '@dnd/mechanics/fog'
import { sightParty, type Token } from '@dnd/mechanics/tokens'
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

/**
 * One pair of eyes and what it reaches. The token stays attached because the §3 rule is asked
 * *per token*: darkvision is a property of the eye, not of the party, so a union of bare
 * polygons cannot answer "who saw this, and could they have seen it unlit".
 */
export interface Eye {
  x: number
  y: number
  range: number
  darkvision: boolean
  polygon: Polygon
}

export interface PartyVision {
  eyes: Eye[]
  /**
   * Every light source's own sweep, unioned by `seen` — or null when the scene's ambient is
   * not `darkness`, which is the whole sweep counting as lit and no light sweeps taken at all.
   * Null is therefore both the answer and the P2 fast path.
   */
  lit: Polygon[] | null
}

export interface Sweeps {
  /**
   * The party's live sight: one eye per claimed, non-hidden, sighted token in the scene, plus
   * the lit area the §3 rule measures against. Empty when nobody is looking, which is a party
   * that sees nothing rather than everything.
   *
   * `lights` is null outside `darkness` — pass the scene's live `lightOverrides` to gate.
   */
  partyVision(
    map: SceneMap,
    tokens: Record<string, Token>,
    doors: Doors,
    lights: Record<string, boolean> | null,
    /**
     * S3 P5 — whose eyes to start the closure from. Omitted is every claimed token, which is
     * the party. `individual` share passes one seat's own (`t.ownerId === identityId`) and
     * gets that seat's sight for the same money: the sweeps are memoized per origin and
     * reach, so a per-identity union re-uses the polygons the party union already took.
     */
    isSeed?: (token: Token) => boolean,
  ): PartyVision
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
    partyVision(map, tokens, doors, lights, isSeed) {
      // P4 §4 — the party's eyes are the sight-link closure of the claimed tokens, not the
      // claimed tokens alone: an unclaimed familiar the DM linked to a scout is looking for
      // them. `sightParty` drops hidden tokens itself (hidden trumps links); a token with no
      // sight is in the party but is not an eye.
      const claimed = sightParty(Object.values(tokens), isSeed).filter(
        (token) => (token.sight?.range ?? 0) > 0,
      )
      if (claimed.length === 0) return { eyes: [], lit: null }
      const scene = sweepsFor(map, doors)
      if (scene.polygons.size > SWEEP_CAP) scene.polygons.clear()
      // A light's sweep and an eye's sweep are the same computation from the same occluders,
      // so they share one memo: origin and reach are the whole key either way, and a torch
      // standing where a scout stood is genuinely the same polygon.
      const sweep = (x: number, y: number, radius: number): Polygon => {
        const key = `${x},${y},${radius}`
        let polygon = scene.polygons.get(key)
        if (!polygon) {
          polygon = clockwiseSweep([x, y], radius, scene.segments).map((v) => v.point)
          scene.polygons.set(key, polygon)
        }
        return polygon
      }

      const eyes = claimed.map((token) => {
        const range = token.sight!.range
        // `sight.angle` is ignored — cones are a v1 non-goal. Darkvision sweeps the same
        // geometry as a normal eye; what it changes is the light test, not the shadowcast.
        return {
          x: token.x,
          y: token.y,
          range,
          darkvision: token.sight!.visionMode === 'darkvision',
          polygon: sweep(token.x, token.y, range),
        }
      })
      return {
        eyes,
        lit: lights ? litIn(map, tokens, lights).map((l) => sweep(l.x, l.y, l.radius)) : null,
      }
    },
  }
}

/** §2's shared rule, fed the map's own light children. The rule itself lives in mechanics so
 *  the canvas runs the identical one over the document it holds.
 *
 *  ponytail: the DM's whole map, where the client runs the same rule over the *redacted* copy
 *  — the wall asymmetry `visionSight`'s `sightLayers` carries, on the light side (D5). A lamp
 *  in a room the party does not hold can therefore light a cell here that their own mask never
 *  cleared, so a cell auto-explores as seen and then draws as void until they actually reach
 *  it. It errs to void and it self-heals; the fix, the day it matters, is the server sending
 *  the mask rather than the client sweeping a second time. */
const litIn = (map: SceneMap, tokens: Record<string, Token>, overrides: Record<string, boolean>) =>
  lightSources(
    map.lights.map((light) => ({
      id: light.id,
      x: light.position.x,
      y: light.position.y,
      radius: light.radius,
      visible: light.visible,
    })),
    Object.values(tokens),
    overrides,
  )

/**
 * §3, the whole rule, in one place so the three callers cannot drift:
 *
 *   seen(p) = inSweep(p) AND (ambient ≠ darkness OR lit(p) OR (darkvision eye AND p in range))
 *
 * Party entitlement is the union over the party's eyes, but the darkvision clause is not:
 * only the eye that *has* darkvision may claim unlit ground, and only out to its own range.
 */
export function seen(vision: PartyVision, x: number, y: number): boolean {
  const looking = vision.eyes.filter((eye) => pointInPolygon(eye.polygon, x, y))
  if (looking.length === 0) return false
  if (!vision.lit) return true
  if (vision.lit.some((polygon) => pointInPolygon(polygon, x, y))) return true
  return looking.some((eye) => eye.darkvision && Math.hypot(x - eye.x, y - eye.y) <= eye.range)
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
