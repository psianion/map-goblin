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
  identityRegion,
  regionFor,
  sceneFogOf,
  setCells,
  visibleRooms,
  visionShareOf,
  type Cell,
  type FogRoom,
  type FogState,
  type RoomFog,
  type SceneFog,
} from '@dnd/mechanics/fog'
import { needsLight, sceneTriggersOf, type TriggersState } from '@dnd/mechanics/triggers'
import { sightParty, type SceneVision, type Token, type TokensState } from '@dnd/mechanics/tokens'
import type { Viewer } from '@dnd/mechanics/contract'
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
  seen,
  type PartyVision,
} from './sweep'

/** Everything the rest of the server asks the fog. One implementation, wired at boot. */
export interface Vision {
  /** Backs `fogModule` — the room ids a fog command may name. */
  roomsOf(campaignId: string, sceneId: string): readonly string[]
  /** Backs `fogModule`'s region commands — the rectangle a region cell is counted from. */
  frameOf(campaignId: string, sceneId: string): SceneMap['frame']
  /** …and the room a brushed cell falls in, which is the room that has to ship for it. */
  roomAtOf(campaignId: string, sceneId: string, x: number, y: number): string | null
  /** Backs `doorsModule` — the doors the map authors. */
  doorsOf(campaignId: string, sceneId: string): readonly AuthoredDoor[]
  /**
   * Backs `doorsModule`'s redaction — the door ids bound to a room the party has explored,
   * which is the same cut `redactMapForViewer` makes on the door children themselves, so
   * the slice and the map a player holds name exactly the same doors. Empty for a scene
   * with no map, which is the scene a player is handed no geometry for either.
   */
  playerDoors(sceneId: string): ReadonlySet<string>
  /**
   * Backs `tokensModule` — redaction (D7) and `canOccupy` (D8).
   *
   * P5 — the viewer is what makes `individual` share real: pass the seat being redacted for
   * and `canSee` is that seat's own sight. Omitted (every command-path caller) is the party's,
   * which is what `canOccupy` asks and what party share answers for everyone anyway.
   */
  visionOf(sceneId: string, viewer?: Viewer): SceneVision | null
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
  /**
   * Rooms the sweep touched that are not already lit.
   *
   * Shared in both shares, on purpose (P5 §1): geometry ships per scene, so any seat's sweep
   * latches a room for the table. What diverges is presentation and entity redaction, and
   * the cells below are the presentation half.
   */
  rooms: string[]
  /**
   * P5 — the cells *each* seat's own eyes earned, in `individual` share. Absent in party
   * share, where `cells` is the one record everybody reads.
   */
  byIdentity?: Record<string, Cell[]>
}

interface Computed {
  revision: number
  map: SceneMap
  fog: SceneFog
  /** The party's eyes and the lit area they are judged against — null in `'rooms'` mode,
   *  where nothing sweeps at all. */
  sight: PartyVision | null
  /**
   * P5 — the same thing for one seat: the sweep union of the tokens *that identity* claimed,
   * closed over the DM's sight links. Memoized into this record, so it is keyed on the module
   * revision exactly as the party union is and goes stale on the same write; the shadowcasts
   * underneath are memoized per origin and reach, so a second seat looking at the same map
   * pays for eye assembly and nothing else.
   */
  sightFor(identityId: string): PartyVision | null
  /** Which share the scene is playing — read once, here, so nothing below re-derives it. */
  share: 'party' | 'individual'
  /** The identities holding a claimed token, connected or not: whose records auto-explore. */
  owners: string[]
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
/** No triggers state yet ⇒ no relights and no ambient dial: `sceneTriggersOf` reads daylight. */
const NO_TRIGGERS: TriggersState = { byScene: {} }
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
    // P4 §4 — and "the party" is the sight-link closure of the claimed tokens, the same set
    // the sweep is taken through, so a linked familiar anchors the rooms-mode BFS too.
    const party: string[] = []
    for (const token of sightParty(Object.values(tokens))) {
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
    //
    // P3 — and the light with it. The triggers module holds both halves of the light state the
    // table is actually playing (the scene's ambient dial and every relit light), and any write
    // to it bumps the revision this record is keyed on, so a `set-environment` or a trigger
    // firing re-derives the answer for free. Outside `darkness` no light sweep is taken at all:
    // `lit: null` is the P2 behaviour, unchanged, which is what an untouched scene keeps.
    const triggers = sceneTriggersOf(read(campaignId, 'triggers', NO_TRIGGERS), sceneId)
    const lights = needsLight(triggers) ? triggers.lightOverrides : null
    const vision = fogModeOf(fog) === 'vision'
    const sight = vision ? sweeps.partyVision(map, tokens, doors, lights) : null
    // P5 — one seat's eyes, on demand and once per revision. Lazy because most tables never
    // ask: party share reads `sight` alone, and even in individual share only the seats
    // actually being redacted for are ever computed.
    const perIdentity = new Map<string, PartyVision | null>()
    const sightFor = (identityId: string): PartyVision | null => {
      if (!vision) return null
      let own = perIdentity.get(identityId)
      if (own === undefined) {
        own = sweeps.partyVision(map, tokens, doors, lights, (t) => t.ownerId === identityId)
        perIdentity.set(identityId, own)
      }
      return own
    }

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
      sightFor,
      share: visionShareOf(fog),
      owners: ownersOf(tokens),
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
    roomAtOf: (_campaignId, sceneId, x, y) => sceneMapOf(sceneId)?.roomAt(x, y) ?? null,
    doorsOf: (_campaignId, sceneId) => sceneMapOf(sceneId)?.doors ?? [],
    playerDoors: (sceneId) => compute(sceneId)?.playerDoors ?? NO_ONES_DOORS,

    visionOf: (sceneId, viewer) => {
      const computed = compute(sceneId)
      // No authored rooms, no fog: room-granular fog has nothing to be granular about.
      if (!computed || computed.map.rooms.length === 0) return null
      // P5 — the whole of the per-viewer divergence, in one expression: the same `seen()` rule
      // over a narrower set of eyes. A DM is asked nothing (their redaction is identity), and a
      // caller with no viewer at all — every command path — asks the party question.
      const sight =
        viewer && viewer.role !== 'dm' && computed.share === 'individual'
          ? computed.sightFor(viewer.identityId)
          : computed.sight
      return {
        roomAt: computed.map.roomAt,
        visible: computed.visible,
        occupiable: computed.occupiable,
        // P1 — in vision mode a token is judged by the point it stands on, not the room it
        // is in. Absent in `'rooms'` mode, which leaves `inSight` byte-identical there.
        // P3 — and by the light on that point: in darkness a token beyond every torch and
        // beyond darkvision is not on the wire at all (§3.1).
        canSee: sight ? (x, y) => seen(sight, x, y) : undefined,
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
      if (!computed?.sight?.eyes.length) return null
      const { fog, map } = computed
      // Sight still drives redaction with auto-explore off (§4); it simply writes nothing.
      if (!autoExploreOn(fog) || !map.frame) return null
      const frame = map.frame

      const locks = exploreLocks(map.zones)
      const { cells, rooms } = swept(computed.sight, map, frame, locks)

      // A swept room latches exactly the way the DM's region brush latches one (mechanics'
      // `shipRooms`): `re_hidden` plus the latch, so the geometry travels and what the player
      // then *sees* of it is the cells they actually swept. `revealed` is reserved for a DM's
      // own act — auto-explore claiming it would wash every explored room whole and leave the
      // cell tier with nothing to say. A room already latched is left alone, which is also why
      // a DM's `revealed` survives the party walking back into it.
      //
      // Off the *party's* sweep in both shares (P5 §1): the room record is shared, so whoever
      // opened the door has opened it for the table, and the party union is exactly the union
      // of the seats' own — `sightParty`'s closure over a union of seeds is the union of the
      // closures. Only the cells below are per-seat.
      const fresh = [...rooms].filter((id) => !fog.rooms[id]?.wasEverRevealed)
      // Undefined = a frame past `REGION_CELL_MAX`, which keeps no cell memory; the room
      // reveals are the half that decides what geometry a player holds, and they still ride.
      const region = regionFor(fog.region, frame)
      if (computed.share !== 'individual') {
        // The cheap diff: OR the sweep in and see whether a single byte moved.
        if (!fresh.length && (!region || setCells(region, cells).bits === region.bits)) return null
        return { sceneId, cells: region ? cells : [], rooms: fresh }
      }

      // …and per seat: every identity holding a claimed token, connected or not — the record
      // is state, not a session, so a player who logged off still remembers what their scout
      // walked past while the rest of the party carried on.
      //
      // ponytail: ~2N cell walks per mutation on an N-seat table in individual share, not N.
      // This loop is the first N. The write it returns bumps the fog revision, and redaction
      // then asks `sightFor` again per *connected* viewer to build their mask — so a six-seat
      // table pays roughly twelve enumerations for one token step. What is duplicated is the
      // cheap half: `cellsCoveredByPolygon` over each eye's box, plus the per-cell room and
      // lock tests in `swept`. What is not is the expensive half — the shadowcasts are
      // memoized per origin and reach and are warm by the second pass, and every seat's eyes
      // are a subset of the party's sweep this function already computed.
      // The upgrade, if a big table ever measures it, is one walk that tags each cell with the
      // eyes that reached it rather than a walk per eye set — and that halves both N's at once,
      // which is why it is the one worth writing rather than a cache over this loop.
      const byIdentity: Record<string, Cell[]> = {}
      for (const identityId of computed.owners) {
        const own = computed.sightFor(identityId)
        if (!own?.eyes.length) continue
        const mine = swept(own, map, frame, locks).cells
        const base = region && regionFor(identityRegion(fog, identityId), frame)
        // The same cheap diff, per record: a seat standing still writes nothing.
        if (!base || setCells(base, mine).bits === base.bits) continue
        byIdentity[identityId] = mine
      }
      if (!fresh.length && Object.keys(byIdentity).length === 0) return null
      // The party record is left alone: in individual share it is the *seed* every new seat
      // starts from, and a flip back to party ORs every seat's own into it (`set-share`).
      //
      // ponytail: so it freezes at the moment of the flip. Nothing reads it as "the table's
      // memory" — the DM's own wash asks `tableRegion`, which unions the seats — and letting
      // it accrue instead would seed every seat that claims a token later with everything the
      // rest of the table has seen, which is the mode turned off by the back door.
      return { sceneId, cells: [], rooms: fresh, byIdentity }
    },

    invalidateScene: (sceneId) => {
      invalidateSceneMap(sceneId)
      cache.delete(sceneId)
    },
  }
}

/**
 * What one set of eyes just earned: the non-locked cells they can actually see, and the rooms
 * those cells fall in. Lifted out of `autoExplorePatch` unchanged so the per-seat pass asks
 * the identical question of a narrower sweep rather than a second implementation of it.
 */
function swept(
  sight: PartyVision,
  map: SceneMap,
  frame: NonNullable<SceneMap['frame']>,
  locks: ReturnType<typeof exploreLocks>,
): { cells: Cell[]; rooms: Set<string> } {
  const cells: Cell[] = []
  const rooms = new Set<string>()
  const counted = new Set<string>()
  for (const eye of sight.eyes) {
    for (const [col, row] of cellsCoveredByPolygon(eye.polygon, frame)) {
      const key = `${col},${row}`
      if (counted.has(key)) continue
      counted.add(key)
      const [x, y] = [frame.minX + col + 0.5, frame.minY + row + 0.5]
      // §3.2 — you explore what you saw, not what your sweep crossed in pitch black. In
      // daylight this is the identity (a cell enumerated from an eye's own polygon is in
      // it); in darkness it is the whole difference between walking a lit corridor and
      // groping down an unlit one.
      if (!seen(sight, x, y)) continue
      // A lock beats the sweep by construction: the cell is not written and the room it
      // belongs to is not credited, so a boss chamber seen through an open door stays
      // the DM's to reveal (§5).
      if (inAnyLock(locks, x, y)) continue
      cells.push([col, row])
      const room = map.roomAt(x, y)
      if (room !== null) rooms.add(room)
    }
  }
  return { cells, rooms }
}

/** The identities holding a claimed token in this scene — whose records P5 writes. */
function ownersOf(tokens: Record<string, Token>): string[] {
  const owners = new Set<string>()
  for (const token of Object.values(tokens)) if (token.ownerId) owners.add(token.ownerId)
  return [...owners]
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
