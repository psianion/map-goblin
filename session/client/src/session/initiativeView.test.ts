import { describe, expect, it } from 'vitest';
import type { InitiativeEntry, InitiativeState } from '@dnd/mechanics/initiative';
import type { RollEvent } from '@dnd/mechanics/rolls';
import type { Token, TokensState } from '@dnd/mechanics/tokens';
import {
  captureFromRoll,
  combatantCandidates,
  lastRollTotal,
  myPendingEntry,
  trackerView,
} from './initiativeView';

const entry = (over: Partial<InitiativeEntry> = {}): InitiativeEntry => ({
  key: 'e1',
  name: 'Marra',
  kind: 'pc',
  initiative: null,
  ...over,
});

const stateOf = (over: Partial<InitiativeState> = {}): InitiativeState => ({
  status: 'gathering',
  sceneId: 's1',
  round: 0,
  turn: 0,
  entries: [],
  log: [],
  ...over,
});

const token = (over: Partial<Token>): Token =>
  ({
    id: 't1',
    name: 'Goblin',
    ownerId: null,
    x: 0,
    y: 0,
    ...over,
  }) as Token;

const tokensOf = (tokens: Token[]): TokensState =>
  ({
    library: {},
    byScene: { s1: Object.fromEntries(tokens.map((t) => [t.id, t])) },
  }) as TokensState;

const roll = (over: Partial<RollEvent> = {}): RollEvent => ({
  id: 'r1',
  at: 1,
  identityId: 'me',
  playerName: 'Marra',
  source: 'manual',
  visibility: 'public',
  ...over,
});

describe('combatantCandidates', () => {
  it('is empty without a scene or without tokens on it', () => {
    expect(combatantCandidates(tokensOf([token({})]), null)).toEqual([]);
    expect(combatantCandidates(undefined, 's1')).toEqual([]);
    expect(combatantCandidates(tokensOf([]), 's2')).toEqual([]);
  });

  it('makes a claimed token its player and an unclaimed one an NPC', () => {
    const result = combatantCandidates(
      tokensOf([
        token({ id: 't1', name: 'Goblin' }),
        token({ id: 't2', name: 'Marra', ownerId: 'p-1' }),
      ]),
      's1',
    );
    expect(result).toEqual([
      { tokenId: 't2', name: 'Marra', kind: 'pc', identityId: 'p-1' },
      { tokenId: 't1', name: 'Goblin', kind: 'npc' },
    ]);
  });

  it('sorts players first, then alphabetically inside each group', () => {
    const result = combatantCandidates(
      tokensOf([
        token({ id: 't1', name: 'Wolf' }),
        token({ id: 't2', name: 'Bandit' }),
        token({ id: 't3', name: 'Tomen', ownerId: 'p-2' }),
        token({ id: 't4', name: 'Marra', ownerId: 'p-1' }),
      ]),
      's1',
    );
    expect(result.map((c) => c.name)).toEqual(['Marra', 'Tomen', 'Bandit', 'Wolf']);
  });
});

describe('trackerView', () => {
  it('shows nothing while idle, or before a snapshot lands', () => {
    expect(trackerView(undefined, 's1')).toBeNull();
    expect(trackerView(stateOf({ status: 'idle', sceneId: null }), 's1')).toBeNull();
  });

  it('shows nothing on a scene the encounter is not on', () => {
    expect(trackerView(stateOf({ entries: [entry()] }), 's2')).toBeNull();
    expect(trackerView(stateOf({ entries: [entry()] }), null)).toBeNull();
  });

  it('sorts while gathering, and highlights nobody', () => {
    const view = trackerView(
      stateOf({
        entries: [
          entry({ key: 'a', name: 'Marra', initiative: 8 }),
          entry({ key: 'b', name: 'Tomen', initiative: null }),
          entry({ key: 'c', name: 'Goblin', initiative: 19 }),
        ],
      }),
      's1',
    );
    expect(view?.rows.map((r) => r.name)).toEqual(['Goblin', 'Marra', 'Tomen']);
    expect(view?.rows.some((r) => r.current)).toBe(false);
  });

  it('reads HP as a fraction, a redacted NPC as down, and conditions as labels', () => {
    const view = trackerView(
      stateOf({
        entries: [
          entry({ key: 'a', name: 'Marra', hp: { current: 5, max: 12 }, conditions: ['prone'] }),
          entry({ key: 'b', name: 'Goblin', kind: 'npc', hp: { current: 0, max: 0 } }),
          entry({ key: 'c', name: 'Tomen' }),
        ],
      }),
      's1',
    );
    const by = (name: string) => view!.rows.find((r) => r.name === name)!;
    expect(by('Marra')).toMatchObject({ hp: '5/12', down: false, conditions: ['Prone'] });
    expect(by('Goblin')).toMatchObject({ hp: 'down', down: true, conditions: [] });
    expect(by('Tomen')).toMatchObject({ hp: null, down: false, conditions: [] });
  });

  it('keeps the locked order once running and highlights the current turn', () => {
    const view = trackerView(
      stateOf({
        status: 'running',
        round: 3,
        turn: 1,
        entries: [
          entry({ key: 'a', name: 'Goblin', initiative: 19 }),
          entry({ key: 'b', name: 'Marra', initiative: 8 }),
        ],
      }),
      's1',
    );
    expect(view?.round).toBe(3);
    expect(view?.rows.map((r) => r.name)).toEqual(['Goblin', 'Marra']);
    expect(view?.rows.map((r) => r.current)).toEqual([false, true]);
  });
});

describe('myPendingEntry', () => {
  const entries = [
    entry({ key: 'a', identityId: 'me', initiative: null }),
    entry({ key: 'b', identityId: 'you', initiative: null }),
  ];

  it('is my own unrolled entry while gathering', () => {
    expect(myPendingEntry(stateOf({ entries }), 'me')?.key).toBe('a');
  });

  it('is nothing once mine has a number, whoever put it there', () => {
    const filled = [{ ...entries[0]!, initiative: 14 }, entries[1]!];
    expect(myPendingEntry(stateOf({ entries: filled }), 'me')).toBeUndefined();
  });

  it('is nothing outside gathering, without a seat, or with no entry of mine', () => {
    expect(myPendingEntry(stateOf({ status: 'running', entries }), 'me')).toBeUndefined();
    expect(myPendingEntry(stateOf({ entries }), undefined)).toBeUndefined();
    expect(myPendingEntry(stateOf({ entries }), 'nobody')).toBeUndefined();
  });
});

describe('lastRollTotal', () => {
  it('takes the newest of my own rolls, ignoring everyone else', () => {
    const log = [
      roll({ id: 'r1', total: 9 }),
      roll({ id: 'r2', identityId: 'other', total: 30 }),
      roll({ id: 'r3', total: 17 }),
    ];
    expect(lastRollTotal({ log }, 'me')).toBe(17);
  });

  it('reads the number out of a hand-typed line', () => {
    expect(lastRollTotal({ log: [roll({ text: 'initiative 21' })] }, 'me')).toBe(21);
  });

  it('is undefined with no log, no seat, or nothing numeric of mine', () => {
    expect(lastRollTotal(undefined, 'me')).toBeUndefined();
    expect(lastRollTotal({ log: [roll({ total: 9 })] }, undefined)).toBeUndefined();
    expect(lastRollTotal({ log: [roll({ text: 'i hide' })] }, 'me')).toBeUndefined();
  });
});

describe('captureFromRoll', () => {
  const state = stateOf({ entries: [entry({ key: 'a', identityId: 'me' })] });

  it('captures a titled roll onto my entry', () => {
    expect(captureFromRoll(state, 'me', { title: 'Initiative', total: 17 })).toEqual({
      key: 'a',
      value: 17,
    });
  });

  it('captures a hand-typed line by its trailing number', () => {
    expect(captureFromRoll(state, 'me', { text: 'initiative 1d20+2 = 14' })).toEqual({
      key: 'a',
      value: 14,
    });
  });

  it('ignores a roll that is not an initiative roll', () => {
    expect(captureFromRoll(state, 'me', { title: 'Stealth Check', total: 17 })).toBeNull();
  });

  it('ignores every roll outside gathering', () => {
    const running = stateOf({ status: 'running', entries: state.entries });
    expect(captureFromRoll(running, 'me', { title: 'Initiative', total: 17 })).toBeNull();
    expect(captureFromRoll(undefined, 'me', { title: 'Initiative', total: 17 })).toBeNull();
  });

  it('ignores a seat with no combatant in this fight', () => {
    expect(captureFromRoll(state, 'other', { title: 'Initiative', total: 17 })).toBeNull();
  });

  it('ignores a roll with no usable number, in or out of range', () => {
    expect(captureFromRoll(state, 'me', { title: 'Initiative' })).toBeNull();
    expect(captureFromRoll(state, 'me', { title: 'Initiative', total: 5000 })).toBeNull();
  });

  it('fills my empty combatant first, then overwrites the one I already rolled', () => {
    const two = stateOf({
      entries: [
        entry({ key: 'a', identityId: 'me', initiative: 12 }),
        entry({ key: 'b', identityId: 'me', initiative: null }),
      ],
    });
    expect(captureFromRoll(two, 'me', { title: 'Initiative', total: 8 })?.key).toBe('b');

    const both = stateOf({
      entries: [
        entry({ key: 'a', identityId: 'me', initiative: 12 }),
        entry({ key: 'b', identityId: 'me', initiative: 8 }),
      ],
    });
    expect(captureFromRoll(both, 'me', { title: 'Initiative', total: 20 })?.key).toBe('a');
  });
});
