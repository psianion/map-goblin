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

  // T11 (I2) — the Outdoors row is a fog row like a room, so the bulk buttons carry it too.
  it('reveals and hides the Outdoors row with the rooms', () => {
    const sent = capture();
    useSessionStore.setState({
      session: session({ byScene: { a: { rooms: { '@outdoors': { status: 'revealed', wasEverRevealed: true } }, concealBehindDoors: false } } }),
    });
    render(<FogBody />);
    fireEvent.click(screen.getByTestId('fog-reveal-all'));
    expect(Object.keys((sent[0]!.payload as { rooms: object }).rooms).sort()).toEqual(['@outdoors', 'r1', 'r2']);
    fireEvent.click(screen.getByTestId('fog-hide-all'));
    expect(sent[1]!.payload).toEqual({ rooms: { '@outdoors': { status: 're_hidden', wasEverRevealed: true } }, forget: true });
  });

  // T11 (I5) — a row hidden again is fogged fully for players, and the strip says so.
  it('labels a row hidden again as Hidden', () => {
    useSessionStore.setState({
      session: session({ byScene: { a: { rooms: { r1: { status: 're_hidden', wasEverRevealed: true } }, concealBehindDoors: false } } }),
    });
    render(<FogStrip />);
    const row = screen.getAllByRole('listitem').find((r) => r.getAttribute('data-room-id') === 'r1')!;
    expect(within(row).getByText('Hidden')).toBeTruthy();
    expect(within(row).queryByText('Explored')).toBeNull();
  });

  it('switches the mode and picks a look', () => {
    const sent = capture();
    render(<FogBody />);
    fireEvent.click(screen.getByTestId('fog-mode-vision'));
    expect(sent.at(-1)).toMatchObject({ action: 'set-mode', payload: { mode: 'vision' } });
    fireEvent.click(screen.getByText('Look'));
    fireEvent.click(screen.getByTestId('fog-look-mist'));
    expect(sent.at(-1)).toMatchObject({ action: 'set-fog-look', payload: { look: { preset: 'mist' } } });
  });

  it('lists rooms unrevealed first, each with its own Reveal and Hide', () => {
    const sent = capture();
    render(<FogStrip />);
    const rows = screen.getAllByRole('listitem');
    // Outdoors leads the list (table fix pass §4.5), then the rooms, unrevealed first.
    expect(rows.map((r) => r.getAttribute('data-room-id'))).toEqual(['@outdoors', 'r2', 'r1']);
    fireEvent.click(within(rows[1]!).getByTestId('room-reveal'));
    fireEvent.click(within(rows[2]!).getByTestId('room-hide'));
    fireEvent.click(within(rows[0]!).getByTestId('room-reveal'));
    expect(sent.map((m) => [m.action, (m.payload as { roomId: string }).roomId])).toEqual([
      ['reveal', 'r2'],
      ['hide', 'r1'],
      ['reveal', '@outdoors'],
    ]);
  });

  it('badges the rows a party token stands in', () => {
    const token = (id: string, x: number, y: number, ownerId: string | null) => ({ id, x, y, ownerId, hidden: false, name: id, size: 'medium' });
    useSessionStore.setState({
      session: {
        ...session({ byScene: { a: { rooms: {}, concealBehindDoors: false } } }),
        modules: {
          fog: { byScene: { a: { rooms: {}, concealBehindDoors: false } } },
          tokens: { byScene: { a: { t1: token('t1', 2, 2, 'p1'), t2: token('t2', 30, 30, 'p2'), t3: token('t3', 12, 2, null) } } },
        },
      },
    });
    render(<FogStrip />);
    const badged = screen.getAllByTestId('fog-party-here').map((b) => b.closest('li')?.getAttribute('data-room-id'));
    // Hall holds a player's token, the far one stands outdoors; the Crypt's goblin is nobody's.
    expect(badged.sort()).toEqual(['@outdoors', 'r1']);
  });

  it('warns in By sight mode when no player token is on the map', () => {
    useSessionStore.setState({ session: session({ byScene: { a: { rooms: {}, mode: 'vision', concealBehindDoors: false } } }) });
    render(<FogBody />);
    expect(screen.getByTestId('fog-no-party')).toBeTruthy();
  });
});
