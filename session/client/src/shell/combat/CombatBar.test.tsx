import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PROTOCOL_VERSION, type PlayerInfo, type SessionState } from '@dnd/core/src/shared/protocol';
import type { WebSocketClient } from '../../session/WebSocketClient';
import { useSessionStore } from '../../session/store';
import { CombatBar } from './CombatBar';

const dm: PlayerInfo = { identityId: 'd', name: 'Dana', role: 'dm', connected: true };
const pia: PlayerInfo = { identityId: 'p1', name: 'Pia', role: 'player', connected: true };

function session(status: 'gathering' | 'running', turn = 0): SessionState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: 'a',
    scenes: [{ id: 'a', name: 'A', mapId: 'm' }],
    players: [],
    modules: {
      initiative: {
        status,
        sceneId: 'a',
        round: 3,
        turn,
        entries: [
          { key: 'k1', name: 'Pia', kind: 'pc', identityId: 'p1', initiative: 18 },
          { key: 'k2', name: 'Goblin', kind: 'npc', initiative: 12, hp: { current: 0, max: 7 } },
        ],
        log: [],
      },
    },
  };
}

interface Sent {
  action: string;
}
function capture(): Sent[] {
  const sent: Sent[] = [];
  useSessionStore.setState({ client: { send: (m: Sent) => sent.push(m) } as unknown as WebSocketClient });
  return sent;
}

beforeEach(cleanup);

describe('CombatBar', () => {
  it('says initiative is being rolled while gathering, with no Next yet', () => {
    useSessionStore.setState({ you: dm, session: session('gathering') });
    render(<CombatBar />);
    expect(screen.getByTestId('combat-round').textContent).toBe('Rolling initiative');
    expect(screen.queryByTestId('combat-next')).toBeNull();
  });

  it('shows the order with the current chip marked, the round, previous and Next for the DM', () => {
    const sent = capture();
    useSessionStore.setState({ you: dm, session: session('running', 1) });
    render(<CombatBar />);
    const chips = screen.getAllByTestId('combat-chip');
    expect(chips.map((c) => c.getAttribute('data-current'))).toEqual([null, 'true']);
    expect(screen.getByTestId('combat-round').textContent).toBe('Round 3');
    fireEvent.click(screen.getByTestId('combat-previous'));
    fireEvent.click(screen.getByTestId('combat-next'));
    expect(sent.map((m) => m.action)).toEqual(['previous', 'next']);
    expect(screen.queryByTestId('combat-end-turn')).toBeNull();
  });

  it('gives End turn to the player whose turn it is, and only then', () => {
    const sent = capture();
    useSessionStore.setState({ you: pia, session: session('running', 0) });
    const { rerender } = render(<CombatBar />);
    expect(screen.queryByTestId('combat-next')).toBeNull();
    fireEvent.click(screen.getByTestId('combat-end-turn'));
    expect(sent.map((m) => m.action)).toEqual(['end-turn']);
    useSessionStore.setState({ session: session('running', 1) });
    rerender(<CombatBar />);
    expect(screen.queryByTestId('combat-end-turn')).toBeNull();
  });
});
