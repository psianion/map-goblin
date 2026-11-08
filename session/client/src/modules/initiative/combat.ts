// Table v2 — tokens into the fight. "Add to combat" on a token or group card, and the
// Encounter tab's Start, all build initiative entries the same way: a PC token is a `pc`
// entry its owner may roll for; everything else is the DM's `npc`.

import type { InitiativeEntry, InitiativeState } from '@dnd/mechanics/initiative';
import type { Token } from '@dnd/mechanics/tokens';
import { useSessionStore } from '../../session/store';

export const sendInitiative = (action: string, payload: unknown = {}): void =>
  useSessionStore.getState().sendCommand('initiative', action, payload);

/** The entry a token joins the order as. */
export function entryOf(token: Token): Pick<InitiativeEntry, 'name' | 'kind' | 'tokenId' | 'identityId'> {
  return {
    name: token.name,
    kind: token.kind === 'pc' ? 'pc' : 'npc',
    tokenId: token.id,
    ...(token.ownerId ? { identityId: token.ownerId } : {}),
  };
}

/** The tokens of `tokens` that are not in the encounter yet. */
export function notInCombat(tokens: readonly Token[], state: InitiativeState | undefined): Token[] {
  if (!state || state.status === 'idle') return [...tokens];
  const inFight = new Set(state.entries.map((e) => e.tokenId).filter(Boolean));
  return tokens.filter((t) => !inFight.has(t.id));
}

/** Start an encounter with these tokens, or add the ones not in it yet to the running one. */
export function addToCombat(tokens: readonly Token[], state: InitiativeState | undefined, sceneId: string | null): void {
  const joining = notInCombat(tokens, state);
  if (joining.length === 0) return;
  if (!state || state.status === 'idle') {
    sendInitiative('start', { ...(sceneId ? { sceneId } : {}), entries: joining.map(entryOf) });
    return;
  }
  for (const token of joining) sendInitiative('add', entryOf(token));
}
