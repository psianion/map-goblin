// Table fix pass §2.6 — By hand mode: the room, or Outdoors, that a player-owned token or a PC
// is put in is revealed then, and stored. One hook after the token writes that put a party token
// somewhere, plus the one-time pass at server start for sessions already running.

import { PARTY_HERE } from '@dnd/mechanics/fog'
import type { AfterWrite, DispatchContext, ModuleRegistry } from '../modules/registry'
import type { Vision } from './vision'

/** The token writes that put a party token in a room or Outdoors. */
const TRIGGERS: readonly string[] = ['place', 'move', 'claim', 'assign', 'gather', 'set-token-level']
/** …and the writes that can move which rows the party sees (§2.6): its tokens, and doors. */
const MOVES_SIGHT: Record<string, readonly string[]> = {
  tokens: [...TRIGGERS, 'hide', 'delete'],
  doors: ['toggle', 'lock', 'reveal-secret'],
}

export function partyHere(vision: Vision): AfterWrite {
  // The rows each scene's seats were last sent: the fog slice carries them (`visible`), and
  // only a fog write re-sends it, so a party walking into another area re-sends it here.
  const sent = new Map<string, string>()
  return ({ module, action, sceneId }, ctx, registry) => {
    if (!sceneId || !MOVES_SIGHT[module]?.includes(action)) return
    if (module === 'tokens' && TRIGGERS.includes(action)) reveal(vision, registry, sceneId, ctx)
    const rows = (vision.visibleOf(sceneId) ?? []).join('\n')
    const before = sent.get(sceneId)
    sent.set(sceneId, rows)
    if (before !== undefined && before !== rows) registry.refresh('fog', ctx, sceneId)
  }
}

/** Writes the patch for one scene, if there is one. Also called at session and server start. */
export function reveal(
  vision: Pick<Vision, 'partyHerePatch'>,
  registry: Pick<ModuleRegistry, 'dispatchInternal'>,
  sceneId: string,
  ctx: DispatchContext,
): void {
  const patch = vision.partyHerePatch(sceneId)
  if (!patch) return
  const error = registry.dispatchInternal('fog', PARTY_HERE, patch, ctx)
  if (error) console.warn(`[fog] party-here refused: ${error.message}`)
}
