// table-shell-redesign — the player Journal sidebar's unread-badge bookkeeping. Split out of
// `JournalSidebar.tsx` for the same reason `prepActivity.ts` is split out of `PrepSidebar.tsx`
// (a test-only reset export would otherwise trip `react-refresh/only-export-components` on the
// component file).
//
// Journal is session-scoped, not per-scene (`JournalEntry`), so unlike the Prep badge there is
// no scene switch to reseed on — just a silent seed on first mount ever.

import { useEffect } from 'react';
import { journalOf, type JournalEntry, type TriggersState } from '@dnd/mechanics/triggers';
import { useSessionStore } from '../../session/store';
import { useShell } from '../../shell/shellStore';

const seenIds = new Set<string>();
let seeded = false;

function currentEntries(): readonly JournalEntry[] {
  const state = useSessionStore.getState().session?.modules?.triggers as TriggersState | undefined;
  return state ? journalOf(state) : [];
}

export function journalBadge(): number | null {
  const n = currentEntries().filter((e) => !seenIds.has(e.id)).length;
  return n > 0 ? n : null;
}

/** Call once from the sidebar body. */
export function useMarkJournalSeen(entries: readonly JournalEntry[]): void {
  const open = useShell((s) => s.sidebarOpen);
  useEffect(() => {
    if (!seeded) {
      for (const e of entries) seenIds.add(e.id);
      seeded = true;
      return;
    }
    if (open) for (const e of entries) seenIds.add(e.id);
  }, [open, entries]);
}

/** Test-only: a real tab mounts the sidebar once, so this cache never needs clearing outside
 *  a test file re-mounting the component across cases. */
export function __resetJournalBadgeForTests(): void {
  seenIds.clear();
  seeded = false;
}
