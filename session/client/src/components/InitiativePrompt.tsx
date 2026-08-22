// The one card a player gets from the initiative tracker: "you owe the table a number".
// Same shape as TriggerPrompts and for the same reason — a modal mid-fight stops the game to
// ask a question everyone already knows the answer to. It sits over the map, the map stays
// live under it, and it leaves on its own the moment the entry fills, from whichever source
// filled it (a Beyond20 roll captured on the way past, the DM typing it, the bot).

import { useState } from 'react';
import type { InitiativeState } from '@dnd/mechanics/initiative';
import type { RollEvent } from '@dnd/mechanics/rolls';
import { lastRollTotal, myPendingEntry } from '../session/initiativeView';
import { prefersReducedMotion } from '../session/motion';
import { useModuleState, useSessionStore } from '../session/store';

const send = (key: string, value: number): void =>
  useSessionStore.getState().sendCommand('initiative', 'set', { key, value });

const chipButton =
  'shrink-0 rounded-chip border border-border-default px-2 py-1 text-xs font-medium text-text-primary transition-colors duration-150 ease-out-quart hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus active:bg-surface-1 disabled:opacity-60 motion-reduce:transition-none';

export function InitiativePrompt() {
  const state = useModuleState<InitiativeState>('initiative');
  // `log?` deliberately loosens `RollsState`, as in GameLog: the slice is absent before the
  // join snapshot and untrusted after it.
  const rolls = useModuleState<{ log?: RollEvent[] }>('rolls');
  const identityId = useSessionStore((s) => s.you?.identityId);
  const [draft, setDraft] = useState('');

  const entry = myPendingEntry(state, identityId);
  const last = lastRollTotal(rolls, identityId);
  if (!entry) return null;

  const submit = (value: number) => {
    send(entry.key, value);
    setDraft('');
  };

  const typed = Number(draft);
  const entrance = prefersReducedMotion() ? '' : 'animate-toast-in';

  return (
    <div
      // One strip above the trigger card's track, so a trap prompt firing in the same
      // moment stacks with this rather than landing on top of it.
      className="pointer-events-none absolute inset-x-0 bottom-32 z-toolbar flex flex-col items-center px-4 max-sm:bottom-40"
    >
      <div
        data-testid="initiative-prompt"
        className={`pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded border border-border-default bg-surface-2 px-3 py-2 text-sm text-text-primary shadow-lg shadow-black/50 ${entrance}`}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate">Roll for initiative</p>
          <p className="truncate text-xs text-text-secondary">{entry.name}</p>
        </div>

        {last !== undefined && (
          <button
            type="button"
            aria-label={`Use my last roll, ${last}`}
            onClick={() => submit(last)}
            className={chipButton}
          >
            Last roll {last}
          </button>
        )}

        <form
          className="flex shrink-0 items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (Number.isFinite(typed)) submit(typed);
          }}
        >
          <input
            type="number"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label={`Initiative for ${entry.name}`}
            className="w-14 rounded border border-border-default bg-surface-1 px-1.5 py-1 text-sm text-text-primary focus:border-border-focus focus:outline-none"
          />
          <button type="submit" disabled={!draft.trim()} className={chipButton}>
            Set
          </button>
        </form>
      </div>
    </div>
  );
}
