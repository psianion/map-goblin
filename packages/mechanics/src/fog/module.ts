// The fog module (§2.2, D1). Every command is DM-only — fog is the DM's instrument, and
// role gating is data the registry checks before the handler runs, so what is left here is
// the extra validation: the room must be one the map actually has, and `hide` only applies
// to a room the party has already seen.
//
// Rooms live in the map file, not in module state, so the module is built with a lookup
// the server backs with its map store — the same shape `scenesModule(stores)` uses.

import type { GameModule, ModuleContext } from '../contract'
import { actorOf, logged, type LogAction, type LogEntry } from '../log'
import { ID_MAX, Reject, bad, bool, obj, oneOf, str } from '../tokens/validate'
import {
  ROOM_FOG_STATUSES,
  roomFogOf,
  sceneFogOf,
  type FogState,
  type RoomFog,
  type SceneFog,
} from './types'

export * from './types'
export * from './visibility'

/** The room ids of a scene's map — corridors included, they are rooms (D6). */
export type SceneRooms = (campaignId: string, sceneId: string) => readonly string[]

type Ctx = ModuleContext<FogState>
type Payload = Record<string, unknown>

export function fogModule(roomsOf: SceneRooms): GameModule<FogState> {
  return {
    name: 'fog',
    commands: {
      reveal: ['dm'],
      hide: ['dm'],
      reset: ['dm'],
      'set-bulk': ['dm'],
      'set-conceal': ['dm'],
    },
    initialState: { byScene: {} },

    handler(action, payload, ctx) {
      try {
        run(action, obj(payload ?? {}, 'payload'), ctx, roomsOf)
      } catch (err) {
        if (err instanceof Reject) return { code: err.code, message: err.message }
        throw err
      }
    },

    // D4: a player is told about the rooms they have seen and nothing else. Never-revealed
    // rooms are absent whole — their ids and their *count* are exactly what must not leak,
    // so a status field would not be enough. Idempotent: re-filtering drops nothing new.
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

function run(action: string, p: Payload, ctx: Ctx, roomsOf: SceneRooms): void {
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
    default:
      bad(`fog has no action '${action}'`)
  }
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
