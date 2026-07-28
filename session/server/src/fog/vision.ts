// What the fog rules answer, for the whole server: which rooms the player role may see,
// which ones a player token may stand in, the map a player is allowed to hold, and the
// geometry a reveal just handed over (§2.3).
//
// The BFS behind it is party-global and per-mutation, never per message or per frame (D3,
// §4): every answer for a scene is computed once and kept until something writes module
// state. `ModuleStateStore` counts its writes, so the revision it is at *is* the cache key
// — there is no invalidation hook anywhere to forget to call.

import { doorsOfScene, type AuthoredDoor, type DoorLiveState, type DoorsState } from '@dnd/mechanics/doors'
import { sceneFogOf, visibleRooms, type FogState, type RoomFog, type SceneFog } from '@dnd/mechanics/fog'
import type { SceneVision, TokensState } from '@dnd/mechanics/tokens'
import type { SerializedMapData } from '@dnd/core/src/store/types'
import type { Stores } from '../db/stores'
import { mapDeltaFor, redactMapForViewer, exploredRooms, type MapDelta } from './redactMap'
import { CACHE_MAX, createSceneMaps, type SceneMap } from './sceneMap'

/** Everything the rest of the server asks the fog. One implementation, wired at boot. */
export interface Vision {
  /** Backs `fogModule` — the room ids a fog command may name. */
  roomsOf(campaignId: string, sceneId: string): readonly string[]
  /** Backs `doorsModule` — the doors the map authors. */
  doorsOf(campaignId: string, sceneId: string): readonly AuthoredDoor[]
  /** Backs `tokensModule` — redaction (D7) and `canOccupy` (D8). */
  visionOf(sceneId: string): SceneVision | null
  /** The map GET's player path (D4). Null when the map is unknown or will not parse. */
  playerMap(sceneId: string): SerializedMapData | null
  /** Rooms whose geometry entered the player view at this mutation, sliced (D5). */
  revealDelta(sceneId: string): MapDelta | null
}

interface Computed {
  revision: number
  map: SceneMap
  fog: SceneFog
  doors: Record<string, DoorLiveState>
  /** Rooms the party can see right now (D3). */
  visible: Set<string>
  /** Rooms a player token may stand in (D8) — reachable, and not never-revealed. */
  occupiable: Set<string>
  /** Rooms whose geometry the player holds (D4). */
  explored: Set<string>
  /** The rooms newly explored at this mutation, sliced once and sent to every player. */
  delta: MapDelta | null
}

const NO_FOG: FogState = { byScene: {} }
const NO_DOORS: DoorsState = { byScene: {} }
const NO_TOKENS: TokensState = { library: {}, byScene: {} }

export function createVision(stores: Stores): Vision {
  const sceneMapOf = createSceneMaps(stores)
  const cache = new Map<string, Computed>()

  const read = <S>(campaignId: string, module: string, fallback: S): S =>
    (stores.moduleState.get(campaignId, module) as S | undefined) ?? fallback

  function compute(sceneId: string): Computed | null {
    const map = sceneMapOf(sceneId)
    if (!map) return null
    const previous = cache.get(sceneId)
    if (previous && previous.revision === stores.moduleState.revision) return previous

    const { campaignId } = map
    const fog = sceneFogOf(read(campaignId, 'fog', NO_FOG), sceneId)
    const doors = doorsOfScene(read(campaignId, 'doors', NO_DOORS), sceneId, map.doors)
    const tokens = read(campaignId, 'tokens', NO_TOKENS).byScene[sceneId] ?? {}

    // Party-global (D3): one set for the player role, anchored on the rooms the claimed
    // tokens stand in. ponytail: with nobody's token on the map there is no party to be
    // shut behind a door from, so concealment has nothing to measure and the revealed set
    // is the answer — otherwise a DM revealing a room before the table arrives shows them
    // nothing at all.
    const party: string[] = []
    for (const token of Object.values(tokens)) {
      if (token.ownerId === null || token.hidden) continue
      const room = map.roomAt(token.x, token.y)
      if (room !== null && !party.includes(room)) party.push(room)
    }
    const concealBehindDoors = fog.concealBehindDoors && party.length > 0

    const explored = exploredRooms(fog)
    // Against nothing on a cold cache, so the first answer after a restart is everything
    // the party has explored rather than nothing at all. Correctness must not depend on
    // whether someone happened to fetch the map first, and a client already holding a
    // room's geometry loses nothing by being handed it again.
    const revealed = [...explored].filter((room) => !previous?.explored.has(room))
    const next: Computed = {
      revision: stores.moduleState.revision,
      map,
      fog,
      doors,
      visible: visibleRooms({ ...fog, concealBehindDoors }, doors, map.doors, party),
      // D8 asks a different question of the same graph: a re-hidden room the party can
      // still walk to is somewhere to stand, it is simply dark (D7). Asking `visibleRooms`
      // for a scene where every room they have seen counts as lit answers it exactly.
      occupiable: visibleRooms(
        { rooms: asSeen(fog.rooms), concealBehindDoors },
        doors,
        map.doors,
        party,
      ),
      explored,
      // Cut once per mutation, not once per viewer: every player at the table is owed the
      // same rooms, and the slice is the expensive half of a reveal.
      delta: revealed.length ? mapDeltaFor(map, sceneId, revealed, doors) : null,
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
    roomsOf: (_campaignId, sceneId) => sceneMapOf(sceneId)?.rooms.map((room) => room.id) ?? [],
    doorsOf: (_campaignId, sceneId) => sceneMapOf(sceneId)?.doors ?? [],

    visionOf: (sceneId) => {
      const computed = compute(sceneId)
      // No authored rooms, no fog: room-granular fog has nothing to be granular about.
      if (!computed || computed.map.rooms.length === 0) return null
      return {
        roomAt: computed.map.roomAt,
        visible: computed.visible,
        occupiable: computed.occupiable,
      }
    },

    playerMap: (sceneId) => {
      const computed = compute(sceneId)
      return computed ? redactMapForViewer(computed.map, computed.fog, computed.doors) : null
    },

    revealDelta: (sceneId) => compute(sceneId)?.delta ?? null,
  }
}

/** The same rooms, with everything the party has ever seen counting as lit. */
function asSeen(rooms: Record<string, RoomFog>): Record<string, RoomFog> {
  const seen: Record<string, RoomFog> = {}
  for (const [roomId, room] of Object.entries(rooms)) {
    seen[roomId] = room.wasEverRevealed ? { ...room, status: 'revealed' } : room
  }
  return seen
}
