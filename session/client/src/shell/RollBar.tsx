// M4 — the player's composer, replacing the drawer's at the bottom of the map instead of the
// bottom of a scrolling column: always visible, always reachable with `/` (hotkeys.ts), and
// the one place a player types a roll without opening anything. The drawer keeps its own
// composer (`LogDrawer.tsx`) for the DM and for a player who has it open too — both post
// through the same `usePostRoll()` (`logFeed.ts`), so there is one submit rule, not two.

import { useState } from 'react';
import type { InitiativeState } from '@dnd/mechanics/initiative';
import type { TriggersState } from '@dnd/mechanics/triggers';
import { myPendingEntry } from '../session/initiativeView';
import { useModuleState, useSessionStore } from '../session/store';
import { visiblePrompts } from '../session/triggerVisibility';
import { Icon } from './icons';
import { usePostRoll } from './logFeed';

/** True while `InitiativePrompt` or `TriggerPrompts` has a card up for this seat — read the
 *  same store state those two components gate on, not a flag of our own, so this can never
 *  drift out of sync with whether a card is actually on screen. */
function usePromptOpen(): boolean {
  const initiativeState = useModuleState<InitiativeState>('initiative');
  const identityId = useSessionStore((s) => s.you?.identityId);
  const pending = myPendingEntry(initiativeState, identityId);

  const triggersState = useModuleState<TriggersState>('triggers');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const prompts = visiblePrompts(triggersState, sceneId);

  return !!pending || prompts.length > 0;
}

export function RollBar() {
  const postRoll = usePostRoll();
  const [draft, setDraft] = useState('');
  const [whisper, setWhisper] = useState(false);
  const shifted = usePromptOpen();

  const post = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    postRoll(trimmed, whisper ? 'private' : 'public');
    setDraft('');
    // One whisper at a time — the next line defaults back to public rather than a toggle
    // silently staying on for a table line the player meant everyone to see.
    setWhisper(false);
  };

  return (
    <div
      data-testid="roll-bar"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      className={`absolute bottom-10 left-1/2 flex h-[38px] w-[460px] max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-2 rounded-full border border-border-structure bg-surface-1/95 px-3 shadow-panel transition-transform duration-150 ease-settle motion-reduce:transition-none ${
        shifted ? '-translate-y-12' : ''
      }`}
    >
      <Icon name="dice" size={16} className="shrink-0 text-text-muted" />
      <form
        className="flex min-w-0 flex-1 items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          post();
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Roll or say something"
          placeholder="Roll or say something · stealth 17 · 1d20+2"
          maxLength={200}
          data-testid="manual-roll"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none"
        />
        <button
          type="button"
          aria-pressed={whisper}
          title="Send this line to only you and the DM"
          onClick={() => setWhisper((v) => !v)}
          className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors duration-150 ease-settle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none ${
            whisper
              ? 'border-accent-active bg-surface-3 text-accent-active'
              : 'border-border-default bg-transparent text-text-secondary hover:bg-surface-2'
          }`}
        >
          <Icon name="whisper" size={12} />
          Whisper
        </button>
        <button
          type="submit"
          disabled={!draft.trim()}
          className="inline-flex h-7 shrink-0 items-center rounded-full border border-accent-active bg-accent-active px-3 text-xs font-medium text-on-accent transition-colors duration-150 ease-settle hover:bg-accent-active/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
        >
          Post
        </button>
      </form>
    </div>
  );
}
