// Decision 16 on the server: the party's PC tokens are on the map when the table opens, a
// player who comes back under the same name gets their PC back, and token defs written
// before table v2 read with its defaults.

import { fanAround, normalizeTokenDef, type TokensState } from '@dnd/mechanics/tokens'
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
 */
export function spawnParty(
  modules: ModuleRegistry,
  vision: Pick<Vision, 'sceneMapOf'>,
  at: { campaignId: string; sessionId: string; sceneId: string; roomId: string; dmId: string; levelId?: string },
): number {
  const state = modules.readState(at.campaignId, 'tokens') as TokensState | undefined
  if (!state) return 0
  const onScene = new Set(Object.values(state.byScene[at.sceneId] ?? {}).map((t) => t.defId))
  const party = Object.values(state.library)
    .map((def) => normalizeTokenDef(def))
    .filter((def) => def.kind === 'pc' && !onScene.has(def.id))
  if (party.length === 0) return 0
  const room = vision.sceneMapOf(at.sceneId)?.rooms.find((r) => r.id === at.roomId)
  if (!room) return 0

  const spots = fanAround(roomAnchor(room), party.length + SPARE_SPOTS)
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
 * A player joining under a PC def's `ownerName` takes that PC back: the def and every token
 * placed from it point at their new seat. A name match is enough for a home table, where
 * the players know each other; a table with strangers would need accounts, which are out
 * of scope. Returns whether anything changed.
 */
export function reattachPc(stores: Pick<Stores, 'moduleState'>, campaignId: string, identityId: string, name: string): boolean {
  const state = stores.moduleState.get(campaignId, 'tokens') as TokensState | undefined
  if (!state) return false
  const wanted = name.trim().toLowerCase()
  const defIds = new Set(
    Object.values(state.library)
      .filter((def) => normalizeTokenDef(def).kind === 'pc' && def.ownerName?.trim().toLowerCase() === wanted)
      .map((def) => def.id),
  )
  if (defIds.size === 0) return false

  const library = { ...state.library }
  for (const id of defIds) library[id] = { ...library[id]!, ownerIdentityId: identityId }
  const byScene: TokensState['byScene'] = {}
  for (const [sceneId, tokens] of Object.entries(state.byScene)) {
    byScene[sceneId] = Object.fromEntries(
      Object.entries(tokens).map(([id, token]) =>
        token.defId !== null && defIds.has(token.defId) ? [id, { ...token, ownerIdentityId: identityId, ownerId: identityId }] : [id, token],
      ),
    )
  }
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
