// What the fog rules answer, for the whole server: which rooms the player role may see,
// which ones a player token may stand in, the map a player is allowed to hold, and the
// geometry a reveal just handed over (§2.3).
//
// The BFS behind it is party-global and per-mutation, never per message or per frame (D3,
// §4): every answer for a scene is computed once and kept until something writes module
// state. `ModuleStateStore` counts its writes, so the revision it is at *is* the cache key
// — there is no invalidation hook anywhere to forget to call.

import {
  doorsOfScene,
  type AuthoredDoor,
  type DoorLiveState,
  type DoorsState,
} from '@dnd/mechanics/doors'
import {
  autoExploreOn,
  blockedEdge,
  cellsCoveredByPolygon,
  clearedOn,
  containedSightOn,
  effectiveFog,
  fogModeOf,
  fogOn,
  rebaseRegion,
  identityRegion,
  isOutdoorsId,
  outdoorsId,
  tableRegion,
  regionFor,
  sceneFogOf,
  setCells,
  sightRangeLimitOn,
  toBytes,
  visibleRooms,
  visionShareOf,
  type AutoExploreByLevel,
  type Cell,
  type FogRoom,
  type FogState,
  type RegionMask,
  type SceneFog,
} from '@dnd/mechanics/fog'
import {
  roomEditsOf,
  sceneTriggersOf,
  viewedLevel,
  worldSkyOf,
  type SceneTriggers,
  type TriggersState,
} from '@dnd/mechanics/triggers'
import {
  NO_GROUND as NO_GROUND_CELL,
  SIZE_CELLS,
  STANDABLE,
  cellAt,
  cellCentre,
  claimed,
  eyes,
  sightParty,
  walkAreas,
  walkRefusal,
  type SceneVision,
  type Token,
  type TokensState,
  type WalkGrid,
} from '@dnd/mechanics/tokens'
import type { CrossingsState } from '@dnd/mechanics/crossings'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the Lighting pass's level rules, pure
import { firstLevelId, onLevel } from '@dnd/core/src/shared/visionGate'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the plateau model is pure
import { hiddenTops } from '@dnd/core/src/shared/plateaus'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design
import { pointInRing } from '@dnd/core/src/shared/roomUtils'
import type { Viewer } from '@dnd/mechanics/contract'
import type { MapDelta } from '@dnd/core/src/shared/protocol'
import type { SerializedMapData } from '@dnd/core/src/store/types'
import type { Stores } from '../db/stores'
import {
  childDeltaFor,
  keptChildIds,
  doorKept,
  outsideFace,
  lockMaskFor,
  mapDeltaFor,
  redactMapForViewer,
  heldRooms,
  bandPad,
  groundOf,
  standInDeltaFor,
  type Places,
  type Ground,
} from './redactMap'
import {
  CACHE_MAX,
  createSceneMaps,
  type SceneMap,
  type SceneMapOf,
} from './sceneMap'
import { createWalkGrids } from './walk'
import { enclosedOn, enclosureRings, hasHiddenGround, zonedEnclosureRings } from './outdoorGround'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the Clipper wrapper the server already boots (clipperBoot.ts)
import { clipper2Engine } from '@dnd/core/src/geometry/Clipper2Engine'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: floor-piece predicates, pure
import { baseGroundOf } from '@dnd/core/src/shared/pieces'
import {
  createSweeps,
  exploreLocks,
  inAnyLock,
  seen,
  type LightGate,
  type PartyVision,
  type SightFence,
} from './sweep'

/** Everything the rest of the server asks the fog. One implementation, wired at boot. */
export interface Vision {
  /** Backs `fogModule` — the room ids a fog command may name. */
  roomsOf(campaignId: string, sceneId: string): readonly string[]
  /** Backs `fogModule`'s region commands — the rectangle a region cell is counted from. */
  frameOf(campaignId: string, sceneId: string): SceneMap['frame']
  /** …and the room a brushed cell falls in, which is the room that has to ship for it. */
  roomAtOf(campaignId: string, sceneId: string, x: number, y: number): string | null
  /** …and whether a brushed cell is ground, or beside it, on any level (table fix pass §2.5). */
  groundAtOf(campaignId: string, sceneId: string, x: number, y: number): boolean
  /** Fog rework — the level ids that key a scene's cleared record. */
  levelsOf(campaignId: string, sceneId: string): readonly string[]
  /** Fog rework — whether a brushed cell is ground, or beside it, on one level. */
  floorOnOf(campaignId: string, sceneId: string, levelId: string, x: number, y: number): boolean
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
  /** Table fix pass §2.7 — the fog rows a player seat may see right now (`SceneFog.visible`). */
  visibleOf(sceneId: string): readonly string[] | null
  /**
   * Table fix pass §2.6 — By hand mode: the rooms, or Outdoors rows, a party token stands in
   * that were never revealed, for `fog.party-here`. Null when there is nothing to write.
   */
  partyHerePatch(sceneId: string): { sceneId: string; rooms: string[] } | null
  /** Rooms whose geometry entered the player view at this mutation, sliced (D5). */
  revealDelta(sceneId: string): MapDelta | null
  /**
   * Fog rework — what the party's sight has just cleared, per level, or null when there is
   * nothing new to write (fog off, Auto-explore off, nobody looking, or the sweep covers only
   * ground already cleared). The auto-explore hook feeds this straight to `fog.auto-explore`.
   */
  autoExplorePatch(sceneId: string): AutoExploreByLevel | null
  /** #47 — call after a re-publish repoints a scene's map, or its cached answers go stale. */
  invalidateScene(sceneId: string): void
  /**
   * The light ids a player's copy of the map keeps (lights in explored rooms) — what the
   * triggers redaction keeps the live `lightEdits` of. Null when the scene has no map.
   */
  keptLightsOf(sceneId: string): ReadonlySet<string> | null
  /** P9 — the real room ids a player's copy holds (the triggers module's `keptRoomsOf`). */
  keptRoomsOf(sceneId: string): ReadonlySet<string> | null
  /**
   * Backs `tokensModule`'s level cut: which tokens a player's viewed level shows. Null on a
   * one-level map, for the DM, or with no map — every token shows.
   */
  levelFilterOf(sceneId: string, viewer: Viewer): ((levelId: string | undefined) => boolean) | null
}

interface Computed {
  revision: number
  map: SceneMap
  fog: SceneFog
  /** The party's eyes and the lit area they are judged against, on the map's first level —
   *  null in `'rooms'` mode, where nothing sweeps at all. */
  sight: PartyVision | null
  /** The party's sight on one level (levels: only the eyes standing on it look at it). */
  sightOn(levelId: string): PartyVision | null
  /** Every level some claimed token stands on — what auto-explore sweeps. */
  eyeLevels: string[]
  /**
   * Fog rework — the party's sight on one level as Auto-explore takes it: each eye swept at its
   * own sight range, walls and closed doors blocking, darkness as ever, no fence.
   */
  clearSightOn(levelId: string): PartyVision
  /** The scene's triggers state, for the viewed-level rule. */
  triggers: SceneTriggers
  tokens: Record<string, Token>
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
  /** §5's zones, read once: they bound the record *and* (under containment) live sight. */
  locks: ReturnType<typeof exploreLocks>
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
  /** Every child id a player is entitled to — what the next mutation's delta is diffed against. */
  playerChildren: Set<string>
  /** The rooms newly explored at this mutation, sliced once and sent to every player. */
  delta: MapDelta | null
  /** The DM's live room places, baked into the stand-ins a seat is sent, and their key. */
  places: Places
  placesKey: string
  /** §2.7 — ground the table knows, as the redactor's lookup. */
  ground: Ground
  /** §2.7 — the ground outside the walled floors, once any outdoor cell is known. */
  openGround: SerializedMapData['openGround']
  /** §2.5 — whether a seen cell may go in the record: ground, or within one cell of it. */
  nearGround(x: number, y: number): boolean
}

const NO_FOG: FogState = { byScene: {} }
/** `effectiveFog`'s default-room fallback, switched off — see its call site below. */
const NO_ROOMS: readonly FogRoom[] = []
const NO_DOORS: DoorsState = { byScene: {} }
const NO_TOKENS: TokensState = { library: {}, byScene: {} }
/** No triggers state yet ⇒ no relights and no ambient dial: `sceneTriggersOf` reads daylight. */
const NO_TRIGGERS: TriggersState = { byScene: {} }
const NO_ONES_DOORS: ReadonlySet<string> = new Set()
const NO_CROSSINGS: CrossingsState = { byScene: {} }

/**
 * The plateau tops on the map that no party token stands high enough to see: a token sees a top
 * at or below its own elevation. The party is the claimed tokens, or this seat's own in
 * individual share. Undefined when nothing is covered.
 */
function coveredOf(
  data: SerializedMapData,
  tokens: readonly Token[],
  viewer: Viewer | undefined,
  share: string,
): ((x: number, y: number) => boolean) | undefined {
  const tops = data.layers.flatMap((l) => (l.type === 'dungeon' ? hiddenTops(l, data.mapSettings.sightDropCells) : []))
  if (tops.length === 0) return undefined
  const party = tokens.filter(
    (t) => !t.hidden && t.ownerId !== null && (share !== 'individual' || !viewer || t.ownerId === viewer.identityId),
  )
  const covered = tops.filter((top) => !party.some((t) => (t.elevation ?? 0) >= top.height))
  if (covered.length === 0) return undefined
  return (x, y) => covered.some((top) => top.rings.some((ring) => pointInRing(x, y, ring)))
}

export function createVision(stores: Stores): Vision {
  const { sceneMapOf, invalidate: invalidateSceneMap } = createSceneMaps(stores)
  const sweeps = createSweeps()
  const walks = createWalkGrids()
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
    // …and the rows the party stands in, Outdoors included (table fix pass §2.6): concealment
    // has someone to measure from wherever the party stands.
    const partyRows: string[] = []
    for (const token of sightParty(Object.values(tokens))) {
      const room = map.roomAt(token.x, token.y)
      if (room !== null && !party.includes(room)) party.push(room)
      const row = room ?? outdoorsRowOf(map.data, levelOfToken(map, token))
      if (!partyRows.includes(row)) partyRows.push(row)
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
    //
    // What a fresh table does give a player is the room the party stands in: while the DM has
    // never revealed a room, in rooms mode, those rooms count as revealed (`revealPartyRooms`), so the first
    // move inside them is allowed and the ground under their feet is drawn.
    //
    // Table fix pass §2.6: that read-time reveal is gone (F8). The room or Outdoors a party
    // token is put in is revealed and stored instead (`partyHerePatch`), so it survives the DM
    // revealing another room.
    const fog = effectiveFog(sceneFogOf(read(campaignId, 'fog', NO_FOG), sceneId), NO_ROOMS, partyRows)
    const crossings = read(campaignId, 'crossings', NO_CROSSINGS)
    // S3 P1 — the sweep is taken once per mutation alongside the BFS, and cached with it:
    // token redaction, auto-explore and (P2) the mask all read the same polygons, so the
    // three cannot disagree about where the party's sight ends.
    //
    // P3 — and the light with it. The triggers module holds both halves of the light state the
    // table is actually playing (the scene's ambient dial and every relit light), and any write
    // to it bumps the revision this record is keyed on, so a `set-world`, a `set-darkness` or a
    // trigger firing re-derives the answer for free.
    //
    // The gate is per region: the sky (the campaign's time of day and this scene's darkness
    // slider) through each room's place decides which ground needs light (`isDarkRegion`), so
    // the gate is the sky, the live light edits and the live room places. The same function
    // the table's mask calls, on the same slices, so the referee and the canvas cannot disagree
    // about whether the party needs a torch.
    const triggersState = read(campaignId, 'triggers', NO_TRIGGERS)
    const triggers = sceneTriggersOf(triggersState, sceneId)
    const mapSettings = map.data.mapSettings ?? ({} as NonNullable<typeof map.data.mapSettings>)
    const gate: LightGate = {
      sky: worldSkyOf(triggersState, mapSettings, sceneId),
      edits: triggers.lightEdits,
      roomPlaces: roomEditsOf(triggers),
    }
    const vision = fogModeOf(fog) === 'vision'
    const firstLevel = firstLevelId(map.data)
    const rangeLimited = sightRangeLimitOn(fog)
    const locks = exploreLocks(map.zones)
    // Containment (default on, vision mode only): live sight is fenced by the ground the table
    // has opened, and each eye's own `range` is the only thing that pushes the fence outward.
    //
    // Deliberately *not* a document event, unlike the mode flip. A `set-mode` re-cuts a seated
    // player's map because the cut itself reads the mode — `redactMapForViewer` stamps `frame`
    // when the scene is zoned OR the mode is vision (redactMap.ts:67), so a roomless scene
    // flipped to vision leaves a connected seat holding a frameless document and drawing no fog
    // at all (the client's `fogModeFlips` re-fetch). Containment appears nowhere in that cut:
    // `set-containment` writes one boolean (mechanics' fog module) and the cut reads `fog.rooms`
    // (`heldRooms`, `keptChildIds`), `tableRegion` and the mode — none of which it touches,
    // so the document is byte-identical either side of the flip. What the flip *does* move is
    // live sight, and that lands on its own: the fog broadcast retracts the tokens and doors
    // slices (registry's `RETRACTS`), which re-runs redaction through the composed `seen()` for
    // every seat in the same beat.
    //
    // The one asymmetry worth naming: the flip does not retroactively take back ground the
    // party earned uncontained — the record is a ratchet, and turning the fence on fences
    // *future* sight only. That is the stated trade in `containedSightOn`'s own doc.
    // Built per *record*, because that is what "the table has opened" means per seat — the
    // party's for the party sweep, the seat's own where the table shares individually — and
    // handed to the sweep as a cell test, never as a clip on the polygons (`SightFence`).
    const fenceFor = (stored: RegionMask | undefined): SightFence | null =>
      vision && containedSightOn(fog) ? { held: heldIn(map, fog, stored), locks } : null
    const perLevel = new Map<string, PartyVision | null>()
    const sightOn = (levelId: string): PartyVision | null => {
      if (!vision) return null
      let own = perLevel.get(levelId)
      if (own === undefined) {
        own = sweeps.partyVision(map, tokens, doors, gate, undefined, rangeLimited, fenceFor(fog.region), levelId)
        perLevel.set(levelId, own)
      }
      return own
    }
    const sight = sightOn(firstLevel)
    const eyeLevels = [...new Set(eyes(Object.values(tokens)).map((t) => levelOfToken(map, t)))]
    const clearing = new Map<string, PartyVision>()
    const clearSightOn = (levelId: string): PartyVision => {
      let own = clearing.get(levelId)
      if (!own) {
        own = sweeps.partyVision(map, tokens, doors, gate, undefined, 'range', null, levelId)
        clearing.set(levelId, own)
      }
      return own
    }
    // P5 — one seat's eyes, on demand and once per revision. Lazy because most tables never
    // ask: party share reads `sight` alone, and even in individual share only the seats
    // actually being redacted for are ever computed.
    const perIdentity = new Map<string, PartyVision | null>()
    const sightFor = (identityId: string): PartyVision | null => {
      if (!vision) return null
      let own = perIdentity.get(identityId)
      if (own === undefined) {
        own = sweeps.partyVision(
          map,
          tokens,
          doors,
          gate,
          (t) => t.ownerId === identityId,
          rangeLimited,
          // …and fenced by that seat's own memory, not the table's: the whole point of
          // `individual` is that a seat plays by what *it* has opened (`identityRegion`
          // falls back to the party record, which is the seed a seat with none reads).
          fenceFor(identityRegion(fog, identityId)),
          // …and on the level that seat is looking at.
          viewedLevel(triggers, Object.values(tokens), { role: 'player', identityId }, firstLevel),
        )
        perIdentity.set(identityId, own)
      }
      return own
    }

    // T10: the rooms held now, so a hidden room leaves the seat's copy (the client re-fetches).
    const explored = heldRooms(map, fog)
    // The DM's live room places: a stand-in carries its room's (it has lost the real id the
    // table's override is keyed by), and a moved place re-sends the stand-ins a seat holds.
    const places: Places = Object.fromEntries(
      Object.entries(gate.roomPlaces ?? {}).flatMap(([id, edit]) => (edit.place ? [[id, edit.place]] : [])),
    )
    const placesKey = JSON.stringify(places)
    // Table fix pass §2.7: ground the table knows, for what a seat is sent — the cell record,
    // and every outdoor ground cell of a level whose Outdoors row is revealed (T10: now, not ever).
    const ground = knownGroundOf(map, fog, (level) => walks.gridFor(map, doors, crossings, sceneId, level))
    // T11: …and the outdoor ground a party eye sees now, so a Hide all (or an Outdoors row reset)
    // with auto-explore off cannot leave the party blind on the ground it stands on.
    const liveOutdoors = vision
      ? seenOutdoorCells(map, fog, ground.outdoors, eyeLevels, sightOn, (level) => walks.gridFor(map, doors, crossings, sceneId, level))
      : NO_LIVE_OUTDOORS
    const openGround =
      ground.outdoors || liveOutdoors.size > 0
        ? openGroundRings(map, fog, (level) => walks.gridFor(map, doors, crossings, sceneId, level), liveOutdoors)
        : undefined
    // §2.5: what the record may hold — ground, or within one cell of it, on any level.
    const levelIds = map.data.levels?.length ? map.data.levels.map((l) => l.id) : [firstLevel]
    const nearGround = (x: number, y: number): boolean =>
      levelIds.some((level) => {
        const grid = walks.gridFor(map, doors, crossings, sceneId, level)
        return !!grid && groundNear(grid, x, y)
      })
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
    const held = map.doors.filter((door) => doorKept(door, explored, doors, ground.test, outsideFace(map, door)))
    // Against nothing on a cold cache, so the first answer after a restart is everything
    // the party has explored rather than nothing at all. Correctness must not depend on
    // whether someone happened to fetch the map first, and a client already holding a
    // room's geometry loses nothing by being handed it again.
    const revealed = [...explored].filter((room) => !previous?.explored.has(room))
    // Cut once per mutation, not once per viewer: every player at the table is owed the same
    // rooms, and the slice is the expensive half of a reveal.
    // …and the room cut carries the re-cut lock mask with it. The mask is the seat's fence for
    // its own near pass and it is cut against the rooms that seat holds, so the message that
    // grows that set is the one that owes the new fence — the same D5 debt the geometry pays.
    // Only on a room delta: a room that leaves `heldRooms` goes by the seat's re-fetch instead.
    const roomDelta = revealed.length
      ? { ...mapDeltaFor(map, sceneId, revealed, doors, explored, places), lockMask: lockMaskFor(map, fog, explored) }
      : null
    // …and the same question asked of every *child*, which is what a reveal that moves no room
    // at all still owes. Two of those exist: a `reveal-secret`, whose door child was cut while
    // it was a secret (D2), and the cell brush — brushed ground is a reveal, so the art stamped
    // along it becomes the player's the moment the referee paints the cell. Rooms were the only
    // trigger here before, so a brush stroke shipped its state and none of its geometry, and the
    // band along it stayed missing until the seat happened to refetch the whole document.
    //
    // Diffed off the same predicate the document cut uses (`keptChildIds`), so what a reveal
    // *delivers* and what a fresh fetch *contains* cannot drift. Anything the room slice already
    // carried is dropped — it is the same child, sliced twice.
    const playerChildren = keptChildIds(map, fog, doors, ground.test)
    const carried = new Set(roomDelta?.layers.flatMap((l) => l.children.map((c) => c.id)) ?? [])
    const newChildren = new Set(
      [...playerChildren].filter((id) => !previous?.playerChildren.has(id) && !carried.has(id)),
    )
    // §2.6: what the party sees behind doors is the walk areas its tokens stand in.
    const reached = reachedRows(map, sightParty(Object.values(tokens)), (level) => {
      const grid = walks.gridFor(map, doors, crossings, sceneId, level)
      return grid ? { grid, areas: areasOf(map, grid, level) } : null
    })
    const revealedRows = new Set(Object.entries(fog.rooms).filter(([, r]) => r.status === 'revealed').map(([id]) => id))
    const within = (rows: Set<string>) =>
      fog.concealBehindDoors && reached ? new Set([...rows].filter((id) => reached.has(id))) : rows
    // The open ground arrives with the mutation that first lets the seat know any of it, and again
    // whenever a level's rings change (S3: they grow with the ground the seat knows).
    const groundMoved =
      !!openGround && (!previous?.openGround || openGround.some((g, i) => g.rings !== previous.openGround?.[i]?.rings))
    const groundDelta: MapDelta | null = groundMoved ? { sceneId, layers: [], openGround } : null
    // A live place the DM moved reaches the stand-ins a seat holds the way a reveal does.
    const placeDelta =
      previous && previous.placesKey !== placesKey ? standInDeltaFor(map, sceneId, fog, doors, ground.test, places) : null
    const next: Computed = {
      revision: stores.moduleState.revision,
      map,
      fog,
      sight,
      sightOn,
      eyeLevels,
      clearSightOn,
      triggers,
      tokens,
      sightFor,
      share: visionShareOf(fog),
      locks,
      owners: ownersOf(tokens),
      doors,
      // §2.6: revealed, and with concealment on, in a walk area a party token stands in.
      visible: reached ? within(revealedRows) : visibleRooms(fog, doors, map.doors, party),
      // T10: a room hidden again is nowhere to stand, the same rule as known ground (§2.2).
      occupiable: reached ? within(revealedRows) : visibleRooms(fog, doors, map.doors, party),
      party,
      explored,
      playerDoors: new Set(held.map((door) => door.id)),
      playerChildren,
      ground: ground.test,
      openGround,
      nearGround,
      places,
      placesKey,
      delta: mergeDelta(
        mergeDelta(
          mergeDelta(roomDelta, newChildren.size ? childDeltaFor(map, sceneId, newChildren, explored, places) : null),
          placeDelta,
        ),
        groundDelta,
      ),
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
    // Table fix pass §2.1: Outdoors is a fog row like a room, one per level.
    roomsOf: (_campaignId, sceneId) => {
      const map = sceneMapOf(sceneId)
      if (!map) return []
      const rooms = map.rooms.map((room) => room.id)
      if (!map.frame) return rooms
      const levels = map.data.levels?.length ? map.data.levels.map((l) => l.id) : [firstLevelId(map.data)]
      return [...rooms, ...new Set(levels.map((level) => outdoorsRowOf(map.data, level)))]
    },
    frameOf: (_campaignId, sceneId) => sceneMapOf(sceneId)?.frame ?? null,
    roomAtOf: (_campaignId, sceneId, x, y) => sceneMapOf(sceneId)?.roomAt(x, y) ?? null,
    groundAtOf: (campaignId, sceneId, x, y) => {
      const map = sceneMapOf(sceneId)
      if (!map) return false
      const doors = doorsOfScene(read(campaignId, 'doors', NO_DOORS), sceneId, map.doors)
      const crossings = read(campaignId, 'crossings', NO_CROSSINGS)
      const levels = map.data.levels?.length ? map.data.levels.map((l) => l.id) : [firstLevelId(map.data)]
      return levels.some((level) => {
        const grid = walks.gridFor(map, doors, crossings, sceneId, level)
        return !!grid && groundNear(grid, x, y)
      })
    },
    levelsOf: (_campaignId, sceneId) => {
      const map = sceneMapOf(sceneId)
      return map ? levelIdsOf(map) : []
    },
    floorOnOf: (campaignId, sceneId, levelId, x, y) => {
      const map = sceneMapOf(sceneId)
      if (!map) return false
      const doors = doorsOfScene(read(campaignId, 'doors', NO_DOORS), sceneId, map.doors)
      const grid = walks.gridFor(map, doors, read(campaignId, 'crossings', NO_CROSSINGS), sceneId, levelId)
      return !!grid && groundNear(grid, x, y)
    },
    doorsOf: (_campaignId, sceneId) => sceneMapOf(sceneId)?.doors ?? [],
    playerDoors: (sceneId) => compute(sceneId)?.playerDoors ?? NO_ONES_DOORS,

    visionOf: (sceneId, viewer) => {
      const computed = compute(sceneId)
      if (!computed) return null
      // No authored rooms, no fog: room-granular fog has nothing to be granular about — in
      // rooms mode. In vision mode the unit is the cell, so a roomless scene has plenty to
      // say, and it has to be said here: `canSee` and `openGround` below are the whole of
      // what keeps every token on an imported battlemap off the players' wire. Bailing out
      // was what made vision mode unsafe on such a map, and mechanics refused the mode
      // switch on account of exactly this line.
      // R3: …and a roomless map with ground pieces or base ground is fogged by hand through its
      // Outdoors row; only an imported picture has nothing to be granular about.
      if (computed.map.rooms.length === 0 && !hasHiddenGround(computed.map.data) && fogModeOf(computed.fog) !== 'vision') return null
      // P5 — the whole of the per-viewer divergence, in one expression: the same `seen()` rule
      // over a narrower set of eyes. A DM is asked nothing (their redaction is identity), and a
      // caller with no viewer at all — every command path — asks the party question.
      // Levels: a player is judged on the level their seat is looking at.
      const sight =
        viewer && viewer.role !== 'dm' && computed.share === 'individual'
          ? computed.sightFor(viewer.identityId)
          : viewer && viewer.role !== 'dm'
            ? computed.sightOn(
                viewedLevel(computed.triggers, Object.values(computed.tokens), viewer, firstLevelId(computed.map.data)),
              )
            : computed.sight
      return {
        roomAt: (x, y) => computed.map.roomAt(x, y),
        visible: computed.visible,
        occupiable: computed.occupiable,
        // P1 — in vision mode a token is judged by the point it stands on, not the room it
        // is in. Absent in `'rooms'` mode, which leaves `inSight` byte-identical there.
        // P3 — and by the light on that point: in darkness a token beyond every torch and
        // beyond darkvision is not on the wire at all (§3.1).
        canSee: sight ? (x, y) => seen(sight, x, y) : undefined,
        // Rooms mode's one exception (plan §6): plateau tops no party eye is high enough to see.
        coveredAt: sight ? undefined : coveredOf(computed.map.data, Object.values(computed.tokens), viewer, computed.share),
        // The ground half of the same widening (`SceneVision.openGround`): in vision mode a
        // cell the party remembers is somewhere they may stand, room or no room. Built from
        // the *stored* record rather than the live sweep on purpose — walking out of your own
        // torchlight onto a path you crossed a minute ago is movement, not clairvoyance, and
        // it is the record the DM's brush writes into. Same eyes as `sight` above: the party's
        // for every command path, the seat's own where the table shares individually.
        openGround: openGroundOf(computed, viewer, (level) =>
          walks.gridFor(computed.map, computed.doors, read(computed.map.campaignId, 'crossings', NO_CROSSINGS), sceneId, level),
        ),
        // The half of the refusal that was never plugged in: `occupiable` is the BFS's
        // boolean, and without this the cause it discarded stayed discarded, so every move
        // a door refused came back as the generic "you can't move there".
        blockedEdge: (room) => blockedEdge(computed.doors, computed.map.doors, computed.party, room),
        // Table fix pass §2.3: solid things decide where a player's token stands and walks.
        walkRefusal: computed.map.frame
          ? (token, to, from) => {
              const levelId = levelOfToken(computed.map, token)
              const grid = walks.gridFor(
                computed.map,
                computed.doors,
                read(computed.map.campaignId, 'crossings', NO_CROSSINGS),
                sceneId,
                levelId,
              )
              if (!grid) return null
              return walkRefusal(
                {
                  grid,
                  known: knownCells(computed, viewer, grid, levelId),
                  heldDoor: (id) => computed.playerDoors.has(id),
                  doorLocked: (id) => computed.doors[id]?.locked === true,
                },
                from,
                to,
                SIZE_CELLS[token.size] ?? 1,
              )
            }
          : undefined,
      }
    },

    playerMap: (sceneId) => {
      const computed = compute(sceneId)
      return computed
        ? redactMapForViewer(computed.map, computed.fog, computed.doors, computed.ground, computed.openGround, computed.places)
        : null
    },

    revealDelta: (sceneId) => compute(sceneId)?.delta ?? null,

    visibleOf: (sceneId) => {
      const computed = compute(sceneId)
      return computed ? [...computed.visible] : null
    },

    partyHerePatch: (sceneId) => {
      const computed = compute(sceneId)
      if (!computed || fogModeOf(computed.fog) !== 'rooms' || !computed.map.frame) return null
      const { map, fog } = computed
      if (map.rooms.length === 0 && !hasHiddenGround(map.data)) return null
      const rows = new Set<string>()
      for (const token of Object.values(computed.tokens)) {
        if (token.hidden || !claimed(token)) continue
        const row = map.roomAt(token.x, token.y) ?? outdoorsRowOf(map.data, levelOfToken(map, token))
        if (!fog.rooms[row]?.wasEverRevealed) rows.add(row)
      }
      return rows.size ? { sceneId, rooms: [...rows] } : null
    },

    autoExplorePatch: (sceneId) => {
      const computed = compute(sceneId)
      if (!computed) return null
      const { fog, map } = computed
      // With fog off, or Auto-explore off, no sweep runs at all.
      if (!fogOn(fog) || !autoExploreOn(fog) || !map.frame) return null
      const frame = map.frame
      const crossings = read(map.campaignId, 'crossings', NO_CROSSINGS)
      const byLevel: Record<string, Cell[]> = {}
      // Every level some party eye stands on: a party split across floors clears both, each on
      // its own record.
      for (const levelId of computed.eyeLevels) {
        const sight = computed.clearSightOn(levelId)
        if (!sight.eyes.length) continue
        const mask = rebaseRegion(clearedOn(fog, levelId), frame)
        if (!mask) continue
        const grid = walks.gridFor(map, computed.doors, crossings, sceneId, levelId)
        const cells = clearedBy(sight, frame, computed.locks, (x, y) => !!grid && groundNear(grid, x, y))
        // The cheap diff: OR the sweep in and see whether a single byte moved.
        if (setCells(mask, cells).bits !== mask.bits) byLevel[levelId] = cells
      }
      return Object.keys(byLevel).length ? { sceneId, byLevel } : null
    },

    invalidateScene: (sceneId) => {
      invalidateSceneMap(sceneId)
      cache.delete(sceneId)
    },

    keptLightsOf: (sceneId) => {
      const computed = compute(sceneId)
      if (!computed) return null
      return new Set(computed.map.lights.map((l) => l.id).filter((id) => computed.playerChildren.has(id)))
    },

    keptRoomsOf: (sceneId) => compute(sceneId)?.explored ?? null,

    levelFilterOf: (sceneId, viewer) => {
      if (viewer.role === 'dm') return null
      const computed = compute(sceneId)
      const levels = computed?.map.data.levels ?? []
      if (!computed || levels.length <= 1) return null
      const first = firstLevelId(computed.map.data)
      const viewed = viewedLevel(computed.triggers, Object.values(computed.tokens), viewer, first)
      return (levelId) => onLevel(computed.map.data, { levelId }, viewed)
    },
  }
}

/**
 * Fog rework — the cells one level's party sight clears: every cell an eye's sweep covers that
 * the eye actually sees (in the dark, lit or within darkvision), outside every explore-lock zone,
 * on or within one cell of the level's ground. A lock stays the DM's to clear with the brush; the
 * one-cell band is where the wall art is drawn, and the void past it is nobody's ground.
 */
function clearedBy(
  sight: PartyVision,
  frame: NonNullable<SceneMap['frame']>,
  locks: ReturnType<typeof exploreLocks>,
  floor: (x: number, y: number) => boolean,
): Cell[] {
  const cells: Cell[] = []
  const counted = new Set<string>()
  for (const eye of sight.eyes) {
    for (const [col, row] of cellsCoveredByPolygon(eye.polygon, frame)) {
      const key = `${col},${row}`
      if (counted.has(key)) continue
      counted.add(key)
      const [x, y] = [frame.minX + col + 0.5, frame.minY + row + 0.5]
      if (!seen(sight, x, y) || inAnyLock(locks, x, y) || !floor(x, y)) continue
      cells.push([col, row])
    }
  }
  return cells
}

/**
 * Ground the table has opened, as a cell test — containment's fence (`SightFence.held`).
 *
 * Two sources, because the DM opens ground two ways: the cell record (their brush, plus
 * everything the party's own sight has already earned) and the rooms they have *revealed*.
 * A latched room (`re_hidden` — what a sweep leaves behind) is deliberately not held: the
 * cells the party actually saw are already in the record, and crediting the whole room would
 * hand them the far end of a hall they only glimpsed the mouth of. On a roomless map the room
 * term is empty and the fence is the record alone, which is #114's battlemap clip.
 *
 * ponytail: the mask is decoded once here rather than per probe (`getCell` decodes the whole
 * base64 on every call, and `swept` asks this of every cell in every eye's box) — the same shape
 * `groundOf` in redactMap.ts already takes.
 */
function heldIn(
  map: SceneMap,
  fog: SceneFog,
  stored: RegionMask | undefined,
): (x: number, y: number) => boolean {
  const region = map.frame ? regionFor(stored, map.frame) : undefined
  const bytes = region ? toBytes(region.bits) : undefined
  const revealed = new Set(
    Object.entries(fog.rooms)
      .filter(([, room]) => room.status === 'revealed')
      .map(([id]) => id),
  )
  // Table fix pass §2.5: a revealed Outdoors row holds the ground in no room.
  const outdoorsLit = [...revealed].some(isOutdoorsId)
  return (x, y) => {
    if (region && bytes) {
      const col = Math.floor(x - region.minX)
      const row = Math.floor(y - region.minY)
      if (col >= 0 && row >= 0 && col < region.cols && row < region.rows) {
        const bit = row * region.cols + col
        if ((bytes[bit >>> 3] & (1 << (bit & 7))) !== 0) return true
      }
    }
    if (revealed.size === 0) return false
    const room = map.roomAt(x, y)
    return room !== null ? revealed.has(room) : outdoorsLit
  }
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
  const layers = rooms.layers.map((layer) => ({ ...layer }))
  for (const layer of doors.layers) {
    const existing = layers.find((l) => l.id === layer.id)
    if (existing) {
      existing.children = [...existing.children, ...layer.children]
      existing.rooms = [...existing.rooms, ...layer.rooms]
    } else layers.push(layer)
  }
  // The second delta's own fields (its open ground) survive the merge too.
  return { ...doors, ...rooms, layers }
}

/**
 * `SceneVision.openGround` for a scene: table fix pass §2.2's known ground on the level the
 * viewer looks at — standable, and known by hand or by sight. Undefined with no walk grid.
 */
function openGroundOf(
  computed: Computed,
  viewer: Viewer | undefined,
  gridOn: (levelId: string) => WalkGrid | null,
): ((x: number, y: number) => boolean) | undefined {
  const first = firstLevelId(computed.map.data)
  const level = viewer ? viewedLevel(computed.triggers, Object.values(computed.tokens), viewer, first) : first
  const grid = gridOn(level)
  if (!grid) return undefined
  const known = knownCells(computed, viewer, grid, level)
  return (x, y) => {
    const i = cellAt(grid, x, y)
    return i >= 0 && grid.cell[i] === STANDABLE && known(i)
  }
}

/** The level a token stands on: its own when the map has it, else the map's first. */
function levelOfToken(map: SceneMap, token: Pick<Token, 'levelId'>): string {
  return map.data.levels?.some((l) => l.id === token.levelId) ? token.levelId! : firstLevelId(map.data)
}

/** Every level id of the map, in order; the first level's alone on a map with none. */
function levelIdsOf(map: SceneMap): string[] {
  return map.data.levels?.length ? map.data.levels.map((l) => l.id) : [firstLevelId(map.data)]
}

/** The Outdoors fog row of a level: one row on a one-level map, one per level otherwise. */
export function outdoorsRowOf(data: Pick<SerializedMapData, 'levels'>, levelId: string): string {
  return (data.levels?.length ?? 0) > 1 ? outdoorsId(levelId) : outdoorsId()
}

/** A stored cell record as a point test, decoded once (the shape `heldIn` takes). */
function recordTest(map: SceneMap, stored: RegionMask | undefined): (x: number, y: number) => boolean {
  const region = map.frame ? regionFor(stored, map.frame) : undefined
  const bytes = region ? toBytes(region.bits) : undefined
  if (!region || !bytes) return () => false
  return (x, y) => {
    const col = Math.floor(x - region.minX)
    const row = Math.floor(y - region.minY)
    if (col < 0 || row < 0 || col >= region.cols || row >= region.rows) return false
    const bit = row * region.cols + col
    return (bytes[bit >>> 3] & (1 << (bit & 7))) !== 0
  }
}

/**
 * §2.2 — known ground, per cell of a walk grid, memoised. By hand: the cell's room, or
 * Outdoors, is revealed. By sight, any of: the cell is in the record, in live sight, its room is
 * revealed, or it is outdoors and Outdoors is revealed. T10: revealed now, not ever, so ground
 * the DM hid again is no ground to walk on unless an eye sees it. The party's in party share,
 * the viewer's own seat in individual share.
 */
function knownCells(
  computed: Computed,
  viewer: Viewer | undefined,
  grid: WalkGrid,
  levelId: string,
): (i: number) => boolean {
  const { map, fog } = computed
  const memo = new Int8Array(grid.cols * grid.rows)
  const outdoors = outdoorsRowOf(map.data, levelId)
  const vision = fogModeOf(fog) === 'vision'
  const individual = !!viewer && viewer.role !== 'dm' && computed.share === 'individual'
  const inRecord = vision ? recordTest(map, individual ? identityRegion(fog, viewer!.identityId) : fog.region) : null
  const sight = vision ? (individual ? computed.sightFor(viewer!.identityId) : computed.sightOn(levelId)) : null
  const enclosed = enclosedOn(map, levelId)
  return (i) => {
    if (memo[i] !== 0) return memo[i] === 1
    const { x, y } = cellCentre(grid, i)
    const row = cellRow(map, enclosed, outdoors, x, y)
    const ok =
      (row !== null && fog.rooms[row]?.status === 'revealed') ||
      (inRecord !== null && inRecord(x, y)) ||
      (sight !== null && seen(sight, x, y))
    memo[i] = ok ? 1 : 2
    return ok
  }
}

/** How far round a cell's centre a room is looked for when the centre itself lies in none. */
const EDGE_PROBE = 0.25

/**
 * The fog row a walk cell counts in: its centre's room, else Outdoors. R2: a cell in no room is
 * Outdoors only outside every walled floor and cave outline; rock and the gap inside a cave's
 * outline are no room's. T12: a centre on a cave's very edge falls in the thin cut the edge
 * makes between the room faces, though the cell stands on the room's floor, as in a tunnel
 * under a cell wide; such a cell counts in the room a quarter cell round it.
 */
function cellRow(
  map: SceneMap,
  enclosed: (x: number, y: number) => boolean,
  outdoors: string,
  x: number,
  y: number,
): string | null {
  const room = map.roomAt(x, y)
  if (room !== null) return room
  if (!enclosed(x, y)) return outdoors
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0], [-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const near = map.roomAt(x + dx * EDGE_PROBE, y + dy * EDGE_PROBE)
    if (near !== null) return near
  }
  return null
}

/** A level's walk areas and the fog rows (rooms, and the level's Outdoors) each one touches. */
interface Areas {
  labels: Int32Array
  rows: Set<string>[]
}

const areaCache = new WeakMap<WalkGrid, Areas>()

/** Labels a grid once and names the rows of every area, kept with the grid it was cut from. */
function areasOf(map: SceneMap, grid: WalkGrid, levelId: string): Areas {
  const hit = areaCache.get(grid)
  if (hit) return hit
  const labels = walkAreas(grid)
  const rows: Set<string>[] = []
  const outdoors = outdoorsRowOf(map.data, levelId)
  const enclosed = enclosedOn(map, levelId)
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i]
    if (label < 0) continue
    const { x, y } = cellCentre(grid, i)
    const row = cellRow(map, enclosed, outdoors, x, y)
    const set = (rows[label] ??= new Set())
    if (row !== null) set.add(row)
  }
  const areas = { labels, rows }
  areaCache.set(grid, areas)
  return areas
}

/**
 * §2.6 — every row in a walk area some party token stands in; null when the scene has no walk
 * grid to flood (nothing drawn), which leaves the room graph to answer. A token on a cell that
 * is in no area (rock, or off the ground) still reaches its own row.
 */
function reachedRows(
  map: SceneMap,
  party: readonly Token[],
  gridOn: (levelId: string) => { grid: WalkGrid; areas: Areas } | null,
): Set<string> | null {
  if (!map.frame) return null
  const out = new Set<string>()
  for (const token of party) {
    const level = levelOfToken(map, token)
    const on = gridOn(level)
    if (!on) return null
    const i = cellAt(on.grid, token.x, token.y)
    const label = i >= 0 ? on.areas.labels[i] : -1
    if (label >= 0) for (const row of on.areas.rows[label]) out.add(row)
    else out.add(map.roomAt(token.x, token.y) ?? outdoorsRowOf(map.data, level))
  }
  return out
}

/**
 * §2.7 — the ground the table knows, as the redactor's `Ground` lookup: the cell record (as
 * before), and each outdoor ground cell (in no room) of a level whose Outdoors row is revealed. `outdoors` says whether any outdoor cell is known at all, which is when the seat is
 * owed the open ground.
 */
function knownGroundOf(
  map: SceneMap,
  fog: SceneFog,
  gridOn: (levelId: string) => WalkGrid | null,
): { test: Ground; outdoors: boolean } {
  const record = groundOf(fog, map.frame)
  const levels = (map.data.levels?.length ? map.data.levels.map((l) => l.id) : [firstLevelId(map.data)]).filter(
    (level) => fog.rooms[outdoorsRowOf(map.data, level)]?.status === 'revealed',
  )
  const grids = levels
    .map((level) => ({ grid: gridOn(level), enclosed: enclosedOn(map, level) }))
    .filter((g): g is { grid: WalkGrid; enclosed: (x: number, y: number) => boolean } => g.grid !== null)
  // R2: outdoor ground is a ground cell outside every walled floor and cave outline of its level.
  const outdoorCell = ({ grid, enclosed }: (typeof grids)[number], col: number, row: number): boolean => {
    if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return false
    if (grid.cell[row * grid.cols + col] === NO_GROUND_CELL) return false
    const [x, y] = [grid.minX + col + 0.5, grid.minY + row + 0.5]
    return map.roomAt(x, y) === null && !enclosed(x, y)
  }
  const outdoorsKnown: Ground = (x, y, pad) => {
    const reach = Math.ceil(pad)
    for (const entry of grids) {
      const { grid } = entry
      const col0 = Math.floor(x - grid.minX)
      const row0 = Math.floor(y - grid.minY)
      for (let col = col0 - reach; col <= col0 + reach; col++) {
        for (let row = row0 - reach; row <= row0 + reach; row++) {
          const [cx, cy] = [grid.minX + col, grid.minY + row]
          const dx = Math.max(cx - x, 0, x - (cx + 1))
          const dy = Math.max(cy - y, 0, y - (cy + 1))
          if (Math.hypot(dx, dy) <= pad && outdoorCell(entry, col, row)) return true
        }
      }
    }
    return false
  }
  const test: Ground = grids.length ? (x, y, pad) => record(x, y, pad) || outdoorsKnown(x, y, pad) : record
  return { test, outdoors: grids.length > 0 || recordHasOutdoorCell(map, fog) }
}

/** Whether the table's cell record holds any outdoor cell (R2: in no room, outside every outline) — known by sight. */
function recordHasOutdoorCell(map: SceneMap, fog: SceneFog): boolean {
  if (fogModeOf(fog) !== 'vision' || !map.frame) return false
  const region = tableRegion(fog, map.frame)
  if (!region) return false
  const bytes = toBytes(region.bits)
  const levels = map.data.levels?.length ? map.data.levels.map((l) => l.id) : [firstLevelId(map.data)]
  const enclosures = levels.map((level) => enclosedOn(map, level))
  for (let bit = 0; bit < region.cols * region.rows; bit++) {
    if ((bytes[bit >>> 3] & (1 << (bit & 7))) === 0) continue
    const col = bit % region.cols
    const row = (bit - col) / region.cols
    const [x, y] = [region.minX + col + 0.5, region.minY + row + 0.5]
    if (map.roomAt(x, y) === null && enclosures.some((enclosed) => !enclosed(x, y))) return true
  }
  return false
}

/** T11 — per level, the walk-grid cells of outdoor ground live sight sees now. */
type LiveOutdoors = ReadonlyMap<string, ReadonlySet<number>>
const NO_LIVE_OUTDOORS: LiveOutdoors = new Map()

/**
 * T11 — the outdoor ground cells (R2: ground, in no room, outside every outline) a party eye sees
 * now, per level. A token always sees its surroundings in By sight, so this ground is owed to the
 * seat however the record or the Outdoors row was reset (a Hide all with auto-explore off writes
 * nothing back). Only asked where it adds anything: every level when no outdoor ground is known
 * at all, else a ground-pieces level whose Outdoors row is not revealed.
 */
function seenOutdoorCells(
  map: SceneMap,
  fog: SceneFog,
  outdoorsKnown: boolean,
  levels: readonly string[],
  sightOn: (levelId: string) => PartyVision | null,
  gridOn: (levelId: string) => WalkGrid | null,
): LiveOutdoors {
  const frame = map.frame
  if (!frame) return NO_LIVE_OUTDOORS
  const out = new Map<string, Set<number>>()
  for (const levelId of levels) {
    const level = map.data.levels?.find((l) => l.id === levelId) ?? null
    const base = !!baseGroundOf(map.data.mapSettings, level)
    if (outdoorsKnown && (base || fog.rooms[outdoorsRowOf(map.data, levelId)]?.status === 'revealed')) continue
    const sight = sightOn(levelId)
    const grid = gridOn(levelId)
    if (!sight?.eyes.length || !grid) continue
    const enclosed = enclosedOn(map, levelId)
    const cells = new Set<number>()
    for (const eye of sight.eyes) {
      for (const [col, row] of cellsCoveredByPolygon(eye.polygon, frame)) {
        const [x, y] = [frame.minX + col + 0.5, frame.minY + row + 0.5]
        const i = cellAt(grid, x, y)
        if (i < 0 || cells.has(i) || grid.cell[i] === NO_GROUND_CELL) continue
        if (map.roomAt(x, y) !== null || enclosed(x, y) || !seen(sight, x, y)) continue
        cells.add(i)
      }
    }
    if (cells.size > 0) out.set(levelId, cells)
  }
  return out.size > 0 ? out : NO_LIVE_OUTDOORS
}

type Ring = [number, number][]

/** S3 — a level's open ground, kept with the walk grid it was cut from, keyed by what was known. */
const openGroundCache = new WeakMap<WalkGrid, { key: string; rings: Ring[] }>()
/** …and the whole-frame answer of a base-ground level, once per parsed map, so it keeps its identity. */
const wholeCache = new WeakMap<SceneMap, Map<string, Ring[]>>()

/**
 * §2.7 — per level, the open ground a seat is owed, as rings read even-odd.
 *
 * On a level with base ground every outdoor cell is ground, so it is the frame with the level's
 * walled floors as holes, as it always was. S3: elsewhere (ground pieces only) it is the known
 * outdoor ground cells — all of them once the level's Outdoors row is revealed, else the record's
 * by sight, and (T11) the ones live sight sees now — unioned, grown by the band pad and cut by
 * the zoned walled floors and caves. So the empty frame and a cave's rock far from any known
 * ground stay under the fog.
 */
function openGroundRings(
  map: SceneMap,
  fog: SceneFog,
  gridOn: (levelId: string) => WalkGrid | null,
  live: LiveOutdoors = NO_LIVE_OUTDOORS,
): NonNullable<SerializedMapData['openGround']> {
  const f = map.frame!
  const frameRing: Ring = [
    [f.minX, f.minY],
    [f.maxX, f.minY],
    [f.maxX, f.maxY],
    [f.minX, f.maxY],
  ]
  const levels = map.data.levels?.length ? map.data.levels.map((l) => l.id) : [firstLevelId(map.data)]
  const region = fogModeOf(fog) === 'vision' ? tableRegion(fog, f) : undefined
  const inRecord = recordTest(map, region)
  return levels.map((levelId) => {
    let byLevel = wholeCache.get(map)
    if (!byLevel) wholeCache.set(map, (byLevel = new Map()))
    let wholeRings = byLevel.get(levelId)
    if (!wholeRings) byLevel.set(levelId, (wholeRings = [frameRing, ...enclosureRings(map, levelId).flat()]))
    const whole = { levelId, rings: wholeRings }
    const level = map.data.levels?.find((l) => l.id === levelId) ?? null
    const grid = gridOn(levelId)
    if (baseGroundOf(map.data.mapSettings, level) || !grid) return whole
    const outdoorsKnown = fog.rooms[outdoorsRowOf(map.data, levelId)]?.status === 'revealed'
    const pad = bandPad(map)
    const seenNow = live.get(levelId)
    const key = `${outdoorsKnown}|${pad}|${region?.bits ?? ''}|${seenNow ? [...seenNow].join(',') : ''}`
    const hit = openGroundCache.get(grid)
    if (hit && hit.key === key) return { levelId, rings: hit.rings }
    const enclosed = enclosedOn(map, levelId)
    const known = (i: number): boolean => {
      if (seenNow?.has(i)) return true
      if (grid.cell[i] === NO_GROUND_CELL) return false
      const { x, y } = cellCentre(grid, i)
      return map.roomAt(x, y) === null && !enclosed(x, y) && (outdoorsKnown || inRecord(x, y))
    }
    // One rectangle per run of known cells along a row, then one union: cheap at frame scale.
    const runs: Ring[] = []
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        if (!known(row * grid.cols + col)) continue
        const start = col
        while (col + 1 < grid.cols && known(row * grid.cols + col + 1)) col++
        const [x0, x1, y0, y1] = [grid.minX + start, grid.minX + col + 1, grid.minY + row, grid.minY + row + 1]
        runs.push([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])
      }
    }
    // P7: grown, then held to the frame. The pad buys back a wall band at a cave's edge; at the
    // map's edge it would hand the seat open ground out in the void.
    const grown = runs.length
      ? clipper2Engine.intersection(clipper2Engine.inflate(clipper2Engine.union(runs, []), pad), [frameRing])
      : []
    const rings = grown.length ? (clipper2Engine.difference(grown, zonedEnclosureRings(map, levelId)) as Ring[]) : []
    openGroundCache.set(grid, { key, rings })
    return { levelId, rings }
  })
}

/** Whether a point's cell, or one of the eight round it, is ground on this grid. */
function groundNear(grid: WalkGrid, x: number, y: number): boolean {
  const col = Math.floor(x - grid.minX)
  const row = Math.floor(y - grid.minY)
  for (let r = row - 1; r <= row + 1; r++) {
    for (let c = col - 1; c <= col + 1; c++) {
      if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) continue
      if (grid.cell[r * grid.cols + c] !== NO_GROUND_CELL) return true
    }
  }
  return false
}
