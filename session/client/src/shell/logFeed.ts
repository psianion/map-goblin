// The table log's merged feed: rolls, presence, door/fog lines, trigger narration and
// initiative sentences, one timestamp-sorted timeline. Owned here so `GameLog` (the old
// popover body) and `LogDrawer` (M1's bottom drawer) render the same data through the same
// hook — no drift between the two while both exist.

import { useCallback, useMemo } from 'react';
import { create } from 'zustand';
import type { DoorsState } from '@dnd/mechanics/doors';
import type { FogState } from '@dnd/mechanics/fog';
import type { InitiativeState } from '@dnd/mechanics/initiative';
import type { RollEvent } from '@dnd/mechanics/rolls';
import type { TriggersState } from '@dnd/mechanics/triggers';
import { sceneTriggersOf } from '@dnd/mechanics/triggers';
import { captureFromRoll } from '../session/initiativeView';
import { useModuleState, useSessionStore } from '../session/store';
import { tableLogLines } from '../session/tableLog';

export interface Entry {
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
  /** What kind of line this is — the drawer's filter chips key off it. */
  kind: 'roll' | 'presence' | 'table' | 'trigger' | 'combat';
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

const withCharacter = (player: string, character: string | undefined): string =>
  character && character !== player ? `${player} (${character})` : player;

/** The merged, sorted feed every log surface renders. */
export function useLogEntries(): Entry[] {
  // `log?` deliberately loosens `RollsState`: the slice is absent before the join snapshot
  // and is untrusted wire data after it. Nothing below does arithmetic on a roll — the
  // server already capped every string (§2.2) and this hook only shapes them for print.
  const rolls = useModuleState<{ log?: RollEvent[] }>('rolls');
  const presence = useSessionStore((s) => s.presence);
  // The doors and fog lines (§2.4.3). They ride their modules' state, so this seat only
  // ever holds the ones it is allowed to read — there is nothing to filter here.
  const doors = useModuleState<DoorsState>('doors');
  const fog = useModuleState<FogState>('fog');
  // Already redacted for this viewer server-side (players: `toPlayers` lines plus their own
  // outcomes; the DM: everything) — nothing to filter again here, unlike doors/fog above.
  const triggers = useModuleState<TriggersState>('triggers');
  // Composed server-side, printed verbatim — the table and the bot's thread word the fight
  // identically because neither of them writes the sentence.
  const initiative = useModuleState<InitiativeState>('initiative');
  const mapData = useSessionStore((s) => s.mapData);
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);

  return useMemo<Entry[]>(() => {
    const rollEntries: Entry[] = (Array.isArray(rolls?.log) ? rolls.log : []).map((e, i) => ({
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
      kind: 'roll',
    }));
    const presenceEntries: Entry[] = presence.map((p) => ({
      key: p.id,
      at: p.at,
      who: p.name,
      text: p.kind === 'joined' ? 'joined the table' : 'left the table',
      whisper: false,
      presence: true,
      kind: 'presence',
    }));
    // Same quiet register as a join line: what the table did, not what it rolled.
    const tableEntries: Entry[] = tableLogLines(doors, fog, mapData, sceneId).map((line) => ({
      ...line,
      whisper: false,
      presence: true,
      kind: 'table',
    }));
    // Room narration and trap/check outcomes read the same quiet register as a door or fog
    // line — what the table did, not a roll anyone made.
    const triggerEntries: Entry[] = (
      sceneId && triggers ? sceneTriggersOf(triggers, sceneId).log : []
    ).map((e) => ({
      key: e.id,
      at: e.at,
      who: '',
      text: e.text,
      whisper: false,
      presence: true,
      kind: 'trigger',
    }));
    const initiativeEntries: Entry[] = (Array.isArray(initiative?.log) ? initiative.log : []).map(
      (e) => ({
        key: e.id,
        at: e.at,
        who: '',
        text: e.text,
        whisper: false,
        presence: true,
        kind: 'combat',
      }),
    );
    return [
      ...rollEntries,
      ...presenceEntries,
      ...tableEntries,
      ...triggerEntries,
      ...initiativeEntries,
    ].sort((a, b) => a.at - b.at);
  }, [rolls, presence, doors, fog, triggers, initiative, mapData, sceneId]);
}

/**
 * The shared submit path for a typed line: `GameLog`'s composer and the drawer's each keep
 * their own draft string (they are separate inputs), but posting — and the auto-capture into
 * a running initiative — is one rule, made here once (D7: no dice engine, a manual entry is a
 * string someone typed, posted as-is).
 *
 * `visibility` defaults to `'public'` — every existing caller posts to the table. The rolls
 * module accepts `'private'` from any role (M4 — a player's own whisper reaches them and the
 * DM, same as a whispered Beyond20 roll); `RollBar` is the first caller to pass it.
 */
export function usePostRoll(): (text: string, visibility?: 'public' | 'private') => void {
  const initiative = useModuleState<InitiativeState>('initiative');
  const identityId = useSessionStore((s) => s.you?.identityId);
  return useCallback(
    (text: string, visibility: 'public' | 'private' = 'public') => {
      const trimmed = text.trim();
      if (!trimmed) return;
      useSessionStore
        .getState()
        .sendCommand('rolls', 'post', { source: 'manual', text: trimmed, visibility });
      // Auto-track: "initiative 17" typed here is also this seat's initiative, so it lands in
      // the tracker without anyone typing the number twice. Same rule the Beyond20 bridge uses.
      const set = captureFromRoll(initiative, identityId, { text: trimmed });
      if (set) useSessionStore.getState().sendCommand('initiative', 'set', set);
    },
    [initiative, identityId],
  );
}

// ── Unread count ────────────────────────────────────────────────────────────
// ponytail: a one-field zustand store, not sessionStorage — the count only has to survive
// this tab's lifetime, same as `presence` above.
const useLogSeen = create<{ lastSeenAt: number; markSeen: () => void }>()((set) => ({
  lastSeenAt: 0,
  markSeen: () => set({ lastSeenAt: Date.now() }),
}));

/** Call while the drawer is open (and on every new entry) so the badge clears. */
export function markLogSeen(): void {
  useLogSeen.getState().markSeen();
}

/** Entries newer than the last time the drawer was open — the rail's badge count. */
export function useUnreadCount(): number {
  const entries = useLogEntries();
  const lastSeenAt = useLogSeen((s) => s.lastSeenAt);
  return entries.filter((e) => e.at > lastSeenAt).length;
}
