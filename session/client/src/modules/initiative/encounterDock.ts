// Table v2 — the Encounter tab's dock hooks: the context text at the end of the tab row, and
// the DM-side loop that says when a round ran an effect timer out.

import { notify } from '@dnd/ui/toast';
import type { InitiativeState } from '@dnd/mechanics/initiative';
import { useSessionStore } from '../../session/store';

/** "Round 3 · Bram's turn", or "Rolling initiative", while a fight runs on this scene. */
export function encounterContext(): string | null {
  const session = useSessionStore.getState().session;
  const state = session?.modules.initiative as InitiativeState | undefined;
  if (!state || state.status === 'idle' || state.sceneId !== session?.activeSceneId) return null;
  if (state.status === 'gathering') return 'Rolling initiative';
  const who = state.entries[state.turn]?.name;
  return who ? `Round ${state.round} · ${who}'s turn` : `Round ${state.round}`;
}

/** "Bless on Bram ends." — one toast per timer that ran out (board 16). */
export function effectEndedText(e: { tokenName: string; name: string }): string {
  return `${e.name} on ${e.tokenName} ends.`;
}

/** While the DM sits at the table: toast every `effects-ended` the server sends. */
export function encounterOnMap(): () => void {
  let seen = useSessionStore.getState().effectsEnded;
  return useSessionStore.subscribe((s) => {
    if (s.effectsEnded === seen) return;
    seen = s.effectsEnded;
    for (const e of seen?.ended ?? []) notify.info(effectEndedText(e));
  });
}
