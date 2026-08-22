// M1 — the log's expanded form: a fixed-height drawer over the bottom of the map, the one
// scrolling region in the whole shell (docs/2026-08-22-table-shell-plan.md, no-scroll ledger).
// Filter chips narrow the merged feed from `logFeed.ts`; the composer is the same one
// `GameLog.tsx` still renders in its own popover body until M3 retires it.

import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { markLogSeen, usePostRoll, useLogEntries, type Entry } from './logFeed';
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
  const postRoll = usePostRoll();
  const [filter, setFilter] = useState<FilterKind>('all');
  const [draft, setDraft] = useState('');
  const feedRef = useRef<HTMLOListElement>(null);
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

  const post = () => {
    postRoll(draft);
    setDraft('');
  };

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

      <ol
        ref={feedRef}
        onScroll={onScroll}
        data-testid="game-log"
        className="grid flex-1 grid-cols-1 content-end gap-x-6 gap-y-0.5 overflow-y-auto px-3 py-1.5 text-[12.5px] min-[900px]:grid-cols-2"
      >
        {shown.length === 0 && <li className="text-text-muted">Nothing has happened yet.</li>}
        {shown.map((e) => (
          <li key={e.key} data-whisper={e.whisper || undefined} className="min-w-0 leading-[22px]">
            <LogLine e={e} />
          </li>
        ))}
      </ol>

      <form
        className="flex shrink-0 gap-2 border-t border-border-default px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          post();
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Roll or note, e.g. stealth 17 · initiative 1d20+2"
          aria-label="Post a roll"
          // §2.2 caps `text` at 200; without this the server rejects the command and the
          // typed line is gone. The native attribute is the whole fix.
          maxLength={200}
          data-testid="manual-roll"
          className="min-w-0 flex-1 rounded border border-border-default bg-surface-1 px-2 py-1 text-sm text-text-primary placeholder:text-text-muted focus:border-border-focus focus:outline-none"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="rounded bg-surface-2 px-2 py-1 text-sm text-text-secondary transition-colors duration-150 ease-out-quart hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus disabled:opacity-40 motion-reduce:transition-none"
        >
          Post
        </button>
      </form>
    </div>
  );
}
