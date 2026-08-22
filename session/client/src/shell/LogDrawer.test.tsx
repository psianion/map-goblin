import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import type { SessionState } from '@dnd/core/src/shared/protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '../session/store';
import { LogDrawer } from './LogDrawer';
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

describe('LogDrawer', () => {
  it('renders nothing while the drawer is closed', () => {
    render(<LogDrawer />);
    expect(screen.queryByTestId('log-drawer')).toBeNull();
  });

  it('shows the merged feed and narrows it with a filter chip', () => {
    useShell.setState({ drawerOpen: true });
    useSessionStore.setState({
      session: session({
        rolls: { log: [{ id: 'r1', at: 1, playerName: 'Willow', total: 17, visibility: 'public' }] },
        doors: { log: [{ id: 'd1', at: 2, sceneId: 'sc-1', actor: 'Ayla', action: 'opened' }] },
      }),
    });
    render(<LogDrawer />);
    const feed = screen.getByTestId('game-log');
    expect(feed.textContent).toContain('Willow');
    expect(feed.textContent).toContain('Ayla');

    fireEvent.click(screen.getByTestId('log-filter-roll'));
    expect(feed.textContent).toContain('Willow');
    expect(feed.textContent).not.toContain('Ayla');

    fireEvent.click(screen.getByTestId('log-filter-all'));
    expect(feed.textContent).toContain('Ayla');
  });

  it('posts through the shared submit path and clears the input', () => {
    useShell.setState({ drawerOpen: true });
    const sendCommand = vi.fn();
    useSessionStore.setState({ sendCommand, session: session({}) });
    render(<LogDrawer />);

    const input = screen.getByTestId('manual-roll') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'stealth 17' } });
    fireEvent.submit(input.closest('form')!);

    expect(sendCommand).toHaveBeenCalledWith('rolls', 'post', {
      source: 'manual',
      text: 'stealth 17',
      visibility: 'public',
    });
    expect(input.value).toBe('');
  });

  it('closes on the header button', () => {
    useShell.setState({ drawerOpen: true });
    render(<LogDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Close the log' }));
    expect(useShell.getState().drawerOpen).toBe(false);
  });
});
