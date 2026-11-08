import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PROTOCOL_VERSION, type PlayerInfo, type SessionState } from '@dnd/core/src/shared/protocol';
import type { WebSocketClient } from '../../session/WebSocketClient';
import { useSessionStore } from '../../session/store';
import { useActiveTool } from '../../session/tools';
import { useToasts } from '../../session/toasts';
import { FogBody, FogStrip } from './FogTab';

const dm: PlayerInfo = { identityId: 'd', name: 'Dana', role: 'dm', connected: true };

const room = (id: string, name: string, x: number) => ({
  id,
  name,
  boundary: [
    [x, 0],
    [x + 4, 0],
    [x + 4, 4],
    [x, 4],
  ],
});
const mapData = { layers: [{ id: 'L', type: 'dungeon', rooms: [room('r1', 'Hall', 0), room('r2', 'Crypt', 10)], children: [] }] };

function session(fog: unknown): SessionState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: 'a',
    scenes: [{ id: 'a', name: 'Web Gallery', mapId: 'm' }],
    players: [dm],
    modules: { fog },
  };
}

interface Sent {
  module: string;
  action: string;
  payload: unknown;
}
function capture(): Sent[] {
  const sent: Sent[] = [];
  useSessionStore.setState({ client: { send: (m: Sent) => sent.push(m) } as unknown as WebSocketClient });
  return sent;
}

beforeEach(() => {
  cleanup();
  useActiveTool.getState().setActiveTool(null);
  useSessionStore.setState({
    you: dm,
    mapData,
    session: session({ byScene: { a: { rooms: { r1: { status: 'revealed' } }, concealBehindDoors: false } } }),
  });
});

describe('Fog tab', () => {
  it('arms Reveal and Hide from the body', () => {
    render(<FogBody />);
    fireEvent.click(screen.getByTestId('fog-reveal'));
    expect(useActiveTool.getState()).toMatchObject({ activeTool: 'fog', toolDetail: 'Reveal' });
    fireEvent.click(screen.getByTestId('fog-hide'));
    expect(useActiveTool.getState()).toMatchObject({ activeTool: 'fog', toolDetail: 'Hide' });
  });

  it('reveals every room in one command, with Undo in the toast', () => {
    const sent = capture();
    render(<FogBody />);
    fireEvent.click(screen.getByTestId('fog-reveal-all'));
    expect(sent[0]).toMatchObject({ module: 'fog', action: 'set-bulk' });
    expect(useToasts.getState().toast?.action?.label).toBe('Undo');
  });

  it('switches the mode and picks a look', () => {
    const sent = capture();
    render(<FogBody />);
    fireEvent.click(screen.getByRole('button', { name: 'Vision' }));
    expect(sent.at(-1)).toMatchObject({ action: 'set-mode', payload: { mode: 'vision' } });
    fireEvent.click(screen.getByText('Look'));
    fireEvent.click(screen.getByTestId('fog-look-mist'));
    expect(sent.at(-1)).toMatchObject({ action: 'set-fog-look', payload: { look: { preset: 'mist' } } });
  });

  it('lists rooms unrevealed first, each with its own Reveal and Hide', () => {
    const sent = capture();
    render(<FogStrip />);
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('data-room-id'))).toEqual(['r2', 'r1']);
    fireEvent.click(within(rows[0]!).getByTestId('room-reveal'));
    fireEvent.click(within(rows[1]!).getByTestId('room-hide'));
    expect(sent.map((m) => [m.action, (m.payload as { roomId: string }).roomId])).toEqual([
      ['reveal', 'r2'],
      ['hide', 'r1'],
    ]);
  });
});
