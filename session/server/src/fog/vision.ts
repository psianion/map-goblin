// What the fog rules answer, for the whole server: the ground the players have, where a
// player token may stand, the map a player is allowed to hold, and the geometry a clear just
// handed over (§2.3).
//
// Per mutation, never per message or per frame (§4): every answer for a scene is computed
// once and kept until something writes module state. `ModuleStateStore` counts its writes, so the revision it is at *is* the cache key
// — there is no invalidation hook anywhere to forget to call.

import {
  doorsOfScene,
  type AuthoredDoor,
  type DoorLiveState,
  type DoorsState,
} from '@dnd/mechanics/doors'
import {
  autoExploreOn,
  cellsCoveredByPolygon,
  clearedOn,
  fogOn,
  rebaseRegion,
  sceneFogOf,
  setCells,
  toBytes,
  type AutoExploreByLevel,
  type Cell,
  type FogState,
  type RegionMask,
  type SceneFog,
} from '@dnd/mechanics/fog'
import {
  roomEditsOf,
  sceneTriggersOf,
  viewedLevel,
  type SceneTriggers,
  type TriggersState,
} from '@dnd/mechanics/triggers'
import {
  NO_GROUND as NO_GROUND_CELL,
  SIZE_CELLS,
  cellCentre,
  eyes,
  walkRefusal,
  type SceneVision,
  type Token,
  type TokensState,
  type WalkGrid,
} from '@dnd/mechanics/tokens'
import type { CrossingsState } from '@dnd/mechanics/crossings'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the Lighting pass's level rules, pure
import { firstLevelId, onLevel } from '@dnd/core/src/shared/visionGate'
import type { Viewer } from '@dnd/mechanics/contract'
import type { MapDelta } from '@dnd/core/src/shared/protocol'
import type { SerializedMapData } from '@dnd/core/src/store/types'
import type { Stores } from '../db/stores'
import {
  childDeltaFor,
  keptChildIds,
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
import { enclosedOn, enclosureRings, zonedEnclosureRings } from './outdoorGround'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the Clipper wrapper the server already boots (clipperBoot.ts)
import { clipper2Engine } from '@dnd/core/src/geometry/Clipper2Engine'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: floor-piece predicates, pure
import { baseGroundOf } from '@dnd/core/src/shared/pieces'
import {
  createSweeps,
  exploreLocks,
  inAnyLock,
  seen,
  type PartyVision,
} from './sweep'

/** Everything the rest of the server asks the fog. One implementation, wired at boot. */
export interface Vision {
  /** The room ids of a scene's map — what a starting room may name (`openSession`). */
  roomsOf(campaignId: string, sceneId: string): readonly string[]
  /** Backs `fogModule`'s region commands — the rectangle a region cell is counted from. */
  frameOf(campaignId: string, sceneId: string): SceneMap['frame']
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
  /** Backs `tokensModule` — redaction (D7) and `canOccupy` (D8). */
  visionOf(sceneId: string, viewer?: Viewer): SceneVision | null
  /** The map GET's player path (D4). Null when the map is unknown or will not parse. */
  playerMap(sceneId: string): SerializedMapData | null
  /** The scene's parsed map, raw — triggers' prep resolver (M4) reuses this cache rather
   *  than parsing the map doc a second time. */
  sceneMapOf: SceneMapOf
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
  /** Every level some party eye stands on — what auto-explore sweeps. */
  eyeLevels: string[]
  /**
   * Fog rework — the party's sight on one level as Auto-explore takes it: each eye swept at its
   * own sight range, walls and closed doors blocking, lit or dark alike, no fence.
   */
  clearSightOn(levelId: string): PartyVision
  /**
   * Fog rework — whether a point's cell is cleared on a level: true everywhere with fog off.
   * Decoded once per level and revision.
   */
  clearedAt(levelId: string): (x: number, y: number) => boolean
  /** The scene's triggers state, for the viewed-level rule. */
  triggers: SceneTriggers
  tokens: Record<string, Token>
  /** §5's zones, read once: Auto-explore never clears inside one. */
  locks: ReturnType<typeof exploreLocks>
  doors: Record<string, DoorLiveState>
  /** Rooms whose geometry the player holds (D4): every room with fog off, else the cleared ones. */
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
  /** §2.7 — ground the players have, as the redactor's lookup. */
  ground: Ground
  /** §2.7 — the ground outside the walled floors, once any outdoor cell is the players'. */
  openGround: SerializedMapData['openGround']
}

const NO_FOG: FogState = { byScene: {} }
const NO_DOORS: DoorsState = { byScene: {} }
const NO_TOKENS: TokensState = { library: {}, byScene: {} }
/** No triggers state yet ⇒ no relights and no ambient dial: `sceneTriggersOf` reads daylight. */
const NO_TRIGGERS: TriggersState = { byScene: {} }
const NO_ONES_DOORS: ReadonlySet<string> = new Set()
const NO_CROSSINGS: CrossingsState = { byScene: {} }

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
    const fog = sceneFogOf(read(campaignId, 'fog', NO_FOG), sceneId)
    const crossings = read(campaignId, 'crossings', NO_CROSSINGS)
    const gridOn = (levelId: string): WalkGrid | null => walks.gridFor(map, doors, crossings, sceneId, levelId)
    // The sweep is taken once per mutation and cached with the rest: auto-explore reads it.
    const triggers = sceneTriggersOf(read(campaignId, 'triggers', NO_TRIGGERS), sceneId)
    const eyeLevels = [...new Set(eyes(Object.values(tokens)).map((t) => levelOfToken(map, t)))]
    const clearing = new Map<string, PartyVision>()
    const clearSightOn = (levelId: string): PartyVision => {
      let own = clearing.get(levelId)
      if (!own) {
        own = sweeps.partyVision(map, tokens, doors, levelId)
        clearing.set(levelId, own)
      }
      return own
    }
    const on = fogOn(fog)
    const decoded = new Map<string, (x: number, y: number) => boolean>()
    const clearedAt = (levelId: string): ((x: number, y: number) => boolean) => {
      if (!on) return ALL_CLEARED
      let own = decoded.get(levelId)
      if (!own) decoded.set(levelId, (own = cellTest(map, clearedOn(fog, levelId))))
      return own
    }

    const explored = heldRooms(map, fog)
    // The DM's live room places: a stand-in carries its room's (it has lost the real id the
    // table's override is keyed by), and a moved place re-sends the stand-ins a seat holds.
    const places: Places = Object.fromEntries(
      Object.entries(roomEditsOf(triggers)).flatMap(([id, edit]) => (edit.place ? [[id, edit.place]] : [])),
    )
    const placesKey = JSON.stringify(places)
    const ground = groundOf(fog, map.frame)
    // §2.7: the open ground is what the players' fog is cut by, so it travels only with fog on,
    // once an outdoor cell is cleared on some level.
    const openGround =
      map.frame && on && clearsOutdoors(map, fog)
        ? openGroundRings(map, gridOn, clearedAt, (levelId) => clearedOn(fog, levelId)?.bits ?? '')
        : undefined
    // Against nothing on a cold cache, so the first answer after a restart is everything
    // the party has explored rather than nothing at all. Correctness must not depend on
    // whether someone happened to fetch the map first, and a client already holding a
    // room's geometry loses nothing by being handed it again.
    const revealed = [...explored].filter((room) => !previous?.explored.has(room))
    // Cut once per mutation, not once per viewer: every player at the table is owed the same
    // rooms, and the slice is the expensive half of a reveal. A room that leaves `explored`
    // goes by the seat's re-fetch instead.
    const roomDelta = revealed.length ? mapDeltaFor(map, sceneId, revealed, doors, explored, places) : null
    // …and the same question asked of every *child*, which is what a clear that moves no room
    // at all still owes: a `reveal-secret`, whose door child was cut while it was a secret (D2),
    // and cleared ground, whose art (the band along it, the shrubs at its edge) becomes the
    // player's the moment the cell clears.
    //
    // Diffed off the same predicate the document cut uses (`keptChildIds`), so what a clear
    // *delivers* and what a fresh fetch *contains* cannot drift. Anything the room slice already
    // carried is dropped — it is the same child, sliced twice.
    const playerChildren = keptChildIds(map, fog, doors, ground)
    const carried = new Set(roomDelta?.layers.flatMap((l) => l.children.map((c) => c.id)) ?? [])
    const newChildren = new Set(
      [...playerChildren].filter((id) => !previous?.playerChildren.has(id) && !carried.has(id)),
    )
    // The open ground arrives with the mutation that first lets the seat have any of it, and again
    // whenever a level's rings change (they grow with the ground cleared).
    const groundMoved =
      !!openGround && (!previous?.openGround || openGround.some((g, i) => g.rings !== previous.openGround?.[i]?.rings))
    const groundDelta: MapDelta | null = groundMoved ? { sceneId, layers: [], openGround } : null
    // A live place the DM moved reaches the stand-ins a seat holds the way a reveal does.
    const placeDelta =
      previous && previous.placesKey !== placesKey ? standInDeltaFor(map, sceneId, fog, doors, ground, places) : null
    const next: Computed = {
      revision: stores.moduleState.revision,
      map,
      fog,
      eyeLevels,
      clearSightOn,
      clearedAt,
      triggers,
      tokens,
      locks: exploreLocks(map.zones),
      doors,
      explored,
      // The doors a player may hold are the door children the map cut ships, so the live slice
      // and the geometry name one set of doors and not two.
      playerDoors: new Set(map.doors.filter((door) => playerChildren.has(door.id)).map((door) => door.id)),
      playerChildren,
      ground,
      openGround,
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
    roomsOf: (_campaignId, sceneId) => sceneMapOf(sceneId)?.rooms.map((room) => room.id) ?? [],
    frameOf: (_campaignId, sceneId) => sceneMapOf(sceneId)?.frame ?? null,
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

    // Fog rework §2.4 — one answer for every scene, fog on or off, rooms or none: a token is
    // sent when it stands on ground the players have (`known`), and a player's token walks only
    // over it. With fog off that is everywhere, so the walk grid alone decides.
    visionOf: (sceneId) => {
      const computed = compute(sceneId)
      if (!computed) return null
      const { map } = computed
      const first = firstLevelId(map.data)
      const levelOf = (levelId: string | undefined): string =>
        levelId && map.data.levels?.some((l) => l.id === levelId) ? levelId : first
      return {
        roomAt: (x, y) => map.roomAt(x, y),
        known: (levelId, x, y) => computed.clearedAt(levelOf(levelId))(x, y),
        walkRefusal: map.frame
          ? (token, to, from) => {
              const levelId = levelOfToken(map, token)
              const grid = walks.gridFor(
                map,
                computed.doors,
                read(map.campaignId, 'crossings', NO_CROSSINGS),
                sceneId,
                levelId,
              )
              if (!grid) return null
              return walkRefusal(
                {
                  grid,
                  known: knownCells(grid, computed.clearedAt(levelId)),
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
 * the eye actually sees (in the dark as in daylight), outside every explore-lock zone,
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

/** Fog off: every point is cleared. */
const ALL_CLEARED = (): boolean => true

/** A stored cell record as a point test on the current frame, decoded once. */
function cellTest(map: SceneMap, stored: RegionMask | undefined): (x: number, y: number) => boolean {
  const region = map.frame && stored ? rebaseRegion(stored, map.frame) : undefined
  if (!region) return () => false
  const bytes = toBytes(region.bits)
  return (x, y) => {
    const col = Math.floor(x - region.minX)
    const row = Math.floor(y - region.minY)
    if (col < 0 || row < 0 || col >= region.cols || row >= region.rows) return false
    const bit = row * region.cols + col
    return (bytes[bit >>> 3] & (1 << (bit & 7))) !== 0
  }
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

/** The level a token stands on: its own when the map has it, else the map's first. */
function levelOfToken(map: SceneMap, token: Pick<Token, 'levelId'>): string {
  return map.data.levels?.some((l) => l.id === token.levelId) ? token.levelId! : firstLevelId(map.data)
}

/** Every level id of the map, in order; the first level's alone on a map with none. */
function levelIdsOf(map: SceneMap): string[] {
  return map.data.levels?.length ? map.data.levels.map((l) => l.id) : [firstLevelId(map.data)]
}

/** Fog rework — a walk grid's cells the players have, as `walkRefusal`'s `known`, memoised. */
function knownCells(grid: WalkGrid, cleared: (x: number, y: number) => boolean): (i: number) => boolean {
  const memo = new Int8Array(grid.cols * grid.rows)
  return (i) => {
    if (memo[i] !== 0) return memo[i] === 1
    const { x, y } = cellCentre(grid, i)
    const ok = cleared(x, y)
    memo[i] = ok ? 1 : 2
    return ok
  }
}

/** Whether any level's cleared record holds an outdoor cell (R2: in no room, outside every outline). */
function clearsOutdoors(map: SceneMap, fog: SceneFog): boolean {
  if (!map.frame) return false
  for (const [levelId, stored] of Object.entries(fog.cleared ?? {})) {
    const region = rebaseRegion(stored, map.frame)
    if (!region) continue
    const bytes = toBytes(region.bits)
    const enclosed = enclosedOn(map, levelId)
    for (let bit = 0; bit < region.cols * region.rows; bit++) {
      if ((bytes[bit >>> 3] & (1 << (bit & 7))) === 0) continue
      const col = bit % region.cols
      const row = (bit - col) / region.cols
      const [x, y] = [region.minX + col + 0.5, region.minY + row + 0.5]
      if (map.roomAtOn(levelId, x, y) === null && !enclosed(x, y)) return true
    }
  }
  return false
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
 * walled floors as holes, as it always was. Elsewhere (ground pieces only) it is the level's
 * cleared outdoor ground cells, unioned, grown by the band pad and cut by the zoned walled floors and caves. So the empty
 * frame and a cave's rock far from any cleared ground stay under the fog.
 */
function openGroundRings(
  map: SceneMap,
  gridOn: (levelId: string) => WalkGrid | null,
  clearedAt: (levelId: string) => (x: number, y: number) => boolean,
  /** What the level's cleared ground is, as a cache key. */
  keyOf: (levelId: string) => string,
): NonNullable<SerializedMapData['openGround']> {
  const f = map.frame!
  const frameRing: Ring = [
    [f.minX, f.minY],
    [f.maxX, f.minY],
    [f.maxX, f.maxY],
    [f.minX, f.maxY],
  ]
  return levelIdsOf(map).map((levelId) => {
    let byLevel = wholeCache.get(map)
    if (!byLevel) wholeCache.set(map, (byLevel = new Map()))
    let wholeRings = byLevel.get(levelId)
    if (!wholeRings) byLevel.set(levelId, (wholeRings = [frameRing, ...enclosureRings(map, levelId).flat()]))
    const whole = { levelId, rings: wholeRings }
    const level = map.data.levels?.find((l) => l.id === levelId) ?? null
    const grid = gridOn(levelId)
    if (baseGroundOf(map.data.mapSettings, level) || !grid) return whole
    const pad = bandPad(map)
    const key = `${pad}|${keyOf(levelId)}`
    const hit = openGroundCache.get(grid)
    if (hit && hit.key === key) return { levelId, rings: hit.rings }
    const cleared = clearedAt(levelId)
    const enclosed = enclosedOn(map, levelId)
    const known = (i: number): boolean => {
      if (grid.cell[i] === NO_GROUND_CELL) return false
      const { x, y } = cellCentre(grid, i)
      return map.roomAtOn(levelId, x, y) === null && !enclosed(x, y) && cleared(x, y)
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
