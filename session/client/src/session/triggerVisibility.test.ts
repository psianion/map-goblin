import { describe, expect, it } from 'vitest';
import type { TriggerPrompt, TriggersState } from '@dnd/mechanics/triggers';
import { PROMPT_CARD_MAX, promptMeta, visiblePrompts } from './triggerVisibility';

const prompt = (over: Partial<TriggerPrompt> = {}): TriggerPrompt => ({
  id: 'p1',
  triggerId: 't1',
  kind: 'trap',
  targetIdentityId: 'me',
  text: 'The floor tilts underfoot.',
  at: 0,
  ...over,
});

const stateOf = (prompts: TriggerPrompt[]): TriggersState => ({
  byScene: {
    s1: { fired: {}, armed: {}, disabled: {}, lightOverrides: {}, env: {}, prompts, log: [] },
  },
});

describe('promptMeta', () => {
  it('formats a trap save with its DC', () => {
    expect(promptMeta(prompt({ ability: 'dex', dc: 13 }))).toBe('DEX save · DC 13');
  });

  it('formats an ability check as a check, not a save', () => {
    expect(promptMeta(prompt({ kind: 'ability-check', ability: 'wis', dc: 10 }))).toBe(
      'WIS check · DC 10',
    );
  });

  it('omits the DC clause when none is set', () => {
    expect(promptMeta(prompt({ ability: 'str', dc: undefined }))).toBe('STR save');
  });

  it('is undefined for a prompt with no ability', () => {
    expect(promptMeta(prompt({ ability: undefined }))).toBeUndefined();
  });
});

describe('visiblePrompts', () => {
  it('is empty with no state or no active scene', () => {
    expect(visiblePrompts(undefined, 's1')).toEqual([]);
    expect(visiblePrompts(stateOf([prompt()]), null)).toEqual([]);
  });

  it('sorts oldest first', () => {
    const newer = prompt({ id: 'p-new', at: 200 });
    const older = prompt({ id: 'p-old', at: 100 });
    const result = visiblePrompts(stateOf([newer, older]), 's1');
    expect(result.map((v) => v.prompt.id)).toEqual(['p-old', 'p-new']);
  });

  it('caps the stack at PROMPT_CARD_MAX', () => {
    const prompts = Array.from({ length: PROMPT_CARD_MAX + 2 }, (_, i) =>
      prompt({ id: `p${i}`, at: i }),
    );
    expect(visiblePrompts(stateOf(prompts), 's1')).toHaveLength(PROMPT_CARD_MAX);
  });

  it('flags a null-target prompt as needing the DM', () => {
    const result = visiblePrompts(stateOf([prompt({ targetIdentityId: null })]), 's1');
    expect(result[0]?.needsDm).toBe(true);
  });

  it('does not flag a prompt with an owner', () => {
    const result = visiblePrompts(stateOf([prompt({ targetIdentityId: 'me' })]), 's1');
    expect(result[0]?.needsDm).toBe(false);
  });
});
