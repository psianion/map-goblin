import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PROTOCOL_VERSION, type PlayerInfo, type SessionState } from '@dnd/core/src/shared/protocol';
import { useStore } from '@dnd/core/src/store/store';
import type { WebSocketClient } from '../../session/WebSocketClient';
import { useSessionStore } from '../../session/store';
import { WorldBody, WorldStrip } from './WorldTab';

const dm: PlayerInfo = { identityId: 'd', name: 'Dana', role: 'dm', connected: true };
const pia: PlayerInfo = { identityId: 'p1', name: 'Pia', role: 'player', connected: true };

function session(): SessionState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: 'a',
    scenes: [{ id: 'a', name: 'A', mapId: 'm' }],
    players: [dm, pia],
    modules: { triggers: { byScene: {}, world: { clock: 600, nightSky: 'full-moon', timeSpeed: 'paused', weather: 'clear', darkness: null } } },
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
  useSessionStore.setState({
    you: dm,
    session: session(),
    mapData: { layers: [{ id: 'L', type: 'dungeon', rooms: [{ id: 'r1', name: 'Hall', boundary: [[0, 0], [1, 0], [1, 1]] }], children: [] }] },
  });
  useStore.setState({
    levels: [
      { id: 'lv1', name: 'Ground' },
      { id: 'lv2', name: 'Cellar' },
    ],
  });
});

describe('World tab', () => {
  it('jumps the clock by +1h, +6h and to a named hour', () => {
    const sent = capture();
    render(<WorldBody />);
    fireEvent.click(screen.getByTestId('world-plus-1h'));
    fireEvent.click(screen.getByTestId('world-plus-6h'));
    fireEvent.click(screen.getByText('Dawn'));
    expect(sent.map((m) => (m.payload as { clock: number }).clock)).toEqual([660, 960, expect.any(Number)]);
    expect(sent.every((m) => m.module === 'triggers' && m.action === 'set-world')).toBe(true);
  });

  it('sets the weather and every light', () => {
    const sent = capture();
    render(<WorldBody />);
    fireEvent.click(screen.getByTestId('weather-rain'));
    fireEvent.click(screen.getByRole('button', { name: 'Off' }));
    expect(sent).toEqual([
      expect.objectContaining({ action: 'set-world', payload: { weather: 'rain' } }),
      expect.objectContaining({ action: 'set-lights-all', payload: { on: false } }),
    ]);
  });

  it('pins a seat to a level and a room to a mood', () => {
    const sent = capture();
    render(<WorldStrip />);
    fireEvent.change(screen.getByTestId('world-seat-p1'), { target: { value: 'lv2' } });
    fireEvent.change(screen.getByTestId('room-mood'), { target: { value: 'dark' } });
    expect(sent).toEqual([
      expect.objectContaining({ action: 'set-seat-level', payload: { identity: 'p1', levelId: 'lv2' } }),
      expect.objectContaining({ action: 'set-room', payload: { sceneId: 'a', roomId: 'r1', patch: { mood: 'dark' } } }),
    ]);
  });
});
