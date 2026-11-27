// Decision 16 on the server: the party's PC tokens are put on the map when the DM starts the
// table (and a late pick beside the party), a player who comes back under the same name gets
// their PC back, and token defs written before table v2 read with its defaults.

import {
  besideParty,
  cellKey,
  normalizeTokenDef,
  ownPcOf,
  partySpots,
  ringOffsets,
  standsAt,
  targetLevel,
  type PartyTarget,
  type TableFlags,
  type TokenDef,
  type TokensState,
} from '@dnd/mechanics/tokens'
import type { Stores } from './db/stores'
import type { Vision } from './fog/vision'
import type { AfterWrite, DispatchContext, ModuleRegistry } from './modules/registry'

/**
 * Places each def on the scene: the standable, free cells of the area from its centre outward,
 * then fanned out from the centre once the area is full (or from the point, for `near`), the way
 * an encounter's monsters fan out. Placed as the DM through `tokens.place`, so each token copies
 * its def (art, owner, HP) and lands on the ground under it. Only standable spots are taken: one
 * on rock or off the ground moves on, the way the walk grid would refuse a player there. Returns
 * how many were placed.
 */
export function placeParty(
  modules: ModuleRegistry,
  vision: Pick<Vision, 'visionOf'>,
  defs: readonly TokenDef[],
  target: PartyTarget,
  at: Pick<DispatchContext, 'campaignId' | 'sessionId' | 'players' | 'broadcast'> & { sceneId: string },
): number {
  if (defs.length === 0) return 0
  const state = modules.readState(at.campaignId, 'tokens') as TokensState | undefined
  const levelId = targetLevel(target)
  const spots = partySpots(target, defs.length)
  const taken = new Set(Object.values(state?.byScene[at.sceneId] ?? {}).map((t) => cellKey(t.x, t.y)))
  const scene = vision.visionOf(at.sceneId)
  const ctx: DispatchContext = {
    campaignId: at.campaignId,
    sessionId: at.sessionId,
    activeSceneId: at.sceneId,
    sender: { role: 'dm', identityId: 'server' },
    players: at.players,
    broadcast: at.broadcast,
  }
  let placed = 0
  let next = 0
  for (const def of defs) {
    while (next < spots.length) {
      const spot = spots[next++]!
      if (taken.has(cellKey(spot.x, spot.y)) || !standsAt(scene, def.size, spot.x, spot.y, levelId)) continue
      const refused = modules.dispatch(
        'tokens',
        'place',
        { sceneId: at.sceneId, defId: def.id, x: spot.x, y: spot.y, ...(levelId ? { levelId } : {}) },
        ctx,
      )
      if (!refused) {
        taken.add(cellKey(spot.x, spot.y))
        placed++
        break
      }
    }
  }
  return placed
}

/**
 * Table lobby pass §3.5, as an after-write rule. When the DM starts the table, every PC a seat
 * at this table holds and that is not on the live scene yet goes into the scene's party start
 * area (beside the party when the scene has none); PCs already there stay put, and a PC nobody
 * picked stays off the map. After Start, a seat that picks or makes its PC with no token on the
 * live scene gets it beside the party, else in the area. With neither, nothing is placed: the
 * DM's roster shows that seat without a token.
 */
export function partyPlacement(vision: Pick<Vision, 'visionOf'>, flagsOf: (sessionId: string) => TableFlags | null): AfterWrite {
  return ({ module, action }, ctx, registry) => {
    const start = module === 'table' && action === 'start'
    const pick = module === 'tokens' && (action === 'pc-claim' || action === 'pc-create')
    if (!(start || pick) || !flagsOf(ctx.sessionId)?.started) return
    const sceneId = ctx.activeSceneId
    const state = registry.readState(ctx.campaignId, 'tokens') as TokensState | undefined
    if (!sceneId || !state) return
    const onScene = Object.values(state.byScene[sceneId] ?? {})
    const area = state.partyStart?.[sceneId]
    const at = { campaignId: ctx.campaignId, sessionId: ctx.sessionId, players: ctx.players, broadcast: ctx.broadcast, sceneId }

    if (start) {
      const seats = new Set(ctx.players.map((p) => p.identityId))
      const here = new Set(onScene.map((t) => t.defId))
      const defs = Object.values(state.library).filter(
        (def) => def.kind === 'pc' && !!def.ownerIdentityId && seats.has(def.ownerIdentityId) && !here.has(def.id),
      )
      const target = area ? { area } : besideParty(onScene)
      if (target) placeParty(registry, vision, defs, target, at)
      return
    }
    if (onScene.some((t) => t.ownerId === ctx.sender.identityId)) return
    const def = ownPcOf(state, ctx.sender.identityId)
    const target = besideParty(onScene) ?? (area ? { area } : null)
    if (def && target) placeParty(registry, vision, [def], target, at)
  }
}

/**
 * The host wizard's start, written as the scene's party start area when it has none: the 3 by 3
 * cells round the chosen point or room anchor. Nobody is placed until the DM starts the table.
 */
export function storePartyStart(
  modules: ModuleRegistry,
  at: { campaignId: string; sessionId: string; sceneId: string; centre: { x: number; y: number }; levelId?: string; dmId: string },
): void {
  const state = modules.readState(at.campaignId, 'tokens') as TokensState | undefined
  if (state?.partyStart?.[at.sceneId]) return
  const [cx, cy] = [Math.floor(at.centre.x), Math.floor(at.centre.y)]
  const refused = modules.dispatch(
    'tokens',
    'set-party-start',
    { sceneId: at.sceneId, rect: { x0: cx - 1, y0: cy - 1, x1: cx + 1, y1: cy + 1 }, ...(at.levelId ? { levelId: at.levelId } : {}) },
    {
      campaignId: at.campaignId,
      sessionId: at.sessionId,
      activeSceneId: at.sceneId,
      sender: { role: 'dm', identityId: at.dmId },
      players: [],
      // Nobody is at the table yet: the session was opened a moment ago.
      broadcast: () => {},
    },
  )
  if (refused) console.warn(`[party] party start refused: ${refused.message}`)
}

/** How many rings of cells round the map's start a party start area may move to find standing room. */
const START_SEARCH_RINGS = 24

/**
 * Finishing pass 12.1: a scene that goes live with no party start area gets one, so the DM always
 * sees an outline and Start always places the party. It is the 3 by 3 cells round the map's own
 * `partyStart`, else round the centre of the map, moved to the nearest spot where all nine cells
 * can be stood on (else the one with the most). A scene that has an area keeps it.
 */
export function ensurePartyStart(
  modules: ModuleRegistry,
  vision: Pick<Vision, 'sceneMapOf' | 'visionOf'>,
  at: { campaignId: string; sessionId: string; sceneId: string; broadcast?: DispatchContext['broadcast'] },
): void {
  const state = modules.readState(at.campaignId, 'tokens') as TokensState | undefined
  if (state?.partyStart?.[at.sceneId]) return
  const map = vision.sceneMapOf(at.sceneId)
  if (!map) return
  const start = map.data.mapSettings?.partyStart
  const { frame } = map
  const point = start ?? (frame ? { x: (frame.minX + frame.maxX) / 2, y: (frame.minY + frame.maxY) / 2 } : null)
  if (!point) return
  const levels = map.data.levels ?? []
  const levelId = start?.levelId && levels.length > 1 && levels.some((l) => l.id === start.levelId) ? start.levelId : undefined

  const scene = vision.visionOf(at.sceneId)
  const seen = new Map<string, boolean>()
  const stands = (x: number, y: number): boolean => {
    const key = `${x},${y}`
    let ok = seen.get(key)
    if (ok === undefined) seen.set(key, (ok = standsAt(scene, 'medium', x + 0.5, y + 0.5, levelId)))
    return ok
  }
  const [px, py] = [Math.floor(point.x), Math.floor(point.y)]
  let best = { x: px, y: py, room: 0 }
  for (const [dx, dy] of ringOffsets(START_SEARCH_RINGS)) {
    const [x, y] = [px + dx, py + dy]
    if (!stands(x, y)) continue
    let room = 0
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (stands(x + i, y + j)) room++
    if (room > best.room) best = { x, y, room }
    if (room === 9) break
  }
  const refused = modules.dispatch(
    'tokens',
    'set-party-start',
    { sceneId: at.sceneId, rect: { x0: best.x - 1, y0: best.y - 1, x1: best.x + 1, y1: best.y + 1 }, ...(levelId ? { levelId } : {}) },
    {
      campaignId: at.campaignId,
      sessionId: at.sessionId,
      activeSceneId: at.sceneId,
      sender: { role: 'dm', identityId: 'server' },
      players: [],
      broadcast: at.broadcast ?? (() => {}),
    },
  )
  if (refused) console.warn(`[party] party start refused: ${refused.message}`)
}

/** A scene the DM switches to gets its party start area then (`ensurePartyStart`). */
export function partyStartOnSwitch(vision: Pick<Vision, 'sceneMapOf' | 'visionOf'>): AfterWrite {
  return ({ module, action, sceneId }, ctx, registry) => {
    if (module !== 'scenes' || action !== 'activate' || !sceneId) return
    ensurePartyStart(registry, vision, { campaignId: ctx.campaignId, sessionId: ctx.sessionId, sceneId, broadcast: ctx.broadcast })
  }
}

/**
 * A player joining under a name takes their PC back: a PC def whose `ownerName` matches, and
 * every token placed from it or handed to that name (`ownerName`, stamped by `claim` and
 * `assign`), point at their new seat. A name match is enough for a home table, where the
 * players know each other; a table with strangers would need accounts, which are out of scope.
 *
 * Table fix pass F2: never from someone still at the table. Nothing attaches while another
 * connected seat already goes by that name, and a token whose current owner is connected stays
 * theirs: the DM hands it over instead. Returns whether anything changed.
 */
export function reattachPc(
  stores: Pick<Stores, 'moduleState'>,
  campaignId: string,
  identityId: string,
  name: string,
  connected: readonly { identityId: string; name: string; connected: boolean }[] = [],
): boolean {
  const state = stores.moduleState.get(campaignId, 'tokens') as TokensState | undefined
  if (!state) return false
  const wanted = name.trim().toLowerCase()
  const matches = (owner: string | undefined) => owner?.trim().toLowerCase() === wanted
  const live = new Set(connected.filter((p) => p.connected && p.identityId !== identityId).map((p) => p.identityId))
  if (connected.some((p) => live.has(p.identityId) && matches(p.name))) return false
  const free = (owner: string | null | undefined) => !owner || !live.has(owner)

  const defIds = new Set(
    Object.values(state.library)
      .filter((def) => normalizeTokenDef(def).kind === 'pc' && matches(def.ownerName) && free(def.ownerIdentityId))
      .map((def) => def.id),
  )
  let changed = false
  const library = { ...state.library }
  for (const id of defIds) {
    library[id] = { ...library[id]!, ownerIdentityId: identityId }
    changed = true
  }
  const byScene: TokensState['byScene'] = {}
  for (const [sceneId, tokens] of Object.entries(state.byScene)) {
    byScene[sceneId] = Object.fromEntries(
      Object.entries(tokens).map(([id, token]) => {
        const ours = (token.defId !== null && defIds.has(token.defId)) || matches(token.ownerName)
        if (!ours || token.ownerId === identityId || !free(token.ownerId)) return [id, token]
        changed = true
        return [id, { ...token, ownerId: identityId, ...(token.defId !== null && defIds.has(token.defId) ? { ownerIdentityId: identityId } : {}) }]
      }),
    )
  }
  if (!changed) return false
  stores.moduleState.put(campaignId, 'tokens', { ...state, library, byScene })
  return true
}

/**
 * Startup: every stored token def and placed token gets the table v2 fields it lacks
 * (`kind` npc, `nameplate` hover, `showHp` dm, no conditions or effects), so nothing past
 * this point meets a row written before them. Returns how many campaigns were rewritten.
 */
export function fillTokenDefaults(stores: Pick<Stores, 'campaigns' | 'moduleState'>): number {
  let rewritten = 0
  for (const campaign of stores.campaigns.list()) {
    const state = stores.moduleState.get(campaign.id, 'tokens') as TokensState | undefined
    if (!state) continue
    let changed = false
    const fill = <T extends TokensState['library'][string]>(def: T): T => {
      const next = normalizeTokenDef(def)
      if (next !== def) changed = true
      return next
    }
    const library = Object.fromEntries(Object.entries(state.library).map(([id, def]) => [id, fill(def)]))
    const byScene = Object.fromEntries(
      Object.entries(state.byScene).map(([sceneId, tokens]) => [
        sceneId,
        Object.fromEntries(Object.entries(tokens).map(([id, token]) => [id, fill(token)])),
      ]),
    )
    if (!changed) continue
    stores.moduleState.put(campaign.id, 'tokens', { ...state, library, byScene })
    rewritten++
  }
  return rewritten
}
