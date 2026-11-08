import { journalOf, type JournalEntry, type JournalKicker, type TriggersState } from '@dnd/mechanics/triggers';
import type { StoryState } from '@dnd/mechanics/story';
import { Caption } from '@dnd/ui';
import { closeSheet } from '../../shell/sheets/registry';
import { SheetFrame } from '../../shell/sheets/SheetFrame';
import { useModuleState, useSessionStore } from '../../session/store';
import { useMarkJournalSeen } from '../triggers/journalActivity';
import { NoteImage } from '../triggers/NoteImage';

const clock = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

const KICKER: Record<JournalKicker, string> = { place: 'Place', person: 'Person', missive: 'Missive', lore: 'Lore' };

function Card({ entry, sceneId }: { entry: JournalEntry; sceneId: string | null }) {
  return (
    <article data-testid="journal-card" className="overflow-hidden rounded-control border border-line bg-panel-2">
      {entry.imageKeys?.map((key) => (
        <NoteImage key={key} sceneId={entry.sceneId ?? sceneId ?? ''} imageKey={key} variant="card" />
      ))}
      <div className="flex flex-col gap-0.5 px-2.5 py-2">
        <Caption>{KICKER[entry.kicker]}</Caption>
        <p className="text-sm font-medium text-text">{entry.title}</p>
        <p className="text-xs whitespace-pre-wrap text-text-2">{entry.body}</p>
        <time className="mt-1 font-mono text-xs text-text-3">{clock(entry.at)}</time>
      </div>
    </article>
  );
}

/** The player's Journal sheet: every card the DM has shared, and the handouts shown to this seat. */
export function JournalSheet() {
  const triggers = useModuleState<TriggersState>('triggers');
  const story = useModuleState<StoryState>('story');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const entries = triggers ? journalOf(triggers) : [];
  useMarkJournalSeen(entries);
  const handouts = (story?.journal ?? [])
    .filter((j) => j.kind === 'handout')
    .map((j) => ({ j, h: story?.handouts.find((h) => h.id === j.ref) }))
    .filter((x) => !!x.h);
  return (
    <SheetFrame title="Journal" onClose={closeSheet} testId="journal-sheet">
      <div className="flex flex-col gap-2.5 px-3 py-2.5" data-testid="journal-feed">
        {entries.length === 0 && handouts.length === 0 && (
          <p className="py-6 text-center text-xs text-text-3" data-testid="journal-empty">
            Nothing shared yet. What the world tells you will be kept here.
          </p>
        )}
        {[...entries].reverse().map((c) => (
          <Card key={c.id} entry={c} sceneId={sceneId} />
        ))}
        {handouts.length > 0 && <Caption>Handouts</Caption>}
        {[...handouts].reverse().map(({ j, h }) => (
          <article key={j.id} className="rounded-control border border-line bg-panel-2 px-2.5 py-2" data-testid="journal-handout">
            <p className="text-sm font-medium text-text">{h!.caption}</p>
            {h!.text && <p className="text-xs whitespace-pre-wrap text-text-2">{h!.text}</p>}
            <time className="font-mono text-xs text-text-3">{clock(j.sharedAt)}</time>
          </article>
        ))}
      </div>
    </SheetFrame>
  );
}
