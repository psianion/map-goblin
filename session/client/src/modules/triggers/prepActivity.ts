// table-shell-redesign — the DM Prep sidebar's activity-badge bookkeeping, split out of
// `PrepSidebar.tsx` because the test-only reset export here would otherwise trip
// `react-refresh/only-export-components` on a component file (same reason `tokensUi.ts` and
// `railRefs.ts` live as their own files instead of inside a component).
//
// Module-scope, not a component ref: `badge()` (`session/sidebars.ts`) is read outside React
// by `Sidebar.tsx`, so a plain function has nowhere else to keep its "seen" set. Seeded
// silently on the first look at a scene's log (nothing already on the table counts as news),
// then everything currently in the log is marked seen while the sidebar sits open — the same
// shape `useTriggerToasts` uses for its own per-tab seen-set, just persisted here instead of a
// component ref.

import { useEffect } from 'react';
import { sceneTriggersOf, type TriggerLogEntry, type TriggersState } from '@dnd/mechanics/triggers';
import { useSessionStore } from '../../session/store';
import { useShell } from '../../shell/shellStore';

const seenLogIds = new Set<string>();
let seenLogScene: string | null = null;

function currentLog(): readonly TriggerLogEntry[] {
  const session = useSessionStore.getState().session;
  const sceneId = session?.activeSceneId;
  const state = session?.modules?.triggers as TriggersState | undefined;
  if (!sceneId || !state) return [];
  return sceneTriggersOf(state, sceneId).log;
}

export function prepBadge(): number | null {
  const n = currentLog().filter((e) => !seenLogIds.has(e.id)).length;
  return n > 0 ? n : null;
}

/** Call once from the sidebar body. */
export function useMarkPrepSeen(sceneId: string | null, log: readonly TriggerLogEntry[]): void {
  const open = useShell((s) => s.sidebarOpen);
  useEffect(() => {
    if (seenLogScene !== sceneId) {
      seenLogIds.clear();
      for (const e of log) seenLogIds.add(e.id);
      seenLogScene = sceneId;
      return;
    }
    if (open) for (const e of log) seenLogIds.add(e.id);
  }, [open, sceneId, log]);
}

/** Test-only: a real tab mounts the sidebar once, so this cache never needs clearing outside
 *  a test file re-mounting the component across cases. */
export function __resetPrepBadgeForTests(): void {
  seenLogIds.clear();
  seenLogScene = null;
}
