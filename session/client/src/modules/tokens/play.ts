// Table v2 — the plain logic behind the Tokens tab, the token and group cards, and the
// Token type, Party and Character sheets: which tokens and defs a filter keeps, the labels,
// and the one `send` every surface uses. No React and no Pixi, so it tests as data.

import { create } from 'zustand';
import { CONDITIONS, conditionLabel as srdLabel } from '@dnd/mechanics/initiative';
import {
  normalizeTokenDef,
  type Disposition,
  type HpVisibility,
  type Nameplate,
  type Token,
  type TokenDef,
  type TokenKind,
  type TokenSize,
  type TokensState,
} from '@dnd/mechanics/tokens';
import type { TableState } from '@dnd/mechanics/table';
import { useSessionStore } from '../../session/store';

export const sendTokens = (action: string, payload: unknown): void =>
  useSessionStore.getState().sendCommand('tokens', action, payload);

export const KIND_LABEL: Record<TokenKind, string> = { pc: 'PC', npc: 'NPC', monster: 'Monster' };
export const NAMEPLATE_LABEL: Record<Nameplate, string> = { hover: 'On hover', always: 'Always', never: 'Never' };
export const HP_LABEL: Record<HpVisibility, string> = { dm: 'DM only', owner: 'DM and owner', all: 'Everyone' };
export const SIZE_LABEL: Record<TokenSize, string> = {
  tiny: 'Tiny',
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  huge: 'Huge',
  gargantuan: 'Gargantuan',
};
export const DISPOSITION_LABEL: Record<Disposition, string> = { friendly: 'Friendly', neutral: 'Neutral', hostile: 'Hostile' };

/** The board's catalogue (board 16), in its order; ids are the mechanics' SRD ids. */
export const CATALOGUE = [
  'blinded',
  'charmed',
  'frightened',
  'grappled',
  'paralyzed',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
  'exhaustion',
] as const satisfies readonly (typeof CONDITIONS)[number][];

/** "Paralysed" for the board's spelling; every other id reads as the SRD names it. */
export const conditionLabel = (id: string): string => (id === 'paralyzed' ? 'Paralysed' : srdLabel(id));

export const kindOf = (t: Pick<TokenDef, 'kind'>): TokenKind => t.kind ?? 'npc';

/** The active scene's tokens, defaults filled. */
export function sceneTokens(state: TokensState | undefined, sceneId: string | null | undefined): Token[] {
  const scene = sceneId ? state?.byScene?.[sceneId] : undefined;
  if (!scene || typeof scene !== 'object') return [];
  return Object.values(scene)
    .filter((t): t is Token => !!t && typeof t.x === 'number' && typeof t.y === 'number')
    .map((t) => normalizeTokenDef(t));
}

export type LibraryFilter = 'all' | 'pc' | 'npc' | 'monster' | 'prepped';

/** The library strip's defs for a filter chip and the search text, by name. */
export function filterLibrary(library: Record<string, TokenDef> | undefined, filter: LibraryFilter, search: string): TokenDef[] {
  const q = search.trim().toLowerCase();
  return Object.values(library ?? {})
    .filter((d) => filter === 'all' || filter === 'prepped' || kindOf(d) === filter)
    .filter((d) => !q || d.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** How many tokens on the scene were placed from each def. */
export function placedCounts(tokens: readonly Token[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tokens) if (t.defId) counts.set(t.defId, (counts.get(t.defId) ?? 0) + 1);
  return counts;
}

/** 0..1 of the pool left; null without one. */
export const hpFraction = (t: Pick<TokenDef, 'hp'>): number | null =>
  t.hp && t.hp.max > 0 ? Math.max(0, Math.min(1, t.hp.current / t.hp.max)) : null;

/** A third or less left reads as danger, the one hue HP gets (decision 3). */
export const hpDanger = (t: Pick<TokenDef, 'hp'>): boolean => {
  const f = hpFraction(t);
  return f !== null && f <= 1 / 3;
};

export const tableFlags = (state: TableState | undefined): TableState => ({
  paused: state?.paused === true,
  movementLocked: state?.movementLocked === true,
});

/** What the Tokens tab's "new token" defaults hand to the Token type sheet and to a drop. */
export interface NewTokenDefaults {
  size: TokenSize;
  disposition: Disposition;
  nameplate: Nameplate;
  showHp: HpVisibility;
}

export const useNewTokenDefaults = create<NewTokenDefaults & { set: (patch: Partial<NewTokenDefaults>) => void }>()((set) => ({
  size: 'medium',
  disposition: 'hostile',
  nameplate: 'hover',
  showHp: 'dm',
  set: (patch) => set(patch),
}));

/** The value string a whole-number field holds, '' when the field is unset. */
export const numText = (n: number | undefined): string => (n === undefined ? '' : String(n));

/** A whole number from a field, or undefined for blank or garbage. */
export function parseWhole(text: string, min: number, max: number): number | undefined {
  if (text.trim() === '') return undefined;
  const n = Number(text);
  if (!Number.isInteger(n) || n < min || n > max) return undefined;
  return n;
}

/** The dock row's context text while the Tokens tab is open: "4 on the map, 1 hidden". */
export function tokensContext(): string | null {
  const session = useSessionStore.getState().session;
  const tokens = sceneTokens(session?.modules.tokens as TokensState | undefined, session?.activeSceneId);
  if (tokens.length === 0) return null;
  const hidden = tokens.filter((t) => t.hidden).length;
  return `${tokens.length} on the map${hidden ? `, ${hidden} hidden` : ''}`;
}
