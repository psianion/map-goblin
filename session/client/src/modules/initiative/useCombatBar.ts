// Table v2 — the combat bar's data (boards 3 and 5). The shell draws the bar; this answers
// what it shows: the order with each combatant's token and face, whose turn it is, the round,
// who may advance, and the three things a click on it can do.

import { useMemo } from 'react';
import type { InitiativeEntry, InitiativeState } from '@dnd/mechanics/initiative';
import type { TokensState } from '@dnd/mechanics/tokens';
import { useModuleState, useSessionStore } from '../../session/store';
import { sendInitiative } from './combat';

export interface CombatChip {
  key: string;
  name: string;
  kind: InitiativeEntry['kind'];
  initiative: number | null;
  /** The seat that plays it, when one does (directly, or through the token it owns). */
  identityId: string | null;
  tokenId: string | null;
  /** The token's uploaded art, for the portrait. */
  imageAssetId: string | null;
  /** 0..1 of the pool left, as far as this seat is told; null when it is not. */
  hp: number | null;
  /** At 0 HP. */
  down: boolean;
  current: boolean;
}

export interface CombatBar {
  /** An encounter is running on the scene this seat is looking at. */
  active: boolean;
  /** Still rolling initiative (Start pressed, order not locked). */
  gathering: boolean;
  order: CombatChip[];
  /** Index into `order`; -1 when not active. */
  current: number;
  round: number;
  /** The DM: Next and Previous are theirs. */
  canAdvance: boolean;
  /** The current combatant is this seat's: End turn is theirs. */
  isMyTurn: boolean;
  next: () => void;
  previous: () => void;
  endTurn: () => void;
}

const next = () => sendInitiative('next');
const previous = () => sendInitiative('previous');
const endTurn = () => sendInitiative('end-turn');

/**
 * Whose a combatant is right now: the seat holding its token (a PC claimed after it joined the
 * fight), else the identity stored on the entry — the same rule the server's End turn checks.
 */
export function ownerOf(entry: InitiativeEntry, tokens: TokensState | undefined, sceneId: string | null): string | null {
  const holder = entry.tokenId && sceneId ? tokens?.byScene?.[sceneId]?.[entry.tokenId]?.ownerId : undefined;
  return holder ?? entry.identityId ?? null;
}

/** The pure part, for tests and non-React readers. */
export function combatBarOf(
  state: InitiativeState | undefined,
  tokens: TokensState | undefined,
  sceneId: string | null,
  you: { identityId: string; role: 'dm' | 'player' } | null,
): CombatBar {
  const running = !!state && (state.status === 'running' || state.status === 'gathering') && state.sceneId === sceneId;
  const entries = running && Array.isArray(state.entries) ? state.entries : [];
  const turn = state?.status === 'running' ? state.turn : -1;
  const scene = sceneId ? tokens?.byScene?.[sceneId] : undefined;
  const order = entries.map((e, i): CombatChip => {
    const token = e.tokenId ? scene?.[e.tokenId] : undefined;
    const pool = token?.hp ?? e.hp;
    return {
      key: e.key,
      name: e.name,
      kind: e.kind,
      initiative: e.initiative,
      identityId: ownerOf(e, tokens, sceneId),
      tokenId: e.tokenId ?? null,
      imageAssetId: token?.imageAssetId ?? null,
      hp: pool && pool.max > 0 ? Math.max(0, Math.min(1, pool.current / pool.max)) : null,
      down: !!pool && pool.current === 0,
      current: i === turn,
    };
  });
  const dm = you?.role === 'dm';
  const now = turn >= 0 ? order[turn] : undefined;
  return {
    active: order.length > 0,
    gathering: running && state.status === 'gathering',
    order,
    current: order.length > 0 ? turn : -1,
    round: running ? state.round : 0,
    canAdvance: dm && order.length > 0,
    isMyTurn: !dm && !!now && !!you && now.identityId === you.identityId,
    next,
    previous,
    endTurn,
  };
}

/** The combat bar's data, live. */
export function useCombatBar(): CombatBar {
  const state = useModuleState<InitiativeState>('initiative');
  const tokens = useModuleState<TokensState>('tokens');
  const sceneId = useSessionStore((s) => s.session?.activeSceneId ?? null);
  const you = useSessionStore((s) => s.you);
  return useMemo(
    () => combatBarOf(state, tokens, sceneId, you ? { identityId: you.identityId, role: you.role } : null),
    [state, tokens, sceneId, you],
  );
}
