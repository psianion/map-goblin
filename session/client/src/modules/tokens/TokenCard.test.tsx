import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useTokenInteraction } from './drag';
import { TokenCards } from './TokenCard';
import { BRAM, DM, seat, sent, token, tokensState } from './playTestSeat';

beforeEach(() => useTokenInteraction.setState({ selectedId: null, selectedIds: [], draggingId: null }));
afterEach(cleanup);

const ogre = token({ id: 'ogre', name: 'Ogre', hp: { current: 40, max: 59 }, ac: 11 });
const bram = token({ id: 'bram', name: 'Bram', kind: 'pc', ownerId: BRAM.identityId, hp: { current: 9, max: 24 }, conditions: ['prone'] });

describe('token card', () => {
  it('shows nothing until a token is picked', () => {
    seat({ tokens: tokensState([ogre]) });
    render(<TokenCards />);
    expect(screen.queryByTestId('token-card')).toBeNull();
  });

  it('shows name, kind, HP and AC, and damages and heals the token', () => {
    const spy = seat({ tokens: tokensState([ogre]) });
    useTokenInteraction.getState().select('ogre');
    render(<TokenCards />);
    expect(screen.getByTestId('token-card-kind').textContent).toBe('Monster');
    expect(screen.getByTestId('token-card-hp').textContent).toBe('40 / 59 HP');
    fireEvent.change(screen.getByTestId('token-card-amount'), { target: { value: '7' } });
    fireEvent.click(screen.getByTestId('token-card-damage'));
    fireEvent.change(screen.getByTestId('token-card-amount'), { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('token-card-heal'));
    expect(sent(spy)).toEqual([
      ['tokens', 'damage', { targets: ['ogre'], amount: 7 }],
      ['tokens', 'heal', { targets: ['ogre'], amount: 3 }],
    ]);
  });

  it('adds a condition from the catalogue, hides, adds to combat and deletes', () => {
    const spy = seat({ tokens: tokensState([ogre]), initiative: { status: 'idle', sceneId: null, round: 0, turn: 0, entries: [], log: [] } });
    useTokenInteraction.getState().select('ogre');
    render(<TokenCards />);
    fireEvent.click(screen.getByTestId('token-card-condition-add'));
    fireEvent.click(screen.getByTestId('token-card-condition-restrained'));
    fireEvent.click(screen.getByTestId('token-card-hide'));
    fireEvent.click(screen.getByTestId('token-card-add-combat'));
    fireEvent.click(screen.getByTestId('token-card-delete'));
    expect(sent(spy)).toEqual([
      ['tokens', 'set-condition', { targets: ['ogre'], name: 'restrained', on: true }],
      ['tokens', 'hide', { id: 'ogre', hidden: true }],
      ['initiative', 'start', { sceneId: 'scene-1', entries: [{ name: 'Ogre', kind: 'npc', tokenId: 'ogre' }] }],
      ['tokens', 'delete', { id: 'ogre' }],
    ]);
    expect(useTokenInteraction.getState().selectedId).toBeNull();
  });

  it('a condition already on shows as a chip and a click takes it off', () => {
    const spy = seat({ tokens: tokensState([bram]) });
    useTokenInteraction.getState().select('bram');
    render(<TokenCards />);
    fireEvent.click(screen.getByTestId('token-card-condition-prone'));
    expect(sent(spy)).toEqual([['tokens', 'set-condition', { targets: ['bram'], name: 'prone', on: false }]]);
  });

  it('a player gets Claim on an unclaimed token and nothing on their own', () => {
    const spy = seat({ tokens: tokensState([ogre, bram]) }, BRAM);
    useTokenInteraction.getState().select('ogre');
    const { rerender } = render(<TokenCards />);
    fireEvent.click(screen.getByTestId('token-card-claim'));
    expect(sent(spy)).toEqual([['tokens', 'claim', { id: 'ogre' }]]);
    useTokenInteraction.getState().select('bram');
    rerender(<TokenCards />);
    expect(screen.queryByTestId('token-card')).toBeNull();
  });
});

describe('group card', () => {
  it('opens for two or more, damages all with half on save, and sets conditions on all', () => {
    const spy = seat({ tokens: tokensState([ogre, bram]) }, DM);
    useTokenInteraction.getState().selectMany(['ogre', 'bram']);
    render(<TokenCards />);
    expect(screen.getByTestId('group-card')).toBeTruthy();
    fireEvent.change(screen.getByTestId('group-card-amount'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('switch', { hidden: true }));
    fireEvent.click(screen.getByTestId('group-card-damage'));
    fireEvent.click(screen.getByTestId('group-card-condition-add'));
    fireEvent.click(screen.getByTestId('group-card-condition-prone'));
    fireEvent.click(screen.getByTestId('group-card-hide'));
    expect(sent(spy)).toEqual([
      ['tokens', 'damage', { targets: ['ogre', 'bram'], amount: 9, half: true }],
      ['tokens', 'set-condition', { targets: ['ogre', 'bram'], name: 'prone', on: true }],
      ['tokens', 'hide', { id: 'ogre', hidden: true }],
      ['tokens', 'hide', { id: 'bram', hidden: true }],
    ]);
  });

  it('Shift+click selection toggles members in and out', () => {
    useTokenInteraction.getState().select('a');
    useTokenInteraction.getState().toggleSelected('b');
    expect(useTokenInteraction.getState().selectedIds).toEqual(['a', 'b']);
    useTokenInteraction.getState().toggleSelected('a');
    expect(useTokenInteraction.getState()).toMatchObject({ selectedIds: ['b'], selectedId: 'b' });
  });
});
