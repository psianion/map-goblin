import { useEffect, useRef, useState } from 'react';
import { Chip, cn } from '@dnd/ui';
import { Lock } from '@dnd/ui/icons';
import { markLogSeen, useLogEntries, type Entry } from '../logFeed';
import { closeSheet } from './registry';
import { SheetFrame } from './SheetFrame';

type Filter = 'all' | Exclude<Entry['kind'], 'presence'>;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'roll', label: 'Rolls' },
  { id: 'table', label: 'Doors & fog' },
  { id: 'trigger', label: 'Triggers' },
  { id: 'combat', label: 'Combat' },
];

const clock = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

function Line({ e }: { e: Entry }) {
  return (
    <li className={cn('flex gap-2 text-xs', e.presence ? 'text-text-3 italic' : 'text-text-2')} data-whisper={e.whisper || undefined}>
      <time className="w-10 shrink-0 font-mono text-text-3">{clock(e.at)}</time>
      <span className="min-w-0 break-words">
        {e.who && <b className="font-medium text-text not-italic">{e.who} </b>}
        {e.title}
        {e.text}
        {e.whisper && <Lock aria-label="Whisper" strokeWidth={1.75} className="mx-1 inline size-3 align-middle" />}
        {e.total !== undefined && <span className="ml-1 font-mono font-semibold text-text">{e.total}</span>}
        {(e.formula || e.breakdown) && (
          <span className="ml-1 font-mono text-text-3">{[e.formula, e.breakdown].filter(Boolean).join(' = ')}</span>
        )}
        {e.description && <span className="mt-0.5 block whitespace-pre-wrap text-text-3">{e.description}</span>}
      </span>
    </li>
  );
}

/** The Log sheet: everything the table has seen, newest at the bottom, with kind filters. */
export function LogSheet() {
  const entries = useLogEntries();
  const [filter, setFilter] = useState<Filter>('all');
  const feed = useRef<HTMLOListElement>(null);

  useEffect(() => {
    markLogSeen();
    const el = feed.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const shown = filter === 'all' ? entries : entries.filter((e) => e.kind === filter);
  return (
    <SheetFrame title="Log" onClose={closeSheet} testId="log-sheet" scroll={false}>
      <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-2">
        {FILTERS.map((f) => (
          <Chip key={f.id} pressed={filter === f.id} onPressedChange={() => setFilter(f.id)} data-testid={`log-filter-${f.id}`}>
            {f.label}
          </Chip>
        ))}
      </div>
      <ol ref={feed} className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 py-2" data-testid="game-log">
        {shown.length === 0 && <li className="text-xs text-text-3">Nothing has happened yet.</li>}
        {shown.map((e) => (
          <Line key={e.key} e={e} />
        ))}
      </ol>
    </SheetFrame>
  );
}
