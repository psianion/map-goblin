// The tokens module (§2.2, D5/D10/D12/D13). One persisted row per campaign holds both the
// library (campaign-scoped) and every placed instance keyed by scene — which is what makes
// "positions remembered per map" free.
//
// Role gating is data: the registry checks `commands[action]` before the handler runs, so
// everything below is the *extra* validation — ownership, ids, field caps, snap.

import { ANY_ROLE, type GameModule, type ModuleContext, type Viewer } from '../contract'
import type { SceneVision, Token, TokenDef, TokensState, VisionOf } from './types'
import {
  DISPOSITIONS,
  ID_MAX,
  LIBRARY_MAX,
  NAME_MAX,
  Reject,
  SCENE_TOKENS_MAX,
  SIZES,
  bad,
  bool,
  canOccupy,
  denied,
  num,
  obj,
  oneOf,
  parseDefFields,
  snap,
  str,
} from './validate'

export * from './types'
// The client snaps optimistically during a drag (§2.4.6) against the same function the
// server validates with — one rule, one implementation.
export { snap } from './validate'

type Ctx = ModuleContext<TokensState>
type Payload = Record<string, unknown>

/** Fields `update` accepts; players get `name` alone (D10). */
const UPDATE_FIELDS = ['name', 'size', 'disposition', 'elevation', 'z'] as const

let minted = 0
const mintId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}${(minted++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

/**
 * S3 hands this module the fog: `visionOf` is the server's per-scene view of what the
 * player role may see and stand in (S3 D3/D8), the same shape `fogModule(roomsOf)` and
 * `doorsModule(doorsOf)` take their map lookups in. The default answers "no fog anywhere",
 * which is the S2 behaviour and what a scene with no authored rooms gets anyway.
 */
export function tokensModule(visionOf: VisionOf = () => null): GameModule<TokensState> {
  return {
    name: 'tokens',
    commands: {
      'library-upsert': ['dm'],
      'library-delete': ['dm'],
      place: ['dm'],
      move: ANY_ROLE,
      update: ANY_ROLE,
      hide: ['dm'],
      delete: ['dm'],
      claim: ['player'],
    },
    initialState: { library: {}, byScene: {} },

    handler(action, payload, ctx) {
      try {
        run(action, obj(payload ?? {}, 'payload'), ctx, visionOf)
      } catch (err) {
        if (err instanceof Reject) return { code: err.code, message: err.message }
        throw err
      }
    },

    // D4: a hidden token is dropped whole for non-DMs — its position is exactly what must
    // not leak, so filtering fields would not be enough. S3 stacks the fog rule on top:
    // a token in a room the party cannot currently see goes the same way. Pure and
    // idempotent: dropping tokens from a state with none left to drop is a no-op.
    redact(state, viewer) {
      if (viewer.role === 'dm') return state
      let dropped = false
      const byScene: TokensState['byScene'] = {}
      for (const [sceneId, tokens] of Object.entries(state.byScene)) {
        const scene = visionOf(sceneId)
        const visible: Record<string, Token> = {}
        for (const [id, token] of Object.entries(tokens)) {
          if (token.hidden || !inSight(token, scene, viewer)) dropped = true
          else visible[id] = token
        }
        byScene[sceneId] = visible
      }
      return dropped ? { ...state, byScene } : state
    },
  }
}

/**
 * D7 — your own claimed token is always visible, wherever the DM puts the dark; everything
 * else only while its room is. A token on unzoned map is the DM's alone, same as the map
 * under it (D6).
 */
function inSight(token: Token, scene: SceneVision | null, viewer: Viewer): boolean {
  if (!scene || token.ownerId === viewer.identityId) return true
  const room = scene.roomAt(token.x, token.y)
  return room !== null && scene.visible.has(room)
}

function run(action: string, p: Payload, ctx: Ctx, visionOf: VisionOf): void {
  switch (action) {
    case 'library-upsert':
      return libraryUpsert(p, ctx)
    case 'library-delete':
      return libraryDelete(p, ctx)
    case 'place':
      return place(p, ctx, visionOf)
    case 'move':
      return move(p, ctx, visionOf)
    case 'update':
      return update(p, ctx)
    case 'hide':
      return hide(p, ctx)
    case 'delete':
      return remove(p, ctx)
    case 'claim':
      return claim(p, ctx)
    default:
      bad(`tokens has no action '${action}'`)
  }
}

/** Payload scene, else the table's active scene; a command with neither is nonsense. */
function sceneOf(p: Payload, ctx: Ctx): string {
  const sceneId = p.sceneId === undefined ? ctx.activeSceneId : str(p.sceneId, 'sceneId', ID_MAX)
  if (!sceneId) bad('no sceneId in the payload and no active scene')
  return sceneId
}

function find(p: Payload, ctx: Ctx): { sceneId: string; token: Token } {
  const sceneId = sceneOf(p, ctx)
  const id = str(p.id, 'id', ID_MAX)
  const token = ctx.state.byScene[sceneId]?.[id]
  // A hidden token does not exist for players — redact drops it whole, and the command
  // layer must answer the same, or a forged move/update/claim on a remembered id would
  // confirm it is still there and keep server-side control of it. The message does not
  // echo the id either: a hidden token's id appears in ZERO player-bound frames, no
  // exceptions — that absolute is what the fog gate greps for.
  if (!token || (token.hidden && ctx.sender.role !== 'dm')) {
    bad('no such token in that scene')
  }
  return { sceneId, token }
}

function put(ctx: Ctx, sceneId: string, token: Token): void {
  const { state } = ctx
  ctx.setState({
    ...state,
    byScene: { ...state.byScene, [sceneId]: { ...state.byScene[sceneId], [token.id]: token } },
  })
}

function libraryUpsert(p: Payload, ctx: Ctx): void {
  const { state } = ctx
  const id = p.id === undefined ? mintId('def') : str(p.id, 'id', ID_MAX)
  const base = state.library[id]
  if (!base && Object.keys(state.library).length >= LIBRARY_MAX) bad('the token library is full')
  ctx.setState({
    ...state,
    library: { ...state.library, [id]: { id, ...parseDefFields(p, base) } },
  })
}

function libraryDelete(p: Payload, ctx: Ctx): void {
  const { state } = ctx
  const id = str(p.id, 'id', ID_MAX)
  if (!state.library[id]) bad(`no token def '${id}'`)
  const library = { ...state.library }
  delete library[id]
  // D12: placed instances already carry their own copy of the fields and keep their (now
  // dangling) defId — deleting a def never removes something from the table.
  ctx.setState({ ...state, library })
}

function place(p: Payload, ctx: Ctx, visionOf: VisionOf): void {
  const { state } = ctx
  const sceneId = sceneOf(p, ctx)
  if (Object.keys(state.byScene[sceneId] ?? {}).length >= SCENE_TOKENS_MAX) bad('this scene is full')

  const defId = p.defId === undefined || p.defId === null ? null : str(p.defId, 'defId', ID_MAX)
  let base: TokenDef | undefined
  if (defId !== null) {
    base = state.library[defId]
    if (!base) bad(`no token def '${defId}'`)
  }

  const fields = parseDefFields(p, base)
  const token: Token = {
    id: mintId('tok'),
    ...fields,
    defId,
    x: snap(num(p.x, 'x'), fields.size),
    y: snap(num(p.y, 'y'), fields.size),
    elevation: p.elevation === undefined ? 0 : num(p.elevation, 'elevation'),
    z: p.z === undefined ? 0 : num(p.z, 'z'),
    hidden: p.hidden === undefined ? false : bool(p.hidden, 'hidden'),
    ownerId: null,
  }
  const at = { x: token.x, y: token.y }
  if (!canOccupy(token, at, visionOf(sceneId), ctx.sender.role)) bad('that space cannot be occupied')
  put(ctx, sceneId, token)
}

function move(p: Payload, ctx: Ctx, visionOf: VisionOf): void {
  const { sceneId, token } = find(p, ctx)
  if (ctx.sender.role !== 'dm' && token.ownerId !== ctx.sender.identityId) {
    denied('you may only move a token you own')
  }
  const pos = { x: snap(num(p.x, 'x'), token.size), y: snap(num(p.y, 'y'), token.size) }
  if (!canOccupy(token, pos, visionOf(sceneId), ctx.sender.role)) bad('that space cannot be occupied')
  put(ctx, sceneId, { ...token, ...pos })
}

function update(p: Payload, ctx: Ctx): void {
  const { sceneId, token } = find(p, ctx)
  if (ctx.sender.role !== 'dm') {
    if (token.ownerId !== ctx.sender.identityId) denied('you may only update a token you own')
    if (UPDATE_FIELDS.some((f) => f !== 'name' && p[f] !== undefined)) {
      denied('players may only rename their own token')
    }
  }
  if (UPDATE_FIELDS.every((f) => p[f] === undefined)) {
    bad(`update needs one of: ${UPDATE_FIELDS.join(', ')}`)
  }

  const next = { ...token }
  if (p.name !== undefined) next.name = str(p.name, 'name', NAME_MAX)
  if (p.size !== undefined) {
    next.size = oneOf(p.size, SIZES, 'size')
    // Snap parity follows size (D13) — a medium on a cell centre becomes a large on an
    // intersection, so re-snap rather than persist an off-grid token.
    next.x = snap(next.x, next.size)
    next.y = snap(next.y, next.size)
  }
  if (p.disposition !== undefined) next.disposition = oneOf(p.disposition, DISPOSITIONS, 'disposition')
  if (p.elevation !== undefined) next.elevation = num(p.elevation, 'elevation')
  if (p.z !== undefined) next.z = num(p.z, 'z')
  put(ctx, sceneId, next)
}

function hide(p: Payload, ctx: Ctx): void {
  const { sceneId, token } = find(p, ctx)
  // Explicit rather than a toggle: two DMs clicking at once must not race back to visible.
  const hidden = p.hidden === undefined ? true : bool(p.hidden, 'hidden')
  put(ctx, sceneId, { ...token, hidden })
}

function remove(p: Payload, ctx: Ctx): void {
  const { state } = ctx
  const { sceneId, token } = find(p, ctx)
  const scene = { ...state.byScene[sceneId] }
  delete scene[token.id]
  ctx.setState({ ...state, byScene: { ...state.byScene, [sceneId]: scene } })
}

function claim(p: Payload, ctx: Ctx): void {
  const { sceneId, token } = find(p, ctx)
  if (token.ownerId !== null) denied('that token is already claimed')
  put(ctx, sceneId, { ...token, ownerId: ctx.sender.identityId })
}
