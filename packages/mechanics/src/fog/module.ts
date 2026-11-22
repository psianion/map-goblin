// The fog module (§2.2, D1). Every command is DM-only — fog is the DM's instrument, and
// role gating is data the registry checks before the handler runs, so what is left here is
// the extra validation: the room must be one the map actually has, and `hide` only applies
// to a room the party has already seen.
//
// Rooms live in the map file, not in module state, so the module is built with a lookup
// the server backs with its map store — the same shape `scenesModule(stores)` uses.

import { dropScene, type GameModule, type ModuleContext, type Viewer } from '../contract'
import { FOG_LAYER_TYPES, FOG_LOOK_PRESETS, FOG_LOOK_RANGES, type FogLayer, type FogLook } from '@dnd/core/src/shared/fogLook.ts'
import { actorOf, logged, type LogAction, type LogEntry } from '../log'
import { ID_MAX, Reject, bad, bool, num, obj, oneOf, str } from '../tokens/validate'
import {
  REGION_CELL_MAX,
  clearCells,
  fillRegion,
  nearAuthoredFloor,
  orRegion,
  rebaseRegion,
  regionFor,
  setCells,
  toBytes,
  type Cell,
  type Frame,
  type RegionMask,
} from './region'
import {
  FOG_BRUSH_OPS,
  FOG_MODES,
  clearedOn,
  PARTY_HERE,
  ROOM_FOG_STATUSES,
  VISION_SHARES,
  fogModeOf,
  identityRegion,
  isOutdoorsId,
  roomFogOf,
  sceneFogOf,
  tableRegion,
  visionShareOf,
  type FogState,
  type RoomFog,
  type SceneFog,
  type VisionShare,
} from './types'

export * from './light'
export * from './region'
export * from './types'
export * from './visibility'

/** The room ids of a scene's map — corridors included, they are rooms (D6). */
export type SceneRooms = (campaignId: string, sceneId: string) => readonly string[]

/**
 * The scene's cell-snapped confining rectangle, which is what a region cell is counted from.
 * Injected rather than imported: measuring it needs the map document, and mechanics does not
 * read files (D2/D3). Null for a scene with no map, which is a scene with no region either.
 */
export type SceneFrame = (campaignId: string, sceneId: string) => Frame | null

/**
 * The room a world point falls in, or null for unzoned map (D6). Injected for the reason
 * {@link SceneFrame} is: the polygons live in the map document, and mechanics reads no files.
 */
export type SceneRoomAt = (
  campaignId: string,
  sceneId: string,
  x: number,
  y: number,
) => string | null

/**
 * Table fix pass §2.7 — the room and Outdoors ids a player seat may see right now, computed by
 * the server, which sends them on the fog slice (`SceneFog.visible`). Null = nothing to say.
 */
export type SceneVisible = (sceneId: string, viewer: Viewer) => readonly string[] | null

/**
 * Table fix pass §2.1 / §2.5 — whether a world point is ground, or within one cell of it, on any
 * level: what the record may hold away from rooms. Injected like {@link SceneRoomAt}.
 */
export type SceneGroundAt = (campaignId: string, sceneId: string, x: number, y: number) => boolean

/**
 * T10 — the fog rows a player holds right now, computed by the server (the rooms whose geometry
 * the seat is sent). Null = no map to judge by, and the slice falls back to {@link heldRow}.
 */
export type SceneHeld = (sceneId: string) => ReadonlySet<string> | null

/**
 * Fog rework — the level ids of a scene's map, which key the cleared record. Injected like
 * {@link SceneFrame}. Empty for a scene with no map.
 */
export type SceneLevels = (campaignId: string, sceneId: string) => readonly string[]

/**
 * Fog rework — whether a world point is ground, or within one cell of it, on one level: what the
 * brush's `clear` may open there. Injected like {@link SceneGroundAt}.
 */
export type SceneFloorOn = (campaignId: string, sceneId: string, levelId: string, x: number, y: number) => boolean

/** T10 — held without a map to judge by: revealed now, or in By sight latched by the record. */
const heldRow = (scene: SceneFog, room: RoomFog): boolean =>
  room.status === 'revealed' || (fogModeOf(scene) === 'vision' && room.wasEverRevealed)

const REGION_OPS = ['reveal', 'hide'] as const

type Ctx = ModuleContext<FogState>
type Payload = Record<string, unknown>

export function fogModule(
  roomsOf: SceneRooms,
  frameOf: SceneFrame = () => null,
  roomAtOf: SceneRoomAt = () => null,
  visibleOf: SceneVisible = () => null,
  groundAtOf: SceneGroundAt = () => false,
  heldOf: SceneHeld = () => null,
  levelsOf: SceneLevels = () => [],
  floorOnOf: SceneFloorOn = () => false,
): GameModule<FogState> {
  const cells: CellLookups = { frameOf, levelsOf, floorOnOf }
  return {
    name: 'fog',
    commands: {
      'set-on': ['dm'],
      'clear-all': ['dm'],
      'fog-all': ['dm'],
      restore: ['dm'],
      reveal: ['dm'],
      hide: ['dm'],
      reset: ['dm'],
      'set-bulk': ['dm'],
      'set-conceal': ['dm'],
      'set-mode': ['dm'],
      'set-share': ['dm'],
      'set-auto-explore': ['dm'],
      'set-range-limit': ['dm'],
      'set-containment': ['dm'],
      'set-fog-look': ['dm'],
      'open-map': ['dm'],
      'region-set': ['dm'],
      // `auto-explore` is deliberately absent: it is the server's own write (the sweep a
      // token move earned), reachable only through `dispatchInternal`, exactly the way
      // `triggers.event` is. Leaving it out of this map *is* its access control.
    },
    initialState: { byScene: {} },
    forgetScene: dropScene,

    handler(action, payload, ctx) {
      try {
        const p = obj(payload ?? {}, 'payload')
        if (!runCleared(action, p, ctx, cells)) run(action, p, ctx, roomsOf, frameOf, roomAtOf, groundAtOf)
      } catch (err) {
        if (err instanceof Reject) return { code: err.code, message: err.message }
        throw err
      }
    },

    // D4: a player is told about the rooms they hold and nothing else. Never-revealed rooms
    // are absent whole — their ids and their *count* are exactly what must not leak, so a
    // status field would not be enough. Idempotent: re-filtering drops nothing new.
    // T10: held is now, not ever — a room the DM hid again leaves the slice (and the seat
    // re-fetches its cut when one does), so its id goes where its geometry goes.
    //
    // The vision-mode fields ride the spread whole (mode, share, autoExplore, region): the
    // first three are settings the client has to render the same way the DM set them, and
    // the region is presentation memory of cells the party themselves swept — low-secret by
    // construction, and P2's mask is the thing that needs it. Rooms filtering is unchanged.
    //
    // P5 does the *viewer mapping* here and nowhere else: in `'individual'` share this
    // viewer's own record becomes the `region` field they already read, and `regions` — every
    // other seat's memory, and the mere fact of who is at the table — is stripped whole. Every
    // other seat's record must never be on this wire, so filtering it down would not do; and
    // because the mapping lands on the field the mask already reads, no client code changes.
    redact(state, viewer) {
      if (viewer.role === 'dm') return state
      const byScene: FogState['byScene'] = {}
      for (const [sceneId, scene] of Object.entries(state.byScene)) {
        const rooms: Record<string, RoomFog> = {}
        const held = heldOf(sceneId)
        for (const [roomId, fog] of Object.entries(scene.rooms)) {
          if (held ? held.has(roomId) : heldRow(scene, fog)) rooms[roomId] = fog
        }
        // Stripped in *both* shares: a table the DM flipped back to party still holds the
        // per-seat records (nothing is ever destroyed), and they are nobody's but the DM's.
        const { regions, ...rest } = scene
        const seen = visibleOf(sceneId, viewer)
        const kept: SceneFog = seen ? { ...rest, rooms, visible: [...seen] } : { ...rest, rooms }
        byScene[sceneId] =
          regions && visionShareOf(scene) === 'individual'
            ? { ...kept, region: identityRegion(scene, viewer.identityId) }
            : kept
      }
      // Same rule as the rooms: a line about a room is readable exactly when the room is,
      // so a reveal in a wing the party has never entered is not on this wire at all. A
      // line naming no room (Reveal All, Hide All, reset) is the whole map changing under
      // everyone at once — there is nothing in it a player cannot already see.
      return {
        ...state,
        byScene,
        log: state.log?.filter(
          (e) => !e.targetId || byScene[e.sceneId]?.rooms[e.targetId] !== undefined,
        ),
      }
    },
  }
}

function run(
  action: string,
  p: Payload,
  ctx: Ctx,
  roomsOf: SceneRooms,
  frameOf: SceneFrame,
  roomAtOf: SceneRoomAt,
  groundAtOf: SceneGroundAt,
): void {
  const sceneId = sceneOf(p, ctx)
  const scene = sceneFogOf(ctx.state, sceneId)
  switch (action) {
    case 'reveal': {
      const id = roomId(p, ctx, sceneId, roomsOf)
      return setRooms(
        ctx,
        sceneId,
        scene,
        { ...scene.rooms, [id]: { status: 'revealed', wasEverRevealed: true } },
        { action: 'revealed-room', targetId: id },
      )
    }
    case 'hide': {
      const id = roomId(p, ctx, sceneId, roomsOf)
      if (!roomFogOf(scene, id).wasEverRevealed) bad('a room nobody has seen cannot be hidden')
      // T10: Hide fogs the room fully again, so its cells leave the record too.
      return setScene(
        ctx,
        sceneId,
        {
          ...scene,
          ...forgetRows(scene, [id], ctx, sceneId, frameOf, roomAtOf),
          rooms: { ...scene.rooms, [id]: { status: 're_hidden', wasEverRevealed: true } },
        },
        { action: 'hid-room', targetId: id },
      )
    }
    case 'reset': {
      // A true reset: the latch goes too, so the scene is indistinguishable from a fresh one.
      // Which means the cell memory goes with it — the party's record *and* every seat's. A
      // reset that left those standing would hand a "fresh" vision scene back with the whole
      // dungeon still washed on the DM's overlay and still remembered on every player's mask,
      // which is the one thing the word cannot mean. A rooms-mode scene carries neither field,
      // so this is byte-for-byte the write it always was there.
      const { region, regions, ...rest } = scene
      return setScene(ctx, sceneId, { ...rest, rooms: {} }, { action: 'reset-fog' })
    }
    case 'set-bulk': {
      const rooms = parseRooms(p.rooms, ctx, sceneId, roomsOf)
      // T10: Hide all says `forget`, and every row it leaves unrevealed leaves the record as well
      // (Outdoors too, which a sweep records without latching). An undo does not say it, so
      // taking back a Reveal all leaves the swept ground where it was.
      const hidden = roomsOf(ctx.campaignId, sceneId).filter((id) => rooms[id]?.status !== 'revealed')
      const forgotten =
        p.forget !== undefined && bool(p.forget, 'forget') ? forgetRows(scene, hidden, ctx, sceneId, frameOf, roomAtOf) : {}
      return setScene(ctx, sceneId, { ...scene, ...forgotten, rooms }, {
        action: bulkAction(rooms, roomsOf(ctx.campaignId, sceneId).length),
      })
    }
    case 'set-conceal':
      return setScene(ctx, sceneId, {
        ...scene,
        concealBehindDoors: bool(p.concealBehindDoors, 'concealBehindDoors'),
      })
    // Neither record is touched by a flip: the rooms the party explored and the cells they
    // swept both survive a scene going back and forth between the two modes, so a DM trying
    // token vision out mid-session loses nothing by changing their mind.
    case 'set-mode': {
      const mode = oneOf(p.mode, FOG_MODES, 'mode')
      // A roomless map used to be refused here, because the token redactor's `canSee` was
      // only wired for a scene that has rooms and every token would have shipped to every
      // player the moment the DM flipped the switch. That hole is plugged at its source now
      // (`vision.ts`'s `visionOf` answers a roomless vision scene instead of bailing), and
      // the refusal was the only thing left between a DM and the map that needs this most:
      // an imported battlemap, which has no traced rooms and never will. Vision mode counts
      // cells, not rooms, and a map with no rooms is made entirely of cells the brush paints.
      return setScene(ctx, sceneId, { ...scene, mode })
    }
    case 'set-share': {
      const visionShare = oneOf(p.visionShare, VISION_SHARES, 'visionShare')
      return setScene(ctx, sceneId, { ...scene, visionShare, ...shareMerge(scene, visionShare) })
    }
    case 'set-auto-explore':
      return setScene(ctx, sceneId, {
        ...scene,
        autoExplore: bool(p.autoExplore, 'autoExplore'),
      })
    // No log line, for the reason `set-conceal` and `set-auto-explore` have none: it changes
    // how the referee measures sight, not what the party has seen, and the table reads the
    // difference on the map itself.
    case 'set-range-limit':
      return setScene(ctx, sceneId, {
        ...scene,
        sightRangeLimit: bool(p.sightRangeLimit, 'sightRangeLimit'),
      })
    // No log line either, and for the same reason: it changes how far the referee lets sight
    // reach, not what the party has seen, and the table reads the difference on the map.
    case 'set-containment':
      return setScene(ctx, sceneId, {
        ...scene,
        containedSight: bool(p.containedSight, 'containedSight'),
      })
    // No log line, same reason as `set-containment`: this changes how the cloud looks, not
    // what the party has seen, and every seat renders its own copy of it. `{ look: null }`
    // clears the override back to the map's authored default (`fogLookOf`); the object form
    // is field-by-field, so a single slider drag sends just the field it moved.
    // A patch merges into the override already on the scene: the panel sends only the
    // field it moved (one dial per debounce window), so replacing the whole override with
    // the patch would drop every earlier pick — a base colour set a moment before a layer
    // tint went back to the map's default. `null` is the one payload that clears.
    case 'set-fog-look': {
      const look = parseFogLook(p.look)
      return setScene(ctx, sceneId, { ...scene, look: look ? { ...scene.look, ...look } : undefined })
    }
    // P3 — "players see everything", as one command because it is one act. Contained sight
    // is fenced by two records at once (the rooms a player holds and the cells the table has
    // opened), so opening only one of them opens nothing: revealed rooms with an empty record
    // still fence live sight to the rooms, and a full record on unshipped geometry has nothing
    // to sit on. Two commands would also be two writes, two broadcasts and a window in
    // between where the table is half-open.
    case 'open-map': {
      const rooms: Record<string, RoomFog> = {}
      for (const id of roomsOf(ctx.campaignId, sceneId)) {
        rooms[id] = { status: 'revealed', wasEverRevealed: true }
      }
      // No `frameFor` here, so no refusal: a scene with no map to measure, and a frame past
      // `REGION_CELL_MAX`, both keep no cell memory at all — there is nothing to fill and the
      // room reveals are the whole of what opening that map can mean. Refusing instead would
      // leave the DM's one "open it all" button dead on exactly the maps it is loudest on.
      // `auto-explore` treats the same frame the same way.
      const frame = frameOf(ctx.campaignId, sceneId)
      const region = frame ? regionFor(scene.region, frame) : undefined
      return setScene(
        ctx,
        sceneId,
        {
          ...scene,
          rooms,
          ...(region ? { region: fillRegion(region) } : {}),
          // Every seat's own record too, for the reason a DM brush stroke lands on all of
          // them (`region-set`): this is the table being opened, not one player's memory.
          ...(scene.regions && frame ? { regions: paintAll(scene.regions, frame, fillRegion) } : {}),
        },
        // The same line Reveal All writes, because it is the same sentence — "revealed the
        // whole map" — and this is the one that actually earns it in vision mode.
        { action: 'revealed-all' },
      )
    }
    case 'region-set': {
      const frame = frameFor(ctx, sceneId, frameOf)
      const region = regionFor(scene.region, frame)
      if (!region) bad('that scene is too large to keep region memory for')
      const cells = parseCells(p.cells, region)
      const op = oneOf(p.op, REGION_OPS, 'op')
      // A brush may only open ground the map authors, plus the one-cell band its wall art sits
      // on (`nearAuthoredFloor`). The cells that fall past that are dropped from the write
      // rather than refusing the whole stroke: a DM
      // dragging a rect over a chamber is aiming at the chamber, and making them trace its
      // outline to be allowed to paint it would be a refusal for the shape of their gesture.
      // What the record must not carry is ground nobody can stand on — the write is where that
      // is enforced, not the aim.
      //
      // `hide` is deliberately unfiltered: a record written before this rule still holds
      // off-floor cells, and the DM's eraser is the one hand that can take them back.
      const brushed =
        op === 'reveal' ? brushReveal(scene, region, cells, ctx, sceneId, roomsOf, roomAtOf, groundAtOf) : null
      const paint = (mask: RegionMask): RegionMask =>
        brushed ? setCells(mask, brushed.cells) : clearCells(mask, cells)
      // A brush stroke is a reveal-shaped DM act like the room buttons are, so it reads back
      // in the table log the same way. `changed-fog` and no targetId: it names cells rather
      // than a room, which is also what makes it a whole-scene line every seat may read.
      return setScene(
        ctx,
        sceneId,
        {
          ...scene,
          region: paint(region),
          // P5 — a DM stroke is for the table, so it lands on every record the scene keeps and
          // not only the party's: a reveal nobody could see, or a hide that left the cells
          // standing on four seats, would be a brush that does not brush. There is no
          // per-player targeting (a stated non-goal), which is why this needs no `viewer`.
          // A scene with no per-identity records — every party-mode table — spreads nothing.
          ...(scene.regions ? { regions: paintAll(scene.regions, frame, paint) } : {}),
          // …and the rooms those cells fall in have to *ship*, or the brush paints memory
          // onto geometry the player was never handed and the wash has nothing to sit on
          // (P2 §1 clips it to what they hold). The latch is all it does: `re_hidden` washes
          // no room whole, so what a player sees is the cells the DM painted and not the
          // room around them. `hide` never un-ships — geometry a player holds is theirs (D4).
          rooms: brushed ? brushed.rooms : scene.rooms,
        },
        { action: 'changed-fog' },
      )
    }
    // Server-internal (see `commands` above): the region cells and rooms one party sweep
    // just earned, applied as ONE write so persistence, the broadcast, D5's geometry delta
    // and the retract re-sends all ride the path a DM's own reveal rides.
    case 'auto-explore': {
      // Undefined region = a scene past `REGION_CELL_MAX`, which keeps no cell memory at
      // all. The room reveals still land: those are what decide the geometry a player holds.
      const frame = frameFor(ctx, sceneId, frameOf)
      const region = regionFor(scene.region, frame)
      const cells = region ? parseCells(p.cells, region) : []
      // P5 — the same write, per identity, in `'individual'` share: the referee sends the
      // cells *each* seat's own eyes earned and each lands in that seat's own record. Absent
      // in party share, which is every table until a DM says otherwise, so the payload and
      // the write below are byte-identical there.
      const byIdentity = parseByIdentity(p.byIdentity, region)
      let regions = scene.regions
      for (const [identityId, own] of byIdentity) {
        const base = regionFor(identityRegion(scene, identityId), frame)
        if (!base) continue
        regions = { ...regions, [identityId]: setCells(base, own) }
      }
      const rooms = { ...scene.rooms }
      // The same latch the brush leaves (`shipRooms`), for the same reason: the room has to
      // ship or the swept cells have no geometry to sit on, and `revealed` — which washes the
      // room whole on the player's canvas — is the DM's word, not the sweep's. Already latched
      // is left as it stands, so a sweep can never undo a DM's reveal or a DM's re-hide.
      for (const id of parseRoomIds(p.rooms, ctx, sceneId, roomsOf)) {
        if (rooms[id]?.wasEverRevealed) continue
        rooms[id] = { status: 're_hidden', wasEverRevealed: true }
      }
      // ponytail: no log line. A DM's reveal is an act worth reading back; the map opening
      // as the party walks is the map, and a line per step would bury the acts under it.
      return setScene(ctx, sceneId, {
        ...scene,
        region: region && setCells(region, cells),
        ...(regions ? { regions } : {}),
        rooms,
      })
    }
    // Server-internal, like `auto-explore` (table fix pass §2.6): By hand mode reveals the room,
    // or Outdoors, that a player's token or a PC is put in, and stores it. One write for every
    // row named; a row already lit is left alone, so standing still writes nothing.
    case PARTY_HERE: {
      const rooms = { ...scene.rooms }
      let changed = false
      for (const id of parseRoomIds(p.rooms, ctx, sceneId, roomsOf)) {
        if (rooms[id]?.status === 'revealed') continue
        rooms[id] = { status: 'revealed', wasEverRevealed: true }
        changed = true
      }
      if (changed) setScene(ctx, sceneId, { ...scene, rooms })
      return
    }
    default:
      bad(`fog has no action '${action}'`)
  }
}

/** What the cleared record's commands measure a scene by. */
interface CellLookups {
  frameOf: SceneFrame
  levelsOf: SceneLevels
  floorOnOf: SceneFloorOn
}

/**
 * Fog rework — the commands of the one model: the switch, the brush, the two bulk acts, their
 * undo, and the party's own sight. True when `action` was one of them; false hands it to the
 * old handler, which still answers the commands the current client sends until they go.
 *
 * Every write re-bases each level's record onto the current frame first (`rebaseRegion`), so
 * a republish that moved the map keeps cleared ground where it was on the map.
 */
function runCleared(action: string, p: Payload, ctx: Ctx, cells: CellLookups): boolean {
  switch (action) {
    case 'set-on': {
      const sceneId = sceneOf(p, ctx)
      const scene = sceneFogOf(ctx.state, sceneId)
      const on = bool(p.on, 'on')
      // Only turning it on needs a record to play by; turning it off always works.
      if (on && !rebaseRegion(undefined, frameFor(ctx, sceneId, cells.frameOf))) {
        bad('that scene is too large to fog: it is over 512 by 512 cells')
      }
      setScene(ctx, sceneId, { ...scene, on }, { action: on ? 'turned-fog-on' : 'turned-fog-off' })
      return true
    }
    case 'region-set': {
      // The old strokes (`reveal` / `hide`) still go to the old handler.
      if (!(FOG_BRUSH_OPS as readonly unknown[]).includes(p.op)) return false
      const sceneId = sceneOf(p, ctx)
      const scene = sceneFogOf(ctx.state, sceneId)
      const frame = frameFor(ctx, sceneId, cells.frameOf)
      const levelId = levelOf(p, ctx, sceneId, cells)
      const op = oneOf(p.op, FOG_BRUSH_OPS, 'op')
      const mask = rebaseRegion(clearedOn(scene, levelId), frame)
      if (!mask) bad('that scene is too large to keep fog for')
      const stroke = parseCells(p.cells, mask)
      // `clear` opens only ground the level has, plus the one-cell band its wall art sits on;
      // the rest of the stroke is dropped rather than refused, since the DM aims at a chamber,
      // not at its outline. `fog` is unfiltered: covering void costs nothing.
      const next =
        op === 'clear'
          ? setCells(
              mask,
              stroke.filter(([col, row]) =>
                cells.floorOnOf(ctx.campaignId, sceneId, levelId, mask.minX + col + 0.5, mask.minY + row + 0.5),
              ),
            )
          : clearCells(mask, stroke)
      setScene(ctx, sceneId, withCleared(scene, { ...scene.cleared, [levelId]: next }), { action: 'changed-fog' })
      return true
    }
    case 'clear-all': {
      const sceneId = sceneOf(p, ctx)
      const scene = sceneFogOf(ctx.state, sceneId)
      const empty = rebaseRegion(undefined, frameFor(ctx, sceneId, cells.frameOf))
      if (!empty) bad('that scene is too large to keep fog for')
      // One byte fill per level rather than a floor walk: cells off the ground are never stood
      // on or drawn, so a full record and a floor-only one show the players the same map.
      const cleared: Record<string, RegionMask> = {}
      for (const levelId of cells.levelsOf(ctx.campaignId, sceneId)) cleared[levelId] = fillRegion(empty)
      setScene(ctx, sceneId, withCleared(scene, cleared), { action: 'cleared-all' })
      return true
    }
    case 'fog-all': {
      const sceneId = sceneOf(p, ctx)
      const scene = sceneFogOf(ctx.state, sceneId)
      setScene(ctx, sceneId, withCleared(scene, {}), { action: 'fogged-all' })
      return true
    }
    case 'restore': {
      const sceneId = sceneOf(p, ctx)
      const scene = sceneFogOf(ctx.state, sceneId)
      const frame = frameFor(ctx, sceneId, cells.frameOf)
      const levels = cells.levelsOf(ctx.campaignId, sceneId)
      const cleared: Record<string, RegionMask> = {}
      for (const [levelId, raw] of Object.entries(obj(p.cleared, 'cleared'))) {
        oneOf(levelId, levels, 'cleared key')
        const mask = rebaseRegion(parseMask(raw, `cleared.${levelId}`), frame)
        if (mask) cleared[levelId] = mask
      }
      setScene(ctx, sceneId, withCleared(scene, cleared), { action: 'changed-fog' })
      return true
    }
    case 'auto-explore': {
      // The old payload (`cells`, `rooms`, `byIdentity`) still goes to the old handler.
      if (p.byLevel === undefined) return false
      const sceneId = sceneOf(p, ctx)
      const scene = sceneFogOf(ctx.state, sceneId)
      const frame = frameFor(ctx, sceneId, cells.frameOf)
      const levels = cells.levelsOf(ctx.campaignId, sceneId)
      const cleared = { ...scene.cleared }
      for (const [levelId, raw] of Object.entries(obj(p.byLevel, 'byLevel'))) {
        oneOf(levelId, levels, 'byLevel key')
        const mask = rebaseRegion(cleared[levelId], frame)
        if (!mask) continue
        cleared[levelId] = setCells(mask, parseCells(raw, mask))
      }
      // No log line: the map opening as the party walks is the map, not an act to read back.
      setScene(ctx, sceneId, withCleared(scene, cleared))
      return true
    }
    default:
      return false
  }
}

/** The scene with its cleared record replaced; an empty record is stored as none. */
function withCleared(scene: SceneFog, cleared: Record<string, RegionMask>): SceneFog {
  const { cleared: _old, ...rest } = scene
  return Object.keys(cleared).length > 0 ? { ...rest, cleared } : rest
}

/** The level a brush stroke names: one the scene's map has. */
function levelOf(p: Payload, ctx: Ctx, sceneId: string, cells: CellLookups): string {
  return oneOf(p.levelId, cells.levelsOf(ctx.campaignId, sceneId), 'levelId')
}

/**
 * A cell record off the wire (`restore`): four whole numbers and bits of exactly the length they
 * call for, so a hand-made record cannot write past its own grid.
 */
function parseMask(value: unknown, field: string): RegionMask {
  const o = obj(value, field)
  const whole = (v: unknown, name: string): number => {
    const n = num(v, `${field}.${name}`)
    if (!Number.isInteger(n)) bad(`${field}.${name} must be a whole number`)
    return n
  }
  const [minX, minY, cols, rows] = [whole(o.minX, 'minX'), whole(o.minY, 'minY'), whole(o.cols, 'cols'), whole(o.rows, 'rows')]
  if (cols < 0 || rows < 0 || cols * rows > REGION_CELL_MAX) bad(`${field} is not a cell record this scene can hold`)
  const bits = typeof o.bits === 'string' ? o.bits : bad(`${field}.bits must be a string`)
  let length: number
  try {
    length = toBytes(bits).length
  } catch {
    bad(`${field}.bits must be base64`)
  }
  if (length !== Math.ceil((cols * rows) / 8)) bad(`${field}.bits does not fit ${cols} by ${rows} cells`)
  return { minX, minY, cols, rows, bits }
}

/**
 * What a `reveal` stroke actually writes: the cells of it that land on or beside authored floor, and
 * the room record they leave behind — every room a newly revealed cell falls in, latched so
 * its geometry travels, and nothing else touched. A room the party has already seen keeps
 * whatever status it is at: a brush must not re-light a room the DM re-hid.
 *
 * Both answers come out of one pass because both ask the same question of the same cell.
 * `roomAtOf` is a point-in-polygon walk over every room on the map, so a 60×60 stroke on a
 * twelve-room map is ~43k of them in one synchronous handler — and now every cell pays it,
 * because the filter has to look at the ones the latch loop used to be able to skip. The
 * early exit it lost (stop once every room is latched) was only ever the second stroke's
 * saving; this is the first stroke's cost, paid on every stroke.
 *
 * ponytail: the upgrade, if a DM ever feels a big stroke, is a cell→room index on the scene
 * map (the caller's side of `SceneRoomAt`) — one lookup instead of a room walk, for all three
 * consumers of the floor predicate at once, not a cache in here.
 */
function brushReveal(
  scene: SceneFog,
  region: RegionMask,
  cells: readonly Cell[],
  ctx: Ctx,
  sceneId: string,
  roomsOf: SceneRooms,
  roomAtOf: SceneRoomAt,
  groundAtOf: SceneGroundAt,
): { cells: Cell[]; rooms: Record<string, RoomFog> } {
  const authored = roomsOf(ctx.campaignId, sceneId)
  const unlatched = new Set(authored.filter((id) => !scene.rooms[id]?.wasEverRevealed))
  let rooms = scene.rooms
  const kept: Cell[] = []
  const roomAt = (x: number, y: number): string | null => roomAtOf(ctx.campaignId, sceneId, x, y)
  for (const [col, row] of cells) {
    const [x, y] = [region.minX + col + 0.5, region.minY + row + 0.5]
    const id = roomAt(x, y)
    // The floor test and the ship test, in that order: a cell past the wall band is not painted
    // at all, so it can latch nothing either. The latch stays on the *strict* room under the
    // cell — a band cell is in no room and ships none, and the stroke's interior cells are what
    // latch the room its band belongs to.
    // `id` already answers the centre, so a cell well inside a room never pays the band scan.
    // Table fix pass §2.5: outdoor ground (and its one-cell band) is as much the record's as a
    // room's floor, so a DM can brush open ground in vision mode.
    if (
      id === null &&
      !groundAtOf(ctx.campaignId, sceneId, x, y) &&
      !nearAuthoredFloor(authored.length, roomAt, x, y)
    )
      continue
    kept.push([col, row])
    // `delete` is the guard as well as the bookkeeping: false means the cell landed on a room
    // the map does not author, on none at all (a roomless map, where every cell is floor), or
    // on one already latched.
    if (!id || !unlatched.delete(id)) continue
    rooms = { ...rooms, [id]: { status: 're_hidden', wasEverRevealed: true } }
  }
  return { cells: kept, rooms }
}

/**
 * What a share flip does to the two records: it merges them, in whichever direction it is
 * going, and destroys neither (P5 §1). A DM trying individual vision out mid-session and
 * changing their mind back an hour later loses nothing either way.
 *
 * party → individual: everything the table already remembers becomes every seat's own
 * starting point. Only the records that exist need the OR — a seat with none reads the party
 * record through `identityRegion` and is seeded by the same fact.
 *
 * individual → party: every seat's memory becomes the table's, and every seat *keeps* its
 * own, so flipping back hands each of them their own record again rather than the union.
 */
function shareMerge(scene: SceneFog, share: VisionShare): Pick<SceneFog, 'region' | 'regions'> {
  const { region, regions } = scene
  if (!regions) return { region, regions }
  if (share === 'individual') {
    if (!region) return { region, regions }
    const seeded: Record<string, RegionMask> = {}
    for (const [id, mask] of Object.entries(regions)) seeded[id] = orRegion(mask, region)
    return { region, regions: seeded }
  }
  return { region: tableRegion(scene), regions }
}

/** One brush stroke applied to every per-identity record, each in the current frame. */
/**
 * T10 — what Hide does to the cell record: every cell of the hidden rows leaves the party's
 * record and every seat's. A room takes the cells inside it and its one-cell wall band (cells in
 * no room beside it); an Outdoors row takes every cell in no room. Nothing changes on a scene
 * that keeps no record or has no map to place a cell by.
 */
function forgetRows(
  scene: SceneFog,
  rows: readonly string[],
  ctx: Ctx,
  sceneId: string,
  frameOf: SceneFrame,
  roomAtOf: SceneRoomAt,
): Pick<SceneFog, 'region' | 'regions'> {
  const frame = frameOf(ctx.campaignId, sceneId)
  if (!frame || rows.length === 0 || (!scene.region && !scene.regions)) return {}
  const hidden = new Set(rows)
  const outdoors = rows.some(isOutdoorsId)
  const inHidden = (x: number, y: number): boolean => {
    const id = roomAtOf(ctx.campaignId, sceneId, x, y)
    return id !== null && hidden.has(id)
  }
  const forgets = (x: number, y: number): boolean => {
    if (roomAtOf(ctx.campaignId, sceneId, x, y) !== null) return inHidden(x, y)
    if (outdoors) return true
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) if (inHidden(x + dx, y + dy)) return true
    }
    return false
  }
  // Every record is normalised to the same frame (`regionFor`), so a bit is one cell in all of them.
  const memo = new Map<number, boolean>()
  const forget = (mask: RegionMask): RegionMask => {
    const bytes = toBytes(mask.bits)
    const cells: Cell[] = []
    for (let bit = 0; bit < mask.cols * mask.rows; bit++) {
      if ((bytes[bit >>> 3] & (1 << (bit & 7))) === 0) continue
      const col = bit % mask.cols
      const row = (bit - col) / mask.cols
      let hit = memo.get(bit)
      if (hit === undefined) memo.set(bit, (hit = forgets(mask.minX + col + 0.5, mask.minY + row + 0.5)))
      if (hit) cells.push([col, row])
    }
    return cells.length ? clearCells(mask, cells) : mask
  }
  const region = scene.region && regionFor(scene.region, frame)
  return {
    ...(region ? { region: forget(region) } : {}),
    ...(scene.regions ? { regions: paintAll(scene.regions, frame, forget) } : {}),
  }
}

function paintAll(
  regions: Record<string, RegionMask>,
  frame: Frame,
  paint: (mask: RegionMask) => RegionMask,
): Record<string, RegionMask> {
  const next: Record<string, RegionMask> = {}
  for (const [id, mask] of Object.entries(regions)) {
    // Undefined = this scene keeps no cell memory at all any more (past `REGION_CELL_MAX`),
    // in which case the record it used to keep is not one to carry forward either.
    const current = regionFor(mask, frame)
    if (current) next[id] = paint(current)
  }
  return next
}

/**
 * `auto-explore`'s per-identity half off the wire — `{ identityId: [[col, row], …] }`.
 *
 * Server-internal like the command itself (`dispatchInternal`; see `commands` above), and
 * validated anyway: this parses the same bounds-checked cells the party payload does, because
 * "nothing untrusted reaches it today" is a property of the caller and not of this handler.
 */
function parseByIdentity(value: unknown, region: RegionMask | undefined): Array<[string, Cell[]]> {
  if (value === undefined) return []
  return Object.entries(obj(value, 'byIdentity')).map(([id, cells]) => [
    str(id, 'byIdentity key', ID_MAX),
    region ? parseCells(cells, region) : [],
  ])
}

function frameFor(ctx: Ctx, sceneId: string, frameOf: SceneFrame): Frame {
  const frame = frameOf(ctx.campaignId, sceneId)
  if (!frame) bad('that scene has no map to measure cells against')
  return frame
}

/** `[col, row]` pairs off the wire, bounds-checked against the mask they are about to hit. */
function parseCells(value: unknown, region: RegionMask): Cell[] {
  if (!Array.isArray(value)) bad('cells must be an array of [col, row] pairs')
  return value.map((raw, i): Cell => {
    if (!Array.isArray(raw) || raw.length !== 2) bad(`cells[${i}] must be [col, row]`)
    const col = num(raw[0], `cells[${i}][0]`)
    const row = num(raw[1], `cells[${i}][1]`)
    if (!Number.isInteger(col) || !Number.isInteger(row)) bad(`cells[${i}] must be whole cells`)
    if (col < 0 || row < 0 || col >= region.cols || row >= region.rows) {
      bad(`cells[${i}] is outside the scene`)
    }
    return [col, row]
  })
}

/** Room ids off the wire — the same "the map actually has it" check every reveal makes. */
function parseRoomIds(
  value: unknown,
  ctx: Ctx,
  sceneId: string,
  roomsOf: SceneRooms,
): readonly string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) bad('rooms must be an array of room ids')
  const known = new Set(roomsOf(ctx.campaignId, sceneId))
  return value.map((raw, i) => {
    const id = str(raw, `rooms[${i}]`, ID_MAX)
    if (!known.has(id)) bad(`no room '${id}' in that scene`)
    return id
  })
}

/** Payload scene, else the table's active scene; a command with neither is nonsense. */
function sceneOf(p: Payload, ctx: Ctx): string {
  const sceneId = p.sceneId === undefined ? ctx.activeSceneId : str(p.sceneId, 'sceneId', ID_MAX)
  if (!sceneId) bad('no sceneId in the payload and no active scene')
  return sceneId
}

function roomId(p: Payload, ctx: Ctx, sceneId: string, roomsOf: SceneRooms): string {
  const id = str(p.roomId, 'roomId', ID_MAX)
  if (!roomsOf(ctx.campaignId, sceneId).includes(id)) bad(`no room '${id}' in that scene`)
  return id
}

/** D9's Reveal All / Hide All / undo: a whole record off the wire, so parse all of it. */
function parseRooms(
  value: unknown,
  ctx: Ctx,
  sceneId: string,
  roomsOf: SceneRooms,
): Record<string, RoomFog> {
  const known = new Set(roomsOf(ctx.campaignId, sceneId))
  const rooms: Record<string, RoomFog> = {}
  for (const [id, raw] of Object.entries(obj(value, 'rooms'))) {
    if (!known.has(id)) bad(`no room '${id}' in that scene`)
    const fog = obj(raw, `rooms.${id}`)
    const status = oneOf(fog.status, ROOM_FOG_STATUSES, `rooms.${id}.status`)
    const wasEverRevealed = bool(fog.wasEverRevealed, `rooms.${id}.wasEverRevealed`)
    // The latch is not optional history: a seen room cannot arrive claiming it never was.
    if (status !== 'never_revealed' && !wasEverRevealed) {
      bad(`rooms.${id}.status '${status}' needs wasEverRevealed`)
    }
    rooms[id] = { status, wasEverRevealed }
  }
  return rooms
}

// `set-fog-look` (D7). No clamp helper exists in `tokens/validate` — every numeric field of
// `FogLook` gets its own range check here, by hand, against the bounds the plan settled on.
const HEX_COLOR = /^#[0-9a-f]{6}$/i

function hexColor(v: unknown, field: string): string {
  const s = str(v, field, 7)
  if (!HEX_COLOR.test(s)) bad(`${field} must be a #rrggbb colour`)
  return s
}

function ranged(v: unknown, field: string, { min, max }: { min: number; max: number }): number {
  const n = num(v, field)
  if (n < min || n > max) bad(`${field} must be between ${min} and ${max}`)
  return n
}

function parseFogLayer(v: unknown, i: number): FogLayer {
  const o = obj(v, `look.layers[${i}]`)
  return {
    type: oneOf(o.type, FOG_LAYER_TYPES, `look.layers[${i}].type`),
    tint: hexColor(o.tint, `look.layers[${i}].tint`),
    strength: ranged(o.strength, `look.layers[${i}].strength`, FOG_LOOK_RANGES.strength),
    scale: ranged(o.scale, `look.layers[${i}].scale`, FOG_LOOK_RANGES.scale),
    speed: ranged(o.speed, `look.layers[${i}].speed`, FOG_LOOK_RANGES.speed),
    angle: ranged(o.angle, `look.layers[${i}].angle`, FOG_LOOK_RANGES.angle),
  }
}

function parseFogLayers(v: unknown): [FogLayer, FogLayer, FogLayer] {
  if (!Array.isArray(v) || v.length !== 3) bad('look.layers must be exactly 3 layers')
  return [parseFogLayer(v[0], 0), parseFogLayer(v[1], 1), parseFogLayer(v[2], 2)]
}

/**
 * The DM's live override, or the clear signal. `null` is the whole payload — clears `look`
 * back to the map's authored default. The object form validates only the fields it carries
 * (every one of `FogLook` is optional here), so a slider debounced client-side can send just
 * the field it moved without re-sending the rest of the cloud.
 */
function parseFogLook(v: unknown): Partial<FogLook> | null {
  if (v === null) return null
  const o = obj(v, 'look')
  const out: Partial<FogLook> = {}
  if (o.preset !== undefined) out.preset = oneOf(o.preset, FOG_LOOK_PRESETS, 'look.preset')
  if (o.base !== undefined) out.base = hexColor(o.base, 'look.base')
  if (o.layers !== undefined) out.layers = parseFogLayers(o.layers)
  if (o.wind !== undefined) out.wind = ranged(o.wind, 'look.wind', FOG_LOOK_RANGES.wind)
  if (o.fade !== undefined) out.fade = ranged(o.fade, 'look.fade', FOG_LOOK_RANGES.fade)
  if (o.veil !== undefined) out.veil = ranged(o.veil, 'look.veil', FOG_LOOK_RANGES.veil)
  if (o.glow !== undefined) out.glow = ranged(o.glow, 'look.glow', FOG_LOOK_RANGES.glow)
  if (o.heavy !== undefined) out.heavy = bool(o.heavy, 'look.heavy')
  return out
}

/**
 * Which of D9's two buttons this was. `set-bulk` is the wire form of Reveal All, Hide All
 * *and* the undo that puts a mixture back, and only the result can tell them apart — the
 * payload is the same shape for all three.
 */
function bulkAction(rooms: Record<string, RoomFog>, total: number): LogAction {
  const lit = Object.values(rooms).filter((room) => room.status === 'revealed').length
  if (lit === 0) return 'hid-all'
  return lit === total ? 'revealed-all' : 'changed-fog'
}

type Line = Omit<LogEntry, 'id' | 'at' | 'sceneId' | 'actor'>

function setRooms(
  ctx: Ctx,
  sceneId: string,
  scene: SceneFog,
  rooms: Record<string, RoomFog>,
  line: Line,
): void {
  setScene(ctx, sceneId, { ...scene, rooms }, line)
}

/** `line` omitted = a change the table has no business reading about (`set-conceal`). */
function setScene(ctx: Ctx, sceneId: string, scene: SceneFog, line?: Line): void {
  ctx.setState({
    ...ctx.state,
    byScene: { ...ctx.state.byScene, [sceneId]: scene },
    log: line ? logged(ctx.state.log, { ...line, actor: actorOf(ctx), sceneId }) : ctx.state.log,
  })
}
