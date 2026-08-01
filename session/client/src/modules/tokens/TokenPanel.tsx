// §2.4.8 — the shared token panel: what is on this scene, what you have selected, and
// the claim affordance. It is also where the Pixi overlay is mounted from, because a
// panel is this module's only React lifecycle (D8) and the engine is only ready some time
// after boot (§4).

import { useEffect, useMemo } from 'react';
import type { TokensState } from '@dnd/mechanics/tokens';
import { ALL_ROLES, registerPanel } from '../../session/panels';
import { useModuleState, useSessionStore } from '../../session/store';
import { showToast } from '../../session/toasts';
import { liveSceneDoors } from '../doors/DoorRenderer';
import { tokenRefusal, useTokenInteraction } from './drag';
import { mountTokenLayerWhenReady, tokensOf } from './TokenRenderer';

const send = (action: string, payload: unknown): void =>
  useSessionStore.getState().sendCommand('tokens', action, payload);

/**
 * Turns the server's refusal into the one toast the table has — the doors lane's
 * `useDoorFeedback`, for the move a player is not allowed to make. Without it the only
 * feedback is the 600ms rubber-band in `TokenRenderer`, which reads as a dropped frame
 * rather than as an answer.
 *
 * Only the seat that sent the move ever sees it: a refusal reaches the sender alone
 * (`CommandRouter`), and the DM is refused by none of this (`canOccupy` passes the DM).
 */
function useTokenFeedback(): void {
  const lastError = useSessionStore((s) => s.lastError);
  useEffect(() => {
    if (!lastError) return;
    // The doors this seat holds, read at refusal time rather than subscribed to: the name
    // is wanted once, for the sentence, and a door list is not a reason to re-toast.
    const message = tokenRefusal(lastError.message, liveSceneDoors());
    // One toast per rejected drop, not one per refused message: a drag across a wall is
    // refused at ~10 Hz on the way and again on the drop, and the last throttled move can
    // land after the pointer is already up. An accepted move raises no error at all, so a
    // slow echo (the case the rubber-band also fires on) stays silent.
    //
    // The de-duplication is `useToasts.show`'s, not this hook's: it keeps the one toast but
    // restarts its window, so the refusal a player reads on the drop is not one already
    // most of the way through its life because the drag tripped it seconds earlier.
    if (!message) return;
    showToast({ message });
  }, [lastError]);
}

export function TokenPanel() {
  const state = useModuleState<TokensState>('tokens');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const players = useSessionStore((s) => s.session?.players);
  const you = useSessionStore((s) => s.you);
  const selectedId = useTokenInteraction((s) => s.selectedId);
  const select = useTokenInteraction((s) => s.select);

  // Mount for as long as the table is on screen; the helper handles the engine appearing
  // late and going away again.
  useEffect(() => mountTokenLayerWhenReady(), []);
  useTokenFeedback();

  const tokens = useMemo(() => tokensOf(state, sceneId), [state, sceneId]);
  const selected = tokens.find((t) => t.id === selectedId);
  const owner = players?.find((p) => p.identityId === selected?.ownerId);
  const isDm = you?.role === 'dm';

  return (
    <div className="flex flex-col gap-2 text-sm">
      {tokens.length === 0 ? (
        <p className="text-neutral-500">No tokens on this scene.</p>
      ) : (
        <ul data-testid="token-layer" className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
          {tokens.map((t) => (
            <li
              key={t.id}
              data-token-id={t.id}
              data-x={t.x}
              data-y={t.y}
              data-hidden={t.hidden || undefined}
              data-owner={t.ownerId ?? undefined}
            >
              <button
                type="button"
                aria-current={t.id === selectedId}
                onClick={() => select(t.id)}
                className={`w-full truncate rounded px-2 py-0.5 text-left ${
                  t.id === selectedId
                    ? 'bg-neutral-800 text-neutral-100'
                    : 'text-neutral-400 hover:bg-neutral-800/60'
                }`}
              >
                {t.name}
                {t.hidden && <span className="ml-1 text-xs text-neutral-500">hidden</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div data-testid="token-selection" className="flex flex-col gap-1 border-t border-neutral-800 pt-2">
          <p className="truncate text-neutral-200">{selected.name}</p>
          <p className="text-xs text-neutral-500">
            {selected.size} · {selected.disposition} · {owner ? `held by ${owner.name}` : 'unclaimed'}
          </p>
          <div className="flex flex-wrap gap-1">
            {you?.role === 'player' && selected.ownerId === null && (
              <button
                type="button"
                data-testid="claim-button"
                onClick={() => send('claim', { id: selected.id })}
                className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-100 hover:bg-neutral-700"
              >
                Claim
              </button>
            )}
            {isDm && (
              <>
                <button
                  type="button"
                  data-testid="token-hide"
                  onClick={() => send('hide', { id: selected.id, hidden: !selected.hidden })}
                  className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-100 hover:bg-neutral-700"
                >
                  {selected.hidden ? 'Reveal' : 'Hide'}
                </button>
                <button
                  type="button"
                  data-testid="token-delete"
                  onClick={() => {
                    send('delete', { id: selected.id });
                    select(null);
                  }}
                  className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-red-300 hover:bg-neutral-700"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

registerPanel({ id: 'tokens', title: 'Tokens', roles: ALL_ROLES, order: 15, component: TokenPanel });
