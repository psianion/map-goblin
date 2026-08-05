import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Room } from '@dnd/core/src/shared/types';
import type { Layer } from '@dnd/core/src/store/types';
import { useStore } from '@dnd/core/src/store/store';
import type { FogState, RoomFog } from '@dnd/mechanics/fog';
import type { PlayerInfo, SessionState } from '@dnd/core/src/shared/protocol';
import type { WebSocketClient } from '../../session/WebSocketClient';
import { useSessionStore } from '../../session/store';
import { usePanels } from '../../session/panels';
import { useToasts } from '../../session/toasts';
import { useActiveTool } from '../../session/tools';
import {
  DM_FOG_LOOK,
  FOG_STATUS_LABEL,
  fogActionFor,
  hideAllRooms,
  revealAllRooms,
  roomAt,
  roomsOfLayers,
  sceneFog,
} from './fog';
import { FogTool } from './FogTool';

const room = (id: string, x: number, name = id): Room => ({
  id,
  name,
  boundary: [
    [x, 0],
    [x + 4, 0],
    [x + 4, 4],
    [x, 4],
  ],
  centroid: [x + 2, 2],
  area: 16,
  isPathway: false,
});

const CRYPT = room('r-crypt', 0, 'Crypt');
const HALL = room('r-hall', 10, 'Hall');

const dungeonLayer = (rooms: Room[]): Layer =>
  ({ id: 'l1', type: 'dungeon', children: [], standaloneWalls: [], rooms }) as unknown as Layer;

const dm: PlayerInfo = { identityId: 'dm-1', name: 'Ayla', role: 'dm', connected: true };

function session(modules: Record<string, unknown> = {}): SessionState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: 'scene-1',
    scenes: [{ id: 'scene-1', name: 'Crypt', mapId: 'scene-1' }],
    players: [dm],
    modules,
  };
}

interface Sent {
  module: string;
  action: string;
  payload: unknown;
}

/** Commands the panel puts on the wire, in order. */
function captureCommands(): Sent[] {
  const sent: Sent[] = [];
  useSessionStore.setState({
    client: { send: (msg: Sent) => sent.push(msg) } as unknown as WebSocketClient,
  });
  return sent;
}

const fogWith = (rooms: Record<string, RoomFog>, concealBehindDoors = true): FogState => ({
  byScene: { 'scene-1': { rooms, concealBehindDoors } },
});

beforeEach(() => {
  cleanup();
  // FogTool lists the server document's rooms, never core's re-detected ones.
  useSessionStore.setState({
    session: null,
    you: null,
    client: null,
    lastError: null,
    mapData: { layers: [dungeonLayer([CRYPT, HALL])] },
  });
  useActiveTool.getState().setActiveTool(null);
  useToasts.setState({ toast: null });
  useStore.setState({ layers: [dungeonLayer([CRYPT, HALL])] });
});

describe('fog geometry and vocabulary', () => {
  it('reads rooms off the dungeon layer and finds the one under a point', () => {
    const rooms = roomsOfLayers(useStore.getState().layers);
    expect(rooms.map((r) => r.id)).toEqual(['r-crypt', 'r-hall']);
    expect(roomAt(rooms, 2, 2)?.id).toBe('r-crypt');
    expect(roomAt(rooms, 12, 2)?.id).toBe('r-hall');
    // Unzoned map is unrevealable (D6) — there is simply nothing there to click.
    expect(roomAt(rooms, 7, 2)).toBeUndefined();
  });

  it('encodes every state twice over, so none of them is colour alone (D11)', () => {
    expect(DM_FOG_LOOK.never_revealed).toMatchObject({ tintAlpha: 0.62 });
    expect(DM_FOG_LOOK.revealed).toMatchObject({ tintAlpha: 0 });
    // The hover is a third reading of the same three states, and three separate colours —
    // an outline that means "you are over a room" and nothing more is D11 half-built.
    const hovers = Object.values(DM_FOG_LOOK).map((look) => look.hoverColor);
    expect(new Set(hovers).size).toBe(3);
    // Three separate tint weights, so the state is brightness and not hue — this is what
    // seconds the colour now that no mark is stamped at the centroid to do it.
    const tints = Object.values(DM_FOG_LOOK).map((look) => look.tintAlpha);
    expect(new Set(tints).size).toBe(3);
    expect(DM_FOG_LOOK.re_hidden.tintAlpha).toBeGreaterThan(0);
    expect(DM_FOG_LOOK.re_hidden.tintAlpha).toBeLessThan(DM_FOG_LOOK.never_revealed.tintAlpha);
    expect(new Set(Object.values(FOG_STATUS_LABEL)).size).toBe(3);
  });

  it('toggles the other way for anything the party cannot currently see', () => {
    expect(fogActionFor('revealed')).toBe('hide');
    expect(fogActionFor('never_revealed')).toBe('reveal');
    expect(fogActionFor('re_hidden')).toBe('reveal');
  });

  it('defaults an absent slice to a dark scene with concealment on', () => {
    expect(sceneFog(undefined, 'scene-1')).toEqual({ rooms: {}, concealBehindDoors: true });
    expect(sceneFog(fogWith({}), null)).toEqual({ rooms: {}, concealBehindDoors: true });
  });

  it('builds the bulk records: reveal all latches, hide all leaves the unseen unseen', () => {
    expect(revealAllRooms([CRYPT, HALL])).toEqual({
      'r-crypt': { status: 'revealed', wasEverRevealed: true },
      'r-hall': { status: 'revealed', wasEverRevealed: true },
    });
    expect(
      hideAllRooms({
        'r-crypt': { status: 'revealed', wasEverRevealed: true },
        'r-hall': { status: 'never_revealed', wasEverRevealed: false },
      }),
    ).toEqual({ 'r-crypt': { status: 're_hidden', wasEverRevealed: true } });
  });
});

describe('FogTool — a mode, never a dialog (D11)', () => {
  it('is the DM’s tool alone: players are not offered the panel', () => {
    expect(usePanels('dm').map((p) => p.id)).toContain('fog');
    expect(usePanels('player').map((p) => p.id)).not.toContain('fog');
  });

  it('arms and disarms on the switch, and shows nothing of its bar until armed', () => {
    useSessionStore.setState({ session: session(), you: dm });
    render(<FogTool />);
    expect(screen.queryByTestId('fog-bar')).toBeNull();

    fireEvent.click(screen.getByTestId('fog-tool-toggle'));
    expect(useActiveTool.getState().activeTool).toBe('fog');
    expect(screen.getByTestId('fog-bar')).not.toBeNull();
    expect(screen.getByTestId('fog-tool-toggle').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByTestId('fog-tool-toggle'));
    expect(useActiveTool.getState().activeTool).toBeNull();
  });

  it('Escape exits the tool — the guarantee every later tool inherits', () => {
    useSessionStore.setState({ session: session(), you: dm });
    render(<FogTool />);
    fireEvent.click(screen.getByTestId('fog-tool-toggle'));
    expect(useActiveTool.getState().activeTool).toBe('fog');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useActiveTool.getState().activeTool).toBeNull();
    expect(screen.queryByTestId('fog-bar')).toBeNull();
  });

  it('spells each room’s state out in words beside the canvas tint', () => {
    useSessionStore.setState({
      session: session({
        fog: fogWith({
          'r-crypt': { status: 'revealed', wasEverRevealed: true },
          'r-hall': { status: 're_hidden', wasEverRevealed: true },
        }),
      }),
      you: dm,
    });
    render(<FogTool />);
    fireEvent.click(screen.getByTestId('fog-tool-toggle'));

    const rows = screen.getByTestId('fog-rooms').querySelectorAll('li');
    expect(rows[0].getAttribute('data-fog-status')).toBe('revealed');
    expect(rows[0].textContent).toContain('Revealed');
    expect(rows[1].getAttribute('data-fog-status')).toBe('re_hidden');
    expect(rows[1].textContent).toContain('Explored');
  });

  it('toggles the room a list row names', () => {
    useSessionStore.setState({
      session: session({ fog: fogWith({ 'r-crypt': { status: 'revealed', wasEverRevealed: true } }) }),
      you: dm,
    });
    const sent = captureCommands();
    render(<FogTool />);
    fireEvent.click(screen.getByTestId('fog-tool-toggle'));

    const rows = screen.getByTestId('fog-rooms').querySelectorAll('button');
    fireEvent.click(rows[0]); // revealed → hide
    fireEvent.click(rows[1]); // never revealed → reveal
    expect(sent.map((s) => [s.action, s.payload])).toEqual([
      ['hide', { roomId: 'r-crypt' }],
      ['reveal', { roomId: 'r-hall' }],
    ]);
  });

  it('flips concealment behind doors for the scene', () => {
    useSessionStore.setState({ session: session({ fog: fogWith({}, true) }), you: dm });
    const sent = captureCommands();
    render(<FogTool />);
    fireEvent.click(screen.getByTestId('fog-tool-toggle'));

    expect(screen.getByTestId('fog-conceal').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByTestId('fog-conceal'));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      module: 'fog',
      action: 'set-conceal',
      payload: { concealBehindDoors: false },
    });
  });
});

describe('Reveal all / Hide all — instant, with a way back (D9)', () => {
  const before: Record<string, RoomFog> = {
    'r-crypt': { status: 'revealed', wasEverRevealed: true },
    'r-hall': { status: 're_hidden', wasEverRevealed: true },
  };

  function armed() {
    useSessionStore.setState({ session: session({ fog: fogWith(before) }), you: dm });
    const sent = captureCommands();
    render(<FogTool />);
    fireEvent.click(screen.getByTestId('fog-tool-toggle'));
    return sent;
  }

  it('applies at once and offers undo instead of asking first', () => {
    const sent = armed();
    fireEvent.click(screen.getByTestId('fog-reveal-all'));

    expect(sent).toHaveLength(1);
    expect(sent[0].action).toBe('set-bulk');
    expect(sent[0].payload).toEqual({ rooms: revealAllRooms([CRYPT, HALL]) });

    const toast = useToasts.getState().toast;
    expect(toast?.action?.label).toBe('Undo');
    expect(toast?.durationMs).toBe(5000);
  });

  it('undo replays the exact rooms record captured before the bulk op', () => {
    const sent = armed();
    fireEvent.click(screen.getByTestId('fog-hide-all'));
    expect(sent[0].payload).toEqual({ rooms: hideAllRooms(before) });

    useToasts.getState().toast?.action?.onAction();
    // Not an approximation of the old state — the record itself, byte for byte.
    expect(sent[1]).toMatchObject({ module: 'fog', action: 'set-bulk', payload: { rooms: before } });
    expect(sent[1].payload).toEqual({ rooms: before });
  });

  it('undo survives the slice having moved on — the capture is a value, not a read', () => {
    const sent = armed();
    fireEvent.click(screen.getByTestId('fog-reveal-all'));
    // The server's echo lands before the DM reaches for undo.
    act(() =>
      useSessionStore.setState({ session: session({ fog: fogWith(revealAllRooms([CRYPT, HALL])) }) }),
    );

    useToasts.getState().toast?.action?.onAction();
    expect(sent[1].payload).toEqual({ rooms: before });
  });
});
