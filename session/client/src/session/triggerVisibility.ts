// M4 — which trigger prompts a viewer's attention card stack shows, and the terse
// "DEX save · DC 13" meta line under each one.
//
// No role branching here: the server's `redact` already cuts a player's `prompts` down to
// `targetIdentityId === me` before it ever reaches the wire (see the triggers module), so a
// null-target (unclaimed token) prompt physically cannot appear in a player's slice. The DM's
// own slice is unredacted and can hold one — that is the only case `needsDm` ever fires.

import type { Ability, TriggerPrompt, TriggersState } from '@dnd/mechanics/triggers';
import { sceneTriggersOf } from '@dnd/mechanics/triggers';

export interface VisiblePrompt {
  prompt: TriggerPrompt;
  /** The entering token was unclaimed — only the DM can resolve this one. */
  needsDm: boolean;
}

/** PROMPT_CARD_MAX: the card stack over the map, not the server's 20-deep queue. */
export const PROMPT_CARD_MAX = 3;

const ABILITY_LABEL: Record<Ability, string> = {
  str: 'STR',
  dex: 'DEX',
  con: 'CON',
  int: 'INT',
  wis: 'WIS',
  cha: 'CHA',
};

/** "DEX save · DC 13" / "WIS check" / undefined for a prompt with no authored ability. */
export function promptMeta(prompt: TriggerPrompt): string | undefined {
  if (!prompt.ability) return undefined;
  const word = prompt.kind === 'trap' ? 'save' : 'check';
  const dc = prompt.dc !== undefined ? ` · DC ${prompt.dc}` : '';
  return `${ABILITY_LABEL[prompt.ability]} ${word}${dc}`;
}

/**
 * The viewer's open prompts for the active scene, oldest first, capped to what the card
 * stack shows at once. `undefined` state/sceneId (no snapshot yet, or between scenes) is an
 * empty stack, never a crash.
 */
export function visiblePrompts(
  state: TriggersState | undefined,
  sceneId: string | null,
): VisiblePrompt[] {
  if (!state || !sceneId) return [];
  const { prompts } = sceneTriggersOf(state, sceneId);
  return prompts
    .slice()
    .sort((a, b) => a.at - b.at)
    .slice(0, PROMPT_CARD_MAX)
    .map((prompt) => ({ prompt, needsDm: prompt.targetIdentityId === null }));
}
