import type { InitiativeEntry, InitiativeState } from '@dnd/mechanics/initiative';
import type { TokensState } from '@dnd/mechanics/tokens';
import { Button, FloatBox, IconKeyButton, PrimaryButton, cn } from '@dnd/ui';
import { ChevronLeft } from '@dnd/ui/icons';
import { useModuleState, useSessionStore } from '../../session/store';
import { seatColour } from '../seatColour';
import { initials } from '../top/roster';

/** An entry is this seat's by identity, or through the token it owns. */
function isMine(entry: InitiativeEntry, identityId: string | undefined, tokens: TokensState | undefined, sceneId: string | null): boolean {
  if (!identityId) return false;
  if (entry.identityId === identityId) return true;
  if (!entry.tokenId || !sceneId) return false;
  return tokens?.byScene?.[sceneId]?.[entry.tokenId]?.ownerId === identityId;
}

const send = (action: string): void => useSessionStore.getState().sendCommand('initiative', action, {});

/**
 * Board 3 and 5: top centre while an encounter runs on this scene. Portrait chips in turn
 * order, the current one enlarged with a ring, the round, the previous arrow and Next for the
 * DM, End turn for the player whose turn it is.
 */
export function CombatBar() {
  const state = useModuleState<InitiativeState>('initiative');
  const tokens = useModuleState<TokensState>('tokens');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const you = useSessionStore((s) => s.you);
  if (!state || state.status !== 'running' || state.sceneId !== sceneId) return null;
  const entries = Array.isArray(state.entries) ? state.entries : [];
  if (entries.length === 0) return null;
  const dm = you?.role === 'dm';
  const current = entries[state.turn];
  const myTurn = !!current && !dm && isMine(current, you?.identityId, tokens, sceneId);

  return (
    <FloatBox
      className="absolute top-3 left-1/2 z-20 flex h-14 -translate-x-1/2 items-center gap-2 px-2 py-0"
      data-testid="combat-bar"
      data-chrome
      role="region"
      aria-label="Combat"
    >
      {dm && <IconKeyButton size={28} icon={ChevronLeft} label="Previous turn" data-testid="combat-previous" onClick={() => send('previous')} />}
      <ol className="flex items-center gap-1.5" aria-label="Turn order">
        {entries.map((e, i) => {
          const now = i === state.turn;
          const down = !!e.hp && e.hp.current === 0;
          return (
            <li
              key={e.key}
              data-testid="combat-chip"
              data-current={now ? 'true' : undefined}
              title={e.name}
              aria-current={now ? 'true' : undefined}
              className={cn(
                'flex shrink-0 items-center justify-center rounded-pill border border-line font-medium text-white',
                now ? 'size-10 text-sm ring-2 ring-ink ring-offset-2 ring-offset-panel' : 'size-8 text-xs',
                down && 'opacity-40',
              )}
              style={{ backgroundColor: e.identityId ? seatColour(e.identityId) : 'var(--text-3)' }}
            >
              {initials(e.name)}
            </li>
          );
        })}
      </ol>
      <span className="px-1 font-mono text-xs whitespace-nowrap text-text-2" data-testid="combat-round">
        Round {state.round}
      </span>
      {dm && (
        <PrimaryButton className="h-8 px-3 text-xs" data-testid="combat-next" onClick={() => send('next')}>
          Next
        </PrimaryButton>
      )}
      {myTurn && (
        <Button variant="default" className="h-8 px-3 text-xs" data-testid="combat-end-turn" onClick={() => send('end-turn')}>
          End turn
        </Button>
      )}
    </FloatBox>
  );
}
