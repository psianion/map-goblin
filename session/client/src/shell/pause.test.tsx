import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { PROTOCOL_VERSION, type PlayerInfo, type SessionState } from '@dnd/core/src/shared/protocol';
import type { WebSocketClient } from '../session/WebSocketClient';
import { useSessionStore } from '../session/store';
import { useHotkeys } from './hotkeys';
import { PauseOverlay } from './PauseOverlay';
import { closeSheet, openSheetNow } from './sheets/registry';
import { TitleCard } from './top/TitleCard';

const dm: PlayerInfo = { identityId: 'd', name: 'Dana', role: 'dm', connected: true };
const pia: PlayerInfo = { identityId: 'p1', name: 'Pia', role: 'player', connected: true };

function session(paused: boolean): SessionState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: 'a',
    scenes: [{ id: 'a', name: 'Web Gallery', mapId: 'm1' }],
    players: [dm, pia],
    modules: { table: { paused, movementLocked: false } },
  };
}

const pause = (paused: boolean) => act(() => useSessionStore.setState({ session: session(paused) }));

beforeEach(() => {
  cleanup();
  closeSheet();
  useSessionStore.setState({ you: pia, session: session(false), client: null });
});

afterEach(() => cleanup());

describe('the paused table', () => {
  it('covers a player’s seat only while paused, and lifts on resume', () => {
    const page = document.createElement('div');
    page.id = 'page';
    document.body.appendChild(page);
    render(<PauseOverlay />);
    expect(screen.queryByTestId('pause-overlay')).toBeNull();

    pause(true);
    const card = screen.getByTestId('pause-card');
    expect(card.textContent).toContain('The DM has paused the table');
    expect(card.getAttribute('role')).toBe('status');
    expect(card.getAttribute('aria-live')).toBe('assertive');
    // Everything on the page but the overlay is out of reach.
    expect(page.hasAttribute('inert')).toBe(true);
    expect(screen.getByTestId('pause-overlay').hasAttribute('inert')).toBe(false);

    pause(false);
    expect(screen.queryByTestId('pause-overlay')).toBeNull();
    expect(page.hasAttribute('inert')).toBe(false);
    page.remove();
  });

  it('never covers the DM’s seat', () => {
    useSessionStore.setState({ you: dm, session: session(true) });
    render(<PauseOverlay />);
    expect(screen.queryByTestId('pause-overlay')).toBeNull();
  });

  it('Leave table on the card leaves, the same as the Session menu’s', () => {
    const disconnect = vi.fn();
    useSessionStore.setState({ session: session(true), disconnect });
    window.history.pushState(null, '', '/table');
    render(<PauseOverlay />);
    fireEvent.click(screen.getByTestId('pause-leave'));
    expect(disconnect).toHaveBeenCalledOnce();
    expect(window.location.pathname).toBe('/');
  });

  it('answers no shortcut on a frozen seat, and answers again on resume', () => {
    renderHook(() => useHotkeys());
    pause(true);
    fireEvent.keyDown(window, { key: '?', shiftKey: true });
    expect(openSheetNow()).toBeNull();

    pause(false);
    fireEvent.keyDown(window, { key: '?', shiftKey: true });
    expect(openSheetNow()?.id).toBe('shortcuts');
  });
});

describe('the DM’s Paused chip', () => {
  it('shows beside the title only while paused, and resumes the table', () => {
    const sent: { module: string; action: string; payload: unknown }[] = [];
    useSessionStore.setState({ you: dm, client: { send: (m: (typeof sent)[number]) => sent.push(m) } as unknown as WebSocketClient });
    render(<TitleCard />);
    expect(screen.queryByTestId('paused-chip')).toBeNull();

    pause(true);
    fireEvent.click(screen.getByTestId('paused-chip'));
    expect(sent).toEqual([expect.objectContaining({ module: 'table', action: 'pause', payload: { on: false } })]);
  });

  it('is not a player’s', () => {
    useSessionStore.setState({ session: session(true) });
    render(<TitleCard />);
    expect(screen.queryByTestId('paused-chip')).toBeNull();
  });
});
