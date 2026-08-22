import { useEffect, useRef, useState } from 'react';
import { ALL_ROLES, registerPanel } from '../session/panels';
import { useLogEntries, usePostRoll } from '../shell/logFeed';

export function GameLog() {
  // Merge model lives in shell/logFeed.ts — LogDrawer (M1) renders the same entries.
  const entries = useLogEntries();
  const postRoll = usePostRoll();
  const [draft, setDraft] = useState('');
  const feedRef = useRef<HTMLOListElement>(null);

  // Newest at the bottom, so follow it. Not setState — no render loop.
  useEffect(() => {
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [entries]);

  const post = () => {
    postRoll(draft);
    setDraft('');
  };

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <ol
        ref={feedRef}
        data-testid="game-log"
        className="flex max-h-64 flex-col gap-1 overflow-y-auto text-sm"
      >
        {entries.length === 0 && <li className="text-text-muted">Nothing has happened yet.</li>}
        {entries.map((e) => (
          <li
            key={e.key}
            data-whisper={e.whisper || undefined}
            className={
              e.presence
                ? 'text-xs italic text-text-muted'
                : 'rounded bg-surface-2/60 px-2 py-1 text-text-secondary'
            }
          >
            <span className={e.presence ? '' : 'font-medium text-text-primary'}>{e.who}</span>{' '}
            {e.title && <span>{e.title}</span>}
            {e.text && <span>{e.text}</span>}
            {e.whisper && (
              <span className="ml-1 rounded bg-surface-3 px-1 text-xs text-text-secondary">
                🔒 whisper
              </span>
            )}
            {e.total !== undefined && (
              <span className="ml-1 font-mono font-semibold text-text-primary">{e.total}</span>
            )}
            {(e.formula || e.breakdown) && (
              <span className="ml-1 font-mono text-xs text-text-muted">
                {[e.formula, e.breakdown].filter(Boolean).join(' = ')}
              </span>
            )}
          </li>
        ))}
      </ol>

      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          post();
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="stealth 17"
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
          className="rounded bg-surface-2 px-2 py-1 text-sm text-text-secondary hover:bg-surface-3 disabled:opacity-40"
        >
          Post
        </button>
      </form>
    </div>
  );
}

registerPanel({
  id: 'game-log',
  title: 'Log',
  icon: 'log',
  key: 'L',
  group: 'log',
  roles: ALL_ROLES,
  order: 90,
  component: GameLog,
});
