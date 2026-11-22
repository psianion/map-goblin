// The server's half of token vision (S3 P1): what a claimed token can actually see, as a
// polygon, from the scene's walls and its live doors.
//
// None of the geometry is written here. `clockwiseSweep` and `extractWallSegments` already
// exist in @dnd/core and are pure — the same shadowcasting the editor's lighting runs — so
// this file's whole job is to hand them the *live* door states the map file knows nothing
// about, and to remember the answers until something moves.

import { seedDoor, type DoorLiveState } from '@dnd/mechanics/doors'
import { carriedCone, lightSources, pointInPolygon, type LightSource } from '@dnd/mechanics/fog'
import { eyes as partyEyes, type Token } from '@dnd/mechanics/tokens'
import { effectiveLight, type LightEdit, type RoomEdit, type SkyFrame } from '@dnd/mechanics/triggers'
// D3's runtime waivers, in the same targeted per-line style redactMap.ts uses for
// shared/mapBounds: the sweep subtree (ClockwiseSweep → raycaster → occlusion, wallResolve,
// wallSnap) is pure segment math, pixi-free by design, and re-implementing shadowcasting
// server-side to satisfy the ban would be the second copy of it in this repo.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design (see above)
import { clockwiseSweep } from '@dnd/core/src/engine/lighting/ClockwiseSweep'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design (see above)
import { extractWallSegments } from '@dnd/core/src/engine/lighting/raycaster'
import type { Segment } from '@dnd/core/src/engine/lighting/raycaster'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the Lighting pass's level and darkness rules, pure
import { darkTest, firstLevelId, layersOnLevel, onLevel, polygonEdges } from '@dnd/core/src/shared/visionGate'
import type { DoorChild, LightChild, ZoneChild, ZoneShape } from '@dnd/core/src/shared/types'
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
  /** The level these occluders and lights are on. */
  levelId: string
  layers: DungeonLayer[]
  /** What stops light, and what stops sight (windows pass both; props block both). */
  lightSegments: Segment[]
  sightSegments: Segment[]
  polygons: Map<string, Polygon>
}

/**
 * The table's light state a sweep is judged against (the Lighting pass): the sky (time of day
 * and the scene's darkness slider, `worldSkyOf`), every live light edit, and the live room
 * places. Null is a scene with nothing dark anywhere.
 */
export interface LightGate {
  sky: SkyFrame
  edits: Record<string, LightEdit>
  roomPlaces: Record<string, RoomEdit>
}

/** A darkness source's swept area, and whether darkvision sees through it. */
export interface DarkArea {
  polygon: Polygon
  darkvisionSees: boolean
}

/**
 * One pair of eyes and what it reaches. The token stays attached because the §3 rule is asked
 * *per token*: darkvision is a property of the eye, not of the party, so a union of bare
 * polygons cannot answer "who saw this, and could they have seen it unlit".
 */
export interface Eye {
  x: number
  y: number
  /** How far this eye's sight is swept, and how far it sees *unlit* ground with darkvision. */
  range: number
  darkvision: boolean
  polygon: Polygon
}

export interface PartyVision {
  eyes: Eye[]
  /**
   * Every light source's own sweep (inside the dim edge is lit), unioned by `seen` — or null
   * when nothing on the level is dark (no dark region, no darkness source), which is the
   * whole sweep counting as lit and no light sweeps taken at all. Null is therefore both the
   * answer and the fast path.
   */
  lit: Polygon[] | null
  /** Where the ground is dark enough to need light (per room, by mood and sky). Null with `lit`. */
  darkAt: ((x: number, y: number) => boolean) | null
  /** Darkness sources: no light reaches inside them; only darkvision that may see through does. */
  darkness: DarkArea[]
}

export interface Sweeps {
  /**
   * The party's live sight: one eye per claimed, non-hidden, sighted token in the scene, plus
   * the lit area the §3 rule measures against. Empty when nobody is looking, which is a party
   * that sees nothing rather than everything.
   *
   * `gate` is the table's light state (sky, live light edits, room moods); null is a scene
   * with nothing dark anywhere, the whole sweep counting as lit.
   */
  partyVision(
    map: SceneMap,
    tokens: Record<string, Token>,
    doors: Doors,
    gate: LightGate | null,
    /**
     * The level the sweep is taken on: its walls, props, rooms and lights, and only the eyes
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
      layers,
      // The map's own drop threshold: cliffs at least that tall hide their tops from below.
      lightSegments: extractWallSegments(layers, 'light', { sightDropCells: map.data.mapSettings.sightDropCells }),
      sightSegments: extractWallSegments(layers, 'sight', { sightDropCells: map.data.mapSettings.sightDropCells }),
      polygons: new Map(),
    }
    byLevel.set(levelId, next)
    return next
  }

  return {
    partyVision(map, tokens, doors, gate, levelId) {
      const level = levelId ?? firstLevelId(map.data)
      // P4 §4 — the party's eyes are the sight-link closure of the claimed tokens, not the
      // claimed tokens alone: an unclaimed familiar the DM linked to a scout is looking for
      // them. `sightParty` drops hidden tokens itself (hidden trumps links); a token with no
      // sight is in the party but is not an eye. A range of 0 is still an eye — plain sight,
      // which sees whatever is lit — so the test is on `sight` itself, not its range.
      // Table fix pass §2.4: `partyEyes` gives every player-owned token and PC sight of its own.
      // Levels: only the eyes standing on this level look at it.
      const claimed = partyEyes(Object.values(tokens)).filter((token) => onLevel(map.data, token, level))
      if (claimed.length === 0) return { eyes: [], lit: null, darkAt: null, darkness: [] }
      const scene = sweepsFor(map, doors, level)
      if (scene.polygons.size > SWEEP_CAP) scene.polygons.clear()
      // One memo for every sweep on this level: kind, origin, reach, wedge and the extra
      // occluders are the whole key, so a torch standing where a scout stood with the same
      // reach is genuinely the same polygon when the occluders agree.
      const sweep = (
        kind: 'light' | 'sight',
        x: number,
        y: number,
        radius: number,
        opts: { cone?: LightSource['cone']; throughWalls?: boolean; extra?: Segment[]; extraKey?: string } = {},
      ): Polygon => {
        const cone = opts.cone && opts.cone.angle < 360 ? opts.cone : undefined
        const key = `${kind}|${x},${y},${radius}|${cone ? `${cone.angle}/${cone.direction}` : ''}|${opts.throughWalls ? 't' : ''}|${opts.extraKey ?? ''}`
        let polygon = scene.polygons.get(key)
        if (!polygon) {
          const base = opts.throughWalls ? [] : kind === 'light' ? scene.lightSegments : scene.sightSegments
          const segments = opts.extra && opts.extra.length > 0 ? [...base, ...opts.extra] : base
          polygon = clockwiseSweep([x, y], radius, segments, cone).map((v) => v.point)
          scene.polygons.set(key, polygon)
        }
        return polygon
      }

      // The light half, on this level: its lights with the DM's live edits laid over them, and
      // the tokens standing on it carrying theirs; darkness sources split off and swept too.
      let lit: Polygon[] | null = null
      let darkAt: ((x: number, y: number) => boolean) | null = null
      const darkness: (DarkArea & { source: LightSource })[] = []
      if (gate) {
        const levelTokens = Object.values(tokens).filter((t) => onLevel(map.data, t, level))
        const sources = litIn(scene.layers, levelTokens, gate.edits, gate.sky.darkness)
        for (const s of sources) {
          if (!s.darkness) continue
          darkness.push({
            source: s,
            polygon: sweep('light', s.x, s.y, s.radius, { cone: s.cone, throughWalls: s.throughWalls }),
            darkvisionSees: s.darkvisionSees === true,
          })
        }
        const test = darkTest(map.data, scene.layers, level, gate.sky, gate.roomPlaces)
        if (test.any || darkness.length > 0) {
          darkAt = test.dark
          lit = sources
            .filter((s) => !s.darkness)
            .map((s) => sweep('light', s.x, s.y, s.radius, { cone: s.cone, throughWalls: s.throughWalls }))
        }
      }

      // Fog rework: every eye is swept at its own `sight.range` and no further, a carried torch
      // included. The walls, and in the dark the light, bound it inside that.
      //
      // `sight.angle` is the eye's cone (facing east: tokens carry no facing yet). Darkvision
      // sweeps the same geometry as a normal eye, except that a darkness source's edge stops
      // every eye but a darkvision one the source lets through.
      const eyes = claimed.map((token) => {
        const range = token.sight!.range
        const darkvision = token.sight!.visionMode === 'darkvision'
        const blocking = darkness.filter((d) => !(darkvision && d.darkvisionSees))
        return {
          x: token.x,
          y: token.y,
          range,
          darkvision,
          polygon: sweep('sight', token.x, token.y, range, {
            cone: carriedCone(token.sight!.angle),
            extra: blocking.flatMap((d) => polygonEdges(d.polygon)),
            extraKey: blocking.map((d) => `${d.source.x},${d.source.y},${d.source.radius}`).join(';'),
          }),
        }
      })
      return {
        eyes,
        lit,
        darkAt,
        darkness: darkness.map(({ polygon, darkvisionSees }) => ({ polygon, darkvisionSees })),
      }
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

/** §2's shared rule, fed the map's own light children with the DM's live `lightEdits`
 *  overlaid (`effectiveLight`, M2) — the cached `SceneMap` itself is never touched, so a
 *  radius/position/visible edit is a per-request read, not an invalidation.
 *
 *  ponytail: the DM's whole map, where the client runs the same rule over the *redacted* copy
 *  — the wall asymmetry `visionSight`'s `sightLayers` carries, on the light side (D5). A lamp
 *  in a room the party does not hold can therefore light a cell here that their own mask never
 *  cleared, so a cell auto-explores as seen and then draws as void until they actually reach
 *  it. It errs to void and it self-heals; the fix, the day it matters, is the server sending
 *  the mask rather than the client sweeping a second time. */
const litIn = (
  layers: readonly DungeonLayer[],
  tokens: readonly Token[],
  edits: Record<string, LightEdit>,
  darkness: number,
) =>
  lightSources(
    layers
      .flatMap((layer) => childrenOf(layer).filter((c): c is LightChild => c.childType === 'light'))
      .map((light) => {
        const effective = effectiveLight(light, edits[light.id])
        return {
          id: effective.id,
          x: effective.position.x,
          y: effective.position.y,
          radius: effective.radius,
          visible: effective.visible,
          cone: effective.cone,
          throughWalls: effective.throughWalls,
          nightOnly: effective.nightOnly,
          darkness: effective.darkness,
          darkvisionSees: effective.darkvisionSees,
        }
      }),
    tokens,
    {},
    darkness,
  )

/**
 * §3, the whole rule, in one place so its callers cannot drift:
 *
 *   seen(p) = any i inSweep_i(p), AND (NOT dark(p) OR lit(p) OR (darkvision eye AND p in range))
 *
 * `dark(p)` is the Lighting pass's per-region gate: the room the point is in (else the level)
 * resolves dark under the sky (mood, night, weather, the DM's slider). Inside a darkness
 * source nothing lights the ground, and only a darkvision eye in range sees it, and only
 * when every source covering the point lets darkvision through.
 *
 * `inSweep` is line of sight within the eye's range. Party entitlement is the union over the
 * party's eyes, but the darkvision clause is not: only the eye that *has* darkvision may claim
 * unlit ground, and only out to its own range.
 */
export function seen(vision: PartyVision, x: number, y: number): boolean {
  // Per cell, so no allocation here: one pass over the eyes answers both "is anyone looking"
  // and "is a looking darkvision eye in range", each eye's box tested before its polygon.
  let looking = false
  let darkvision = false
  for (const eye of vision.eyes) {
    if (!inBox(boxFor(eye.polygon), x, y) || !pointInPolygon(eye.polygon, x, y)) continue
    const dist = Math.hypot(x - eye.x, y - eye.y)
    looking = true
    if (eye.darkvision && dist <= eye.range) darkvision = true
  }
  if (!looking) return false
  if (!vision.lit) return true
  let inDark = false
  let throughDark = true
  for (const d of vision.darkness) {
    if (!inBox(boxFor(d.polygon), x, y) || !pointInPolygon(d.polygon, x, y)) continue
    inDark = true
    if (!d.darkvisionSees) throughDark = false
  }
  if (inDark) return throughDark && darkvision
  if (vision.darkAt && !vision.darkAt(x, y)) return true
  for (const polygon of vision.lit) {
    if (inBox(boxFor(polygon), x, y) && pointInPolygon(polygon, x, y)) return true
  }
  return darkvision
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
