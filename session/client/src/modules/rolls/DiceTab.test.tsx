import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { createRollsModule, type RollRequest, type RollsState } from '@dnd/mechanics/rolls';
import { useLogEntries } from '../../shell/logFeed';
import { BRAM, YARA, seat, sent, token, tokensState } from '../tokens/playTestSeat';
import { DiceBody, DiceStrip } from './DiceTab';
import { parseTableRows, useDiceSettings } from './dice';

vi.mock('@dnd/ui/toast', () => ({ notify: { info: vi.fn(), error: vi.fn() } }));

beforeEach(() => useDiceSettings.setState({ mode: 'public', adv: 'none' }));
afterEach(cleanup);

const request = (over: Partial<RollRequest> = {}): RollRequest => ({
  id: 'q1',
  at: 0,
  label: 'Perception check',
  dc: 14,
  targets: null,
  results: [
    { identityId: BRAM.identityId, playerName: 'Sam', total: 17, at: 1 },
    { identityId: YARA.identityId, playerName: 'Ola', total: 9, at: 2 },
  ],
  shared: false,
  ...over,
});

describe('Dice tab body', () => {
  it('quick dice and the formula roll on the server with the chosen mode and advantage', () => {
    const spy = seat({});
    render(<DiceBody />);
    fireEvent.click(screen.getByTestId('dice-mode-blind'));
    fireEvent.click(screen.getByTestId('dice-adv-adv'));
    fireEvent.click(screen.getByTestId('dice-d20'));
    fireEvent.change(screen.getByTestId('dice-formula'), { target: { value: '2d6 + 3' } });
    fireEvent.click(screen.getByTestId('dice-roll'));
    expect(sent(spy)).toEqual([
      ['rolls', 'roll', { formula: '1d20', mode: 'blind', adv: 'adv' }],
      ['rolls', 'roll', { formula: '2d6+3', mode: 'blind', adv: 'adv' }],
    ]);
  });

  it('a bad formula is not sent', () => {
    const spy = seat({});
    render(<DiceBody />);
    fireEvent.change(screen.getByTestId('dice-formula'), { target: { value: 'banana' } });
    fireEvent.click(screen.getByTestId('dice-roll'));
    expect(spy).not.toHaveBeenCalled();
  });

  it('asks chosen players for a check with a DC', () => {
    const spy = seat({});
    render(<DiceBody />);
    fireEvent.click(screen.getByTestId(`ask-target-${BRAM.identityId}`));
    fireEvent.change(screen.getByTestId('ask-dc'), { target: { value: '14' } });
    fireEvent.click(screen.getByTestId('ask-send'));
    expect(sent(spy)).toEqual([
      ['rolls', 'request', { targets: [BRAM.identityId], label: 'Perception check', ability: 'perception', dc: 14 }],
    ]);
  });
});

describe('Dice tab strip', () => {
  it('shows each result with pass or fail, shares them, and applies a condition to a failing PC', () => {
    const yara = token({ id: 'yara', name: 'Yara', kind: 'pc', ownerId: YARA.identityId });
    const spy = seat({ rolls: { log: [], requests: [request()] }, tokens: tokensState([yara]) });
    render(<DiceStrip />);
    const rows = screen.getAllByTestId('request-result').map((r) => r.textContent);
    expect(rows[0]).toContain('pass');
    expect(rows[1]).toContain('fail');
    fireEvent.click(screen.getByTestId('request-apply'));
    expect(screen.getByTestId('request-apply').textContent).toBe('Apply Restrained to Yara');
    fireEvent.click(screen.getByTestId('request-share'));
    expect(sent(spy)).toEqual([
      ['tokens', 'set-condition', { target: 'yara', name: 'restrained', on: true }],
      ['rolls', 'share-request', { requestId: 'q1' }],
    ]);
  });

  it('rolls a table and a saved roll, and adds both', () => {
    const state: RollsState = {
      log: [],
      tables: [{ id: 'tb', name: 'Loot', die: '1d20', rows: [{ range: [1, 20], text: 'Coins' }] }],
      saved: [{ id: 'sv', name: 'Goblin attack', formula: '1d20+4' }],
    };
    const spy = seat({ rolls: state });
    render(<DiceStrip />);
    fireEvent.click(screen.getByTestId('roll-table-roll'));
    fireEvent.click(screen.getByTestId('saved-roll-roll'));
    fireEvent.change(screen.getByTestId('saved-name'), { target: { value: 'Ogre club' } });
    fireEvent.change(screen.getByTestId('saved-formula'), { target: { value: '2d8+4' } });
    fireEvent.click(screen.getByTestId('saved-add'));
    fireEvent.click(screen.getByTestId('table-new'));
    fireEvent.change(screen.getByTestId('table-name'), { target: { value: 'Weather' } });
    fireEvent.change(screen.getByTestId('table-rows'), { target: { value: '1-3 Rain\n4-6 Sun' } });
    fireEvent.click(screen.getByTestId('table-save'));
    expect(sent(spy)).toEqual([
      ['rolls', 'roll-table', { id: 'tb', mode: 'public' }],
      ['rolls', 'roll', { formula: '1d20+4', mode: 'public', title: 'Goblin attack' }],
      ['rolls', 'saved-upsert', { name: 'Ogre club', formula: '2d8+4' }],
      ['rolls', 'table-upsert', { name: 'Weather', die: '1d20', rows: [{ range: [1, 3], text: 'Rain' }, { range: [4, 6], text: 'Sun' }] }],
    ]);
  });

  it('parseTableRows reads ranges and single numbers and drops the rest', () => {
    expect(parseTableRows('1-10 Nothing\n11 Ogre\nnonsense\n5-2 Backwards')).toEqual([
      { range: [1, 10], text: 'Nothing' },
      { range: [11, 11], text: 'Ogre' },
    ]);
  });
});

describe('log entries by mode', () => {
  it('a blind roll reaches its roller’s log without a result, GM only not at all', () => {
    const module = createRollsModule({ rng: () => 0.5 });
    let state: RollsState = { log: [] };
    const roll = (mode: string) =>
      module.handler('roll', { formula: '1d20', mode, title: mode }, {
        campaignId: 'c',
        sessionId: 's',
        activeSceneId: null,
        sender: { role: 'player', identityId: BRAM.identityId },
        players: [BRAM],
        state,
        setState: (next) => {
          state = next;
        },
        broadcast: () => {},
      });
    roll('blind');
    roll('gmonly');
    roll('dm');
    const mine = module.redact!(state, { role: 'player', identityId: BRAM.identityId });
    seat({ rolls: mine }, BRAM);
    const { result } = renderHook(() => useLogEntries());
    const rolls = result.current.filter((e) => e.kind === 'roll');
    expect(rolls.map((e) => [e.title, e.total])).toEqual([
      ['blind', undefined],
      ['dm', '11'],
    ]);
  });
});
