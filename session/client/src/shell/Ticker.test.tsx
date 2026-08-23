import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import type { SessionState } from '@dnd/core/src/shared/protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useSessionStore } from '../session/store';
import { Ticker } from './Ticker';
import { useShell } from './shellStore';

function session(modules: SessionState['modules']): SessionState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: 'sc-1',
    scenes: [],
    players: [],
    modules,
  };
}

beforeEach(() => {
  useShell.setState({ drawerOpen: false, openPanel: null, diagnostics: false });
  useSessionStore.setState({ session: null, presence: [], mapData: null, you: null });
});
afterEach(() => cleanup());

describe('Ticker', () => {
  it('renders nothing with no entries', () => {
    render(<Ticker />);
    expect(screen.queryByTestId('ticker')).toBeNull();
  });

  it('renders nothing while the drawer is open, even with entries', () => {
    useShell.setState({ drawerOpen: true });
    useSessionStore.setState({
      session: session({
        rolls: { log: [{ id: 'r1', at: 1, playerName: 'Willow', total: 17, visibility: 'public' }] },
      }),
    });
    render(<Ticker />);
    expect(screen.queryByTestId('ticker')).toBeNull();
  });

  it('shows the newest entry and opens the drawer on click', () => {
    useSessionStore.setState({
      session: session({
        rolls: {
          log: [
            { id: 'r1', at: 1, playerName: 'Willow', total: 17, visibility: 'public' },
            { id: 'r2', at: 2, playerName: 'Ayla', total: 9, visibility: 'public' },
          ],
        },
      }),
    });
    render(<Ticker />);
    const ticker = screen.getByTestId('ticker');
    expect(ticker.textContent).toContain('Ayla');
    expect(ticker.textContent).toContain('9');
    expect(ticker.textContent).not.toContain('Willow');

    fireEvent.click(ticker);
    expect(useShell.getState().drawerOpen).toBe(true);
  });
});
