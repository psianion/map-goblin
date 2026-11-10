import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PROTOCOL_VERSION, type PlayerInfo, type SessionState } from '@dnd/core/src/shared/protocol';
import { useSessionStore } from '../../session/store';
import { closeSheet, openSheetNow } from './registry';
import { SheetHost } from './SheetHost';
import { TabColumn } from './TabColumn';
import './index';
import '../../modules/tokens/sheets';

const dm: PlayerInfo = { identityId: 'd', name: 'Dana', role: 'dm', connected: true };
const pia: PlayerInfo = { identityId: 'p1', name: 'Pia', role: 'player', connected: true };

function session(): SessionState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: null,
    scenes: [],
    players: [dm, pia],
    modules: {},
  };
}

beforeEach(() => {
  cleanup();
  closeSheet();
  useSessionStore.setState({ you: dm, session: session(), presence: [] });
});

describe('sheet column', () => {
  it('gives the DM Party and Log, and opens each as a sheet', () => {
    render(
      <>
        <TabColumn />
        <SheetHost />
      </>,
    );
    fireEvent.click(screen.getByTestId('sheet-tab-party'));
    expect(openSheetNow()?.id).toBe('party');
    expect(screen.getByTestId('party-sheet')).toBeTruthy();
    fireEvent.click(screen.getByTestId('sheet-tab-log'));
    expect(openSheetNow()?.id).toBe('log');
    expect(screen.getByTestId('log-sheet')).toBeTruthy();
    fireEvent.click(screen.getByTestId('sheet-tab-log'));
    expect(openSheetNow()).toBeNull();
  });

  it('gives a player no Party tab, and badges unread log lines', () => {
    useSessionStore.setState({ you: pia });
    render(<TabColumn />);
    expect(screen.queryByTestId('sheet-tab-party')).toBeNull();
    act(() =>
      useSessionStore.setState({ presence: [{ id: 'x', at: Date.now() + 1000, name: 'Bo', kind: 'joined' }] }),
    );
    expect(screen.getByTestId('log-unread').textContent).toBe('1');
  });

  it('filters the log by kind', () => {
    useSessionStore.setState({ presence: [{ id: 'x', at: 1, name: 'Bo', kind: 'joined' }] });
    render(
      <>
        <TabColumn />
        <SheetHost />
      </>,
    );
    fireEvent.click(screen.getByTestId('sheet-tab-log'));
    expect(screen.getByTestId('game-log').textContent).toContain('Bo');
    fireEvent.click(screen.getByTestId('log-filter-roll'));
    expect(screen.getByTestId('game-log').textContent).toContain('Nothing has happened yet.');
  });
});
