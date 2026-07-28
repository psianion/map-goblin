// The doors module (§2.2, D2). Anyone at the table may open a door; only the DM may lock
// one or let the room in on a secret. The authored door list lives in the map file, so the
// module is built with a lookup the server backs with its map store — the shape
// `scenesModule(stores)` already uses.

import { ANY_ROLE, type GameModule, type ModuleContext } from '../contract'
import { ID_MAX, Reject, bad, obj, str } from '../tokens/validate'
import {
  DOOR_LOCKED,
  UNKNOWN_DOOR,
  doorsOfScene,
  isArchway,
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

type Ctx = ModuleContext<DoorsState>
type Payload = Record<string, unknown>

export function doorsModule(
  doorsOf: SceneDoors,
  playerDoorsOf: PlayerDoors = () => null,
): GameModule<DoorsState> {
  return {
    name: 'doors',
    commands: {
      toggle: ANY_ROLE,
      lock: ['dm'],
      unlock: ['dm'],
      'reveal-secret': ['dm'],
    },
    initialState: { byScene: {} },

    handler(action, payload, ctx) {
      try {
        run(action, obj(payload ?? {}, 'payload'), ctx, doorsOf)
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
      return { ...state, byScene }
    },
  }
}

function run(action: string, p: Payload, ctx: Ctx, doorsOf: SceneDoors): void {
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

  switch (action) {
    case 'toggle':
      if (live.locked) bad(`${DOOR_LOCKED}: that door is locked`)
      return put(ctx, sceneId, scene, id, { ...live, open: !live.open })
    case 'lock':
      return put(ctx, sceneId, scene, id, { ...live, locked: true })
    case 'unlock':
      return put(ctx, sceneId, scene, id, { ...live, locked: false })
    case 'reveal-secret':
      if (!authored.isSecret) bad('that door is not a secret door')
      return put(ctx, sceneId, scene, id, { ...live, revealed: true })
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
): void {
  ctx.setState({
    ...ctx.state,
    byScene: { ...ctx.state.byScene, [sceneId]: { ...scene, [id]: next } },
  })
}
