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
import { showToast, type ToastSpec } from './toasts';
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
        // A reveal-note popping (prep v2), or a room key's read-aloud (v3). No role check
        // needed: both are DM-only (`toPlayers: false`) and redaction strips them from every
        // player's copy, so only the DM's tab ever holds one to toast.
        e.kind === 'note' ||
        e.kind === 'room-key' ||
        (myIdentityId !== undefined && e.forIdentityId === myIdentityId)),
  );
}

/** Long enough to read a read-aloud preview and decide whether to Share it. */
export const ROOM_KEY_TOAST_MS = 12000;

/**
 * The toast for a batch of new lines. A room key's pop carries Share — the DM's one-click way
 * to send that room's read-aloud to the player Journal (`share-card` with the room id). When
 * one batch pops several keyed rooms, Share answers the last one: the toast slot is single, and
 * every other key stays one click away in the Prep sidebar.
 */
export function toastFor(
  news: readonly TriggerLogEntry[],
  sceneId: string,
  send: (action: string, payload: unknown) => void,
): ToastSpec {
  const message = news.map((e) => e.text).join('\n');
  const keyed = [...news].reverse().find((e) => e.kind === 'room-key' && typeof e.detail?.roomId === 'string');
  if (!keyed) return { message };
  const roomId = keyed.detail!.roomId as string;
  return {
    message,
    durationMs: ROOM_KEY_TOAST_MS,
    action: { label: 'Share', onAction: () => send('share-card', { sceneId, roomId }) },
  };
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
    if (news.length) {
      const send = (action: string, payload: unknown): void =>
        useSessionStore.getState().sendCommand('triggers', action, payload);
      showToast(toastFor(news, sceneId, send));
    }
    for (const entry of log) seen.current.add(entry.id);
  }, [state, sceneId, myIdentityId]);
}
