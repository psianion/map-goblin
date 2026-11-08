import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TokenTypeSheet } from './TokenTypeSheet';
import { PartySheet } from './PartySheet';
import { BRAM, def, seat, sent, token, tokensState } from './playTestSeat';

afterEach(cleanup);

describe('Token type sheet', () => {
  it('saves a new type with the stats, as one library-upsert', () => {
    const spy = seat({ tokens: tokensState([]) });
    render(<TokenTypeSheet />);
    fireEvent.change(screen.getByTestId('token-type-name'), { target: { value: 'Ogre' } });
    fireEvent.click(screen.getByTestId('token-type-kind-monster'));
    fireEvent.change(screen.getByTestId('token-type-hp'), { target: { value: '59' } });
    fireEvent.change(screen.getByTestId('token-type-ac'), { target: { value: '11' } });
    fireEvent.click(screen.getByTestId('token-type-save'));
    const [[module, action, payload]] = sent(spy);
    expect([module, action]).toEqual(['tokens', 'library-upsert']);
    expect(payload).toMatchObject({ name: 'Ogre', kind: 'monster', hp: { max: 59 }, ac: 11, nameplate: 'hover', showHp: 'dm', sight: null, light: null });
  });

  it('edits an existing type in place and keeps its id', () => {
    const spy = seat({ tokens: tokensState([], [def({ id: 'd-bram', name: 'Bram', kind: 'pc', hp: { current: 20, max: 24 } })]) });
    render(<TokenTypeSheet defId="d-bram" />);
    expect((screen.getByTestId('token-type-name') as HTMLInputElement).value).toBe('Bram');
    fireEvent.change(screen.getByTestId('token-type-hp'), { target: { value: '30' } });
    fireEvent.click(screen.getByTestId('token-type-save'));
    expect(sent(spy)[0][2]).toMatchObject({ id: 'd-bram', kind: 'pc', hp: { max: 30, current: 20 } });
  });

  it('refuses to save without a name', () => {
    const spy = seat({ tokens: tokensState([]) });
    render(<TokenTypeSheet />);
    fireEvent.click(screen.getByTestId('token-type-save'));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('Party sheet', () => {
  it('lists the PCs on the scene with their player, HP and conditions', () => {
    seat({
      tokens: tokensState([
        token({ id: 'b', name: 'Bram', kind: 'pc', ownerId: BRAM.identityId, hp: { current: 6, max: 24 }, ac: 16, conditions: ['poisoned'] }),
        token({ id: 'g', name: 'Goblin' }),
      ]),
    });
    render(<PartySheet />);
    const rows = screen.getAllByTestId('party-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('Bram');
    expect(rows[0].textContent).toContain('Sam');
    expect(rows[0].textContent).toContain('Poisoned');
    expect(screen.getByTestId('party-hp').textContent).toBe('6/24');
  });

  it('says so when there is no party yet', () => {
    seat({ tokens: tokensState([]) });
    render(<PartySheet />);
    expect(screen.getByTestId('party-sheet').textContent).toContain('No player characters');
  });
});
