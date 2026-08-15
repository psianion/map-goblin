// The fog module (§2.2, D1). Every command is DM-only — fog is the DM's instrument, and
// role gating is data the registry checks before the handler runs, so what is left here is
// the extra validation: the room must be one the map actually has, and `hide` only applies
// to a room the party has already seen.
//
// Rooms live in the map file, not in module state, so the module is built with a lookup
// the server backs with its map store — the same shape `scenesModule(stores)` uses.

import type { GameModule, ModuleContext } from '../contract'
import { actorOf, logged, type LogAction, type LogEntry } from '../log'
import { ID_MAX, Reject, bad, bool, num, obj, oneOf, str } from '../tokens/validate'
import { clearCells, regionFor, setCells, type Cell, type Frame, type RegionMask } from './region'
import {
  FOG_MODES,
  ROOM_FOG_STATUSES,
  VISION_SHARES,
  roomFogOf,
  sceneFogOf,
  type FogState,
  type RoomFog,
  type SceneFog,
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

const REGION_OPS = ['reveal', 'hide'] as const

type Ctx = ModuleContext<FogState>
type Payload = Record<string, unknown>

export function fogModule(
  roomsOf: SceneRooms,
  frameOf: SceneFrame = () => null,
  roomAtOf: SceneRoomAt = () => null,
): GameModule<FogState> {
  return {
    name: 'fog',
    commands: {
      reveal: ['dm'],
      hide: ['dm'],
      reset: ['dm'],
      'set-bulk': ['dm'],
      'set-conceal': ['dm'],
      'set-mode': ['dm'],
      'set-share': ['dm'],
      'set-auto-explore': ['dm'],
      'region-set': ['dm'],
      // `auto-explore` is deliberately absent: it is the server's own write (the sweep a
      // token move earned), reachable only through `dispatchInternal`, exactly the way
      // `triggers.event` is. Leaving it out of this map *is* its access control.
    },
    initialState: { byScene: {} },

    handler(action, payload, ctx) {
      try {
        run(action, obj(payload ?? {}, 'payload'), ctx, roomsOf, frameOf, roomAtOf)
      } catch (err) {
        if (err instanceof Reject) return { code: err.code, message: err.message }
        throw err
      }
    },

    // D4: a player is told about the rooms they have seen and nothing else. Never-revealed
    // rooms are absent whole — their ids and their *count* are exactly what must not leak,
    // so a status field would not be enough. Idempotent: re-filtering drops nothing new.
    //
    // The vision-mode fields ride the spread whole (mode, share, autoExplore, region): the
    // first three are settings the client has to render the same way the DM set them, and
    // the region is presentation memory of cells the party themselves swept — low-secret by
    // construction, and P2's mask is the thing that needs it. Rooms filtering is unchanged.
    redact(state, viewer) {
      if (viewer.role === 'dm') return state
      const byScene: FogState['byScene'] = {}
      for (const [sceneId, scene] of Object.entries(state.byScene)) {
        const rooms: Record<string, RoomFog> = {}
        for (const [roomId, fog] of Object.entries(scene.rooms)) {
          if (fog.wasEverRevealed) rooms[roomId] = fog
        }
        byScene[sceneId] = { ...scene, rooms }
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
      return setRooms(
        ctx,
        sceneId,
        scene,
        { ...scene.rooms, [id]: { status: 're_hidden', wasEverRevealed: true } },
        { action: 'hid-room', targetId: id },
      )
    }
    case 'reset':
      // A true reset: the latch goes too, so the scene is indistinguishable from a fresh one.
      return setRooms(ctx, sceneId, scene, {}, { action: 'reset-fog' })
    case 'set-bulk': {
      const rooms = parseRooms(p.rooms, ctx, sceneId, roomsOf)
      return setRooms(ctx, sceneId, scene, rooms, {
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
      // A map with no detected rooms redacts nothing in vision mode: the token redactor's
      // `canSee` is only wired for a scene that has rooms, so every token on a roomless map
      // would ship to every player the moment the DM flipped the switch. Refusing is the
      // honest answer — the DM is told the map is not ready rather than shown a mode that
      // silently does nothing.
      if (mode === 'vision' && roomsOf(ctx.campaignId, sceneId).length === 0) {
        bad('token vision needs a map with detected rooms — this scene has none')
      }
      return setScene(ctx, sceneId, { ...scene, mode })
    }
    case 'set-share':
      return setScene(ctx, sceneId, {
        ...scene,
        visionShare: oneOf(p.visionShare, VISION_SHARES, 'visionShare'),
      })
    case 'set-auto-explore':
      return setScene(ctx, sceneId, {
        ...scene,
        autoExplore: bool(p.autoExplore, 'autoExplore'),
      })
    case 'region-set': {
      const region = regionFor(scene.region, frameFor(ctx, sceneId, frameOf))
      if (!region) bad('that scene is too large to keep region memory for')
      const cells = parseCells(p.cells, region)
      const op = oneOf(p.op, REGION_OPS, 'op')
      // A brush stroke is a reveal-shaped DM act like the room buttons are, so it reads back
      // in the table log the same way. `changed-fog` and no targetId: it names cells rather
      // than a room, which is also what makes it a whole-scene line every seat may read.
      return setScene(
        ctx,
        sceneId,
        {
          ...scene,
          region: op === 'reveal' ? setCells(region, cells) : clearCells(region, cells),
          // …and the rooms those cells fall in have to *ship*, or the brush paints memory
          // onto geometry the player was never handed and the wash has nothing to sit on
          // (P2 §1 clips it to what they hold). The latch is all it does: `re_hidden` washes
          // no room whole, so what a player sees is the cells the DM painted and not the
          // room around them. `hide` never un-ships — geometry a player holds is theirs (D4).
          rooms:
            op === 'reveal'
              ? shipRooms(scene, region, cells, ctx, sceneId, roomsOf, roomAtOf)
              : scene.rooms,
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
      const region = regionFor(scene.region, frameFor(ctx, sceneId, frameOf))
      const cells = region ? parseCells(p.cells, region) : []
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
        rooms,
      })
    }
    default:
      bad(`fog has no action '${action}'`)
  }
}

/**
 * The room record a brush stroke leaves behind: every room a newly revealed cell lands in,
 * latched so its geometry travels, and nothing else touched. A room the party has already
 * seen keeps whatever status it is at — a brush must not re-light a room the DM re-hid.
 *
 * `roomAtOf` is a point-in-polygon walk over every room on the map, so the naive loop is one
 * of those per brushed cell: a 60×60 stroke on a twelve-room map is ~43k of them in one
 * synchronous handler. `unlatched` is the whole answer — the loop exists to latch rooms, and
 * once there is none left to latch there is nothing to look up.
 *
 * ponytail: the ceiling left is the first big stroke on a fresh map, which still pays a
 * lookup per cell until it has touched every room. The upgrade there is a cell→room index on
 * the scene map (the caller's side of `SceneRoomAt`), not a cache in here.
 */
function shipRooms(
  scene: SceneFog,
  region: RegionMask,
  cells: readonly Cell[],
  ctx: Ctx,
  sceneId: string,
  roomsOf: SceneRooms,
  roomAtOf: SceneRoomAt,
): Record<string, RoomFog> {
  const unlatched = new Set(
    roomsOf(ctx.campaignId, sceneId).filter((id) => !scene.rooms[id]?.wasEverRevealed),
  )
  let rooms = scene.rooms
  for (const [col, row] of cells) {
    if (unlatched.size === 0) break
    const id = roomAtOf(ctx.campaignId, sceneId, region.minX + col + 0.5, region.minY + row + 0.5)
    // `delete` is the guard as well as the bookkeeping: false means the cell landed on no
    // room, on one the map does not author, or on one already latched.
    if (!id || !unlatched.delete(id)) continue
    rooms = { ...rooms, [id]: { status: 're_hidden', wasEverRevealed: true } }
  }
  return rooms
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
