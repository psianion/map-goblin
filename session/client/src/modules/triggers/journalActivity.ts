// The player Journal's unread bookkeeping: an entry is seen once the Journal sheet has shown it.

import { useEffect } from 'react';
import { journalOf, type JournalEntry, type TriggersState } from '@dnd/mechanics/triggers';
import { useSessionStore } from '../../session/store';

const seenIds = new Set<string>();

function currentEntries(): readonly JournalEntry[] {
  const state = useSessionStore.getState().session?.modules?.triggers as TriggersState | undefined;
  return state ? journalOf(state) : [];
}

export function journalBadge(): number | null {
  const n = currentEntries().filter((e) => !seenIds.has(e.id)).length;
  return n > 0 ? n : null;
}

/** Call from the Journal sheet: everything it shows is seen. */
export function useMarkJournalSeen(entries: readonly JournalEntry[]): void {
  useEffect(() => {
    for (const e of entries) seenIds.add(e.id);
  }, [entries]);
}

/** Test-only: forget what has been seen. */
export function __resetJournalBadgeForTests(): void {
  seenIds.clear();
}
