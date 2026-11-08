// Table v2 — the plain logic behind the Dice tab, the player roll bar, the roll prompt card
// and the result chips (boards 5 and 20). Server-side rolls (`rolls.roll`) so a blind roll
// stays blind; requests and their answers are rolls state, already cut for this seat.

import { create } from 'zustand';
import { isValidFormula } from '@dnd/mechanics/dice';
import type { RollEvent, RollMode, RollRequest, RollsState } from '@dnd/mechanics/rolls';
import type { Token, TokensState } from '@dnd/mechanics/tokens';
import { useSessionStore } from '../../session/store';

export const sendRolls = (action: string, payload: unknown): void =>
  useSessionStore.getState().sendCommand('rolls', action, payload);

export const QUICK_DICE = [20, 12, 10, 8, 6, 4] as const;

export type Advantage = 'none' | 'adv' | 'dis';

export const MODE_LABEL: Record<RollMode, string> = { public: 'Public', dm: 'To DM', gmonly: 'GM only', blind: 'Blind' };
/** The roll bar's privacy (board 5): a player picks Public or To DM. */
export const PLAYER_MODES: readonly RollMode[] = ['public', 'dm'];

/** "Rolling GM only" — the dock's context text for the Dice tab. */
export const modeContext = (mode: RollMode): string => `Rolling ${MODE_LABEL[mode]}`;

/** One roll, rolled on the server. Refuses a malformed formula here, before it is sent. */
export function rollFormula(formula: string, mode: RollMode, adv: Advantage = 'none', title?: string): boolean {
  const f = formula.replace(/\s+/g, '');
  if (!isValidFormula(f)) return false;
  sendRolls('roll', { formula: f, mode, ...(adv !== 'none' ? { adv } : {}), ...(title ? { title } : {}) });
  return true;
}

/** "1d20+3" from a die and a modifier. */
export const withMod = (die: number, mod: number): string => `1d${die}${mod > 0 ? `+${mod}` : mod < 0 ? `${mod}` : ''}`;

/** The DM's dice settings, shared by the Dice tab body and its context text. */
export const useDiceSettings = create<{ mode: RollMode; adv: Advantage; set: (p: Partial<{ mode: RollMode; adv: Advantage }>) => void }>()((set) => ({
  mode: 'public',
  adv: 'none',
  set: (p) => set(p),
}));

/** Abilities and skills a check names (board 20's Ask players). */
export const CHECKS: readonly { id: string; label: string }[] = [
  { id: 'strength', label: 'Strength' },
  { id: 'dexterity', label: 'Dexterity' },
  { id: 'constitution', label: 'Constitution' },
  { id: 'intelligence', label: 'Intelligence' },
  { id: 'wisdom', label: 'Wisdom' },
  { id: 'charisma', label: 'Charisma' },
  { id: 'acrobatics', label: 'Acrobatics' },
  { id: 'animal-handling', label: 'Animal Handling' },
  { id: 'arcana', label: 'Arcana' },
  { id: 'athletics', label: 'Athletics' },
  { id: 'deception', label: 'Deception' },
  { id: 'history', label: 'History' },
  { id: 'insight', label: 'Insight' },
  { id: 'intimidation', label: 'Intimidation' },
  { id: 'investigation', label: 'Investigation' },
  { id: 'medicine', label: 'Medicine' },
  { id: 'nature', label: 'Nature' },
  { id: 'perception', label: 'Perception' },
  { id: 'performance', label: 'Performance' },
  { id: 'persuasion', label: 'Persuasion' },
  { id: 'religion', label: 'Religion' },
  { id: 'sleight-of-hand', label: 'Sleight of Hand' },
  { id: 'stealth', label: 'Stealth' },
  { id: 'survival', label: 'Survival' },
];

export const checkLabel = (id: string): string => CHECKS.find((c) => c.id === id)?.label ?? id;

/** "Perception check, DC 14". */
export const requestTitle = (r: Pick<RollRequest, 'label' | 'dc'>): string => (r.dc === undefined ? r.label : `${r.label}, DC ${r.dc}`);

/** Pass, fail, or nothing to judge (no DC). */
export const verdict = (r: Pick<RollRequest, 'dc'>, total: number): 'pass' | 'fail' | null =>
  r.dc === undefined ? null : total >= r.dc ? 'pass' : 'fail';

/** The requests this seat still owes an answer to (a player's prompt card). */
export function owedRequests(state: RollsState | undefined, identityId: string | undefined): RollRequest[] {
  if (!identityId) return [];
  return (state?.requests ?? []).filter(
    (r) => (r.targets === null || r.targets.includes(identityId)) && !r.results.some((x) => x.identityId === identityId),
  );
}

/** A player's token on the live scene: the PC they own (the one a request's quick action lands on). */
export function tokenOfSeat(tokens: TokensState | undefined, sceneId: string | null, identityId: string): Token | undefined {
  const scene = sceneId ? tokens?.byScene?.[sceneId] : undefined;
  const owned = Object.values(scene ?? {}).filter((t) => t.ownerId === identityId);
  return owned.find((t) => t.kind === 'pc') ?? owned[0];
}

/** Rows typed as "1-10 Nothing" or "11 A wandering ogre", one a line; bad lines dropped. */
export function parseTableRows(text: string): { range: [number, number]; text: string }[] {
  return text.split('\n').flatMap((line) => {
    const m = /^\s*(-?\d+)(?:\s*[-–]\s*(-?\d+))?\s+(.+?)\s*$/.exec(line);
    if (!m) return [];
    const lo = Number(m[1]);
    const hi = m[2] === undefined ? lo : Number(m[2]);
    return hi < lo ? [] : [{ range: [lo, hi] as [number, number], text: m[3].slice(0, 200) }];
  });
}

/** How long a result chip stands beside its roller's token. */
export const CHIP_MS = 5000;

/** The log's newest rolls with a total, from the last `CHIP_MS`. */
export function recentResults(log: readonly RollEvent[] | undefined, now: number): RollEvent[] {
  return (log ?? []).filter((e) => typeof e.total === 'number' && now - e.at < CHIP_MS);
}

/** The dock row's context while the Dice tab is open. */
export const diceContext = (): string => modeContext(useDiceSettings.getState().mode);

/** What the sheet says about Beyond20: linked, seen but not linked, or not heard from. */
export function beyond20State(linked: string | undefined, detected: string | undefined): { label: string; live: boolean } {
  if (linked) return { label: `Beyond20: ${linked}`, live: true };
  if (detected) return { label: `Beyond20 sees ${detected}`, live: true };
  return { label: 'Beyond20 not connected', live: false };
}
