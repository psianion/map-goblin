// M4 — the DM's trigger board: every trigger authored on the active scene, its runtime
// state, and the trigger log (this module's own §2.4.3-style firehose — trap outcomes and
// secret 'prompt' narration land here, never on a player's screen).
//
// Prep (`TriggerDef[]`) lives server-side, authored in the map editor — the table client has
// never held it before M4, so this panel is the one place in session/client that reaches for
// it over REST rather than the WS snapshot, the same shape SessionControls already uses for
// its own DM-only scene library.

import { useEffect, useMemo, useState } from 'react';
import type { ScenePrep, TriggerCondition } from '@dnd/core/src/shared/prep';
import type { TriggersState } from '@dnd/mechanics/triggers';
import { sceneTriggersOf } from '@dnd/mechanics/triggers';
import { getScenePrep } from '../../session/auth';
import { registerPanel } from '../../session/panels';
import { useModuleState, useSessionStore } from '../../session/store';

const send = (action: string, payload: unknown): void =>
  useSessionStore.getState().sendCommand('triggers', action, payload);

const CONDITION_LABEL: Record<TriggerCondition['kind'], string> = {
  'room-revealed': 'Room revealed',
  'enter-region': 'Enters region',
  'within-radius': 'Within radius',
};

/** A fetch result tagged with the scene it answers — so a slow response for a scene the DM
 *  has already switched away from is never shown as this one's. */
type PrepFetch = { sceneId: string; prep: ScenePrep | null } | { sceneId: string; error: string };

export function TriggerPanel() {
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const state = useModuleState<TriggersState>('triggers');
  const [fetched, setFetched] = useState<PrepFetch | null>(null);

  // Refetches on every scene switch — quiet by design (see the endpoint's own PUT), so
  // nothing else tells this panel prep changed underneath it.
  useEffect(() => {
    if (!sceneId) return;
    const { token } = useSessionStore.getState();
    if (!token) return;
    getScenePrep(sceneId, token)
      .then((res) => setFetched({ sceneId, prep: res.prep }))
      .catch((e) => setFetched({ sceneId, error: e instanceof Error ? e.message : String(e) }));
  }, [sceneId]);

  const current = fetched?.sceneId === sceneId ? fetched : null;
  const prep = current && 'prep' in current ? current.prep : null;
  const error = current && 'error' in current ? current.error : null;

  const scene = sceneId && state ? sceneTriggersOf(state, sceneId) : undefined;

  // Newest first — this is the DM's firehose, and the freshest fire is the one they care
  // about reading right now.
  const log = useMemo(() => (scene ? [...scene.log].reverse().slice(0, 50) : []), [scene]);

  if (error) {
    return (
      <p role="alert" className="text-xs text-danger">
        {error}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      {!prep || prep.triggers.length === 0 ? (
        <p className="text-text-secondary">No triggers authored for this scene.</p>
      ) : (
        <ul data-testid="trigger-list" className="flex flex-col gap-1">
          {prep.triggers.map((t) => {
            const fired = scene?.fired[t.id] !== undefined;
            // "Enabled" as the table is actually playing it: authored on, and not switched
            // off at the table this session. A trigger authored off has nothing for the
            // toggle to turn on — `set-enabled` is a runtime override of prep, not a rewrite
            // of it — so the checkbox is inert too and says why.
            const runtimeEnabled = t.enabled && !scene?.disabled[t.id];
            return (
              <li key={t.id} className="rounded bg-surface-2 px-2 py-1">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-text-primary">{t.name}</span>
                  {fired && (
                    <span className="shrink-0 rounded-chip bg-surface-3 px-1 text-xs text-text-secondary">
                      Fired
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                  <span>{CONDITION_LABEL[t.when.kind]}</span>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={runtimeEnabled}
                      disabled={!t.enabled}
                      aria-label={`${t.name}: enabled`}
                      onChange={() =>
                        send('set-enabled', { triggerId: t.id, enabled: !runtimeEnabled })
                      }
                      className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                    />
                    {t.enabled ? 'Enabled' : 'Off in prep'}
                  </label>
                  {/*
                    Always live, even for a trigger this panel cannot prove is inert (see the
                    file header — `inert` is resolved server-side and not exposed to this
                    client). An inert fire is refused with a sentence-shaped message (the
                    triggers module's own `bad()`), same channel as every other module's
                    refusal (`lastError`) — a targeted toast for it is a reasonable follow-up,
                    not built here to keep this pass to what M4 asked for.
                  */}
                  <button
                    type="button"
                    aria-label={`Fire: ${t.name}`}
                    onClick={() => send('fire', { triggerId: t.id })}
                    className="rounded border border-border-default px-1.5 py-0.5 text-text-primary transition-colors duration-150 ease-out-quart hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus active:bg-surface-1 motion-reduce:transition-none"
                  >
                    Fire
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div>
        <p className="mb-1 text-xs uppercase tracking-wide text-text-secondary">Trigger log</p>
        <ol
          data-testid="trigger-log"
          className="flex max-h-48 flex-col gap-0.5 overflow-y-auto text-xs"
        >
          {log.length === 0 && <li className="text-text-muted">Nothing has fired yet.</li>}
          {log.map((e) => (
            <li key={e.id} className="rounded bg-surface-2 px-2 py-0.5 text-text-secondary">
              {e.text}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

registerPanel({
  id: 'triggers',
  title: 'Triggers',
  roles: ['dm'],
  order: 35,
  component: TriggerPanel,
});
