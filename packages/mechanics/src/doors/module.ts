// The doors module (§2.2, D2). The DM works the doors — open, lock, or let the room in on a
// secret; a player reads what the table is playing and asks for the rest out loud. The
// authored door list lives in the map file, so the module is built with a lookup the server
// backs with its map store — the shape `scenesModule(stores)` already uses.

import { ANY_ROLE, dropScene, type GameModule, type ModuleContext } from '../contract'
import { actorOf, logged, type LogAction } from '../log'
import { ID_MAX, Reject, bad, bool, denied, obj, str } from '../tokens/validate'
import {
  DOORS_DM_ONLY,
  DOOR_LOCKED,
  DOOR_OUT_OF_REACH,
  SET_PLAYERS_OPEN,
  UNKNOWN_DOOR,
  doorsOfScene,
  isArchway,
  refusal,
  type AuthoredDoor,
  type DoorLiveState,
  type DoorsState,
} from './types'

export * from './types'

/** The doors a scene's map authors. */
export type SceneDoors = (campaignId: string, sceneId: string) => readonly AuthoredDoor[]

/**
 * S3 D4 — the door ids a player is allowed to hold for a scene: the ones bound to a room
 * the party has explored. The server backs this with the same fog cache `tokensModule`
 * takes its `visionOf` from. The default answers `null` — no fog knowledge, nothing
 * filtered, which is the S2 behaviour and what a scene with no authored rooms gets anyway.
 */
export type PlayerDoors = (sceneId: string) => ReadonlySet<string> | null

/**
 * Table fix pass, decision b — whether one of a player's own tokens stands within
 * `PLAYER_DOOR_REACH` of the door. The server answers it off the tokens state and the map.
 */
export type PlayerReach = (campaignId: string, sceneId: string, identityId: string, doorId: string) => boolean

type Ctx = ModuleContext<DoorsState>
type Payload = Record<string, unknown>

export function doorsModule(
  doorsOf: SceneDoors,
  playerDoorsOf: PlayerDoors = () => null,
  reachOf: PlayerReach = () => false,
): GameModule<DoorsState> {
  return {
    name: 'doors',
    commands: {
      // D2 — the DM's call, except that a player may open or shut a door their seat holds and
      // stands beside while "Players open doors" is on (table fix pass, decision b): `run`.
      toggle: ANY_ROLE,
      lock: ['dm'],
      unlock: ['dm'],
      'reveal-secret': ['dm'],
      [SET_PLAYERS_OPEN]: ['dm'],
    },
    initialState: { byScene: {} },
    forgetScene: dropScene,

    handler(action, payload, ctx) {
      try {
        run(action, obj(payload ?? {}, 'payload'), ctx, doorsOf, playerDoorsOf, reachOf)
      } catch (err) {
        if (err instanceof Reject) return { code: err.code, message: err.message }
        throw err
      }
    },

    // D4: an unrevealed secret door is dropped whole for non-DMs. That is also why a plain
    // door is seeded `revealed: true` — `revealed` alone decides this, with no authored
    // data in reach. On top of that a player holds only the doors the fog has handed over:
    // a live entry for every door in the scene is a map of the dungeon written in ids, and
    // "door-vault" is a spoiler on its own. Idempotent: a state already cut this way loses
    // nothing more.
    redact(state, viewer) {
      if (viewer.role === 'dm') return state
      const byScene: DoorsState['byScene'] = {}
      for (const [sceneId, doors] of Object.entries(state.byScene)) {
        const held = playerDoorsOf(sceneId)
        const known: Record<string, DoorLiveState> = {}
        for (const [id, door] of Object.entries(doors)) {
          if (door.revealed && (held === null || held.has(id))) known[id] = door
        }
        byScene[sceneId] = known
      }
      // The log is cut by the cut above, not by a second rule: a seat reads the line about
      // a door exactly when it holds that door. So a secret revealed three rooms away, or
      // anything at all in a room nobody has entered, is not merely nameless on this wire —
      // it is absent, and the *count* of what the DM has been doing goes with it.
      return {
        ...state,
        byScene,
        log: state.log?.filter(
          (e) => e.targetId !== undefined && byScene[e.sceneId]?.[e.targetId] !== undefined,
        ),
      }
    },
  }
}

function run(
  action: string,
  p: Payload,
  ctx: Ctx,
  doorsOf: SceneDoors,
  playerDoorsOf: PlayerDoors,
  reachOf: PlayerReach,
): void {
  // The DM's switch is campaign-wide and names no door.
  if (action === SET_PLAYERS_OPEN) {
    ctx.setState({ ...ctx.state, playersOpen: bool(p.open, 'open') })
    return
  }
  const sceneId = p.sceneId === undefined ? ctx.activeSceneId : str(p.sceneId, 'sceneId', ID_MAX)
  if (!sceneId) bad('no sceneId in the payload and no active scene')
  const id = str(p.id, 'id', ID_MAX)

  const authoredDoors = doorsOf(ctx.campaignId, sceneId)
  const authored = authoredDoors.find((door) => door.id === id)
  if (!authored) unknownDoor()
  // First touch seeds the whole scene, so the table's copy of a door's state is complete
  // the moment anyone interacts with it.
  const scene = doorsOfScene(ctx.state, sceneId, authoredDoors)
  const live = scene[id]

  // Identical refusal to a door that does not exist — a player probing ids learns nothing
  // about what the DM is hiding. First, so a secret archway refuses as a secret door does.
  if (authored.isSecret && !live.revealed && ctx.sender.role !== 'dm') unknownDoor()
  // An archway is a hole in a wall: nothing to swing, nothing to lock. Only what the table
  // *knows* about one can change, so `reveal-secret` is the one command it still answers.
  // The client toasts DOOR_LOCKED/UNKNOWN_DOOR alone, so this refusal is silent by design.
  if (isArchway(authored) && action !== 'reveal-secret') {
    bad('an archway is a permanent opening — there is nothing to open, close or lock')
  }

  // A player's toggle (decision b): the door must be one their seat holds, the DM's switch on,
  // and one of their tokens beside it. A door the seat does not hold refuses as unknown.
  if (ctx.sender.role !== 'dm') {
    const held = playerDoorsOf(sceneId)
    if (held !== null && !held.has(id)) unknownDoor()
    if (ctx.state.playersOpen === false) denied(refusal(DOORS_DM_ONLY, id, 'only the DM opens doors at this table'))
    if (!reachOf(ctx.campaignId, sceneId, ctx.sender.identityId, id)) {
      bad(refusal(DOOR_OUT_OF_REACH, id, 'stand next to that door to open or close it'))
    }
  }

  switch (action) {
    case 'toggle':
      if (live.locked) bad(refusal(DOOR_LOCKED, id, 'that door is locked'))
      return put(ctx, sceneId, scene, id, { ...live, open: !live.open }, live.open ? 'closed' : 'opened')
    case 'lock':
      // Locking an open door shuts it (F14): a lock holds a closed door, and a door left open
      // and locked could never be closed again.
      return put(ctx, sceneId, scene, id, { ...live, locked: true, open: false }, 'locked')
    case 'unlock':
      return put(ctx, sceneId, scene, id, { ...live, locked: false }, 'unlocked')
    case 'reveal-secret':
      if (!authored.isSecret) bad('that door is not a secret door')
      return put(ctx, sceneId, scene, id, { ...live, revealed: true }, 'revealed-secret')
    default:
      bad(`doors has no action '${action}'`)
  }
}

function unknownDoor(): never {
  bad(`${UNKNOWN_DOOR}: no such door in that scene`)
}

function put(
  ctx: Ctx,
  sceneId: string,
  scene: Record<string, DoorLiveState>,
  id: string,
  next: DoorLiveState,
  action: LogAction,
): void {
  ctx.setState({
    ...ctx.state,
    byScene: { ...ctx.state.byScene, [sceneId]: { ...scene, [id]: next } },
    // Every write is a line, because every write is something a seat at the table saw a
    // door do. Minted here rather than at the four call sites so no future action can
    // change a door quietly.
    log: logged(ctx.state.log, { actor: actorOf(ctx), action, sceneId, targetId: id }),
  })
}
