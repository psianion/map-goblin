// M1 — the log's expanded form: originally a fixed-height drawer over the bottom of the map;
// table-shell-redesign D2 (user's explicit variant choice, approved mockup) moves it to a
// full-height column on the right, left of the rail — still the one scrolling region in the
// whole shell (docs/2026-08-22-table-shell-plan.md, no-scroll ledger). The column is too
// narrow for the old two-column split, so the feed is a single top-down list, newest at the
// bottom (`stickToBottom`, unchanged). Filter chips narrow the merged feed from `logFeed.ts`;
// the composer is the same one `GameLog.tsx` still renders in its own popover body until M3
// retires it.

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

/** One feed line, shared by the drawer's column and the ticker's single one. */
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

  return (
    <div
      data-testid="log-drawer"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      className="absolute right-14 top-0 bottom-7 z-toolbar flex w-[300px] flex-col border-l border-border-structure bg-surface-1/95 shadow-[var(--panel-shadow)] motion-safe:animate-panel-in"
    >
      {/* table-shell-redesign D2: the column is 300px, too narrow for the old single-row
          header — chips wrap onto their own line instead. */}
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-border-default px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="mr-1 font-serif text-[15px] text-text-primary">Log</span>
          <span className="flex-1" />
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
        <div className="flex flex-wrap items-center gap-1.5">
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
        </div>
        <span className="truncate text-xs text-text-muted">Whispers to you show a lock</span>
      </div>

      {/* Single top-down feed (table-shell-redesign D2 — the two-column split doesn't fit a
          300px column), newest at the bottom; `justify-end` hugs a short feed to the
          composer instead of leaving it stranded under the header. */}
      <div
        ref={feedRef}
        onScroll={onScroll}
        data-testid="game-log"
        className="flex min-h-0 flex-1 flex-col justify-end overflow-y-auto px-3 py-1.5 text-[12.5px]"
      >
        {shown.length === 0 && <p className="text-text-muted">Nothing has happened yet.</p>}
        {shown.length > 0 && (
          <ol data-testid="log-column" className="flex min-w-0 flex-col justify-end gap-y-0.5">
            {shown.map((e) => (
              <li key={e.key} data-whisper={e.whisper || undefined} className="min-w-0 leading-[22px]">
                <LogLine e={e} />
                {e.description && (
                  <div className="ml-12 whitespace-pre-wrap break-words text-[11px] leading-4 text-text-muted">
                    {e.description}
                  </div>
                )}
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
