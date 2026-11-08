import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PROTOCOL_VERSION, type PlayerInfo, type SessionState } from '@dnd/core/src/shared/protocol';
import type { WebSocketClient } from '../../session/WebSocketClient';
import { useSessionStore } from '../../session/store';
import { RoomKeySheet } from './RoomKeySheet';

vi.mock('./scenePrep', () => ({
  useScenePrep: () => ({
    prep: {
      rooms: [
        {
          roomId: 'r1',
          readAloud: 'Webs hang thick.',
          notes: 'The queen sleeps.',
          treasure: '',
          traps: [],
          checks: [],
          encounter: { name: 'Nest', monsters: [{ name: 'Spider', count: 3 }] },
        },
      ],
    },
    inertById: {},
    roomVerdicts: {},
    error: null,
  }),
  useMapRooms: () => new Map([['r1', { id: 'r1', name: 'Gallery', anchor: [0, 0] }]]),
}));

const dm: PlayerInfo = { identityId: 'd', name: 'Dana', role: 'dm', connected: true };

function session(): SessionState {
  return { protocolVersion: PROTOCOL_VERSION, sessionId: 's', campaignId: 'c', activeSceneId: 'a', scenes: [], players: [dm], modules: {} };
}

interface Sent {
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
  useSessionStore.setState({ you: dm, session: session() });
});

describe('RoomKeySheet', () => {
  it('reads the key and shares the read-aloud and spawns the encounter', () => {
    const sent = capture();
    render(<RoomKeySheet roomId="r1" />);
    expect(screen.getByTestId('room-read-aloud').textContent).toBe('Webs hang thick.');
    expect(screen.getByTestId('room-encounter').textContent).toContain('3 × Spider');
    expect(screen.getByText('The queen sleeps.')).toBeTruthy();
    fireEvent.click(screen.getByTestId('room-share'));
    fireEvent.click(screen.getByTestId('room-spawn'));
    expect(sent).toEqual([
      expect.objectContaining({ action: 'share-card', payload: { sceneId: 'a', roomId: 'r1' } }),
      expect.objectContaining({ action: 'spawn-encounter', payload: { sceneId: 'a', roomId: 'r1' } }),
    ]);
  });
});
