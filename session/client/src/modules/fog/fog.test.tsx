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
import { usePanel, usePanels } from '../../session/panels';
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
import { FogFooter, FogHeaderActions, FogTool } from './FogTool';
import { useHotkeys } from '../../shell/hotkeys';

// Escape-exits-the-tool lives in `shell/hotkeys.ts`'s single listener, not in `tools.ts`
// itself (M1) — mount it alongside the panel wherever a test presses Escape or a fog hotkey.
function Hotkeys() {
  useHotkeys();
  return null;
}

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

const visionScene = (over: Partial<SceneFog> = {}): FogState => ({
  byScene: { 'scene-1': { rooms: {}, concealBehindDoors: true, mode: 'vision', ...over } },
});

/**
 * The two fixture rooms sit at x 0..4 and 10..14, y 0..4 — one shape covers both. A plain
 * rectangle to count cells against, not the frame that shape measures (see `fogFrame` below,
 * which snaps out and then clears a whole cell all round).
 */
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
  useFogBrush.setState({ on: false, op: 'reveal', size: 1, shape: 'stroke' });
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
    const hovers = Object.values(DM_FOG_LOOK).map((look) => look.hoverColor);
    expect(new Set(hovers).size).toBe(3);
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

describe('the frame a brushed cell is counted against', () => {
  it('measures the DM’s own document with the function the server measured it with', () => {
    // The 14×4 floor snapped out to whole cells, then the guaranteed cell of clear ground.
    expect(fogFrame({ layers: [layerWith([shapeChild(0, 0, 14, 4)])] })).toEqual({
      minX: -2,
      minY: -2,
      maxX: 16,
      maxY: 6,
    });
  });

  it('prefers the referee’s stamped frame when there is one (the player’s copy)', () => {
    const stamped = { minX: 100, minY: 100, maxX: 110, maxY: 110 };
    expect(fogFrame({ frame: stamped, layers: [layerWith([shapeChild(0, 0, 14, 4)])] })).toEqual(
      stamped,
    );
    expect(fogFrame(null)).toBeNull();
  });

  it('converts a world point to the cell the region record means by it', () => {
    expect(cellAt(FRAME, 0.5, 0.5)).toEqual([1, 1]);
    expect(cellAt(FRAME, -0.5, -0.5)).toEqual([0, 0]);
    expect(cellAt(FRAME, 13.9, 4.9)).toEqual([14, 5]);
    expect(cellRect(FRAME, [1, 1])[0]).toEqual([0, 0]);
    expect(cellRect(FRAME, [1, 1])[2]).toEqual([1, 1]);
    expect(cellAt(FRAME, -1.5, 0)).toBeNull();
    expect(cellAt(FRAME, 0, -1.5)).toBeNull();
    expect(cellAt(FRAME, 15.5, 0)).toBeNull();
    expect(cellAt(FRAME, 0, 5.5)).toBeNull();
  });
});

describe('what the room list derives that the fog record does not hold', () => {
  const region = () => regionOf(FRAME)!;

  it('reads “partly seen” off the region record, per room', () => {
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
});

// ── Registration ─────────────────────────────────────────────────────────────

describe('registration', () => {
  it('is the DM’s tool alone: players are not offered the panel', () => {
    expect(usePanels('dm').map((p) => p.id)).toContain('fog');
    expect(usePanels('player').map((p) => p.id)).not.toContain('fog');
  });

  it('wires the header actions and footer slots', () => {
    const def = usePanel('fog');
    expect(def?.title).toBe('Fog');
    expect(def?.icon).toBe('fog');
    expect(def?.key).toBe('F');
    expect(def?.group).toBe('play');
    expect(def?.order).toBe(20);
    expect(def?.roles).toEqual(['dm']);
    expect(def?.headerActions).toBe(FogHeaderActions);
    expect(def?.footer).toBe(FogFooter);
  });

  it('carries no subtitle — the header is title, mode segment, settings, close', () => {
    expect(usePanel('fog')?.subtitle).toBeUndefined();
  });
});

// ── FogHeaderActions — mode, and the settings menu ──────────────────────────

describe('FogHeaderActions', () => {
  it('shows the mode and sends set-mode on a pick, not on the mode already showing', () => {
    useSessionStore.setState({ session: session({ fog: fogWith({}) }), you: dm });
    const sent = captureCommands();
    render(<FogHeaderActions />);

    expect(screen.getByTestId('fog-mode').getAttribute('data-value')).toBe('rooms');
    fireEvent.click(screen.getByRole('radio', { name: 'Vision' }));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ module: 'fog', action: 'set-mode', payload: { mode: 'vision' } });

    fireEvent.click(screen.getByRole('radio', { name: 'Rooms' }));
    expect(sent).toHaveLength(1); // still shows 'rooms' — no state actually flipped here
  });

  it('keeps auto-explore and the vision share out of a rooms-mode table; conceal always shows', () => {
    useSessionStore.setState({ session: session({ fog: fogWith({}) }), you: dm });
    render(<FogHeaderActions />);
    fireEvent.click(screen.getByRole('button', { name: 'Fog settings' }));

    expect(screen.getByTestId('fog-conceal')).not.toBeNull();
    expect(screen.queryByTestId('fog-auto-explore')).toBeNull();
    expect(screen.queryByTestId('fog-share')).toBeNull();
  });

  it('sends set-auto-explore and set-share from the vision-mode controls', () => {
    useSessionStore.setState({ session: session({ fog: visionScene() }), you: dm });
    const sent = captureCommands();
    render(<FogHeaderActions />);
    fireEvent.click(screen.getByRole('button', { name: 'Fog settings' }));

    expect(screen.getByTestId('fog-auto-explore').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByTestId('fog-auto-explore'));
    expect(sent[0]).toMatchObject({ action: 'set-auto-explore', payload: { autoExplore: false } });

    expect(screen.getByTestId('fog-share').getAttribute('data-value')).toBe('party');
    fireEvent.click(screen.getByRole('radio', { name: 'Individual' }));
    expect(sent[1]).toMatchObject({ action: 'set-share', payload: { visionShare: 'individual' } });
  });

  // S3 P3 — the fence is on unless the DM says otherwise (`containedSightOn`), so the switch
  // has to read `on` for a scene that has never heard of the field.
  it('shows contained sight on by default and flips it off', () => {
    useSessionStore.setState({ session: session({ fog: visionScene() }), you: dm });
    const sent = captureCommands();
    render(<FogHeaderActions />);
    fireEvent.click(screen.getByRole('button', { name: 'Fog settings' }));

    expect(screen.getByTestId('fog-containment').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByTestId('fog-containment'));
    expect(sent[0]).toMatchObject({
      module: 'fog',
      action: 'set-containment',
      payload: { containedSight: false },
    });
  });

  it('reads the switch back off a scene the DM turned it off on', () => {
    useSessionStore.setState({
      session: session({ fog: visionScene({ containedSight: false }) }),
      you: dm,
    });
    const sent = captureCommands();
    render(<FogHeaderActions />);
    fireEvent.click(screen.getByRole('button', { name: 'Fog settings' }));

    expect(screen.getByTestId('fog-containment').getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByTestId('fog-containment'));
    expect(sent[0]).toMatchObject({ action: 'set-containment', payload: { containedSight: true } });
  });

  // …and unlike Reveal all it is not gated on the map having rooms: `mapData` here carries a
  // dungeon layer with none, which is the imported battlemap this button matters most on.
  it('opens the whole map from the vision block, rooms or no rooms, and closes the menu', () => {
    useSessionStore.setState({
      session: session({ fog: visionScene() }),
      you: dm,
      mapData: { layers: [dungeonLayer([])] },
    });
    const sent = captureCommands();
    render(<FogHeaderActions />);
    fireEvent.click(screen.getByRole('button', { name: 'Fog settings' }));

    fireEvent.click(screen.getByTestId('fog-open-map'));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ module: 'fog', action: 'open-map', payload: {} });
    expect(screen.queryByTestId('fog-conceal')).toBeNull();
  });

  it('keeps contained sight and Open whole map out of a rooms-mode table', () => {
    useSessionStore.setState({ session: session({ fog: fogWith({}) }), you: dm });
    render(<FogHeaderActions />);
    fireEvent.click(screen.getByRole('button', { name: 'Fog settings' }));

    expect(screen.queryByTestId('fog-containment')).toBeNull();
    expect(screen.queryByTestId('fog-open-map')).toBeNull();
  });

  it('flips concealment behind doors', () => {
    useSessionStore.setState({ session: session({ fog: fogWith({}, true) }), you: dm });
    const sent = captureCommands();
    render(<FogHeaderActions />);
    fireEvent.click(screen.getByRole('button', { name: 'Fog settings' }));

    expect(screen.getByTestId('fog-conceal').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByTestId('fog-conceal'));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      module: 'fog',
      action: 'set-conceal',
      payload: { concealBehindDoors: false },
    });
  });

  it('closes the menu on an outside click', () => {
    useSessionStore.setState({ session: session({ fog: fogWith({}) }), you: dm });
    render(
      <div>
        <FogHeaderActions />
        <button type="button">elsewhere</button>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fog settings' }));
    expect(screen.getByTestId('fog-conceal')).not.toBeNull();

    fireEvent.pointerDown(screen.getByText('elsewhere'));
    expect(screen.queryByTestId('fog-conceal')).toBeNull();
  });

  it('closes the menu on Escape', () => {
    useSessionStore.setState({ session: session({ fog: fogWith({}) }), you: dm });
    render(<FogHeaderActions />);
    fireEvent.click(screen.getByRole('button', { name: 'Fog settings' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('fog-conceal')).toBeNull();
  });

  it('resets fog behind a two-step confirm that names the trigger re-arm', () => {
    useSessionStore.setState({ session: session({ fog: fogWith({}) }), you: dm });
    const sent = captureCommands();
    render(<FogHeaderActions />);
    fireEvent.click(screen.getByRole('button', { name: 'Fog settings' }));

    expect(screen.queryByTestId('fog-reset-confirm')).toBeNull();
    fireEvent.click(screen.getByTestId('fog-reset'));
    expect(sent).toHaveLength(0);
    expect(screen.getByText(/re-arm/)).not.toBeNull();

    fireEvent.click(screen.getByTestId('fog-reset-confirm'));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ module: 'fog', action: 'reset', payload: {} });
    // The confirm act closes the whole menu, same as Scene panel's delete.
    expect(screen.queryByTestId('fog-conceal')).toBeNull();
  });

  it('cancels the reset confirm without sending anything, and leaves the menu open', () => {
    useSessionStore.setState({ session: session({ fog: fogWith({}) }), you: dm });
    const sent = captureCommands();
    render(<FogHeaderActions />);
    fireEvent.click(screen.getByRole('button', { name: 'Fog settings' }));
    fireEvent.click(screen.getByTestId('fog-reset'));

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(sent).toHaveLength(0);
    expect(screen.queryByTestId('fog-reset-confirm')).toBeNull();
    expect(screen.getByTestId('fog-conceal')).not.toBeNull();
  });

  it('drops a pending confirm when the menu itself closes', () => {
    useSessionStore.setState({ session: session({ fog: fogWith({}) }), you: dm });
    render(<FogHeaderActions />);
    fireEvent.click(screen.getByRole('button', { name: 'Fog settings' }));
    fireEvent.click(screen.getByTestId('fog-reset'));
    fireEvent.keyDown(window, { key: 'Escape' });

    fireEvent.click(screen.getByRole('button', { name: 'Fog settings' }));
    expect(screen.queryByTestId('fog-reset-confirm')).toBeNull();
    expect(screen.getByTestId('fog-reset')).not.toBeNull();
  });
});

// ── FogTool — the tool row, hint, and room grid ↔ brush swap ────────────────

describe('FogTool — the tool row', () => {
  it('the tool row renders whether or not a tool is armed', () => {
    useSessionStore.setState({ session: session(), you: dm });
    render(<FogTool />);
    expect(screen.getByTestId('fog-bar')).not.toBeNull();
    expect(screen.getByTestId('fog-tool-toggle').getAttribute('aria-pressed')).toBe('false');
  });

  it('Reveal arms the tool with a direction, and a second press disarms it', () => {
    useSessionStore.setState({ session: session(), you: dm });
    render(<FogTool />);
    fireEvent.click(screen.getByTestId('fog-tool-toggle'));
    expect(useActiveTool.getState().activeTool).toBe('fog');
    expect(useActiveTool.getState().toolDetail).toBe('Reveal');
    expect(screen.getByTestId('fog-tool-toggle').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByTestId('fog-tool-toggle'));
    expect(useActiveTool.getState().activeTool).toBeNull();
  });

  it('Hide arms the opposite direction, replacing Reveal in one click', () => {
    useSessionStore.setState({ session: session(), you: dm });
    render(<FogTool />);
    fireEvent.click(screen.getByTestId('fog-tool-toggle'));
    fireEvent.click(screen.getByTestId('fog-hide-toggle'));
    expect(useActiveTool.getState().activeTool).toBe('fog');
    expect(useActiveTool.getState().toolDetail).toBe('Hide');
    expect(screen.getByTestId('fog-tool-toggle').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('fog-hide-toggle').getAttribute('aria-pressed')).toBe('true');
  });

  it('Escape exits the tool — the guarantee every later tool inherits', () => {
    useSessionStore.setState({ session: session(), you: dm });
    render(
      <>
        <FogTool />
        <Hotkeys />
      </>,
    );
    fireEvent.click(screen.getByTestId('fog-tool-toggle'));
    expect(useActiveTool.getState().activeTool).toBe('fog');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useActiveTool.getState().activeTool).toBeNull();
  });

  it('R and H hotkeys call the same handlers the buttons do', () => {
    useSessionStore.setState({ session: session(), you: dm });
    render(
      <>
        <FogTool />
        <Hotkeys />
      </>,
    );
    fireEvent.keyDown(window, { key: 'r' });
    expect(useActiveTool.getState().activeTool).toBe('fog');
    expect(useActiveTool.getState().toolDetail).toBe('Reveal');
    fireEvent.keyDown(window, { key: 'h' });
    expect(useActiveTool.getState().toolDetail).toBe('Hide');
  });

  it('disables Brush outside vision mode', () => {
    useSessionStore.setState({
      session: session({ fog: fogWith({}) }),
      you: dm,
      mapData: { frame: FRAME, layers: [dungeonLayer([CRYPT, HALL])] },
    });
    render(<FogTool />);
    expect((screen.getByTestId('fog-brush') as HTMLButtonElement).disabled).toBe(true);
  });

  it('arms the brush as a sub-mode of the same tool once vision mode has a region', () => {
    useSessionStore.setState({
      session: session({ fog: visionScene() }),
      you: dm,
      mapData: { frame: FRAME, layers: [dungeonLayer([CRYPT, HALL])] },
    });
    render(<FogTool />);
    const brush = screen.getByTestId('fog-brush') as HTMLButtonElement;
    expect(brush.disabled).toBe(false);

    fireEvent.click(brush);
    expect(useFogBrush.getState().on).toBe(true);
    expect(useActiveTool.getState().activeTool).toBe('fog');
    expect(useActiveTool.getState().toolDetail).toBe('Brush');
    expect(brush.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(brush);
    expect(useFogBrush.getState().on).toBe(false);
    expect(useActiveTool.getState().activeTool).toBeNull();
  });

  it('does not offer the brush on a scene that keeps no cell memory, and says why', () => {
    useSessionStore.setState({
      session: session({ fog: visionScene() }),
      you: dm,
      mapData: { frame: { minX: 0, minY: 0, maxX: 4000, maxY: 4000 }, layers: [layerWith([])] },
    });
    const sent = captureCommands();
    render(<FogTool />);

    const brush = screen.getByTestId('fog-brush') as HTMLButtonElement;
    expect(brush.disabled).toBe(true);
    expect(screen.getByTestId('fog-brush-unavailable').textContent).toContain('too large');
    fireEvent.click(brush);
    expect(useFogBrush.getState().on).toBe(false);
    expect(sent).toEqual([]);
  });

  it('swaps the room grid for the brush controls while armed, same height budget', () => {
    useSessionStore.setState({
      session: session({ fog: visionScene() }),
      you: dm,
      mapData: { frame: FRAME, layers: [dungeonLayer([CRYPT, HALL])] },
    });
    render(<FogTool />);
    expect(screen.getByTestId('fog-rooms')).not.toBeNull();

    fireEvent.click(screen.getByTestId('fog-brush'));
    expect(screen.queryByTestId('fog-rooms')).toBeNull();
    expect(screen.getByTestId('fog-brush-op')).not.toBeNull();
    expect(screen.getByTestId('fog-brush-shape')).not.toBeNull();
    expect(screen.getByTestId('fog-brush-size')).not.toBeNull(); // stroke is the default shape

    fireEvent.click(screen.getByRole('radio', { name: 'Box' }));
    expect(useFogBrush.getState().shape).toBe('box');
    expect(screen.queryByTestId('fog-brush-size')).toBeNull();

    fireEvent.click(screen.getByTestId('fog-brush')); // disarm entirely
    expect(useActiveTool.getState().activeTool).toBeNull();
    expect(screen.getByTestId('fog-rooms')).not.toBeNull();
  });
});

describe('the hint line', () => {
  it('reads the click/shift-click hint', () => {
    useSessionStore.setState({ session: session(), you: dm });
    render(<FogTool />);
    expect(screen.getByText('Click a room on the map. Shift-click frames it.')).not.toBeNull();
  });
});

// ── The room grid — status as shape, direction-aware chip clicks ───────────

describe('the room grid', () => {
  // S3 P3 — the roomless empty state used to sell the brush as the battlemap's substitute
  // for rooms. Under contained sight the ground it reveals is the fence live sight may reach
  // inside, so the sentence has to say what revealing ground buys, not just that it exists.
  it('tells a roomless vision map that sight stays inside what the brush reveals', () => {
    useSessionStore.setState({
      session: session({ fog: visionScene() }),
      you: dm,
      mapData: { layers: [dungeonLayer([])] },
    });
    render(<FogTool />);
    expect(screen.getByTestId('fog-no-rooms').textContent).toContain(
      'sight stays inside what you reveal',
    );
  });

  it('groups Unrevealed then Revealed, with counts, unrevealed first', () => {
    useSessionStore.setState({
      session: session({ fog: fogWith({ 'r-crypt': { status: 'revealed', wasEverRevealed: true } }) }),
      you: dm,
    });
    render(<FogTool />);
    expect(screen.getByText('Unrevealed · 1')).not.toBeNull();
    expect(screen.getByText('Revealed · 1')).not.toBeNull();

    const chips = screen.getByTestId('fog-rooms').querySelectorAll('[data-room-id]');
    expect(chips[0].getAttribute('data-room-id')).toBe('r-hall');
    expect(chips[1].getAttribute('data-room-id')).toBe('r-crypt');
  });

  it('toggles a room when no tool is armed', () => {
    useSessionStore.setState({
      session: session({ fog: fogWith({ 'r-crypt': { status: 'revealed', wasEverRevealed: true } }) }),
      you: dm,
    });
    const sent = captureCommands();
    render(<FogTool />);
    const grid = screen.getByTestId('fog-rooms');
    fireEvent.click(grid.querySelector('[data-room-id="r-crypt"]')!); // revealed → hide
    fireEvent.click(grid.querySelector('[data-room-id="r-hall"]')!); // never revealed → reveal
    expect(sent.map((s) => [s.action, s.payload])).toEqual([
      ['hide', { roomId: 'r-crypt' }],
      ['reveal', { roomId: 'r-hall' }],
    ]);
  });

  it('sends the armed direction regardless of the room’s own state', () => {
    useSessionStore.setState({
      session: session({ fog: fogWith({ 'r-crypt': { status: 'revealed', wasEverRevealed: true } }) }),
      you: dm,
    });
    const sent = captureCommands();
    render(<FogTool />);

    fireEvent.click(screen.getByTestId('fog-tool-toggle')); // arm Reveal
    fireEvent.click(screen.getByTestId('fog-rooms').querySelector('[data-room-id="r-crypt"]')!);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ module: 'fog', action: 'reveal', payload: { roomId: 'r-crypt' } });

    fireEvent.click(screen.getByTestId('fog-hide-toggle')); // arm Hide instead
    fireEvent.click(screen.getByTestId('fog-rooms').querySelector('[data-room-id="r-hall"]')!);
    expect(sent[1]).toMatchObject({ module: 'fog', action: 'hide', payload: { roomId: 'r-hall' } });
  });

  it('marks a zone-locked room, and never calls a DM-revealed room partly seen', () => {
    const region = () => regionOf(FRAME)!;
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
    const grid = screen.getByTestId('fog-rooms');
    const crypt = grid.querySelector('[data-room-id="r-crypt"]')!;
    expect(crypt.getAttribute('data-fog-label')).toBe('Partly seen');
    expect(crypt.getAttribute('data-locked')).toBeNull();
    const hall = grid.querySelector('[data-room-id="r-hall"]')!;
    expect(hall.getAttribute('data-fog-label')).toBe('Revealed');
    expect(hall.getAttribute('data-locked')).toBe('true');
  });

  it('reaches the map hover on a chip hover, without throwing', () => {
    useSessionStore.setState({ session: session({ fog: fogWith({}) }), you: dm });
    render(<FogTool />);
    const chip = screen.getByTestId('fog-rooms').querySelector('[data-room-id]')!;
    expect(() => {
      fireEvent.mouseEnter(chip);
      fireEvent.mouseLeave(chip);
    }).not.toThrow();
  });
});

// ── The room grid ceiling (25+ rooms) ───────────────────────────────────────

describe('the room grid ceiling', () => {
  const manyRooms = (n: number): Room[] =>
    Array.from({ length: n }, (_, i) => room(`r-${i}`, i * 10, `Room ${i}`));

  function renderWith(n: number) {
    const rooms = manyRooms(n);
    useSessionStore.setState({
      session: session({ fog: fogWith({}) }),
      you: dm,
      mapData: { layers: [dungeonLayer(rooms)] },
    });
    useStore.setState({ layers: [dungeonLayer(rooms)] });
    render(<FogTool />);
  }

  it('12 rooms: grouped, no filter, all show', () => {
    renderWith(12);
    expect(screen.queryByTestId('fog-filter')).toBeNull();
    expect(screen.getByTestId('fog-rooms').querySelectorAll('[data-room-id]')).toHaveLength(12);
  });

  it('24 rooms: still fits without scrolling — no filter, all 24 show', () => {
    renderWith(24);
    expect(screen.queryByTestId('fog-filter')).toBeNull();
    expect(screen.getByTestId('fog-rooms').querySelectorAll('[data-room-id]')).toHaveLength(24);
  });

  it('40 rooms: a filter appears, at most 24 chips show, and the rest are counted', () => {
    renderWith(40);
    expect(screen.getByTestId('fog-filter')).not.toBeNull();
    expect(screen.getByTestId('fog-rooms').querySelectorAll('[data-room-id]')).toHaveLength(24);
    expect(screen.getByText('+16 more, keep typing')).not.toBeNull();
  });

  it('40 rooms: typing narrows the grid to the match', () => {
    renderWith(40);
    fireEvent.change(screen.getByTestId('fog-filter'), { target: { value: 'Room 1' } });
    // "Room 1" and "Room 10".."Room 19" — 11 rooms, all fit under the ceiling.
    const chips = screen.getByTestId('fog-rooms').querySelectorAll('[data-room-id]');
    expect(chips).toHaveLength(11);
    chips.forEach((c) => expect(c.getAttribute('title')).toMatch(/Room 1/));
    expect(screen.queryByText(/more, keep typing/)).toBeNull();
  });
});

// ── FogFooter — bulk ops with undo, and the conceal line ────────────────────

describe('FogFooter', () => {
  const before: Record<string, RoomFog> = {
    'r-crypt': { status: 'revealed', wasEverRevealed: true },
    'r-hall': { status: 're_hidden', wasEverRevealed: true },
  };

  function armed() {
    useSessionStore.setState({ session: session({ fog: fogWith(before) }), you: dm });
    const sent = captureCommands();
    render(<FogFooter />);
    return sent;
  }

  it('reveals every room at once and offers undo', () => {
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
    expect(sent[1]).toMatchObject({ module: 'fog', action: 'set-bulk', payload: { rooms: before } });
    expect(sent[1].payload).toEqual({ rooms: before });
  });

  it('undo survives the slice having moved on — the capture is a value, not a read', () => {
    const sent = armed();
    fireEvent.click(screen.getByTestId('fog-reveal-all'));
    act(() =>
      useSessionStore.setState({ session: session({ fog: fogWith(revealAllRooms([CRYPT, HALL])) }) }),
    );
    useToasts.getState().toast?.action?.onAction();
    expect(sent[1].payload).toEqual({ rooms: before });
  });

  it('shows whether concealment behind doors is on', () => {
    useSessionStore.setState({ session: session({ fog: fogWith({}, true) }), you: dm });
    render(<FogFooter />);
    expect(screen.getByText('Conceal behind doors · on')).not.toBeNull();
  });

  it('keeps the footer to one row — buttons never wrap, the conceal line truncates instead', () => {
    useSessionStore.setState({ session: session({ fog: fogWith({}, true) }), you: dm });
    render(<FogFooter />);
    expect(screen.getByTestId('fog-reveal-all').className).toContain('whitespace-nowrap');
    expect(screen.getByTestId('fog-hide-all').className).toContain('whitespace-nowrap');
    expect(screen.getByText('Conceal behind doors · on').className).toContain('truncate');
  });

  it('disables the bulk buttons with no rooms', () => {
    useSessionStore.setState({
      session: session({ fog: fogWith({}) }),
      you: dm,
      mapData: { layers: [dungeonLayer([])] },
    });
    render(<FogFooter />);
    expect((screen.getByTestId('fog-reveal-all') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('fog-hide-all') as HTMLButtonElement).disabled).toBe(true);
  });
});
