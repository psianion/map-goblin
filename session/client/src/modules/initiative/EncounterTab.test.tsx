import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { InitiativeState } from '@dnd/mechanics/initiative';
import { useSessionStore } from '../../session/store';
import { useTokenInteraction } from '../tokens/drag';
import { BRAM, DM, seat, sent, token, tokensState } from '../tokens/playTestSeat';
import { EncounterBody, EncounterStrip } from './EncounterTab';
import { rollForNpcs } from './combat';
import { effectEndedText, encounterContext, encounterOnMap } from './encounterDock';
import { combatBarOf } from './useCombatBar';

vi.mock('@dnd/ui/toast', () => ({ notify: { info: vi.fn(), error: vi.fn() } }));
vi.mock('../../session/auth', () => ({ getScenePrep: vi.fn(() => Promise.resolve({ prep: null, resolved: [], resolvedNotes: [] })) }));

beforeEach(() => useTokenInteraction.setState({ selectedId: null, selectedIds: [] }));
afterEach(cleanup);

const bram = token({ id: 'bram', name: 'Bram', kind: 'pc', ownerId: BRAM.identityId, hp: { current: 20, max: 24 } });
const ogre = token({ id: 'ogre', name: 'Ogre', hp: { current: 59, max: 59 }, effects: [{ name: 'Hold', roundsLeft: 2 }] });

function running(turn = 0): InitiativeState {
  return {
    status: 'running',
    sceneId: 'scene-1',
    round: 3,
    turn,
    entries: [
      { key: 'e1', name: 'Bram', kind: 'pc', tokenId: 'bram', identityId: BRAM.identityId, initiative: 15 },
      { key: 'e2', name: 'Ogre', kind: 'npc', tokenId: 'ogre', initiative: 8 },
    ],
    log: [],
  };
}

describe('Encounter tab', () => {
  it('Start encounter puts every visible token in the fight', () => {
    const spy = seat({ tokens: tokensState([bram, ogre]), initiative: { status: 'idle', sceneId: null, round: 0, turn: 0, entries: [], log: [] } });
    render(<EncounterBody />);
    fireEvent.click(screen.getByTestId('encounter-start'));
    expect(sent(spy)).toEqual([
      [
        'initiative',
        'start',
        {
          sceneId: 'scene-1',
          entries: [
            { name: 'Bram', kind: 'pc', tokenId: 'bram', identityId: BRAM.identityId },
            { name: 'Ogre', kind: 'npc', tokenId: 'ogre' },
          ],
        },
      ],
    ]);
  });

  it('runs Next and Previous, shows the round, and End asks first', () => {
    const spy = seat({ tokens: tokensState([bram, ogre]), initiative: running() });
    render(<EncounterBody />);
    expect(screen.getByTestId('encounter-round').textContent).toBe('Round 3');
    fireEvent.click(screen.getByTestId('encounter-next'));
    fireEvent.click(screen.getByTestId('encounter-previous'));
    fireEvent.click(screen.getByTestId('encounter-end'));
    expect(sent(spy)).toEqual([
      ['initiative', 'next', {}],
      ['initiative', 'previous', {}],
    ]);
    fireEvent.click(screen.getByTestId('encounter-end-confirm'));
    expect(sent(spy).at(-1)).toEqual(['initiative', 'end', {}]);
  });

  it('damages the selection with half on save and adds an effect timer to it', () => {
    const spy = seat({ tokens: tokensState([bram, ogre]), initiative: running() });
    useTokenInteraction.getState().selectMany(['ogre']);
    render(<EncounterBody />);
    fireEvent.change(screen.getByTestId('encounter-amount'), { target: { value: '11' } });
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByTestId('encounter-damage'));
    fireEvent.change(screen.getByTestId('effect-name'), { target: { value: 'Bless' } });
    fireEvent.change(screen.getByTestId('effect-rounds'), { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('effect-add'));
    expect(sent(spy)).toEqual([
      ['tokens', 'damage', { targets: ['ogre'], amount: 11, half: true }],
      ['tokens', 'set-effect', { targets: ['ogre'], name: 'Bless', rounds: 10 }],
    ]);
    expect(screen.getAllByTestId('effect-row')[0].textContent).toContain('Hold · Ogre');
  });

  it('Roll for NPCs gives every unrolled NPC a d20 and leaves PCs to their players', () => {
    const spy = seat({});
    const state: InitiativeState = { ...running(), status: 'gathering', entries: running().entries.map((e) => ({ ...e, initiative: null })) };
    rollForNpcs(state, () => 0.5);
    expect(sent(spy)).toEqual([['initiative', 'set', { key: 'e2', value: 11 }]]);
  });

  it('the strip lists the order and marks whose turn it is', () => {
    seat({ tokens: tokensState([bram, ogre]), initiative: running(1) });
    render(<EncounterStrip />);
    const rows = screen.getAllByTestId('order-row');
    expect(rows.map((r) => r.getAttribute('data-current'))).toEqual([null, 'true']);
  });
});

describe('combat bar data', () => {
  it('orders chips, marks the current, and gives End turn to its player only', () => {
    const tokens = tokensState([bram, ogre]);
    const asBram = combatBarOf(running(0), tokens, 'scene-1', { identityId: BRAM.identityId, role: 'player' });
    expect(asBram).toMatchObject({ active: true, current: 0, round: 3, canAdvance: false, isMyTurn: true });
    expect(asBram.order.map((c) => [c.name, c.current, c.hp])).toEqual([
      ['Bram', true, 20 / 24],
      ['Ogre', false, 1],
    ]);
    expect(combatBarOf(running(1), tokens, 'scene-1', { identityId: BRAM.identityId, role: 'player' }).isMyTurn).toBe(false);
    expect(combatBarOf(running(0), tokens, 'scene-1', { identityId: DM.identityId, role: 'dm' })).toMatchObject({ canAdvance: true, isMyTurn: false });
    expect(combatBarOf(running(0), tokens, 'other-scene', null).active).toBe(false);
  });

  it('next, previous and endTurn send their commands', () => {
    const spy = seat({});
    const bar = combatBarOf(running(), undefined, 'scene-1', null);
    bar.next();
    bar.previous();
    bar.endTurn();
    expect(sent(spy).map((c) => c[1])).toEqual(['next', 'previous', 'end-turn']);
  });
});

describe('encounter dock hooks', () => {
  it('context says the round and whose turn', () => {
    seat({ initiative: running(1) });
    expect(encounterContext()).toBe("Round 3 · Ogre's turn");
  });

  it('toasts each timer the round ran out', async () => {
    const { notify } = await import('@dnd/ui/toast');
    seat({});
    const stop = encounterOnMap();
    useSessionStore.setState({ effectsEnded: { sceneId: 'scene-1', ended: [{ tokenId: 'b', tokenName: 'Bram', name: 'Bless' }], at: 1 } });
    expect(notify.info).toHaveBeenCalledWith(effectEndedText({ tokenName: 'Bram', name: 'Bless' }));
    stop();
  });
});

describe('End turn after a late claim', () => {
  it('goes to the seat holding the token now, not the identity stored on the entry', () => {
    const state = running(0);
    state.entries[0] = { ...state.entries[0], identityId: undefined };
    const unclaimed = tokensState([{ ...bram, ownerId: null }, ogre]);
    expect(combatBarOf(state, unclaimed, 'scene-1', { identityId: BRAM.identityId, role: 'player' }).isMyTurn).toBe(false);
    const claimed = tokensState([bram, ogre]);
    expect(combatBarOf(state, claimed, 'scene-1', { identityId: BRAM.identityId, role: 'player' }).isMyTurn).toBe(true);
  });
});
