// table-shell-redesign — the player's Journal sidebar body: the table-facing feed of
// everything the DM has shared (`share-note`/`share-card`), newest first. New territory —
// players never had a rail popover of their own for this before the sidebar existed.

import { journalOf, type JournalEntry, type JournalKicker, type TriggersState } from '@dnd/mechanics/triggers';
import { registerSidebar } from '../../session/sidebars';
import { useModuleState, useSessionStore } from '../../session/store';
import { journalBadge, useMarkJournalSeen } from './journalActivity';
import { NoteImage } from './NoteImage';

const fmtTime = (at: number): string =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

const KICKER_LABEL: Record<JournalKicker, string> = {
  place: 'Place',
  person: 'Person',
  missive: 'Missive',
  lore: 'Lore',
};

export function JournalSidebar() {
  const state = useModuleState<TriggersState>('triggers');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const entries = state ? journalOf(state) : [];
  const newestFirst = [...entries].reverse();

  useMarkJournalSeen(entries);

  if (entries.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-xs text-text-muted" data-testid="journal-empty">
        <p>Nothing shared yet. What the world tells you will be kept here.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 px-3" data-testid="journal-feed">
      {newestFirst.map((c) => (
        <Card key={c.id} entry={c} sceneId={sceneId} />
      ))}
    </div>
  );
}

function Card({ entry, sceneId }: { entry: JournalEntry; sceneId: string | null }) {
  return (
    <article
      data-testid="journal-card"
      className="overflow-hidden rounded-md border border-border-default bg-surface-2"
    >
      {entry.imageKeys?.map((key) => (
        <NoteImage key={key} sceneId={entry.sceneId ?? sceneId ?? ''} imageKey={key} variant="card" />
      ))}
      <div className="flex flex-col gap-0.5 px-2.5 py-2">
        <p className="text-[9.5px] font-semibold uppercase tracking-[.08em] text-text-muted">
          {KICKER_LABEL[entry.kicker]}
        </p>
        <p className="text-[13px] font-semibold text-text-primary">{entry.title}</p>
        <p className="max-w-[62ch] whitespace-pre-wrap text-[12px] text-text-secondary">{entry.body}</p>
        <p className="mt-1 font-mono text-[10.5px] text-text-muted">{fmtTime(entry.at)}</p>
      </div>
    </article>
  );
}

registerSidebar('player', {
  title: 'Journal',
  component: JournalSidebar,
  badge: journalBadge,
});
