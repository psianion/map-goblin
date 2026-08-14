// What the fog rules answer, for the whole server: which rooms the player role may see,
// which ones a player token may stand in, the map a player is allowed to hold, and the
// geometry a reveal just handed over (§2.3).
//
// The BFS behind it is party-global and per-mutation, never per message or per frame (D3,
// §4): every answer for a scene is computed once and kept until something writes module
// state. `ModuleStateStore` counts its writes, so the revision it is at *is* the cache key
// — there is no invalidation hook anywhere to forget to call.

import { doorsOfScene, type AuthoredDoor, type DoorLiveState, type DoorsState } from '@dnd/mechanics/doors'
import {
  autoExploreOn,
  blockedEdge,
  cellsCoveredByPolygon,
  effectiveFog,
  fogModeOf,
  regionFor,
  sceneFogOf,
  setCells,
  visibleRooms,
  type Cell,
  type FogRoom,
  type FogState,
  type RoomFog,
  type SceneFog,
} from '@dnd/mechanics/fog'
import type { SceneVision, TokensState } from '@dnd/mechanics/tokens'
import type { SerializedMapData } from '@dnd/core/src/store/types'
import type { Stores } from '../db/stores'
import {
  doorDeltaFor,
  doorKept,
  mapDeltaFor,
  redactMapForViewer,
  exploredRooms,
  type MapDelta,
} from './redactMap'
import { CACHE_MAX, createSceneMaps, type SceneMap, type SceneMapOf } from './sceneMap'
import {
  createSweeps,
  exploreLocks,
  inAnyLock,
  sightContains,
  type Polygon,
} from './sweep'

/** Everything the rest of the server asks the fog. One implementation, wired at boot. */
export interface Vision {
  /** Backs `fogModule` — the room ids a fog command may name. */
  roomsOf(campaignId: string, sceneId: string): readonly string[]
  /** Backs `fogModule`'s region commands — the rectangle a region cell is counted from. */
  frameOf(campaignId: string, sceneId: string): SceneMap['frame']
  /** Backs `doorsModule` — the doors the map authors. */
  doorsOf(campaignId: string, sceneId: string): readonly AuthoredDoor[]
  /**
   * Backs `doorsModule`'s redaction — the door ids bound to a room the party has explored,
   * which is the same cut `redactMapForViewer` makes on the door children themselves, so
   * the slice and the map a player holds name exactly the same doors. Empty for a scene
   * with no map, which is the scene a player is handed no geometry for either.
   */
  playerDoors(sceneId: string): ReadonlySet<string>
  /** Backs `tokensModule` — redaction (D7) and `canOccupy` (D8). */
  visionOf(sceneId: string): SceneVision | null
  /** The map GET's player path (D4). Null when the map is unknown or will not parse. */
  playerMap(sceneId: string): SerializedMapData | null
  /** The scene's parsed map, raw — triggers' prep resolver (M4) reuses this cache rather
   *  than parsing the map doc a second time. */
  sceneMapOf: SceneMapOf
  /** Rooms whose geometry entered the player view at this mutation, sliced (D5). */
  revealDelta(sceneId: string): MapDelta | null
  /**
   * S3 P1 — what the party's sight has just earned in a vision-mode scene, or null when
   * there is nothing new to write (wrong mode, auto-explore off, nobody looking, or the
   * sweep covers only ground the record already holds). The auto-explore hook feeds this
   * straight to `fog.auto-explore`.
   */
  autoExplorePatch(sceneId: string): AutoExplorePatch | null
  /** #47 — call after a re-publish repoints a scene's map, or its cached answers go stale. */
  invalidateScene(sceneId: string): void
}

/** The one fog write a successful token move or door toggle can earn (§4). */
export interface AutoExplorePatch {
  sceneId: string
  /** Every non-locked cell the party can see — an idempotent OR, not a delta. */
  cells: Cell[]
  /** Rooms the sweep touched that are not already lit. */
  rooms: string[]
}

interface Computed {
  revision: number
  map: SceneMap
  fog: SceneFog
  /** The party's sight polygons — null in `'rooms'` mode, where nothing sweeps at all. */
  sight: Polygon[] | null
  doors: Record<string, DoorLiveState>
  /** Rooms the party can see right now (D3). */
  visible: Set<string>
  /** Rooms a player token may stand in (D8) — reachable, and not never-revealed. */
  occupiable: Set<string>
  /** The rooms the party stands in — what `blockedEdge` measures "shut off" against. */
  party: string[]
  /** Rooms whose geometry the player holds (D4). */
  explored: Set<string>
  /** The doors that geometry contains — the live states a player may be told about. */
  playerDoors: Set<string>
  /** The rooms newly explored at this mutation, sliced once and sent to every player. */
  delta: MapDelta | null
}

const NO_FOG: FogState = { byScene: {} }
/** `effectiveFog`'s default-room fallback, switched off — see its call site below. */
const NO_ROOMS: readonly FogRoom[] = []
const NO_DOORS: DoorsState = { byScene: {} }
const NO_TOKENS: TokensState = { library: {}, byScene: {} }
const NO_ONES_DOORS: ReadonlySet<string> = new Set()

export function createVision(stores: Stores): Vision {
  const { sceneMapOf, invalidate: invalidateSceneMap } = createSceneMaps(stores)
  const sweeps = createSweeps()
  const cache = new Map<string, Computed>()

  const read = <S>(campaignId: string, module: string, fallback: S): S =>
    (stores.moduleState.get(campaignId, module) as S | undefined) ?? fallback

  function compute(sceneId: string): Computed | null {
    const map = sceneMapOf(sceneId)
    if (!map) return null
    const previous = cache.get(sceneId)
    if (previous && previous.revision === stores.moduleState.revision) return previous

    const { campaignId } = map
    const doors = doorsOfScene(read(campaignId, 'doors', NO_DOORS), sceneId, map.doors)
    const tokens = read(campaignId, 'tokens', NO_TOKENS).byScene[sceneId] ?? {}

    // Party-global (D3): one set for the player role, anchored on the rooms the claimed
    // tokens stand in.
    const party: string[] = []
    for (const token of Object.values(tokens)) {
      if (token.ownerId === null || token.hidden) continue
      const room = map.roomAt(token.x, token.y)
      if (room !== null && !party.includes(room)) party.push(room)
    }
    // Everything below reads the *effective* fog, never the stored one, and the player's
    // renderer applies the same helper to the same inputs so the two cannot drift.
    //
    // With no rooms to pick from, the one read-time correction left is the empty-party
    // concealment rule. The other — the default room, which revealed the largest non-pathway
    // room whenever nothing was stored as revealed (amendment 2026-07-28) — is off: it handed
    // a player who had been told nothing the geometry of the map's biggest room, which on
    // emberhold-crypt is the torchlit one, and the fourth browser gate read it at full
    // brightness on a scene the DM's panel called Unrevealed. Withholding it here is the half
    // that matters; the mask is only the half the player can see (PRODUCT principle 2).
    const fog = effectiveFog(sceneFogOf(read(campaignId, 'fog', NO_FOG), sceneId), NO_ROOMS, party)
    // S3 P1 — the sweep is taken once per mutation alongside the BFS, and cached with it:
    // token redaction, auto-explore and (P2) the mask all read the same polygons, so the
    // three cannot disagree about where the party's sight ends.
    const sight = fogModeOf(fog) === 'vision' ? sweeps.partySight(map, tokens, doors) : null

    const explored = exploredRooms(fog)
    // The doors a player may hold — the *same* predicate the map cut uses on the door
    // children themselves, so the live slice and the geometry name one set of doors and not
    // two (a secret door the DM has not revealed is in neither).
    //
    // A map nobody zoned used to be exempt: with no room to bind a door to, the explored cut
    // takes every one of them, so the amendment of 2026-07-28 handed them all over instead.
    // That is the leak the fourth browser gate measured — three marks at full brightness over
    // a black canvas, disclosing where the doors are. The geometry of an unzoned map is still
    // handed over whole (`redactMapForViewer`); only the doors on it are the DM's, because a
    // door nobody can earn is a door no player should be told about.
    const held = map.doors.filter((door) => doorKept(door, explored, doors))
    // Against nothing on a cold cache, so the first answer after a restart is everything
    // the party has explored rather than nothing at all. Correctness must not depend on
    // whether someone happened to fetch the map first, and a client already holding a
    // room's geometry loses nothing by being handed it again.
    const revealed = [...explored].filter((room) => !previous?.explored.has(room))
    // Cut once per mutation, not once per viewer: every player at the table is owed the same
    // rooms, and the slice is the expensive half of a reveal.
    const roomDelta = revealed.length ? mapDeltaFor(map, sceneId, revealed, doors, explored) : null
    // …and the same question asked of doors, which is how a `reveal-secret` hands over the
    // door child the player's map was cut without (D2). A door that arrives with the room it
    // belongs to is already in `roomDelta`, so this only carries what the rooms did not.
    const carried = new Set(roomDelta?.layers.flatMap((l) => l.children.map((c) => c.id)) ?? [])
    const newDoors = new Set(
      held
        .filter((door) => !previous?.playerDoors.has(door.id) && !carried.has(door.id))
        .map((door) => door.id),
    )
    const next: Computed = {
      revision: stores.moduleState.revision,
      map,
      fog,
      sight,
      doors,
      visible: visibleRooms(fog, doors, map.doors, party),
      // D8 asks a different question of the same graph: a re-hidden room the party can
      // still walk to is somewhere to stand, it is simply dark (D7). Asking `visibleRooms`
      // for a scene where every room they have seen counts as lit answers it exactly.
      occupiable: visibleRooms({ ...fog, rooms: asSeen(fog.rooms) }, doors, map.doors, party),
      party,
      explored,
      playerDoors: new Set(held.map((door) => door.id)),
      delta: mergeDelta(roomDelta, newDoors.size ? doorDeltaFor(map, sceneId, newDoors, explored) : null),
    }
    // Held to the same ceiling as the parsed maps: every entry keeps a scene's geometry
    // alive through `map` and `delta`, so an uncapped one would quietly undo that cap.
    if (!cache.has(sceneId) && cache.size >= CACHE_MAX) {
      cache.delete(cache.keys().next().value as string)
    }
    cache.set(sceneId, next)
    return next
  }

  return {
    sceneMapOf,
    roomsOf: (_campaignId, sceneId) => sceneMapOf(sceneId)?.rooms.map((room) => room.id) ?? [],
    frameOf: (_campaignId, sceneId) => sceneMapOf(sceneId)?.frame ?? null,
    doorsOf: (_campaignId, sceneId) => sceneMapOf(sceneId)?.doors ?? [],
    playerDoors: (sceneId) => compute(sceneId)?.playerDoors ?? NO_ONES_DOORS,

    visionOf: (sceneId) => {
      const computed = compute(sceneId)
      // No authored rooms, no fog: room-granular fog has nothing to be granular about.
      if (!computed || computed.map.rooms.length === 0) return null
      const { sight } = computed
      return {
        roomAt: computed.map.roomAt,
        visible: computed.visible,
        occupiable: computed.occupiable,
        // P1 — in vision mode a token is judged by the point it stands on, not the room it
        // is in. Absent in `'rooms'` mode, which leaves `inSight` byte-identical there.
        canSee: sight ? (x, y) => sightContains(sight, x, y) : undefined,
        // The half of the refusal that was never plugged in: `occupiable` is the BFS's
        // boolean, and without this the cause it discarded stayed discarded, so every move
        // a door refused came back as the generic "you can't move there".
        blockedEdge: (room) => blockedEdge(computed.doors, computed.map.doors, computed.party, room),
      }
    },

    playerMap: (sceneId) => {
      const computed = compute(sceneId)
      return computed ? redactMapForViewer(computed.map, computed.fog, computed.doors) : null
    },

    revealDelta: (sceneId) => compute(sceneId)?.delta ?? null,

    autoExplorePatch: (sceneId) => {
      const computed = compute(sceneId)
      if (!computed?.sight?.length) return null
      const { fog, map } = computed
      // Sight still drives redaction with auto-explore off (§4); it simply writes nothing.
      if (!autoExploreOn(fog) || !map.frame) return null
      const frame = map.frame

      const locks = exploreLocks(map.zones)
      const cells: Cell[] = []
      const rooms = new Set<string>()
      const counted = new Set<string>()
      for (const polygon of computed.sight) {
        for (const [col, row] of cellsCoveredByPolygon(polygon, frame)) {
          const key = `${col},${row}`
          if (counted.has(key)) continue
          counted.add(key)
          const [x, y] = [frame.minX + col + 0.5, frame.minY + row + 0.5]
          // A lock beats the sweep by construction: the cell is not written and the room it
          // belongs to is not credited, so a boss chamber seen through an open door stays
          // the DM's to reveal (§5).
          if (inAnyLock(locks, x, y)) continue
          cells.push([col, row])
          const room = map.roomAt(x, y)
          if (room !== null) rooms.add(room)
        }
      }

      // A re-hidden room the party is looking at comes back: with auto-explore on, sight is
      // what lights the map. A DM who wants it to stay dark turns auto-explore off or locks
      // it — both of which beat the sweep above.
      const fresh = [...rooms].filter((id) => fog.rooms[id]?.status !== 'revealed')
      // Undefined = a frame past `REGION_CELL_MAX`, which keeps no cell memory; the room
      // reveals are the half that decides what geometry a player holds, and they still ride.
      const region = regionFor(fog.region, frame)
      // The cheap diff: OR the sweep in and see whether a single byte moved.
      if (!fresh.length && (!region || setCells(region, cells).bits === region.bits)) return null
      return { sceneId, cells: region ? cells : [], rooms: fresh }
    },

    invalidateScene: (sceneId) => {
      invalidateSceneMap(sceneId)
      cache.delete(sceneId)
    },
  }
}

/** Two deltas for one mutation, said in one message — the client merges layers by id. */
function mergeDelta(rooms: MapDelta | null, doors: MapDelta | null): MapDelta | null {
  if (!rooms || !doors) return rooms ?? doors
  const layers = [...rooms.layers]
  for (const layer of doors.layers) {
    const existing = layers.find((l) => l.id === layer.id)
    if (existing) existing.children = [...existing.children, ...layer.children]
    else layers.push(layer)
  }
  return { ...rooms, layers }
}

/** The same rooms, with everything the party has ever seen counting as lit. */
function asSeen(rooms: Record<string, RoomFog>): Record<string, RoomFog> {
  const seen: Record<string, RoomFog> = {}
  for (const [roomId, room] of Object.entries(rooms)) {
    seen[roomId] = room.wasEverRevealed ? { ...room, status: 'revealed' } : room
  }
  return seen
}
