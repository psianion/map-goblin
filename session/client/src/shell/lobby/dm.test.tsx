import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PlayerInfo } from '@dnd/core/src/shared/protocol';
import { TABLE_INITIAL } from '@dnd/mechanics/table';
import { useSessionStore } from '../../session/store';
import { useActiveTool } from '../../session/tools';
import { BRAM, DM, SCENE, def, seat, sent, token, tokensState } from '../../modules/tokens/playTestSeat';
import { SessionMenu } from '../top/SessionMenu';
import { cellRect, handCharacter } from './lobbyState';
import { LobbyStrip } from './LobbyStrip';
import { PartyStartLayer } from './PartyStartLayer';

const KIT: PlayerInfo = { identityId: 'p-kit', name: 'Kit', role: 'player', connected: true };
const players = [DM, BRAM, KIT];
const notStarted = { ...TABLE_INITIAL, started: false, ready: { [BRAM.identityId]: `${SCENE}:m`, [KIT.identityId]: `${SCENE}:old` } };
const bram = def({ id: 'd-bram', name: 'Bram', kind: 'pc' });
const yara = def({ id: 'd-yara', name: 'Yara', kind: 'pc', ownerIdentityId: KIT.identityId, ownerName: KIT.name });

beforeEach(() => useActiveTool.getState().setActiveTool(null));
afterEach(cleanup);

describe('the DM lobby strip', () => {
  it('says the table is not started, counts the seats ready for the live scene, and starts it', () => {
    const spy = seat({ table: notStarted, tokens: tokensState([], [bram]) }, DM, players);
    render(<LobbyStrip />);
    expect(screen.getByTestId('lobby-strip').textContent).toContain('Not started');
    expect(screen.getByTestId('lobby-ready-count').textContent).toBe('1 of 2 ready');
    fireEvent.click(screen.getByTestId('lobby-start'));
    expect(sent(spy)).toEqual([['table', 'start', { on: true }]]);
  });

  it('is gone once the table has started, and never shows on a player seat', () => {
    seat({ table: { ...TABLE_INITIAL } }, DM, players);
    render(<LobbyStrip />);
    expect(screen.queryByTestId('lobby-strip')).toBeNull();
    cleanup();
    seat({ table: notStarted }, BRAM, players);
    render(<LobbyStrip />);
    expect(screen.queryByTestId('lobby-strip')).toBeNull();
  });

  it('draws nothing, and does not loop, while the session is still on its way', () => {
    seat({ table: notStarted }, DM, players);
    useSessionStore.setState({ session: null });
    render(<LobbyStrip />);
    expect(screen.queryByTestId('lobby-strip')).toBeNull();
  });

  it('opens the roster: a character per seat, not on the map, the switches and the party start tool', async () => {
    const spy = seat({ table: notStarted, tokens: tokensState([], [bram, yara]) }, DM, players);
    render(<LobbyStrip />);
    fireEvent.click(screen.getByTestId('lobby-ready-count'));
    await screen.findByTestId('lobby-roster');
    const seats = screen.getAllByTestId('roster-seat');
    expect(seats[1].textContent).toContain('Not on the map');
    fireEvent.change(screen.getByTestId(`roster-pc-${BRAM.identityId}`), { target: { value: 'd-bram' } });
    expect(sent(spy)).toContainEqual(['tokens', 'library-upsert', { id: 'd-bram', ownerIdentityId: BRAM.identityId, ownerName: BRAM.name }]);
    fireEvent.click(screen.getByRole('switch', { name: 'Players can make their own character' }));
    expect(sent(spy)).toContainEqual(['table', 'set-lobby', { playersMakePcs: false }]);
    fireEvent.click(screen.getByTestId('lobby-party-start'));
    expect(useActiveTool.getState().activeTool).toBe('party-start');
  });
});

describe('handing a seat a character', () => {
  it('gives the old one back to the pool and the new one to the seat, with its token on the map', () => {
    const spy = seat({ tokens: tokensState([token({ id: 't-bram', defId: 'd-bram', kind: 'pc' })], [bram, yara]) }, DM, players);
    handCharacter(KIT, 'd-bram', tokensState([token({ id: 't-bram', defId: 'd-bram', kind: 'pc' })], [bram, yara]), SCENE);
    expect(sent(spy)).toEqual([
      ['tokens', 'library-upsert', { id: 'd-yara', ownerIdentityId: null, ownerName: null }],
      ['tokens', 'library-upsert', { id: 'd-bram', ownerIdentityId: KIT.identityId, ownerName: KIT.name }],
      ['tokens', 'assign', { id: 't-bram', identityId: KIT.identityId }],
    ]);
  });
});

describe('the party start area', () => {
  it('is a rectangle of cells whichever way the drag went', () => {
    expect(cellRect({ x: 5, y: 2 }, { x: 3, y: 4 })).toEqual({ x0: 3, y0: 2, x1: 5, y1: 4 });
  });

  it('shows on the DM map while not started or while the tool is armed', () => {
    const area = { partyStart: { [SCENE]: { x0: 1, y0: 1, x1: 3, y1: 3 } } };
    seat({ table: notStarted, tokens: { ...tokensState([]), ...area } }, DM, players);
    render(<PartyStartLayer />);
    expect(screen.getByTestId('party-start-outline').textContent).toBe('Party start');
    cleanup();
    seat({ table: { ...TABLE_INITIAL }, tokens: { ...tokensState([]), ...area } }, DM, players);
    const { rerender } = render(<PartyStartLayer />);
    expect(screen.queryByTestId('party-start-outline')).toBeNull();
    useActiveTool.getState().setActiveTool('party-start');
    rerender(<PartyStartLayer />);
    expect(screen.getByTestId('party-start-outline')).toBeTruthy();
  });
});

describe('Back to lobby', () => {
  it('asks first, then sends the players back', async () => {
    const spy = seat({ table: { ...TABLE_INITIAL } }, DM, players);
    render(<SessionMenu />);
    fireEvent.click(screen.getByTestId('session-menu'));
    fireEvent.click(await screen.findByTestId('back-to-lobby'));
    expect(screen.getByTestId('session-popover').textContent).toContain('Players go back to the lobby. Tokens stay where they are.');
    expect(sent(spy)).toEqual([]);
    fireEvent.click(screen.getByTestId('back-to-lobby-confirm'));
    expect(sent(spy)).toEqual([['table', 'start', { on: false }]]);
  });
});
