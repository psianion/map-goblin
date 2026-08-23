// M1 — the log's expanded form: a fixed-height drawer over the bottom of the map, the one
// scrolling region in the whole shell (docs/2026-08-22-table-shell-plan.md, no-scroll ledger).
// Filter chips narrow the merged feed from `logFeed.ts`; the composer is the same one
// `GameLog.tsx` still renders in its own popover body until M3 retires it.

import { useEffect, useRef, useState } from 'react';
import { Composer } from './RollBar';
import { Icon } from './icons';
import { markLogSeen, useLogEntries, type Entry } from './logFeed';
import { useShell } from './shellStore';

type FilterKind = 'all' | Entry['kind'];

const FILTERS: ReadonlyArray<{ id: Exclude<FilterKind, 'presence'>; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'roll', label: 'Rolls' },
  { id: 'table', label: 'Doors & fog' },
  { id: 'trigger', label: 'Triggers' },
  { id: 'combat', label: 'Combat' },
];

const fmtTime = (at: number): string =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

/** First half / second half — column-major reading order (M3 review finding 7): down the
 *  left column, then down the right, so the newest line lands bottom-right instead of the
 *  row-major zig-zag a plain `grid-cols-2` auto-placed it into. */
function splitColumns<T>(items: readonly T[]): [T[], T[]] {
  const half = Math.ceil(items.length / 2);
  return [items.slice(0, half), items.slice(half)];
}

/** One feed line, shared by the drawer's two columns and the ticker's single one. */
export function LogLine({ e }: { e: Entry }) {
  return (
    <span className="flex min-w-0 items-baseline gap-2 truncate">
      <time className="w-10 shrink-0 font-mono text-[11px] text-text-muted">{fmtTime(e.at)}</time>
      <span className={`min-w-0 truncate ${e.presence ? 'italic text-text-secondary' : 'text-text-secondary'}`}>
        {e.who && <span className="font-medium not-italic text-text-primary">{e.who} </span>}
        {e.title}
        {e.text}
        {e.whisper && <Icon name="lock" size={12} title="Whisper" className="mx-1 inline align-middle" />}
        {e.total !== undefined && (
          <span className="ml-1 font-mono font-semibold text-text-primary">{e.total}</span>
        )}
        {(e.formula || e.breakdown) && (
          <span className="ml-1 font-mono text-[11px] text-text-muted">
            {[e.formula, e.breakdown].filter(Boolean).join(' = ')}
          </span>
        )}
      </span>
    </span>
  );
}

export function LogDrawer() {
  const drawerOpen = useShell((s) => s.drawerOpen);
  const setDrawer = useShell((s) => s.setDrawer);
  const entries = useLogEntries();
  const [filter, setFilter] = useState<FilterKind>('all');
  const feedRef = useRef<HTMLDivElement>(null);
  // Follows the newest line unless the reader scrolled up to read back — the same rule
  // GameLog's plain autoscroll approximated by always pinning; the drawer holds more lines
  // at once so it has to ask.
  const stickToBottom = useRef(true);

  // The drawer clears the unread badge for as long as it is open, including for lines that
  // arrive while it is (each new `entries` triggers this, not just the open transition).
  useEffect(() => {
    if (drawerOpen) markLogSeen();
  }, [drawerOpen, entries]);

  useEffect(() => {
    const feed = feedRef.current;
    if (feed && stickToBottom.current) feed.scrollTop = feed.scrollHeight;
  }, [entries]);

  if (!drawerOpen) return null;

  const shown = filter === 'all' ? entries : entries.filter((e) => e.kind === filter);

  const onScroll = () => {
    const feed = feedRef.current;
    if (!feed) return;
    stickToBottom.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 24;
  };

  const [left, right] = splitColumns(shown);

  return (
    <div
      data-testid="log-drawer"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      className="absolute inset-x-0 right-14 bottom-7 flex h-[260px] flex-col border-t border-border-structure bg-surface-1/95 shadow-[var(--panel-shadow)] motion-safe:animate-panel-in"
    >
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border-default px-3">
        <span className="mr-1 font-serif text-[15px] text-text-primary">Log</span>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            data-testid={`log-filter-${f.id}`}
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className={`rounded-full border px-2 py-0.5 text-xs transition-colors duration-150 ease-out-quart focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none ${
              filter === f.id
                ? 'border-border-structure bg-surface-3 text-text-primary'
                : 'border-border-default text-text-secondary hover:bg-surface-2'
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto truncate text-xs text-text-muted">Whispers to you show a lock</span>
        <button
          type="button"
          onClick={() => setDrawer(false)}
          aria-label="Close the log"
          className="flex shrink-0 items-center gap-1.5 rounded px-1.5 py-1 text-xs text-text-secondary transition-colors duration-150 ease-out-quart hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus motion-reduce:transition-none"
        >
          <kbd className="rounded-[3px] border border-border-default bg-surface-2 px-1 font-mono text-[10px] text-text-dim">
            L
          </kbd>
          <Icon name="close" size={15} />
        </button>
      </div>

      {/* Column-major (M3 review finding 7): two independent ordered lists, left then right,
          each bottom-anchored so a short feed still hugs the composer instead of the header. */}
      <div
        ref={feedRef}
        onScroll={onScroll}
        data-testid="game-log"
        className="flex min-h-0 flex-1 flex-col justify-end gap-y-0.5 overflow-y-auto px-3 py-1.5 text-[12.5px] min-[900px]:flex-row min-[900px]:items-end min-[900px]:gap-x-6 min-[900px]:gap-y-0"
      >
        {shown.length === 0 && <p className="text-text-muted">Nothing has happened yet.</p>}
        {left.length > 0 && (
          <ol data-testid="log-column" className="flex min-w-0 flex-col justify-end gap-y-0.5 min-[900px]:flex-1">
            {left.map((e) => (
              <li key={e.key} data-whisper={e.whisper || undefined} className="min-w-0 leading-[22px]">
                <LogLine e={e} />
              </li>
            ))}
          </ol>
        )}
        {right.length > 0 && (
          <ol data-testid="log-column" className="flex min-w-0 flex-col justify-end gap-y-0.5 min-[900px]:flex-1">
            {right.map((e) => (
              <li key={e.key} data-whisper={e.whisper || undefined} className="min-w-0 leading-[22px]">
                <LogLine e={e} />
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border-default px-3 py-2">
        <Composer />
      </div>
    </div>
  );
}
