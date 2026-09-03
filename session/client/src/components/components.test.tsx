import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react';
import type { PlayerInfo, SessionState } from '@dnd/core/src/shared/protocol';
import { fetchActiveSession } from '../session/auth';
import { useSessionStore } from '../session/store';
import { DEFAULT_TOAST_MS, useToasts } from '../session/toasts';
import { useActiveTool } from '../session/tools';
import { ReconnectingBanner } from './ConnectionStatus';
import { TableStatusBar } from './TableStatusBar';
import { GameLog } from './GameLog';
import { PlayerList } from './PlayerList';
import { InviteCodeChip } from './InviteCodeChip';
import { ToastHost } from './Toast';

vi.mock('../session/auth', () => ({ fetchActiveSession: vi.fn() }));

const dm: PlayerInfo = { identityId: 'dm-1', name: 'Ayla', role: 'dm', connected: true };
const gone: PlayerInfo = { identityId: 'p-2', name: 'Borin', role: 'player', connected: false };

function session(players: PlayerInfo[]): SessionState {
  return {
    protocolVersion: PROTOCOL_VERSION,
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
    token: null,
  });
  useToasts.setState({ toast: null });
  useActiveTool.getState().setActiveTool(null);
  vi.mocked(fetchActiveSession).mockReset();
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

describe('TableStatusBar connection readout', () => {
  it('labels each connection state', () => {
    for (const [state, label] of [
      ['connecting', 'Connecting'],
      ['open', 'Connected'],
      ['reconnecting', 'Reconnecting'],
      ['closed', 'Disconnected'],
    ] as const) {
      cleanup();
      useSessionStore.setState({ connection: state });
      render(<TableStatusBar />);
      expect(screen.getByTestId('connection-status').textContent).toContain(label);
    }
  });

  it('shows latency only while open', () => {
    useSessionStore.setState({ connection: 'open', latencyMs: 42.4 });
    render(<TableStatusBar />);
    expect(screen.getByTestId('connection-status').textContent).toContain('42 ms');

    cleanup();
    useSessionStore.setState({ connection: 'reconnecting' });
    render(<TableStatusBar />);
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

  /** M3 review finding 16: the claimed token's name, muted, beside a connected player; a
   *  muted "away" label instead for one who isn't — never both at once. */
  it('shows the claimed character beside a connected player, and "away" instead of one for a disconnected player', () => {
    const here: PlayerInfo = { identityId: 'p-4', name: 'Willow', role: 'player', connected: true };
    const s = session([dm, here, gone]);
    s.activeSceneId = 'sc-1';
    s.modules = {
      tokens: {
        library: {},
        byScene: { 'sc-1': { t1: { id: 't1', name: 'Karlach', x: 1, y: 1, ownerId: 'p-4' } } },
      },
    };
    useSessionStore.setState({ session: s, you: dm });
    render(<PlayerList />);

    const rows = screen.getByTestId('player-list').querySelectorAll('li');
    const willowRow = [...rows].find((r) => r.textContent?.includes('Willow'))!;
    expect(willowRow.textContent).toContain('— Karlach');
    expect(willowRow.textContent).not.toContain('away');

    const borinRow = [...rows].find((r) => r.textContent?.includes('Borin'))!;
    expect(borinRow.textContent).toContain('away');
    expect(borinRow.textContent).not.toContain('—');
  });

  it('links the character name to its D&D Beyond sheet when the claimed token has one', () => {
    const here: PlayerInfo = { identityId: 'p-4', name: 'Willow', role: 'player', connected: true };
    const s = session([dm, here]);
    s.activeSceneId = 'sc-1';
    s.modules = {
      tokens: {
        library: {},
        byScene: {
          'sc-1': {
            t1: {
              id: 't1',
              name: 'Karlach',
              x: 1,
              y: 1,
              ownerId: 'p-4',
              sheet: { name: 'Karlach', url: 'https://www.dndbeyond.com/characters/1' },
            },
          },
        },
      },
    };
    useSessionStore.setState({ session: s, you: dm });
    render(<PlayerList />);

    const link = screen.getByRole('link', { name: 'Karlach' });
    expect(link.getAttribute('href')).toBe('https://www.dndbeyond.com/characters/1');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('does not link the character name when the linked sheet has no url', () => {
    const here: PlayerInfo = { identityId: 'p-4', name: 'Willow', role: 'player', connected: true };
    const s = session([dm, here]);
    s.activeSceneId = 'sc-1';
    s.modules = {
      tokens: {
        library: {},
        byScene: {
          'sc-1': { t1: { id: 't1', name: 'Karlach', x: 1, y: 1, ownerId: 'p-4', sheet: { name: 'Karlach' } } },
        },
      },
    };
    useSessionStore.setState({ session: s, you: dm });
    render(<PlayerList />);

    expect(screen.queryByRole('link', { name: 'Karlach' })).toBeNull();
    expect(screen.getByText(/Karlach/)).toBeTruthy();
  });

  it('badges the DM in outline, not warning colour', () => {
    useSessionStore.setState({ session: session([dm]), you: dm });
    render(<PlayerList />);
    const badge = screen.getByText('DM');
    expect(badge.className).toContain('border-border-default');
    expect(badge.className).toContain('text-text-dim');
    expect(badge.className).not.toContain('warning');
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
    act(() => void useToasts.getState().show({ message: 'That door is locked.' }));
    render(<ToastHost />);
    expect(screen.getByTestId('toast')).not.toBeNull();

    act(() => vi.advanceTimersByTime(DEFAULT_TOAST_MS - 1));
    expect(screen.queryByTestId('toast')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  /**
   * A refused drag is refused at ~10 Hz on the way across and again on the drop. The clock
   * has to run from the last of those, not the first: started at the first, the toast the
   * player reads when they let go had a second left on it, which is the "it vanished before
   * I could read it" the walk found. One toast, renewed — not one toast, expiring early.
   */
  it('restarts its window when the same refusal comes again', () => {
    vi.useFakeTimers();
    act(() => void useToasts.getState().show({ message: 'You can’t move there.' }));
    render(<ToastHost />);

    act(() => vi.advanceTimersByTime(DEFAULT_TOAST_MS - 500));
    act(() => void useToasts.getState().show({ message: 'You can’t move there.' }));

    // The original window has closed by now; the toast is still up on the renewed one.
    act(() => vi.advanceTimersByTime(600));
    expect(screen.queryByTestId('toast')).not.toBeNull();

    act(() => vi.advanceTimersByTime(DEFAULT_TOAST_MS));
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

describe('InviteCodeChip', () => {
  it('renders for the DM only', () => {
    useSessionStore.setState({ you: dm, inviteCode: 'K7QM2X' });
    render(<InviteCodeChip />);
    expect(screen.getByTestId('invite-code-chip').textContent).toContain('K7QM2X');
    expect(screen.getByTestId('invite-code').textContent).toBe('K7QM2X');

    cleanup();
    useSessionStore.setState({ you: { ...gone, connected: true } });
    render(<InviteCodeChip />);
    expect(screen.queryByTestId('invite-code-chip')).toBeNull();
  });

  it('hides itself when there is no code and nothing has been fetched yet', () => {
    useSessionStore.setState({ you: dm, inviteCode: null });
    render(<InviteCodeChip />);
    expect(screen.queryByTestId('invite-code-chip')).toBeNull();
  });

  /** M3 review finding 3: a DM seat that resumed or was minted fresh has `inviteCode: null`
   *  in the store — this is what fills it back in instead of showing no invite row at all. */
  it('fetches the active session once for a DM seat with no stored code, then shows it', async () => {
    vi.mocked(fetchActiveSession).mockResolvedValue({ sessionId: 's1', inviteCode: 'ZQ7F2K' });
    useSessionStore.setState({ you: dm, inviteCode: null, token: 't1', session: session([dm]) });
    render(<InviteCodeChip />);

    await waitFor(() => expect(screen.getByTestId('invite-code-chip')).not.toBeNull());
    expect(screen.getByTestId('invite-code').textContent).toBe('ZQ7F2K');
    expect(fetchActiveSession).toHaveBeenCalledWith('c1', 't1');
    expect(fetchActiveSession).toHaveBeenCalledTimes(1);
  });

  it('never asks for a player, or when a code is already in the store', () => {
    useSessionStore.setState({ you: { ...gone, connected: true }, inviteCode: null, token: 't1', session: session([dm]) });
    render(<InviteCodeChip />);
    expect(fetchActiveSession).not.toHaveBeenCalled();

    cleanup();
    useSessionStore.setState({ you: dm, inviteCode: 'K7QM2X', token: 't1', session: session([dm]) });
    render(<InviteCodeChip />);
    expect(fetchActiveSession).not.toHaveBeenCalled();
  });
});
