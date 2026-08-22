// M4 — the player's whole answer to "whose turn is it": a pill over the top-centre of the
// map, mounted only while an encounter is running on the scene this seat is looking at. The
// DM gets the same answer from `PartyStrip`'s turn order (§plan "Top-left is the party"), so
// this only ever mounts for the player seat (`GameTable`'s composition, not a role check
// here — same split `TableStatusBar` draws between DM/player paths).

import type { InitiativeEntry, InitiativeState } from '@dnd/mechanics/initiative';
import type { TokensState } from '@dnd/mechanics/tokens';
import { useModuleState, useSessionStore } from '../session/store';
import { useShell } from './shellStore';

/** An entry is "yours" by identity, or — for an off-board seat filling in for a monster's
 *  token, or simply because the entry only carries a `tokenId` — by owning the token it
 *  turns for. Same fallback the plan calls out; nowhere else in the shell needs it yet. */
function isMine(
  entry: InitiativeEntry,
  identityId: string | undefined,
  tokensState: TokensState | undefined,
  sceneId: string | null,
): boolean {
  if (!identityId) return false;
  if (entry.identityId === identityId) return true;
  if (!entry.tokenId || !sceneId) return false;
  return tokensState?.byScene?.[sceneId]?.[entry.tokenId]?.ownerId === identityId;
}

export function TurnPill() {
  const state = useModuleState<InitiativeState>('initiative');
  const tokensState = useModuleState<TokensState>('tokens');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const identityId = useSessionStore((s) => s.you?.identityId);
  const openPanelById = useShell((s) => s.openPanelById);

  if (!state || state.status !== 'running' || state.sceneId !== sceneId || state.entries.length === 0) {
    return null;
  }

  const current = state.entries[state.turn];
  if (!current) return null;

  const myTurn = isMine(current, identityId, tokensState, sceneId);
  const nextEntry = state.entries[(state.turn + 1) % state.entries.length];
  const upNext = !myTurn && !!nextEntry && isMine(nextEntry, identityId, tokensState, sceneId);

  return (
    <button
      type="button"
      data-testid="turn-pill"
      aria-label="Open the initiative order"
      onClick={() => openPanelById('initiative')}
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute top-2.5 left-1/2 flex h-[34px] -translate-x-1/2 items-center gap-2.5 rounded-full border border-border-structure bg-surface-1/95 px-3.5 text-[13px] shadow-panel transition-colors duration-150 ease-settle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none"
    >
      <b className={myTurn ? 'text-accent-active' : 'font-semibold text-text-primary'}>
        {myTurn ? 'Your turn' : `${current.name}'s turn`}
      </b>
      <span className="text-text-muted">
        {upNext ? `you're up next · round ${state.round}` : `round ${state.round}`}
      </span>
    </button>
  );
}
