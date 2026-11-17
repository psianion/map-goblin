// Decision 16 on the server: the party's PC tokens are on the map when the table opens, a
// player who comes back under the same name gets their PC back, and token defs written
// before table v2 read with its defaults.

import { OUTSIDE_MAP, SOLID_GROUND, fanAround, normalizeTokenDef, type TokensState } from '@dnd/mechanics/tokens'
import type { Stores } from './db/stores'
import { roomAnchor } from './fog/sceneMap'
import type { Vision } from './fog/vision'
import type { ModuleRegistry } from './modules/registry'

/** Spots tried past one per PC, for a PC whose first spot is taken. */
const SPARE_SPOTS = 24

/**
 * Places every PC def not already on the scene, fanned out from the starting room's anchor
 * the way an encounter's monsters fan out. Placed as the DM through `tokens.place`, so each
 * token copies its def (art, owner, HP) and lands on the ground under it. A spot the tokens
 * module refuses (taken, a wall) moves on to the next. `levelId` is the starting room's level
 * on a map with several. Returns how many were placed.
 *
 * Table fix pass F18: the start may be a point instead of a room (the map's party start, or its
 * centre), and only standable spots are taken — a fan that lands on rock or off the ground moves
 * on, the way the walk grid would refuse a player there.
 */
export function spawnParty(
  modules: ModuleRegistry,
  vision: Pick<Vision, 'sceneMapOf' | 'visionOf'>,
  at: {
    campaignId: string
    sessionId: string
    sceneId: string
    roomId?: string
    point?: { x: number; y: number }
    dmId: string
    levelId?: string
  },
): number {
  const state = modules.readState(at.campaignId, 'tokens') as TokensState | undefined
  if (!state) return 0
  const onScene = new Set(Object.values(state.byScene[at.sceneId] ?? {}).map((t) => t.defId))
  const party = Object.values(state.library)
    .map((def) => normalizeTokenDef(def))
    .filter((def) => def.kind === 'pc' && !onScene.has(def.id))
  if (party.length === 0) return 0
  const room = at.roomId ? vision.sceneMapOf(at.sceneId)?.rooms.find((r) => r.id === at.roomId) : undefined
  const centre = at.point ?? (room ? roomAnchor(room) : null)
  if (!centre) return 0

  const scene = vision.visionOf(at.sceneId)
  const standable = (x: number, y: number, def: (typeof party)[number]): boolean => {
    const why = scene?.walkRefusal?.({ ...def, defId: def.id, x, y, elevation: 0, z: 0, hidden: false, ownerId: null, ...(at.levelId ? { levelId: at.levelId } : {}) }, { x, y }, null)
    return !why || !(why.startsWith(OUTSIDE_MAP) || why.startsWith(SOLID_GROUND))
  }
  const spots = fanAround(centre, party.length + SPARE_SPOTS)
  const ctx = {
    campaignId: at.campaignId,
    sessionId: at.sessionId,
    activeSceneId: at.sceneId,
    sender: { role: 'dm' as const, identityId: at.dmId },
    players: [],
    // Nobody is at the table yet: the session was opened a moment ago.
    broadcast: () => {},
  }
  let placed = 0
  let next = 0
  for (const def of party) {
    while (next < spots.length) {
      const spot = spots[next++]!
      if (!standable(spot.x, spot.y, def)) continue
      const refused = modules.dispatch(
        'tokens',
        'place',
        { sceneId: at.sceneId, defId: def.id, x: spot.x, y: spot.y, ...(at.levelId ? { levelId: at.levelId } : {}) },
        ctx,
      )
      if (!refused) {
        placed++
        break
      }
    }
  }
  return placed
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
