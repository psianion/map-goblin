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

  // M3 review finding 17: the drawer's composer is the same `Composer` the roll bar renders,
  // so it gets the Whisper toggle too — the drawer used to have none.
  it('posts a whisper through the same shared composer the roll bar uses', () => {
    useShell.setState({ drawerOpen: true });
    const sendCommand = vi.fn();
    useSessionStore.setState({ sendCommand, session: session({}) });
    render(<LogDrawer />);

    const whisper = screen.getByRole('button', { name: 'Whisper' });
    fireEvent.click(whisper);
    expect(whisper.getAttribute('aria-pressed')).toBe('true');

    fireEvent.change(screen.getByTestId('manual-roll'), { target: { value: 'a secret note' } });
    fireEvent.click(screen.getByText('Post'));

    expect(sendCommand).toHaveBeenCalledWith('rolls', 'post', {
      source: 'manual',
      text: 'a secret note',
      visibility: 'private',
    });
  });

  // M3 review finding 7: down the left column, then down the right — not the row-major
  // zig-zag a plain `grid-cols-2` auto-placed entries into.
  it('splits the feed column-major, so the newest line lands in the second column', () => {
    useShell.setState({ drawerOpen: true });
    useSessionStore.setState({
      session: session({
        rolls: {
          log: [
            { id: 'r1', at: 1, playerName: 'A', total: 1, visibility: 'public' },
            { id: 'r2', at: 2, playerName: 'B', total: 2, visibility: 'public' },
            { id: 'r3', at: 3, playerName: 'C', total: 3, visibility: 'public' },
            { id: 'r4', at: 4, playerName: 'D', total: 4, visibility: 'public' },
          ],
        },
      }),
    });
    render(<LogDrawer />);

    const columns = screen.getAllByTestId('log-column');
    expect(columns).toHaveLength(2);
    expect(columns[0].textContent).toContain('A');
    expect(columns[0].textContent).toContain('B');
    expect(columns[0].textContent).not.toContain('C');
    expect(columns[1].textContent).toContain('C');
    expect(columns[1].textContent).toContain('D');
  });

  it('closes on the header button', () => {
    useShell.setState({ drawerOpen: true });
    render(<LogDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Close the log' }));
    expect(useShell.getState().drawerOpen).toBe(false);
  });
});
