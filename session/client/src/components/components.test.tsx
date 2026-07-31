import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import type { PlayerInfo, SessionState } from '@dnd/core/src/shared/protocol';
import { useSessionStore } from '../session/store';
import { useToasts } from '../session/toasts';
import { useActiveTool } from '../session/tools';
import { ActiveToolIndicator } from './ActiveToolIndicator';
import { ConnectionStatus, ReconnectingBanner } from './ConnectionStatus';
import { GameLog } from './GameLog';
import { PlayerList } from './PlayerList';
import { InviteCodeChip } from './InviteCodeChip';
import { ToastHost } from './Toast';

const dm: PlayerInfo = { identityId: 'dm-1', name: 'Ayla', role: 'dm', connected: true };
const gone: PlayerInfo = { identityId: 'p-2', name: 'Borin', role: 'player', connected: false };

function session(players: PlayerInfo[]): SessionState {
  return {
    protocolVersion: 2,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: null,
    scenes: [],
    players,
    modules: {},
  };
}

beforeEach(() => {
  cleanup();
  useSessionStore.setState({
    connection: 'closed',
    latencyMs: null,
    session: null,
    you: null,
    inviteCode: null,
  });
  useToasts.setState({ toast: null });
  useActiveTool.getState().setActiveTool(null);
});

describe('GameLog', () => {
  it('attributes a roll to the seat that sent it; character name is flavour, never the lead', () => {
    const s = session([dm]);
    s.modules = {
      rolls: {
        log: [
          // A forged characterName must not impersonate another seat (S2 metric: attributed
          // to the rolling player). The server stamps playerName; the client leads with it.
          { id: 'r1', at: 1, identityId: 'p-9', playerName: 'Borin', characterName: 'Ayla', total: 20, visibility: 'public' },
          { id: 'r2', at: 2, identityId: 'p-9', playerName: 'Borin', characterName: 'Borin', text: 'stealth 17', visibility: 'public' },
        ],
      },
    };
    useSessionStore.setState({ session: s, presence: [] });
    render(<GameLog />);
    const log = screen.getByTestId('game-log').textContent ?? '';
    expect(log).toContain('Borin (Ayla)'); // player leads, character trails
    expect(log).not.toContain('Borin (Borin)'); // same name renders once
  });
});

describe('ConnectionStatus', () => {
  it('labels each connection state', () => {
    for (const [state, label] of [
      ['connecting', 'Connecting'],
      ['open', 'Connected'],
      ['reconnecting', 'Reconnecting'],
      ['closed', 'Disconnected'],
    ] as const) {
      cleanup();
      useSessionStore.setState({ connection: state });
      render(<ConnectionStatus />);
      expect(screen.getByTestId('connection-status').textContent).toContain(label);
    }
  });

  it('shows latency only while open', () => {
    useSessionStore.setState({ connection: 'open', latencyMs: 42.4 });
    render(<ConnectionStatus />);
    expect(screen.getByTestId('connection-status').textContent).toContain('42 ms');

    cleanup();
    useSessionStore.setState({ connection: 'reconnecting' });
    render(<ConnectionStatus />);
    expect(screen.getByTestId('connection-status').textContent).not.toContain('42 ms');
  });

  it('shows the banner only while reconnecting', () => {
    render(<ReconnectingBanner />);
    expect(screen.queryByTestId('reconnecting-banner')).toBeNull();

    cleanup();
    useSessionStore.setState({ connection: 'reconnecting' });
    render(<ReconnectingBanner />);
    expect(screen.getByTestId('reconnecting-banner')).not.toBeNull();
  });
});

describe('PlayerList', () => {
  it('falls back to an empty-table message', () => {
    render(<PlayerList />);
    expect(screen.getByText(/no one at the table/i)).not.toBeNull();
  });

  it('badges the DM, marks you, and keeps disconnected players listed', () => {
    useSessionStore.setState({ session: session([dm, gone]), you: dm });
    render(<PlayerList />);

    const rows = screen.getByTestId('player-list').querySelectorAll('li');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('DM');
    expect(rows[0].textContent).toContain('(you)');
    expect(rows[0].getAttribute('data-connected')).toBe('true');
    expect(rows[1].textContent).toContain('Borin');
    expect(rows[1].getAttribute('data-connected')).toBe('false');
  });

  /**
   * A reconnect from a new tab mints a fresh identity (the join route will not honour a
   * caller-supplied one), and §2.5 keeps the old seat on the roster — so the gate walk saw
   * "Borin" greyed out sitting next to "Borin (you)".
   */
  it('drops the seat a returning player left behind', () => {
    const back: PlayerInfo = { identityId: 'p-3', name: 'Borin', role: 'player', connected: true };
    useSessionStore.setState({ session: session([dm, gone, back]), you: back });
    render(<PlayerList />);

    const rows = screen.getByTestId('player-list').querySelectorAll('li');
    expect(rows).toHaveLength(2);
    expect(rows[1].textContent).toContain('(you)');
    expect(rows[1].getAttribute('data-connected')).toBe('true');
  });

  it('still lists a player who is merely away', () => {
    useSessionStore.setState({ session: session([dm, gone]), you: dm });
    render(<PlayerList />);
    expect(screen.getByTestId('player-list').querySelectorAll('li')).toHaveLength(2);
  });
});

describe('ToastHost', () => {
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(window, 'matchMedia');
  });

  /** jsdom ships no matchMedia — the app treats that as "animate", so opt in explicitly. */
  const reduceMotion = (matches: boolean) => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches, media: '', addEventListener() {}, removeEventListener() {} }),
    });
  };

  it('renders nothing until something has to be said', () => {
    render(<ToastHost />);
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('carries one message and one way out', () => {
    let undone = 0;
    act(() =>
      void useToasts.getState().show({
        message: 'Revealed every room.',
        action: { label: 'Undo', onAction: () => (undone += 1) },
      }),
    );
    render(<ToastHost />);
    expect(screen.getByTestId('toast').textContent).toContain('Revealed every room.');

    fireEvent.click(screen.getByTestId('toast-action'));
    expect(undone).toBe(1);
    // The way out closes behind you — an undo you can press twice is a bug.
    expect(useToasts.getState().toast).toBeNull();
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('stands down on its own after its window closes', () => {
    vi.useFakeTimers();
    act(() => void useToasts.getState().show({ message: 'That door is locked.', durationMs: 4000 }));
    render(<ToastHost />);
    expect(screen.getByTestId('toast')).not.toBeNull();

    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('animates its arrival by default, and simply appears under reduced motion', () => {
    reduceMotion(false);
    act(() => void useToasts.getState().show({ message: 'Hid every explored room.' }));
    render(<ToastHost />);
    expect(screen.getByTestId('toast').className).toContain('animate-toast-in');
    expect(screen.getByTestId('toast').getAttribute('data-animated')).toBe('true');

    cleanup();
    reduceMotion(true);
    render(<ToastHost />);
    const quiet = screen.getByTestId('toast');
    expect(quiet.className).not.toContain('animate-');
    expect(quiet.getAttribute('data-animated')).toBe('false');
    // The message still arrives — reduced motion removes the movement, never the content.
    expect(quiet.textContent).toContain('Hid every explored room.');
  });
});

describe('ActiveToolIndicator', () => {
  it('is the DM’s, and is on screen whether or not a tool is armed', () => {
    useSessionStore.setState({ you: dm });
    render(<ActiveToolIndicator />);
    const chip = screen.getByTestId('active-tool');
    expect(chip.getAttribute('data-tool')).toBe('none');
    expect(chip.textContent).toContain('None');

    cleanup();
    useSessionStore.setState({ you: { ...gone, role: 'player', connected: true } });
    render(<ActiveToolIndicator />);
    expect(screen.queryByTestId('active-tool')).toBeNull();
  });

  it('names the armed tool and hands back the key that exits it', () => {
    useSessionStore.setState({ you: dm });
    act(() => useActiveTool.getState().setActiveTool('fog'));
    render(<ActiveToolIndicator />);
    expect(screen.getByTestId('active-tool').getAttribute('data-tool')).toBe('fog');
    expect(screen.getByTestId('active-tool').textContent).toContain('Fog');

    fireEvent.click(screen.getByTestId('active-tool-exit'));
    expect(useActiveTool.getState().activeTool).toBeNull();
    expect(screen.getByTestId('active-tool').getAttribute('data-tool')).toBe('none');
  });
});

describe('InviteCodeChip', () => {
  it('renders for the DM only', () => {
    useSessionStore.setState({ you: dm, inviteCode: 'K7QM2X' });
    render(<InviteCodeChip />);
    expect(screen.getByTestId('invite-code-chip').textContent).toContain('K7QM2X');

    cleanup();
    useSessionStore.setState({ you: { ...gone, connected: true } });
    render(<InviteCodeChip />);
    expect(screen.queryByTestId('invite-code-chip')).toBeNull();
  });

  it('hides itself when there is no code', () => {
    useSessionStore.setState({ you: dm, inviteCode: null });
    render(<InviteCodeChip />);
    expect(screen.queryByTestId('invite-code-chip')).toBeNull();
  });
});
