// M4 — the table's ear for trigger narration. GameLog is the DM's firehose; this is the
// two lines a viewer should not have to go read the log to catch: room text everyone hears,
// and "did my roll succeed."
//
// The toast store is single-slot (`session/toasts.ts`) — a repeat toast renews rather than
// queues. Multiple *distinct* new lines in the same tick are a different problem: this hook
// raises them as one toast (F2), its lines joined with newlines, rather than dropping all
// but the last.

import { useEffect, useRef } from 'react';
import type { TriggerLogEntry, TriggersState } from '@dnd/mechanics/triggers';
import { sceneTriggersOf } from '@dnd/mechanics/triggers';
import { showToast } from './toasts';
import { useModuleState, useSessionStore } from './store';

/** World narration kinds that toast the moment they land — the same bar as `show-text`:
 *  marked `toPlayers`, seen by players and the DM alike. `environment` is a weather/time
 *  change (M4); `light` is M5's relight narration. */
const WORLD_KINDS = new Set(['show-text', 'environment', 'light']);

/**
 * Log entries worth interrupting for, out of ones not already seen: world narration
 * (marked `toPlayers`) and this viewer's own roll/trap outcome (`forIdentityId` is only ever
 * this viewer's id or absent — the server never hands a seat someone else's). Exported for
 * the pure-logic test; `useTriggerToasts` is the only runtime caller.
 */
export function pickToastable(
  entries: readonly TriggerLogEntry[],
  seen: ReadonlySet<string>,
  myIdentityId: string | undefined,
): TriggerLogEntry[] {
  return entries.filter(
    (e) =>
      !seen.has(e.id) &&
      ((WORLD_KINDS.has(e.kind) && e.toPlayers) ||
        (myIdentityId !== undefined && e.forIdentityId === myIdentityId)),
  );
}

/**
 * Mount once (GameTable). Diffs the active scene's trigger log against what this tab has
 * already shown and toasts anything new and toastable.
 *
 * The join snapshot's log is history, not news — it is seeded into `seen` silently the first
 * time a scene is observed (mount, or a switch onto a scene never seen this tab), so nothing
 * already on the table replays as a toast. A scene switch reseeds the same way, cleanly.
 */
export function useTriggerToasts(): void {
  const state = useModuleState<TriggersState>('triggers');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const myIdentityId = useSessionStore((s) => s.you?.identityId);
  const seen = useRef<Set<string>>(new Set());
  const seenScene = useRef<string | null>(null);

  useEffect(() => {
    if (!state || !sceneId) return;
    const { log } = sceneTriggersOf(state, sceneId);
    if (seenScene.current !== sceneId) {
      seen.current = new Set(log.map((e) => e.id));
      seenScene.current = sceneId;
      return;
    }
    const news = pickToastable(log, seen.current, myIdentityId);
    if (news.length) showToast({ message: news.map((e) => e.text).join('\n') });
    for (const entry of log) seen.current.add(entry.id);
  }, [state, sceneId, myIdentityId]);
}
