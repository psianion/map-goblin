import { describe, expect, it } from 'vitest';
import type { TriggerLogEntry } from '@dnd/mechanics/triggers';
import { pickToastable } from './useTriggerToasts';

const entry = (over: Partial<TriggerLogEntry> = {}): TriggerLogEntry => ({
  id: 'e1',
  at: 0,
  kind: 'show-text',
  text: 'The brazier flares to life.',
  toPlayers: true,
  ...over,
});

describe('pickToastable', () => {
  it('surfaces new show-text entries addressed to players', () => {
    const e = entry();
    expect(pickToastable([e], new Set(), undefined)).toEqual([e]);
  });

  it('drops a show-text entry the DM kept private', () => {
    const e = entry({ toPlayers: false });
    expect(pickToastable([e], new Set(), undefined)).toEqual([]);
  });

  it('drops entries already seen', () => {
    const e = entry();
    expect(pickToastable([e], new Set(['e1']), undefined)).toEqual([]);
  });

  it('surfaces a roll outcome addressed to this viewer regardless of kind', () => {
    const e = entry({
      id: 'e2',
      kind: 'roll-outcome',
      toPlayers: false,
      forIdentityId: 'me',
      text: "Your DEX save: 14 vs DC 13 — success",
    });
    expect(pickToastable([e], new Set(), 'me')).toEqual([e]);
  });

  it('does not surface another viewer\'s roll outcome', () => {
    const e = entry({ id: 'e2', kind: 'roll-outcome', toPlayers: false, forIdentityId: 'someone-else' });
    expect(pickToastable([e], new Set(), 'me')).toEqual([]);
  });

  it('ignores forIdentityId entries when this viewer has no identity yet', () => {
    const e = entry({ id: 'e2', kind: 'roll-outcome', toPlayers: false, forIdentityId: 'me' });
    expect(pickToastable([e], new Set(), undefined)).toEqual([]);
  });
});
