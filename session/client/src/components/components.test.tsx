import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { PlayerInfo, SessionState } from '@dnd/core/src/shared/protocol';
import { useSessionStore } from '../session/store';
import { ConnectionStatus, ReconnectingBanner } from './ConnectionStatus';
import { GameLog } from './GameLog';
import { PlayerList } from './PlayerList';
import { InviteCodeChip } from './InviteCodeChip';

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
