// The initiative tracker's derived reads: who is on the board to fight, what the tracker
// shows this seat, whether this seat is the one being asked for a number, and whether a roll
// that just went out was also that number.
//
// Same split as triggerVisibility — every question with an answer worth pinning is answered
// here, and the four components that ask are renderers.

import {
  INITIATIVE_MAX,
  INITIATIVE_MIN,
  isInitiativeRoll,
  type InitiativeEntry,
  type InitiativeState,
} from '@dnd/mechanics/initiative';
import type { RollEvent } from '@dnd/mechanics/rolls';
import type { Token, TokensState } from '@dnd/mechanics/tokens';

/** A token the DM can put in the fight. `identityId` is set exactly when `kind` is `pc`. */
export interface Combatant {
  tokenId: string;
  name: string;
  kind: 'pc' | 'npc';
  identityId?: string;
}

/** Wire data: the slice is absent before the join snapshot and untrusted after it. */
const entriesOf = (state: InitiativeState | undefined): InitiativeEntry[] =>
  Array.isArray(state?.entries) ? state.entries : [];

/**
 * A roll's number. Beyond20 sends `total`; a hand-typed line ("initiative 17") has only
 * text, so its trailing integer is the total — the same digits a human reads off it.
 * Out of the module's range is *no* number rather than a command the server will refuse.
 */
function rollTotal(roll: { total?: number; text?: string }): number | undefined {
  const digits = roll.text?.match(/-?\d+/g);
  const n = Number.isFinite(roll.total)
    ? (roll.total as number)
    : digits
      ? Number(digits[digits.length - 1])
      : NaN;
  return Number.isFinite(n) && n >= INITIATIVE_MIN && n <= INITIATIVE_MAX ? n : undefined;
}

/**
 * The active scene's tokens as combatants: a claimed token is its player's `pc`, everything
 * else is one of the DM's `npc`s. PCs first, then alphabetical — the order a DM reads the
 * party in, and the order that puts the ticks they still have to make together.
 *
 * ponytail: reads `byScene` itself rather than borrowing TokenRenderer's `tokensOf`, which
 * would pull Pixi into this module and into the DM panel that calls it.
 */
export function combatantCandidates(
  state: TokensState | undefined,
  sceneId: string | null,
): Combatant[] {
  const scene = sceneId ? state?.byScene?.[sceneId] : undefined;
  if (!scene || typeof scene !== 'object') return [];
  return Object.values(scene)
    .filter((t): t is Token => !!t && typeof t.id === 'string')
    .map((t) => ({
      tokenId: t.id,
      name: typeof t.name === 'string' && t.name ? t.name : 'Unnamed',
      ...(t.ownerId
        ? { kind: 'pc' as const, identityId: t.ownerId }
        : { kind: 'npc' as const }),
    }))
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'pc' ? -1 : 1));
}

/**
 * My combatant that is still waiting on a number, which is the whole condition for the
 * prompt card — so the card leaves the moment the entry fills, whoever filled it and from
 * wherever (a Beyond20 roll, the DM typing it, the bot).
 */
export function myPendingEntry(
  state: InitiativeState | undefined,
  identityId: string | undefined,
): InitiativeEntry | undefined {
  if (!state || state.status !== 'gathering' || !identityId) return undefined;
  return entriesOf(state).find((e) => e.identityId === identityId && e.initiative === null);
}

/** The newest number this seat put in the roll log — what "use my last roll" reaches for. */
export function lastRollTotal(
  rolls: { log?: RollEvent[] } | undefined,
  identityId: string | undefined,
): number | undefined {
  const log = Array.isArray(rolls?.log) ? rolls.log : [];
  if (!identityId) return undefined;
  for (let i = log.length - 1; i >= 0; i -= 1) {
    const e = log[i];
    if (!e || e.identityId !== identityId) continue;
    const total = rollTotal(e);
    if (total !== undefined) return total;
  }
  return undefined;
}

/**
 * The `initiative:set` a roll should send beside its own `rolls:post`, or `null` — the whole
 * auto-track path, shared by the Beyond20 bridge and the manual roll box so the two cannot
 * disagree about what counts. What counts is the module's own `isInitiativeRoll`.
 *
 * A seat playing two tokens fills them in order: the first of mine still empty, else the
 * first of mine, so a corrected re-roll overwrites rather than being dropped.
 */
export function captureFromRoll(
  state: InitiativeState | undefined,
  identityId: string | undefined,
  roll: { title?: string; text?: string; total?: number },
): { key: string; value: number } | null {
  if (!state || state.status !== 'gathering' || !identityId) return null;
  if (!isInitiativeRoll(roll)) return null;
  const mine = entriesOf(state).filter((e) => e.identityId === identityId);
  const entry = mine.find((e) => e.initiative === null) ?? mine[0];
  if (!entry) return null;
  const value = rollTotal(roll);
  return value === undefined ? null : { key: entry.key, value };
}
