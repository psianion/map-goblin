import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PROTOCOL_VERSION, type PlayerInfo, type SessionState } from '@dnd/core/src/shared/protocol';
import { useStore } from '@dnd/core/src/store/store';
import type { WebSocketClient } from '../../session/WebSocketClient';
import { useSessionStore } from '../../session/store';
import { closeSheet, openSheetNow } from '../../shell/sheets/registry';
import { useMapFamily } from './family';
import { MapBody, MapStrip } from './MapTab';

vi.mock('../doors/useLiveDoors', () => ({
  useLiveDoors: () => [
    { door: { id: 'd1', name: 'Gate', position: [1, 1], isSecret: true }, live: { open: false, locked: false, revealed: false } },
  ],
}));
vi.mock('../triggers/scenePrep', () => ({
  useScenePrep: () => ({
    prep: { triggers: [{ id: 't1', name: 'Bell', enabled: true, when: { kind: 'room-revealed' }, actions: [] }] },
    inertById: {},
    roomVerdicts: {},
    error: null,
  }),
}));

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
    modules: { triggers: { byScene: { a: { fired: {}, armed: {}, disabled: {}, lightOverrides: {}, lightEdits: {}, env: {}, prompts: [], log: [], seatLevel: { p1: 'lv2' } } } } },
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

const light = { id: 'l1', childType: 'light', name: 'Brazier', visible: true, intensity: 0.5, position: { x: 2, y: 2 } };

beforeEach(() => {
  cleanup();
  closeSheet();
  useMapFamily.setState({ family: 'rooms' });
  useSessionStore.setState({
    you: dm,
    session: session(),
    mapData: { layers: [{ id: 'L', type: 'dungeon', rooms: [{ id: 'r1', name: 'Hall', boundary: [[0, 0], [1, 0], [1, 1]] }], children: [] }] },
  });
  useStore.setState({
    layers: [{ id: 'L', type: 'dungeon', rooms: [], children: [light] }] as never,
    levels: [
      { id: 'lv1', name: 'Ground' },
      { id: 'lv2', name: 'Cellar' },
    ],
  });
});

describe('Map tab', () => {
  it('picks a family and shows it in the strip', () => {
    render(
      <>
        <MapBody />
        <MapStrip />
      </>,
    );
    expect(screen.getByTestId('map-rooms')).toBeTruthy();
    fireEvent.click(screen.getByTestId('map-family-doors'));
    expect(screen.getByTestId('map-doors')).toBeTruthy();
  });

  it('reveals a room and opens its key', () => {
    const sent = capture();
    render(<MapStrip />);
    fireEvent.click(screen.getByText('Reveal'));
    expect(sent[0]).toMatchObject({ module: 'fog', action: 'reveal', payload: { roomId: 'r1' } });
    fireEvent.click(screen.getByTestId('room-key'));
    expect(openSheetNow()).toEqual({ id: 'room-key', props: { roomId: 'r1' } });
  });

  it('opens, locks and reveals a secret door', () => {
    const sent = capture();
    act(() => useMapFamily.setState({ family: 'doors' }));
    render(<MapStrip />);
    fireEvent.click(screen.getByTestId('door-toggle'));
    fireEvent.click(screen.getByTestId('door-lock'));
    fireEvent.click(screen.getByTestId('door-reveal-secret'));
    expect(sent.map((m) => [m.module, m.action])).toEqual([
      ['doors', 'toggle'],
      ['doors', 'lock'],
      ['doors', 'reveal-secret'],
    ]);
  });

  it('turns a light off', () => {
    const sent = capture();
    act(() => useMapFamily.setState({ family: 'lights' }));
    render(<MapStrip />);
    fireEvent.click(within(screen.getByTestId('map-lights')).getByRole('switch'));
    expect(sent[0]).toMatchObject({ module: 'triggers', action: 'set-light', payload: { lightId: 'l1', patch: { visible: false } } });
  });

  it('fires a trigger', () => {
    const sent = capture();
    act(() => useMapFamily.setState({ family: 'triggers' }));
    render(<MapStrip />);
    fireEvent.click(screen.getByTestId('trigger-fire'));
    expect(sent[0]).toMatchObject({ module: 'triggers', action: 'fire', payload: { triggerId: 't1' } });
  });

  it('shows who sees each level and goes to one', () => {
    const sent = capture();
    act(() => useMapFamily.setState({ family: 'levels' }));
    render(<MapStrip />);
    expect(screen.getByText('Seats see: Pia')).toBeTruthy();
    fireEvent.click(screen.getAllByTestId('level-go')[1]!);
    expect(sent[0]).toMatchObject({ action: 'set-dm-level', payload: { levelId: 'lv2' } });
  });

  it('toggles the map labels', () => {
    act(() => useMapFamily.setState({ family: 'labels' }));
    render(<MapBody />);
    fireEvent.click(screen.getByRole('switch'));
    expect(useStore.getState().ui.labelsHidden).toBe(!false);
  });
});
