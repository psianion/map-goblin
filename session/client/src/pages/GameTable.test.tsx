// Finishing pass 12.4: the table page mounts before its session has arrived (the blank page of
// the first browser run, a store selector that made a fresh empty list on every read). Every
// seat's chrome has to sit through `session: null` and then take the snapshot without looping.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { TABLE_INITIAL } from '@dnd/mechanics/table';
import { useSessionStore } from '../session/store';
import { BRAM, DM, seat, tokensState } from '../modules/tokens/playTestSeat';
import GameTable from './GameTable';

// The renderer is the one part a DOM without WebGL cannot mount; the chrome around it is the test.
vi.mock('../renderer/GameRenderer', () => ({ GameRenderer: () => null }));

const LOOP = /getSnapshot should be cached|Maximum update depth|infinite loop/i;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mountBeforeSession(you: typeof DM, table: unknown) {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  // Seated, then the session taken away: the page is up, the snapshot is not.
  seat({ table, tokens: tokensState([]) }, you, [DM, BRAM]);
  const arriving = useSessionStore.getState().session!;
  useSessionStore.setState({ session: null, you: null });
  render(<GameTable />);
  act(() => useSessionStore.setState({ session: arriving, you }));
  const loops = errors.mock.calls.filter((args) => args.some((a) => LOOP.test(String(a))));
  return { loops };
}

describe('the table page before its session arrives', () => {
  it('a DM: blank at first, then the table with the lobby strip, and no render loop', () => {
    const { loops } = mountBeforeSession(DM, { ...TABLE_INITIAL, started: false });
    expect(loops).toEqual([]);
    expect(screen.getByTestId('top-right')).toBeTruthy();
    expect(screen.getByTestId('lobby-strip')).toBeTruthy();
  });

  it('a DM on a started table: the chrome, and no render loop', () => {
    const { loops } = mountBeforeSession(DM, { ...TABLE_INITIAL });
    expect(loops).toEqual([]);
    expect(screen.getByTestId('top-right')).toBeTruthy();
    expect(screen.queryByTestId('lobby-strip')).toBeNull();
  });

  it('a player: the lobby once the snapshot says the table has not started, and no render loop', () => {
    const { loops } = mountBeforeSession(BRAM, { ...TABLE_INITIAL, started: false });
    expect(loops).toEqual([]);
    expect(screen.getByTestId('lobby')).toBeTruthy();
  });

  it('a player on a started table: the chrome, and no render loop', () => {
    const { loops } = mountBeforeSession(BRAM, { ...TABLE_INITIAL });
    expect(loops).toEqual([]);
    expect(screen.getByTestId('top-right')).toBeTruthy();
  });
});
