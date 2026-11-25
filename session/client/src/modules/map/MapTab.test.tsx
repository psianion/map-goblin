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

  it("opens a room's key, and has no fog of its own to change", () => {
    const sent = capture();
    render(<MapStrip />);
    expect(screen.queryByText('Reveal')).toBeNull();
    expect(screen.queryByText('Hide')).toBeNull();
    fireEvent.click(screen.getByTestId('room-key'));
    expect(openSheetNow()).toEqual({ id: 'room-key', props: { roomId: 'r1' } });
    expect(sent).toEqual([]);
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
    expect((screen.getByTestId('trigger-rearm') as HTMLButtonElement).disabled).toBe(true);
  });

  it('re-arms a fired trigger', () => {
    const s = session();
    (s.modules.triggers as { byScene: { a: { fired: Record<string, number> } } }).byScene.a.fired = { t1: 1000 };
    useSessionStore.setState({ session: s });
    const sent = capture();
    act(() => useMapFamily.setState({ family: 'triggers' }));
    render(<MapStrip />);
    expect((screen.getByTestId('trigger-fire') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('trigger-rearm'));
    expect(sent[0]).toMatchObject({ module: 'triggers', action: 'rearm', payload: { triggerId: 't1' } });
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

describe('Map tab: light groups and rooms', () => {
  const lamp = (id: string, x: number, over: Record<string, unknown> = {}) => ({
    id,
    childType: 'light',
    name: id,
    visible: true,
    radius: 2,
    featherRadius: 1,
    intensity: 1,
    color: '#ffffff',
    falloff: 'quadratic',
    position: { x, y: 1 },
    ...over,
  });
  const square: [number, number][] = [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ];

  beforeEach(() => {
    useStore.setState({
      layers: [
        {
          id: 'L',
          type: 'dungeon',
          levelId: 'lv1',
          visible: true,
          locked: false,
          rooms: [{ id: 'hall', name: 'Great hall', anchor: [2, 2], face: square }],
          children: [
            lamp('s1', 1, { group: 'Hall sconces' }),
            lamp('s2', 2, { group: 'Hall sconces', visible: false }),
            lamp('far', 9, { group: 'Hall sconces' }),
            lamp('void', 3, { darkness: true }),
          ],
        },
      ] as never,
      levels: [{ id: 'lv1', name: 'Ground' }],
    });
    act(() => useMapFamily.setState({ family: 'lights' }));
  });

  it('lists each group and each room that holds lights, with a count and a switch', () => {
    render(<MapBody />);
    const groups = within(screen.getByTestId('light-groups'));
    expect(groups.getByText('Hall sconces')).toBeTruthy();
    expect(groups.getByText('2 of 3 on')).toBeTruthy();
    const rooms = within(screen.getByTestId('light-rooms'));
    expect(rooms.getByText('Great hall')).toBeTruthy();
    // The darkness source is not one of the room's lights.
    expect(rooms.getByText('1 of 2 on')).toBeTruthy();
  });

  it('sends set-lights with the group`s ids, and the room`s with their group mates, darkness left out', () => {
    // The group switch turns every mate on at once on this screen, so the room reads all on after it.
    const sent = capture();
    render(<MapBody />);
    fireEvent.click(within(screen.getByTestId('light-groups')).getByRole('switch'));
    fireEvent.click(within(screen.getByTestId('light-rooms')).getByRole('switch'));
    expect(sent.map((m) => [m.action, m.payload])).toEqual([
      ['set-lights', { ids: ['s1', 's2', 'far'], on: true }],
      ['set-lights', { ids: ['s1', 's2', 'far'], on: false }],
    ]);
  });

  it('says there are no groups, and hides Rooms, on a map without them', () => {
    useStore.setState({ layers: [{ id: 'L', type: 'dungeon', visible: true, locked: false, rooms: [], children: [lamp('a', 1)] }] as never });
    render(<MapBody />);
    expect(screen.getByText('No groups. Group lights on their card in the editor.')).toBeTruthy();
    expect(screen.queryByTestId('light-rooms')).toBeNull();
  });
});
