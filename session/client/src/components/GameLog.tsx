import { useEffect, useMemo, useRef, useState } from 'react';
import type { RollEvent } from '@dnd/mechanics/rolls';
import { ALL_ROLES, registerPanel } from '../session/panels';
import { useModuleState, useSessionStore } from '../session/store';

interface Entry {
  key: string;
  at: number;
  /** Bold lead-in: who rolled, or who came and went. */
  who: string;
  title?: string;
  formula?: string;
  breakdown?: string;
  total?: string;
  text?: string;
  whisper: boolean;
  presence: boolean;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

const withCharacter = (player: string, character: string | undefined): string =>
  character && character !== player ? `${player} (${character})` : player;

export function GameLog() {
  // `log?` deliberately loosens `RollsState`: the slice is absent before the join snapshot
  // and is untrusted wire data after it. Nothing below does arithmetic on a roll — the
  // server already capped every string (§2.2) and this panel only prints them.
  const rolls = useModuleState<{ log?: RollEvent[] }>('rolls');
  const presence = useSessionStore((s) => s.presence);
  const [draft, setDraft] = useState('');
  const feedRef = useRef<HTMLOListElement>(null);

  const entries = useMemo<Entry[]>(() => {
    const rollEntries = (Array.isArray(rolls?.log) ? rolls.log : []).map((e, i) => ({
      key: str(e?.id) ?? `roll-${i}`,
      at: typeof e?.at === 'number' ? e.at : 0,
      // D7: attribution is the server-stamped sender, never client-supplied. The DDB
      // character name is flavour riding along, so a forged one can't impersonate a seat.
      who: withCharacter(str(e?.playerName) ?? 'Someone', str(e?.characterName)),
      title: str(e?.title),
      formula: str(e?.formula),
      breakdown: str(e?.breakdown),
      total: Number.isFinite(e?.total) ? String(e.total) : undefined,
      text: str(e?.text),
      whisper: e?.visibility === 'private',
      presence: false,
    }));
    const presenceEntries = presence.map((p) => ({
      key: p.id,
      at: p.at,
      who: p.name,
      text: p.kind === 'joined' ? 'joined the table' : 'left the table',
      whisper: false,
      presence: true,
    }));
    return [...rollEntries, ...presenceEntries].sort((a, b) => a.at - b.at);
  }, [rolls, presence]);

  // Newest at the bottom, so follow it. Not setState — no render loop.
  useEffect(() => {
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [entries]);

  const post = () => {
    const text = draft.trim();
    if (!text) return;
    // D7: no dice engine. A manual entry is a string someone typed, posted as-is.
    useSessionStore
      .getState()
      .sendCommand('rolls', 'post', { source: 'manual', text, visibility: 'public' });
    setDraft('');
  };

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <ol
        ref={feedRef}
        data-testid="game-log"
        className="flex max-h-64 flex-col gap-1 overflow-y-auto text-sm"
      >
        {entries.length === 0 && <li className="text-neutral-500">Nothing has happened yet.</li>}
        {entries.map((e) => (
          <li
            key={e.key}
            data-whisper={e.whisper || undefined}
            className={
              e.presence
                ? 'text-xs italic text-neutral-500'
                : 'rounded bg-neutral-900/60 px-2 py-1 text-neutral-300'
            }
          >
            <span className={e.presence ? '' : 'font-medium text-neutral-100'}>{e.who}</span>{' '}
            {e.title && <span>{e.title}</span>}
            {e.text && <span>{e.text}</span>}
            {e.whisper && (
              <span className="ml-1 rounded bg-neutral-800 px-1 text-xs text-neutral-400">
                🔒 whisper
              </span>
            )}
            {e.total !== undefined && (
              <span className="ml-1 font-mono font-semibold text-neutral-100">{e.total}</span>
            )}
            {(e.formula || e.breakdown) && (
              <span className="ml-1 font-mono text-xs text-neutral-500">
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
          className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-200 hover:bg-neutral-700 disabled:opacity-40"
        >
          Post
        </button>
      </form>
    </div>
  );
}

registerPanel({ id: 'game-log', title: 'Log', roles: ALL_ROLES, order: 50, component: GameLog });
