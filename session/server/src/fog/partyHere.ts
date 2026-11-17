// Table fix pass §2.6 — By hand mode: the room, or Outdoors, that a player-owned token or a PC
// is put in is revealed then, and stored. One hook after the token writes that put a party token
// somewhere, plus the one-time pass at server start for sessions already running.

import { PARTY_HERE } from '@dnd/mechanics/fog'
import type { AfterWrite, DispatchContext, ModuleRegistry } from '../modules/registry'
import type { Vision } from './vision'

/** The token writes that put a party token in a room or Outdoors. */
const TRIGGERS: readonly string[] = ['place', 'move', 'claim', 'assign', 'gather', 'set-token-level']

export function partyHere(vision: Vision): AfterWrite {
  return ({ module, action, sceneId }, ctx, registry) => {
    if (module !== 'tokens' || !sceneId || !TRIGGERS.includes(action)) return
    reveal(vision, registry, sceneId, ctx)
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
