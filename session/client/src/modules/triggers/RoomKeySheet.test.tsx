import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PROTOCOL_VERSION, type PlayerInfo, type SessionState } from '@dnd/core/src/shared/protocol';
import type { WebSocketClient } from '../../session/WebSocketClient';
import { useStore } from '@dnd/core/src/store/store';
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
  describe('Place', () => {
    const BASE = { fired: {}, armed: {}, disabled: {}, lightOverrides: {}, lightEdits: {}, prompts: [], log: [] };
    const build = (environment: 'outdoor' | 'indoor' | 'underground', roomPlace?: 'outdoor' | 'indoor' | 'underground') => {
      useStore.setState({
        mapSettings: { ...useStore.getState().mapSettings, environment },
        levels: [],
        layers: [
          { id: 'L', type: 'dungeon', style: {}, children: [], rooms: [{ id: 'r1', name: 'Gallery', anchor: [0, 0], look: roomPlace ? { place: roomPlace } : undefined }] },
        ],
      } as never);
    };
    const withEdit = (place?: string) =>
      useSessionStore.setState({
        session: { ...session(), scenes: [{ id: 'a', name: 'A', mapId: 'm' }], modules: { triggers: { byScene: { a: { ...BASE, roomEdits: place ? { r1: { place } } : {} } } } } },
      });

    it('leads with As built, chosen while the table has not changed the room, and names what it was built as', () => {
      build('indoor', 'underground');
      withEdit();
      render(<RoomKeySheet roomId="r1" />);
      expect(screen.getByRole('button', { name: /As built/ }).getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByTestId('room-built-place').textContent).toContain('Built as Underground');
    });

    it('flips the room for this scene from a place tile', () => {
      build('indoor');
      withEdit();
      const sent = capture();
      render(<RoomKeySheet roomId="r1" />);
      fireEvent.click(screen.getByRole('button', { name: /Outdoor/ }));
      expect(sent).toEqual([
        expect.objectContaining({ action: 'set-room', payload: { sceneId: 'a', roomId: 'r1', patch: { place: 'outdoor' } } }),
      ]);
    });

    it('marks a flipped room and hands it back to the map from As built', () => {
      build('indoor');
      withEdit('outdoor');
      const sent = capture();
      render(<RoomKeySheet roomId="r1" />);
      expect(screen.getByRole('button', { name: /Outdoor/ }).getAttribute('aria-pressed')).toBe('true');
      fireEvent.click(screen.getByRole('button', { name: /As built/ }));
      expect(sent).toEqual([
        expect.objectContaining({ action: 'set-room', payload: { sceneId: 'a', roomId: 'r1', patch: { place: null } } }),
      ]);
    });

    it('reads an old saved mood on the scene as the place it meant', () => {
      build('indoor');
      useSessionStore.setState({
        session: { ...session(), scenes: [{ id: 'a', name: 'A', mapId: 'm' }], modules: { triggers: { byScene: { a: { ...BASE, roomEdits: { r1: { mood: 'dark' } } } } } } },
      });
      render(<RoomKeySheet roomId="r1" />);
      expect(screen.getByRole('button', { name: /Underground/ }).getAttribute('aria-pressed')).toBe('true');
    });
  });
});
