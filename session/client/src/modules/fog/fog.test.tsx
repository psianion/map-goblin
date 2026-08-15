import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Room } from '@dnd/core/src/shared/types';
import type { Layer } from '@dnd/core/src/store/types';
import { useStore } from '@dnd/core/src/store/store';
import { regionOf, setCells, type FogState, type RoomFog, type SceneFog } from '@dnd/mechanics/fog';
import type { PlayerInfo, SessionState } from '@dnd/core/src/shared/protocol';
import type { WebSocketClient } from '../../session/WebSocketClient';
import { useSessionStore } from '../../session/store';
import { usePanels } from '../../session/panels';
import { useToasts } from '../../session/toasts';
import { useActiveTool } from '../../session/tools';
import {
  DM_FOG_LOOK,
  FOG_STATUS_LABEL,
  cellAt,
  cellRect,
  fogActionFor,
  fogFrame,
  hideAllRooms,
  lockedRooms,
  partlySeenRooms,
  revealAllRooms,
  roomAt,
  roomsOfLayers,
  sceneFog,
} from './fog';
import { useFogBrush } from './brush';
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
  useFogBrush.setState({ on: false, op: 'reveal' });
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

// ── P4 — the DM controls ───────────────────────────────────────────────────

/** The two fixture rooms sit at x 0..4 and 10..14, y 0..4 — one shape covers both. */
const FRAME = { minX: -1, minY: -1, maxX: 15, maxY: 5 };

const shapeChild = (x0: number, y0: number, x1: number, y1: number) => ({
  id: 'floor',
  childType: 'shape',
  visible: true,
  contours: [
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ],
  ],
});

const zoneChild = (id: string, shape: unknown, blocksAutoExplore = true) => ({
  id,
  name: id,
  childType: 'zone',
  visible: true,
  shape,
  blocksAutoExplore,
});

const layerWith = (children: unknown[], rooms: Room[] = [CRYPT, HALL]): Layer =>
  ({ id: 'l1', type: 'dungeon', children, standaloneWalls: [], rooms }) as unknown as Layer;

const visionScene = (over: Partial<SceneFog> = {}): FogState => ({
  byScene: { 'scene-1': { rooms: {}, concealBehindDoors: true, mode: 'vision', ...over } },
});

describe('the frame a brushed cell is counted against', () => {
  it('measures the DM’s own document with the function the server measured it with', () => {
    // The DM's copy is the authored file and carries no stamped frame — this is the half that
    // has to agree with `sceneMap.frame` or every brushed cell lands one square off.
    expect(fogFrame({ layers: [layerWith([shapeChild(0, 0, 14, 4)])] })).toEqual(FRAME);
  });

  it('prefers the referee’s stamped frame when there is one (the player’s copy)', () => {
    const stamped = { minX: 100, minY: 100, maxX: 110, maxY: 110 };
    expect(fogFrame({ frame: stamped, layers: [layerWith([shapeChild(0, 0, 14, 4)])] })).toEqual(
      stamped,
    );
    expect(fogFrame(null)).toBeNull();
  });

  it('converts a world point to the cell the region record means by it', () => {
    // A non-zero origin is the whole test: with minX 0 every off-by-one hides.
    expect(cellAt(FRAME, 0.5, 0.5)).toEqual([1, 1]);
    expect(cellAt(FRAME, -0.5, -0.5)).toEqual([0, 0]);
    expect(cellAt(FRAME, 13.9, 4.9)).toEqual([14, 5]);
    // The convention is `cellsCoveredByPolygon`'s: cell [c, r] is the square whose centre is
    // minX + c + 0.5, so `cellRect` has to be the square that contains it.
    expect(cellRect(FRAME, [1, 1])[0]).toEqual([0, 0]);
    expect(cellRect(FRAME, [1, 1])[2]).toEqual([1, 1]);
    // Off the frame in every direction is not a cell at all.
    expect(cellAt(FRAME, -1.5, 0)).toBeNull();
    expect(cellAt(FRAME, 0, -1.5)).toBeNull();
    expect(cellAt(FRAME, 15.5, 0)).toBeNull();
    expect(cellAt(FRAME, 0, 5.5)).toBeNull();
  });
});

describe('what the room list derives that the fog record does not hold', () => {
  const region = () => regionOf(FRAME)!;

  it('reads “partly seen” off the region record, per room', () => {
    // One cell inside the crypt (world 0.5, 0.5) and nothing in the hall.
    const painted = setCells(region(), [[1, 1]]);
    expect([...partlySeenRooms([CRYPT, HALL], painted)]).toEqual(['r-crypt']);
    expect([...partlySeenRooms([CRYPT, HALL], region())]).toEqual([]);
    expect([...partlySeenRooms([CRYPT, HALL], undefined)]).toEqual([]);
  });

  it('reads “locked” off the authored zones, and never off a point zone', () => {
    const rect = layerWith([zoneChild('z1', { kind: 'rect', x: 10, y: 0, width: 4, height: 4 })]);
    expect([...lockedRooms([CRYPT, HALL], [rect])]).toEqual(['r-hall']);

    const circle = layerWith([
      zoneChild('z2', { kind: 'circle', position: { x: 2, y: 2 }, radius: 1 }),
    ]);
    expect([...lockedRooms([CRYPT, HALL], [circle])]).toEqual(['r-crypt']);

    // A point has no area to lock, and an unflagged zone is not a lock at all.
    expect(
      [...lockedRooms([CRYPT, HALL], [layerWith([zoneChild('z3', { kind: 'point', position: { x: 2, y: 2 } })])])],
    ).toEqual([]);
    expect(
      [
        ...lockedRooms(
          [CRYPT, HALL],
          [layerWith([zoneChild('z4', { kind: 'rect', x: 10, y: 0, width: 4, height: 4 }, false)])],
        ),
      ],
    ).toEqual([]);
  });

  it('shows both in the list — and never calls a DM-revealed room partly seen', () => {
    act(() =>
      useSessionStore.setState({
        mapData: {
          layers: [layerWith([zoneChild('z1', { kind: 'rect', x: 10, y: 0, width: 4, height: 4 })])],
        },
        session: session({
          fog: visionScene({
            rooms: {
              'r-crypt': { status: 're_hidden', wasEverRevealed: true },
              'r-hall': { status: 'revealed', wasEverRevealed: true },
            },
            region: setCells(region(), [
              [1, 1],
              [11, 1],
            ]),
          }),
        }),
        you: dm,
      }),
    );
    render(<FogTool />);
    fireEvent.click(screen.getByTestId('fog-tool-toggle'));

    const rows = screen.getByTestId('fog-rooms').querySelectorAll('li');
    expect(rows[0].getAttribute('data-fog-label')).toBe('Partly seen');
    expect(rows[0].getAttribute('data-locked')).toBeNull();
    // The hall has cells too, but the DM lit it: a revealed room is washed whole, so the
    // word for it stays "Revealed".
    expect(rows[1].getAttribute('data-fog-label')).toBe('Revealed');
    expect(rows[1].getAttribute('data-locked')).toBe('true');
    expect(rows[1].textContent).toContain('Locked');
  });
});

describe('Fog panel v2 — mode, and what the mode brings with it', () => {
  const arm = (fog: FogState) => {
    // A stamped frame, because the brush is only offered where the scene can keep a region
    // record — measured off this map with the function the referee measures it with.
    useSessionStore.setState({
      session: session({ fog }),
      you: dm,
      mapData: { frame: FRAME, layers: [dungeonLayer([CRYPT, HALL])] },
    });
    const sent = captureCommands();
    render(<FogTool />);
    fireEvent.click(screen.getByTestId('fog-tool-toggle'));
    return sent;
  };

  it('offers the mode without taking the map hostage, and sends set-mode', () => {
    useSessionStore.setState({ session: session({ fog: fogWith({}) }), you: dm });
    const sent = captureCommands();
    render(<FogTool />);
    // Not inside the armed bar: which fog the table plays is a table setting.
    expect(screen.queryByTestId('fog-bar')).toBeNull();
    expect(screen.getByTestId('fog-mode').getAttribute('data-value')).toBe('rooms');

    fireEvent.click(screen.getByRole('radio', { name: 'Token vision' }));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ module: 'fog', action: 'set-mode', payload: { mode: 'vision' } });
    // Picking the mode it is already in is not a command.
    fireEvent.click(screen.getByRole('radio', { name: 'Rooms' }));
    expect(sent).toHaveLength(1);
  });

  it('keeps auto-explore, the share and the brush off a rooms-mode table entirely', () => {
    arm(fogWith({}));
    expect(screen.queryByTestId('fog-auto-explore')).toBeNull();
    expect(screen.queryByTestId('fog-share')).toBeNull();
    expect(screen.queryByTestId('fog-brush')).toBeNull();
    // …while everything that was already here is untouched.
    expect(screen.getByTestId('fog-conceal')).not.toBeNull();
    expect(screen.getByTestId('fog-reveal-all')).not.toBeNull();
  });

  it('sends set-auto-explore and set-share from the vision-mode controls', () => {
    const sent = arm(visionScene());
    // Absent reads as on, which is what the switch has to show before anyone touches it.
    expect(screen.getByTestId('fog-auto-explore').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByTestId('fog-auto-explore'));
    expect(sent[0]).toMatchObject({ action: 'set-auto-explore', payload: { autoExplore: false } });

    expect(screen.getByTestId('fog-share').getAttribute('data-value')).toBe('party');
    fireEvent.click(screen.getByRole('radio', { name: 'Individual' }));
    expect(sent[1]).toMatchObject({ action: 'set-share', payload: { visionShare: 'individual' } });
  });

  it('arms the brush as a sub-mode — no second tool, and the indicator says so', () => {
    arm(visionScene());
    expect(useFogBrush.getState().on).toBe(false);
    expect(useActiveTool.getState().toolDetail).toBeNull();

    fireEvent.click(screen.getByTestId('fog-brush'));
    expect(useFogBrush.getState().on).toBe(true);
    // Still the fog tool: a brush is what a click means, not a tool of its own.
    expect(useActiveTool.getState().activeTool).toBe('fog');
    expect(useActiveTool.getState().toolDetail).toBe('Brush');
    expect(screen.getByTestId('fog-brush').textContent).toContain('revealing');

    fireEvent.click(screen.getByRole('radio', { name: 'Hide' }));
    expect(useFogBrush.getState().op).toBe('hide');
    expect(screen.getByTestId('fog-brush').textContent).toContain('hiding');

    // Leaving the tool leaves the brush behind with it.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useActiveTool.getState().toolDetail).toBeNull();
  });

  it('does not offer the brush on a scene that keeps no cell memory, and says why', () => {
    // A frame past `REGION_CELL_MAX`: the referee refuses every `region-set` on it, so a brush
    // here paints into a void and the DM finds out from a rejection they never see.
    useSessionStore.setState({
      session: session({ fog: visionScene() }),
      you: dm,
      mapData: { frame: { minX: 0, minY: 0, maxX: 4000, maxY: 4000 }, layers: [layerWith([])] },
    });
    const sent = captureCommands();
    render(<FogTool />);
    fireEvent.click(screen.getByTestId('fog-tool-toggle'));

    const brush = screen.getByTestId('fog-brush') as HTMLButtonElement;
    expect(brush.disabled).toBe(true);
    expect(screen.getByTestId('fog-brush-unavailable').textContent).toContain('too large');
    fireEvent.click(brush);
    expect(useFogBrush.getState().on).toBe(false);
    expect(sent).toEqual([]);
  });

  it('tints “Partly seen” on its own, per the mockup — the one status that is mid-way', () => {
    useSessionStore.setState({
      session: session({
        fog: visionScene({
          rooms: {
            'r-crypt': { status: 're_hidden', wasEverRevealed: true },
            'r-hall': { status: 're_hidden', wasEverRevealed: true },
          },
          region: setCells(regionOf(FRAME)!, [[1, 1]]),
        }),
      }),
      you: dm,
      mapData: { frame: FRAME, layers: [layerWith([])] },
    });
    render(<FogTool />);
    fireEvent.click(screen.getByTestId('fog-tool-toggle'));

    const rows = screen.getByTestId('fog-rooms').querySelectorAll('li');
    const statusOf = (row: Element) => row.querySelectorAll('span')[row.querySelectorAll('span').length - 1];
    expect(rows[0].getAttribute('data-fog-label')).toBe('Partly seen');
    expect(statusOf(rows[0]).className).toContain('text-warning');
    // Every other status stays the quiet tier — the tint is the state, not decoration.
    expect(rows[1].getAttribute('data-fog-label')).toBe('Explored');
    expect(statusOf(rows[1]).className).toContain('text-text-secondary');
  });
});
