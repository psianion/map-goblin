import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TABLE_INITIAL } from '@dnd/mechanics/table';
import { useSessionStore } from '../../session/store';
import { BRAM, DM, SCENE, YARA, def, seat, sent, token, tokensState } from '../../modules/tokens/playTestSeat';
import { isFrozen } from '../pause';
import { isInLobby } from './lobbyState';
import { Lobby } from './Lobby';
import { CharacterSheet } from '../../modules/rolls/CharacterSheet';
import { PickCharacterCard } from './PickCharacterCard';

const prefetch = vi.hoisted(() => vi.fn(async () => {}));
const preload = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../session/loadSceneMap', () => ({ prefetchSceneMap: prefetch }));
vi.mock('../../modules/tokens/TokenRenderer', async (original) => ({
  ...(await original<typeof import('../../modules/tokens/TokenRenderer')>()),
  preloadTokenArt: preload,
}));

const lobbyTable = { ...TABLE_INITIAL, started: false };
const bram = def({ id: 'd-bram', name: 'Bram', kind: 'pc' });
const yara = def({ id: 'd-yara', name: 'Yara', kind: 'pc', ownerIdentityId: YARA.identityId, ownerName: YARA.name });
const saved = def({ id: 'd-kell', name: 'Kell', kind: 'pc', ownerName: 'Ola' });

beforeEach(() => {
  prefetch.mockClear();
  preload.mockClear();
});
afterEach(cleanup);

describe('the lobby', () => {
  it('is where a player waits while the table is not started; the DM never is', () => {
    seat({ table: lobbyTable }, BRAM);
    expect(isInLobby(useSessionStore.getState())).toBe(true);
    seat({ table: lobbyTable }, DM);
    expect(isInLobby(useSessionStore.getState())).toBe(false);
    seat({ table: { ...TABLE_INITIAL } }, BRAM);
    expect(isInLobby(useSessionStore.getState())).toBe(false);
  });

  it('never freezes a lobby seat when the DM pauses', () => {
    seat({ table: { ...lobbyTable, paused: true } }, BRAM);
    expect(isFrozen(useSessionStore.getState())).toBe(false);
  });

  it('lists the prepared characters as free, taken or saved, and claims a free one', () => {
    const spy = seat({ table: lobbyTable, tokens: tokensState([], [bram, yara, saved]) }, BRAM);
    render(<Lobby />);
    const tiles = screen.getAllByTestId('lobby-pc');
    expect(tiles.map((t) => [t.textContent, t.getAttribute('data-state')])).toEqual([
      ['BRBramFree', 'free'],
      ['KEKellSaved for Ola', 'saved'],
      ['YAYaraTaken by Ola', 'taken'],
    ]);
    fireEvent.click(tiles[0]);
    expect(sent(spy)).toContainEqual(['tokens', 'pc-claim', { defId: 'd-bram' }]);
  });

  it('makes a character of the player’s own when the DM allows it, and not otherwise', () => {
    const spy = seat({ table: lobbyTable, tokens: tokensState([], [bram]) }, BRAM);
    render(<Lobby />);
    fireEvent.click(screen.getByTestId('lobby-make-own'));
    fireEvent.change(screen.getByTestId('lobby-pc-name'), { target: { value: ' Wren ' } });
    fireEvent.click(screen.getByTestId('lobby-pc-create'));
    expect(sent(spy)).toContainEqual(['tokens', 'pc-create', { name: 'Wren' }]);
    cleanup();
    seat({ table: { ...lobbyTable, playersMakePcs: false }, tokens: tokensState([], [bram]) }, BRAM);
    render(<Lobby />);
    expect(screen.queryByTestId('lobby-make-own')).toBeNull();
  });

  it('with a character, shows its token editor and lets the player choose again', () => {
    const spy = seat({ table: lobbyTable, tokens: tokensState([], [{ ...bram, ownerIdentityId: BRAM.identityId, ownerName: BRAM.name }]) }, BRAM);
    render(<Lobby />);
    expect(screen.getByTestId('lobby-mine').textContent).toBe('Bram');
    expect(screen.getByTestId('token-art-editor')).toBeTruthy();
    fireEvent.click(screen.getByTestId('lobby-change'));
    expect(sent(spy)).toContainEqual(['tokens', 'pc-release', {}]);
  });

  it('marks each seat ready for the live scene only', () => {
    seat({ table: { ...lobbyTable, ready: { [BRAM.identityId]: `${SCENE}:m`, [YARA.identityId]: `${SCENE}:old` } } }, BRAM);
    render(<Lobby />);
    const seats = screen.getAllByTestId('lobby-seat');
    expect(seats.map((s) => s.hasAttribute('data-ready'))).toEqual([true, false]);
    expect(seats[1].textContent).toContain('Away');
  });

  it('fetches the scene and its token pictures once per sceneId:mapId, then says it is ready', async () => {
    const spy = seat({ table: lobbyTable, tokens: tokensState([token({ id: 'g', imageAssetId: 'art-g' })]) }, BRAM);
    render(<Lobby />);
    await act(async () => {});
    expect(prefetch).toHaveBeenCalledTimes(1);
    expect(prefetch).toHaveBeenCalledWith(SCENE, 'm', 'test-token');
    expect(preload).toHaveBeenCalledWith('art-g');
    expect(sent(spy)).toContainEqual(['table', 'ready', { key: `${SCENE}:m` }]);
    expect(screen.getByTestId('lobby-loading').getAttribute('data-state')).toBe('ready');

    // Other changes to the table do not fetch again.
    await act(async () => {
      const s = useSessionStore.getState().session!;
      useSessionStore.setState({ session: { ...s, modules: { ...s.modules, table: { ...lobbyTable, ready: { [BRAM.identityId]: `${SCENE}:m` } } } } });
    });
    expect(prefetch).toHaveBeenCalledTimes(1);

    // A republish of the live scene does.
    await act(async () => {
      const s = useSessionStore.getState().session!;
      useSessionStore.setState({ session: { ...s, scenes: [{ id: SCENE, name: 'Web Gallery', mapId: 'm2' }] } });
    });
    expect(prefetch).toHaveBeenCalledTimes(2);
    expect(sent(spy)).toContainEqual(['table', 'ready', { key: `${SCENE}:m2` }]);
  });
});

describe('Pick your character', () => {
  it('asks a seat with no character on a started table, and nobody else', () => {
    seat({ table: { ...TABLE_INITIAL }, tokens: tokensState([], [bram]) }, BRAM);
    render(<PickCharacterCard />);
    expect(screen.getByTestId('pick-character').textContent).toContain('Bram');
    cleanup();
    seat({ table: { ...TABLE_INITIAL }, tokens: tokensState([], [{ ...bram, ownerIdentityId: BRAM.identityId }]) }, BRAM);
    render(<PickCharacterCard />);
    expect(screen.queryByTestId('pick-character')).toBeNull();
    cleanup();
    seat({ table: { ...TABLE_INITIAL }, tokens: tokensState([], [bram]) }, DM);
    render(<PickCharacterCard />);
    expect(screen.queryByTestId('pick-character')).toBeNull();
  });

  it('is not asked of a seat the DM already handed a token on the map', () => {
    seat({ table: { ...TABLE_INITIAL }, tokens: tokensState([token({ ownerId: BRAM.identityId })], [bram]) }, BRAM);
    render(<PickCharacterCard />);
    expect(screen.queryByTestId('pick-character')).toBeNull();
  });

  it('goes away on Not now, and comes back from the Character sheet', () => {
    seat({ table: { ...TABLE_INITIAL }, tokens: tokensState([], [bram]) }, BRAM);
    render(
      <>
        <PickCharacterCard />
        <CharacterSheet />
      </>,
    );
    fireEvent.click(screen.getByTestId('pick-character-later'));
    expect(screen.queryByTestId('pick-character')).toBeNull();
    fireEvent.click(screen.getByTestId('character-pick'));
    expect(screen.getByTestId('pick-character')).toBeTruthy();
  });
});

describe('the lobby header', () => {
  it('names the campaign and who the table is waiting for', () => {
    seat({ table: lobbyTable }, BRAM, [DM, BRAM]);
    const s = useSessionStore.getState().session!;
    useSessionStore.setState({ session: { ...s, campaignName: 'The Sunless Vault' } });
    render(<Lobby />);
    expect(screen.getByTestId('lobby-table').textContent).toBe('The Sunless Vault');
    expect(screen.getByTestId('lobby-waiting').textContent).toBe(`Waiting for ${DM.name} to start`);
  });

  it('falls back to the DM’s table on a server that does not send the name', () => {
    seat({ table: lobbyTable }, BRAM, [DM, BRAM]);
    render(<Lobby />);
    expect(screen.getByTestId('lobby-table').textContent).toBe(`${DM.name}'s table`);
  });
});
