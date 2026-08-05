// M4 — the non-blocking card stack for open trigger prompts (traps, ability checks). D9/D11
// rule out a modal outright: a dialog mid-play stops the game to ask a question nobody
// wanted asked. This gates attention instead — it sits over the map, the map stays
// interactive underneath it, and it goes away on its own once the prompt is resolved
// (`prompts` drops the entry, so the card simply stops being in the list next render).
//
// `absolute` positioning means the stack never participates in document flow, so a card
// appearing or leaving never reflows the map or the sidebar next to it — "reserve via fixed
// positioning" is what this already is, not an extra layout to add.

import { useState } from 'react';
import type { TriggersState } from '@dnd/mechanics/triggers';
import { prefersReducedMotion } from '../session/motion';
import { useModuleState, useSessionStore } from '../session/store';
import { promptMeta, visiblePrompts } from '../session/triggerVisibility';

const send = (action: string, payload: unknown): void =>
  useSessionStore.getState().sendCommand('triggers', action, payload);

export function TriggerPrompts() {
  const state = useModuleState<TriggersState>('triggers');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const isDm = useSessionStore((s) => s.you?.role === 'dm');
  const prompts = visiblePrompts(state, sceneId);
  // Roll is in flight until the server's state-update removes the card — disabling on click
  // spares the user a spurious refusal from a double-click racing the resolution.
  const [rolling, setRolling] = useState<string | null>(null);

  if (prompts.length === 0) return null;

  // Doctrine's own line for reduced motion (see ToastHost): the card is simply already
  // there, rather than a crossfade doing the "already there" job in slow motion.
  const entrance = prefersReducedMotion() ? '' : 'animate-toast-in';

  return (
    <div
      // Above the tool indicator (z-toolbar) and clear of the toast's own centred track —
      // parked one strip higher (bottom-20) so a toast firing at the same moment (a fresh
      // trap outcome, say) never lands on top of the card that caused it.
      className="pointer-events-none absolute inset-x-0 bottom-20 z-toolbar flex flex-col items-center gap-2 px-4 max-sm:bottom-28"
    >
      {prompts.map(({ prompt, needsDm }) => {
        const meta = promptMeta(prompt);
        return (
          <div
            key={prompt.id}
            data-testid="trigger-prompt"
            className={`pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded border border-border-default bg-surface-2 px-3 py-2 text-sm text-text-primary shadow-lg shadow-black/50 ${entrance}`}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate">{prompt.text}</p>
              {(meta || needsDm) && (
                <p className="truncate text-xs text-text-secondary">
                  {[meta, needsDm ? 'needs the DM' : null].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
            <button
              type="button"
              aria-label={`Roll: ${prompt.text}`}
              disabled={rolling === prompt.id}
              onClick={() => {
                setRolling(prompt.id);
                send('roll-prompt', { promptId: prompt.id });
              }}
              className="shrink-0 rounded-chip border border-border-default px-2 py-1 text-xs font-medium text-text-primary transition-colors duration-150 ease-out-quart hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus active:bg-surface-1 disabled:opacity-60 motion-reduce:transition-none"
            >
              {rolling === prompt.id ? 'Rolling…' : 'Roll'}
            </button>
            {isDm && (
              <button
                type="button"
                aria-label={`Dismiss: ${prompt.text}`}
                onClick={() => send('dismiss-prompt', { promptId: prompt.id })}
                className="shrink-0 rounded px-1.5 py-1 text-xs text-text-secondary transition-colors duration-150 ease-out-quart hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none"
              >
                Dismiss
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
