// The tokens module (§2.2, D5/D10/D12/D13). One persisted row per campaign holds both the
// library (campaign-scoped) and every placed instance keyed by scene — which is what makes
// "positions remembered per map" free.
//
// Role gating is data: the registry checks `commands[action]` before the handler runs, so
// everything below is the *extra* validation — ownership, ids, field caps, snap.

import { ANY_ROLE, type GameModule, type ModuleContext, type Viewer } from '../contract'
import { refusal as refusalText } from '../doors/types'
import { fanAround } from './fan'
import { sightPartyIds } from './links'
import type {
  LevelFilterOf,
  SceneVision,
  TableOf,
  TerrainOf,
  Token,
  TokenDef,
  TokenEffect,
  TokensState,
  VisionOf,
} from './types'
import {
  DISPOSITIONS,
  HP_VISIBILITY,
  ID_MAX,
  KINDS,
  LIBRARY_MAX,
  NAME_MAX,
  NAMEPLATES,
  Reject,
  ROUNDS_MAX,
  SCENE_TOKENS_MAX,
  SIZES,
  EFFECT_NAME_MAX,
  EFFECTS_MAX,
  bad,
  bool,
  occupyRefusal,
  denied,
  num,
  obj,
  oneOf,
  parseAc,
  parseCondition,
  parseDefFields,
  parseHp,
  parseLight,
  parseSheet,
  parseSight,
  parseSpeed,
  parsePassive,
  snap,
  str,
} from './validate'
import { HP_MAX } from '../initiative/types'

export * from './fan'
export * from './links'
export * from './types'
// The client snaps optimistically during a drag (§2.4.6) against the same function the
// server validates with — one rule, one implementation.
export { snap } from './validate'
// Table v2: A's server code reads old rows through this; the client shows defaults through it.
export { normalizeTokenDef } from './validate'

type Ctx = ModuleContext<TokensState>
type Payload = Record<string, unknown>

/**
 * Fields `update` accepts; players get {@link PLAYER_FIELDS} alone (D10 + the Beyond20 link,
 * and table v2's name, art and nameplate of a token they own).
 *
 * P4 adds `sight` and `light`, and adding them here is the *whole* of their access control:
 * the guard below refuses a non-DM any field outside the player list, so a player cannot
 * grant their own token darkvision, a torch or more hit points by editing the token they
 * legitimately own.
 */
const UPDATE_FIELDS = [
  'name',
  'size',
  'disposition',
  'elevation',
  'z',
  'sight',
  'light',
  'sheet',
  'elevationPinned',
  'imageAssetId',
  'nameplate',
  'kind',
  'hp',
  'ac',
  'speed',
  'passive',
  'showHp',
] as const
const PLAYER_FIELDS: readonly string[] = ['name', 'sheet', 'imageAssetId', 'nameplate']

/** Refusal prefixes for a player's move while the DM holds the table (table v2). */
export const TABLE_PAUSED = 'table-paused'
export const MOVEMENT_LOCKED = 'movement-locked'

/** How many tokens one damage/heal/condition/gather command may name. */
export const TARGETS_MAX = 50

let minted = 0
const mintId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}${(minted++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

/**
 * S3 hands this module the fog: `visionOf` is the server's per-scene view of what the
 * player role may see and stand in (S3 D3/D8), the same shape `fogModule(roomsOf)` and
 * `doorsModule(doorsOf)` take their map lookups in. The default answers "no fog anywhere",
 * which is the S2 behaviour and what a scene with no authored rooms gets anyway.
 */
export function tokensModule(
  visionOf: VisionOf = () => null,
  levelFilterOf: LevelFilterOf = () => null,
  terrainOf: TerrainOf = () => null,
  tableOf: TableOf = () => null,
): GameModule<TokensState> {
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
      assign: ['dm'],
      'set-sight-link': ['dm'],
      'set-token-level': ['dm'],
      // Table v2. A player may damage or heal only a token they own (their Character sheet's
      // quick buttons); everything else here is the DM's.
      damage: ANY_ROLE,
      heal: ANY_ROLE,
      'set-condition': ['dm'],
      'set-effect': ['dm'],
      gather: ['dm'],
    },
    initialState: { library: {}, byScene: {} },

    handler(action, payload, ctx) {
      try {
        run(action, obj(payload ?? {}, 'payload'), ctx, visionOf, terrainOf, tableOf)
      } catch (err) {
        if (err instanceof Reject) return { code: err.code, message: err.message }
        throw err
      }
    },

    forgetScene(state, sceneId) {
      if (!(sceneId in state.byScene)) return state
      const byScene = { ...state.byScene }
      delete byScene[sceneId]
      return { ...state, byScene }
    },

    // D4: a hidden token is dropped whole for non-DMs — its position is exactly what must
    // not leak, so filtering fields would not be enough. S3 stacks the fog rule on top:
    // a token in a room the party cannot currently see goes the same way. Pure and
    // idempotent: dropping tokens from a state with none left to drop is a no-op.
    //
    // Table v2 stacks `showHp` on what survives: hit points (and the armour class beside
    // them) leave only for the seats the token's setting names.
    redact(state, viewer) {
      if (viewer.role === 'dm') return state
      const library = redactLibrary(state.library, viewer)
      let dropped = library !== state.library
      const byScene: TokensState['byScene'] = {}
      for (const [sceneId, tokens] of Object.entries(state.byScene)) {
        // P5 — the viewer goes through the seam, so `canSee` is *this* seat's sight in
        // individual share and the party's in party share. The rule below is unchanged;
        // only the eyes behind it narrow.
        const scene = visionOf(sceneId, viewer)
        // Levels: a seat sees only the tokens on the level it is looking at, its own included.
        const onLevel = levelFilterOf(sceneId, viewer)
        // P4 §4 — "yours" is the closure of the tokens you claimed over the DM's sight links,
        // so a familiar you were handed is as exempt from the fog as the scout it follows.
        const mine = sightPartyIds(
          Object.values(tokens),
          (token) => token.ownerId === viewer.identityId,
        )
        const visible: Record<string, Token> = {}
        for (const [id, token] of Object.entries(tokens)) {
          if (token.hidden || (onLevel && !onLevel(token.levelId)) || !inSight(token, scene, mine)) dropped = true
          else visible[id] = token
        }
        // A link is a token *id*, so a surviving token's `sharesSightWith` is a list of names
        // — and one of them can name a token this viewer was never handed (the hidden familiar,
        // the scout in the unseen room). That is the same leak dropping the token whole was for,
        // so the edges are trimmed to the survivors. Second pass rather than one: whether a link
        // survives is only answerable once the whole scene has been decided.
        for (const [id, token] of Object.entries(visible)) {
          const links = token.sharesSightWith
          if (!links) continue
          const kept = links.filter((other) => other in visible)
          if (kept.length === links.length) continue
          dropped = true
          const trimmed = { ...token }
          if (kept.length === 0) delete trimmed.sharesSightWith
          else trimmed.sharesSightWith = kept
          visible[id] = trimmed
        }
        for (const [id, token] of Object.entries(visible)) {
          const kept = withoutHp(token, viewer, token.ownerId)
          if (kept === token) continue
          dropped = true
          visible[id] = kept
        }
        byScene[sceneId] = visible
      }
      return dropped ? { ...state, byScene, library } : state
    },
  }
}

/**
 * `showHp` for one viewer: `all` keeps the pool, `owner` keeps it for the owning seat, `dm`
 * (the default, also for rows that predate the field) never sends it. AC goes with it, as
 * the other number behind the DM's screen. Same object back when nothing is cut.
 */
function withoutHp<T extends TokenDef>(token: T, viewer: Viewer, ownerId: string | null | undefined): T {
  if (token.hp === undefined && token.ac === undefined) return token
  const show = token.showHp ?? 'dm'
  if (show === 'all' || (show === 'owner' && ownerId === viewer.identityId)) return token
  const cut = { ...token }
  delete cut.hp
  delete cut.ac
  return cut
}

/** The library under the same `showHp` rule, a PC def's owner standing in for a token's. */
function redactLibrary(library: TokensState['library'], viewer: Viewer): TokensState['library'] {
  let touched = false
  const out: TokensState['library'] = {}
  for (const [id, def] of Object.entries(library)) {
    const kept = withoutHp(def, viewer, def.ownerIdentityId)
    if (kept !== def) touched = true
    out[id] = kept
  }
  return touched ? out : library
}

/**
 * D7 — your own claimed token is always visible, wherever the DM puts the dark; everything
 * else only while its room is. A token on unzoned map is the DM's alone, same as the map
 * under it (D6).
 *
 * S3 P1 stacks token vision on the same seam: with `canSee` wired (vision mode only) the
 * question is asked of the point rather than the room, so an orc standing in the dark half
 * of a lit room is not on this wire at all. Own claimed tokens are exempt either way.
 *
 * P4 widens "own" to `mine`, the sight-link closure of the viewer's claimed tokens
 * (`sightParty`). It matters fully in P5, where each viewer's mask is their own; here the
 * party already sees what any of them sees, so the widening is harmless and the rule is
 * written once.
 */
function inSight(token: Token, scene: SceneVision | null, mine: ReadonlySet<string>): boolean {
  if (!scene || mine.has(token.id)) return true
  // Plateaus: a token up on a top the party cannot see from where it stands is not seen,
  // whatever the room around it is doing.
  if (scene.coveredAt?.(token.x, token.y)) return false
  // Issue #94 finding 3 — an unclaimed friendly is meant to be found, not ambushed from. It
  // is in sight on ground the party has already explored, even while that ground is not
  // currently lit: memory of the room (rooms mode) or of the cell itself (vision mode).
  // Hostile/neutral tokens still need the room or cell to be lit right now, same as before.
  if (token.ownerId === null && token.disposition === 'friendly') {
    if (scene.openGround?.(token.x, token.y)) return true
    const home = scene.roomAt(token.x, token.y)
    if (home !== null && scene.occupiable.has(home)) return true
  }
  // ponytail: one point, the token's own centre. A large or gargantuan token whose far cells
  // are swept but whose centre sits behind the corner vanishes whole rather than partly — an
  // accepted P1 ceiling. The upgrade is sampling the cells the token's footprint covers and
  // calling it seen if any of them are.
  if (scene.canSee) return scene.canSee(token.x, token.y)
  const room = scene.roomAt(token.x, token.y)
  return room !== null && scene.visible.has(room)
}

function run(
  action: string,
  p: Payload,
  ctx: Ctx,
  visionOf: VisionOf,
  terrainOf: TerrainOf,
  tableOf: TableOf,
): void {
  switch (action) {
    case 'library-upsert':
      return libraryUpsert(p, ctx)
    case 'library-delete':
      return libraryDelete(p, ctx)
    case 'place':
      return place(p, ctx, visionOf, terrainOf)
    case 'spawn':
      return spawn(p, ctx)
    case 'move':
      return move(p, ctx, visionOf, terrainOf, tableOf)
    case 'update':
      return update(p, ctx, terrainOf)
    case 'hide':
      return hide(p, ctx)
    case 'delete':
      return remove(p, ctx)
    case 'claim':
      return claim(p, ctx)
    case 'assign':
      return assign(p, ctx)
    case 'set-sight-link':
      return setSightLink(p, ctx)
    case 'set-token-level':
      return setTokenLevel(p, ctx)
    case 'damage':
      return changeHp(p, ctx, -1)
    case 'heal':
      return changeHp(p, ctx, 1)
    case 'set-condition':
      return setCondition(p, ctx)
    case 'set-effect':
      return setEffect(p, ctx)
    case 'gather':
      return gather(p, ctx, terrainOf)
    case 'tick-effects':
      return tickEffects(p, ctx)
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
  const def: TokenDef = { id, ...parseDefFields(p, base) }
  ctx.setState({
    ...state,
    library: { ...state.library, [id]: def },
    // Issue #94 finding 4 — a def edit is meant to reach the table: every def-owned field
    // (everything but id/name) is carried onto tokens already placed from it. A brand new
    // def (`base` unset) has nothing placed from it yet, so there is nothing to walk.
    byScene: base ? propagateDefEdit(state.byScene, id, def) : state.byScene,
  })
}

/** Overwrite the def-owned fields on every instance placed from `def`; instance-only fields
 *  (position, elevation, z, hidden, ownerId, sharesSightWith, sheet) are left alone. */
function propagateDefEdit(
  byScene: TokensState['byScene'],
  defId: string,
  def: TokenDef,
): TokensState['byScene'] {
  const fields = {
    imageAssetId: def.imageAssetId,
    size: def.size,
    disposition: def.disposition,
    sight: def.sight,
    light: def.light,
    ...(def.packAsset ? { packAsset: def.packAsset } : {}),
    // Table v2's def-owned fields. Conditions, effects and the current hit points are the
    // instance's own (the fight happened to this goblin, not to the type), so they stay.
    kind: def.kind,
    nameplate: def.nameplate,
    showHp: def.showHp,
  }
  const optionalFields = ['ac', 'speed', 'passive', 'ownerIdentityId', 'ownerName'] as const
  const out: TokensState['byScene'] = {}
  for (const [sceneId, tokens] of Object.entries(byScene)) {
    const nextTokens: Record<string, Token> = {}
    for (const [tokenId, token] of Object.entries(tokens)) {
      if (token.defId !== defId) {
        nextTokens[tokenId] = token
        continue
      }
      const next: Token = { ...token, ...fields }
      // An edit that drops pack art has to drop it from the placed copy too — spreading
      // `fields` alone would leave the instance's old value in place.
      if (!def.packAsset) delete next.packAsset
      for (const key of optionalFields) {
        if (def[key] === undefined) delete next[key]
        else (next as unknown as Record<string, unknown>)[key] = def[key]
      }
      // A new pool size reaches the placed copy; the damage it has taken does not heal.
      if (!def.hp) delete next.hp
      else if (next.hp?.max !== def.hp.max) {
        const taken = next.hp ? next.hp.max - next.hp.current : 0
        next.hp = { max: def.hp.max, current: Math.max(0, def.hp.max - taken) }
      }
      // A PC def handed to a player hands its placed tokens over too.
      if (def.ownerIdentityId) next.ownerId = def.ownerIdentityId
      nextTokens[tokenId] = next
    }
    out[sceneId] = nextTokens
  }
  return out
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

/**
 * Where a token stands, as a height: the ground's answer at its centre unless the DM pinned
 * one on its card (plan §7). Unchanged on a scene with no terrain.
 */
function grounded(token: Token, sceneId: string, terrainOf: TerrainOf): Token {
  if (token.elevationPinned) return token
  const terrain = terrainOf(sceneId)
  if (!terrain) return token
  const elevation = terrain.elevationAt(token.x, token.y, token.levelId)
  return elevation === token.elevation ? token : { ...token, elevation }
}

function place(p: Payload, ctx: Ctx, visionOf: VisionOf, terrainOf: TerrainOf): void {
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
    // An elevation named at placement is the DM's word, kept until unpinned.
    ...(p.elevation === undefined ? {} : { elevationPinned: true }),
    z: p.z === undefined ? 0 : num(p.z, 'z'),
    hidden: p.hidden === undefined ? false : bool(p.hidden, 'hidden'),
    // A PC def names its player; the token placed from it is theirs from the start.
    ownerId: fields.ownerIdentityId ?? null,
  }
  const at = { x: token.x, y: token.y }
  const refusal = occupyRefusal(token, at, visionOf(sceneId), ctx.sender.role)
  if (refusal) bad(refusal)
  put(ctx, sceneId, grounded(token, sceneId, terrainOf))
}

/**
 * Internal only — deliberately absent from `commands`, exactly like `triggers.event`: the
 * one caller is the server materializing a fired encounter (`applyEncounter`), never a
 * socket. Trusted accordingly: no occupancy refusal (an authored ambush spawns where the
 * DM anchored it, revealed or not) and ids come from the caller so the initiative seed can
 * reference the same tokens. A full scene clamps — spawn what fits, never break the
 * cascade that fired the trigger.
 */
function spawn(p: Payload, ctx: Ctx): void {
  const { state } = ctx
  const sceneId = sceneOf(p, ctx)
  if (!Array.isArray(p.tokens) || p.tokens.length === 0) bad('spawn needs a tokens array')

  const existing = { ...state.byScene[sceneId] }
  let room = SCENE_TOKENS_MAX - Object.keys(existing).length
  for (const raw of p.tokens) {
    if (room <= 0) break
    const t = obj(raw, 'tokens[]')
    const size = t.size === undefined ? 'medium' : oneOf(t.size, SIZES, 'tokens[].size')
    const packAssetRaw = t.packAsset === undefined ? undefined : obj(t.packAsset, 'tokens[].packAsset')
    // Table v2: the room key's rolled HP (`MonsterEntry.hp`) is the token's pool. A bad
    // number is dropped rather than refused, like the rest of this trusted path's clamps.
    const hp =
      typeof t.hp === 'number' && Number.isInteger(t.hp) && t.hp >= 1 && t.hp <= HP_MAX ? t.hp : undefined
    const token: Token = {
      id: str(t.id, 'tokens[].id', ID_MAX),
      name: str(t.name, 'tokens[].name', NAME_MAX),
      imageAssetId: null,
      size,
      disposition: 'hostile',
      sight: null,
      light: null,
      kind: 'monster',
      nameplate: 'hover',
      showHp: 'dm',
      conditions: [],
      effects: [],
      ...(hp !== undefined ? { hp: { current: hp, max: hp } } : {}),
      ...(packAssetRaw
        ? {
            packAsset: {
              packId: str(packAssetRaw.packId, 'tokens[].packAsset.packId', ID_MAX),
              assetId: str(packAssetRaw.assetId, 'tokens[].packAsset.assetId', ID_MAX),
            },
          }
        : {}),
      defId: null,
      x: snap(num(t.x, 'tokens[].x'), size),
      y: snap(num(t.y, 'tokens[].y'), size),
      elevation: 0,
      z: 0,
      hidden: false,
      ownerId: null,
    }
    existing[token.id] = token
    room--
  }
  ctx.setState({ ...state, byScene: { ...state.byScene, [sceneId]: existing } })
}

function move(p: Payload, ctx: Ctx, visionOf: VisionOf, terrainOf: TerrainOf, tableOf: TableOf): void {
  const { sceneId, token } = find(p, ctx)
  if (ctx.sender.role !== 'dm' && token.ownerId !== ctx.sender.identityId) {
    denied('you may only move a token you own')
  }
  // Table v2: the DM holding the table stops every player's piece; the DM's own never stop.
  if (ctx.sender.role !== 'dm') {
    const table = tableOf({ campaignId: ctx.campaignId, sessionId: ctx.sessionId })
    if (table?.paused) denied(refusalText(TABLE_PAUSED, null, 'the DM has paused the table'))
    if (table?.movementLocked) denied(refusalText(MOVEMENT_LOCKED, null, 'the DM has locked token movement'))
  }
  const pos = { x: snap(num(p.x, 'x'), token.size), y: snap(num(p.y, 'y'), token.size) }
  const refusal = occupyRefusal(token, pos, visionOf(sceneId), ctx.sender.role)
  if (refusal) bad(refusal)
  // A raised edge whose crossing kind refuses (Impassable, or whatever the DM switched on)
  // stops a player's move; the DM's own drags are never refused (plan §7).
  if (ctx.sender.role !== 'dm') {
    const crossing = terrainOf(sceneId)?.crossingRefusal(token, pos, token.levelId) ?? null
    if (crossing) bad(crossing)
  }
  put(ctx, sceneId, grounded({ ...token, ...pos }, sceneId, terrainOf))
}

function update(p: Payload, ctx: Ctx, terrainOf: TerrainOf): void {
  const { sceneId, token } = find(p, ctx)
  if (ctx.sender.role !== 'dm') {
    if (token.ownerId !== ctx.sender.identityId) denied('you may only update a token you own')
    if (UPDATE_FIELDS.some((f) => !PLAYER_FIELDS.includes(f) && p[f] !== undefined)) {
      denied('players may only change the name, art, nameplate or sheet link of their own token')
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
  // A hand-set elevation pins it; unpinning hands it back to the ground under the token.
  if (p.elevation !== undefined) {
    next.elevation = num(p.elevation, 'elevation')
    next.elevationPinned = true
  }
  if (p.elevationPinned !== undefined) {
    if (bool(p.elevationPinned, 'elevationPinned')) next.elevationPinned = true
    else delete next.elevationPinned
  }
  if (p.z !== undefined) next.z = num(p.z, 'z')
  // The same two parsers `place` and `library-upsert` already run, so an instance edited at
  // the table and one placed from the library are validated by one rule. `null` clears.
  if (p.sight !== undefined) next.sight = parseSight(p.sight)
  if (p.light !== undefined) next.light = parseLight(p.light)
  // The Beyond20 link (D10 §6): `null` clears it, same as `sight`/`light` above — but unlike
  // them a bad sheet does not clear the field, it refuses the command, so a typo in the DM's
  // hand-typed sheet payload cannot silently unlink a player's working binding. First-sheet-
  // sticks is a prompt-side rule, not this one's: the owner may always overwrite, which is
  // what makes unlink-then-relink work.
  if (p.sheet !== undefined) {
    if (p.sheet === null) delete next.sheet
    else next.sheet = parseSheet(p.sheet) ?? bad('sheet needs at least a name')
  }
  // Table v2. `null` clears the optional numbers; the enums always hold a value.
  if (p.imageAssetId !== undefined) {
    next.imageAssetId = p.imageAssetId === null ? null : str(p.imageAssetId, 'imageAssetId', ID_MAX)
  }
  if (p.nameplate !== undefined) next.nameplate = oneOf(p.nameplate, NAMEPLATES, 'nameplate')
  if (p.kind !== undefined) next.kind = oneOf(p.kind, KINDS, 'kind')
  if (p.showHp !== undefined) next.showHp = oneOf(p.showHp, HP_VISIBILITY, 'showHp')
  if (p.hp !== undefined) {
    if (p.hp === null) delete next.hp
    else next.hp = parseHp(p.hp)
  }
  if (p.ac !== undefined) {
    if (p.ac === null) delete next.ac
    else next.ac = parseAc(p.ac)
  }
  if (p.passive !== undefined) {
    if (p.passive === null) delete next.passive
    else next.passive = parsePassive(p.passive)
  }
  if (p.speed !== undefined) {
    if (p.speed === null) delete next.speed
    else next.speed = parseSpeed(p.speed)
  }
  put(ctx, sceneId, grounded(next, sceneId, terrainOf))
}

// ─── table v2: hit points, conditions, effects, gather ──────────────────────────

/** Every token a `targets` list names, each looked up the way `find` looks one up. */
function targetsOf(p: Payload, ctx: Ctx): { sceneId: string; tokens: Token[] } {
  const sceneId = sceneOf(p, ctx)
  const raw = p.targets ?? (p.target === undefined ? undefined : [p.target])
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > TARGETS_MAX) {
    bad(`targets must be an array of 1..${TARGETS_MAX} token ids`)
  }
  const ids = [...new Set(raw.map((id, i) => str(id, `targets[${i}]`, ID_MAX)))]
  const tokens = ids.map((id) => find({ ...p, sceneId, id }, ctx).token)
  return { sceneId, tokens }
}

/** One write for many tokens: `setState` persists and broadcasts once. */
function putAll(ctx: Ctx, sceneId: string, tokens: readonly Token[]): void {
  const { state } = ctx
  const scene = { ...state.byScene[sceneId] }
  for (const token of tokens) scene[token.id] = token
  ctx.setState({ ...state, byScene: { ...state.byScene, [sceneId]: scene } })
}

/**
 * `damage {targets, amount, half?}` / `heal {targets, amount}`. Tokens with no pool are
 * skipped (a statue in the blast takes nothing); a command that reaches no pool at all is
 * refused, so a DM who forgot to set HP hears about it. Half on save rounds down, as the
 * rules do. A player may only touch their own token.
 */
function changeHp(p: Payload, ctx: Ctx, sign: 1 | -1): void {
  const { sceneId, tokens } = targetsOf(p, ctx)
  if (ctx.sender.role !== 'dm' && tokens.some((t) => t.ownerId !== ctx.sender.identityId)) {
    denied('you may only change the hit points of a token you own')
  }
  const amount = num(p.amount, 'amount')
  if (!Number.isInteger(amount) || amount < 1 || amount > HP_MAX) bad(`amount must be a whole number in 1..${HP_MAX}`)
  const half = sign < 0 && p.half !== undefined && bool(p.half, 'half')
  const delta = sign * (half ? Math.floor(amount / 2) : amount)
  const changed = tokens.flatMap((t) => {
    if (!t.hp) return []
    const current = Math.max(0, Math.min(t.hp.max, t.hp.current + delta))
    return [{ ...t, hp: { ...t.hp, current } }]
  })
  if (changed.length === 0) bad('none of those tokens has hit points set')
  putAll(ctx, sceneId, changed)
}

/** `set-condition {target | targets, name, on}` — idempotent both ways. */
function setCondition(p: Payload, ctx: Ctx): void {
  const { sceneId, tokens } = targetsOf(p, ctx)
  const name = parseCondition(p.name)
  const on = bool(p.on, 'on')
  const changed = tokens.flatMap((t) => {
    const had = t.conditions ?? []
    if (had.includes(name) === on) return []
    return [{ ...t, conditions: on ? [...had, name] : had.filter((c) => c !== name) }]
  })
  if (changed.length > 0) putAll(ctx, sceneId, changed)
}

/**
 * `set-effect {target | targets, name, rounds}` — sets (or replaces) a named timer; `rounds`
 * 0 or null removes it. Ticked down by `tick-effects` each time the encounter's round turns.
 */
function setEffect(p: Payload, ctx: Ctx): void {
  const { sceneId, tokens } = targetsOf(p, ctx)
  const name = str(p.name, 'name', EFFECT_NAME_MAX)
  const rounds = p.rounds === null || p.rounds === 0 ? 0 : num(p.rounds, 'rounds')
  if (!Number.isInteger(rounds) || rounds < 0 || rounds > ROUNDS_MAX) bad(`rounds must be a whole number in 0..${ROUNDS_MAX}`)
  const changed = tokens.map((t) => {
    const rest = (t.effects ?? []).filter((e) => e.name !== name)
    if (rest.length + (rounds > 0 ? 1 : 0) > EFFECTS_MAX) bad(`a token holds at most ${EFFECTS_MAX} effects`)
    return { ...t, effects: rounds > 0 ? [...rest, { name, roundsLeft: rounds }] : rest }
  })
  putAll(ctx, sceneId, changed)
}

/** `gather {targets, x, y}` — the party, fanned out one cell apart around the point. */
function gather(p: Payload, ctx: Ctx, terrainOf: TerrainOf): void {
  const { sceneId, tokens } = targetsOf(p, ctx)
  const at = { x: num(p.x, 'x'), y: num(p.y, 'y') }
  const spots = fanAround(at, tokens.length)
  putAll(
    ctx,
    sceneId,
    tokens.map((t, i) =>
      grounded({ ...t, x: snap(spots[i].x, t.size), y: snap(spots[i].y, t.size) }, sceneId, terrainOf),
    ),
  )
}

/** What one round does to a token's timers: one off each, and the ones at zero gone. */
export function tickEffectList(effects: readonly TokenEffect[]): { kept: TokenEffect[]; ended: string[] } {
  const kept: TokenEffect[] = []
  const ended: string[] = []
  for (const e of effects) {
    if (e.roundsLeft <= 1) ended.push(e.name)
    else kept.push({ ...e, roundsLeft: e.roundsLeft - 1 })
  }
  return { kept, ended }
}

/**
 * Internal only, like `spawn`: the server dispatches it when `initiative.next` turns the
 * round. Every timer on the scene ticks once; the ones that run out are named to the DM in
 * an `effects-ended` frame (hidden tokens included, so it never reaches a player).
 */
function tickEffects(p: Payload, ctx: Ctx): void {
  const sceneId = sceneOf(p, ctx)
  const changed: Token[] = []
  const ended: { tokenId: string; tokenName: string; name: string }[] = []
  for (const token of Object.values(ctx.state.byScene[sceneId] ?? {})) {
    if (!token.effects?.length) continue
    const tick = tickEffectList(token.effects)
    changed.push({ ...token, effects: tick.kept })
    for (const name of tick.ended) ended.push({ tokenId: token.id, tokenName: token.name, name })
  }
  if (changed.length === 0) return
  putAll(ctx, sceneId, changed)
  if (ended.length > 0) ctx.broadcast({ type: 'effects-ended', sceneId, ended })
}

/**
 * P4 §4 — one symmetric edge, written on both ends in one command.
 *
 * Symmetry is maintained here rather than read as a union at query time because the closure
 * walks the edges from whichever end the seed happens to be at: an edge stored on the familiar
 * alone would widen the party when the familiar is claimed and not when the scout is. Storing
 * both directions makes `sightParty` a plain BFS with nothing to reconcile.
 *
 * The empty array is dropped rather than persisted — absent ≡ no links (the type says so), and
 * keeping `[]` around would leave two encodings of the same fact on the wire.
 */
function setSightLink(p: Payload, ctx: Ctx): void {
  const { sceneId, token } = find(p, ctx)
  const otherId = str(p.otherId, 'otherId', ID_MAX)
  if (otherId === token.id) bad('a token cannot share sight with itself')
  const other = ctx.state.byScene[sceneId]?.[otherId]
  const linked = bool(p.linked, 'linked')
  // Linking needs both ends to exist; *unlinking* must not. A ghost id is exactly the state
  // this command has to be able to clean up (data written before `delete` pruned its edges),
  // and refusing it would leave the only way out a hand-edited database.
  if (linked && !other) bad('no such token in that scene')

  const withLink = (subject: Token, otherEnd: string): Token => {
    const links = new Set(subject.sharesSightWith ?? [])
    if (linked) links.add(otherEnd)
    else links.delete(otherEnd)
    const next = { ...subject }
    if (links.size === 0) delete next.sharesSightWith
    else next.sharesSightWith = [...links]
    return next
  }

  // One write, not two puts: `setState` persists and broadcasts, and half a symmetric edge on
  // the wire is a state no reader should ever have to cope with.
  const { state } = ctx
  ctx.setState({
    ...state,
    byScene: {
      ...state.byScene,
      [sceneId]: {
        ...state.byScene[sceneId],
        [token.id]: withLink(token, otherId),
        ...(other ? { [otherId]: withLink(other, token.id) } : {}),
      },
    },
  })
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
  // The edge is symmetric and maintained on write (`setSightLink`), so it has to be *un*written
  // on both ends here too — otherwise the familiar keeps naming a scout that no longer exists,
  // which every reader of `sharesSightWith` would then have to cope with.
  for (const id of token.sharesSightWith ?? []) {
    const other = scene[id]
    if (!other?.sharesSightWith) continue
    const links = other.sharesSightWith.filter((linkId) => linkId !== token.id)
    const next = { ...other }
    if (links.length === 0) delete next.sharesSightWith
    else next.sharesSightWith = links
    scene[id] = next
  }
  ctx.setState({ ...state, byScene: { ...state.byScene, [sceneId]: scene } })
}

function claim(p: Payload, ctx: Ctx): void {
  const { sceneId, token } = find(p, ctx)
  if (token.ownerId !== null) denied('that token is already claimed')
  put(ctx, sceneId, { ...token, ownerId: ctx.sender.identityId })
}

/**
 * The DM's side of `claim`, and the only way out of a real deadlock: claiming is done by
 * clicking a token on your own list, and in vision mode a seat with no token has no eyes, so
 * redaction sends it *no tokens at all* — nothing to click, so nothing to claim. Control stays
 * with the DM either way; this is the referee handing a piece over.
 *
 * Reassignment is deliberate (the DM overrides an existing owner — a player left, a familiar
 * changes hands) and `null` unhands it, so this one command is both directions. The identity
 * is checked against the roster rather than taken on trust: an ownerId nobody at the table
 * holds is a token no seat can ever move again.
 *
 * ponytail: a hidden token can be assigned, and `redact` still withholds it from its new
 * owner — hidden beats own-token there, exactly as it already does for a token claimed and
 * then hidden. That semantic is unchanged here.
 */
function assign(p: Payload, ctx: Ctx): void {
  const { sceneId, token } = find(p, ctx)
  const identityId = p.identityId === null ? null : str(p.identityId, 'identityId', ID_MAX)
  if (identityId !== null && !ctx.players.some((player) => player.identityId === identityId)) {
    bad('no such player at this table')
  }
  put(ctx, sceneId, { ...token, ownerId: identityId })
}

/**
 * DM-only: moves a token to another map level (`levelId`; `null` puts it back on the first
 * level). Players on the old level stop seeing it at once; the seat that claims it follows it
 * unless the DM pinned that seat (`triggers.set-seat-level`).
 */
function setTokenLevel(p: Payload, ctx: Ctx): void {
  const { sceneId, token } = find({ ...p, id: p.tokenId ?? p.id }, ctx)
  const next = { ...token }
  if (p.levelId === null) delete next.levelId
  else next.levelId = str(p.levelId, 'levelId', ID_MAX)
  put(ctx, sceneId, next)
}
