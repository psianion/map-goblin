import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { Container } from 'pixi.js';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import type { SceneGraph } from '@dnd/core/src/engine/sceneGraph';
import type { DoorChild } from '@dnd/core/src/shared/types';
import type { Layer } from '@dnd/core/src/store/types';
import { useStore } from '@dnd/core/src/store/store';
import { DOOR_CLOSED, DOOR_LOCKED, UNKNOWN_DOOR, type DoorsState } from '@dnd/mechanics/doors';
import type { PlayerInfo, SessionState } from '@dnd/core/src/shared/protocol';
import { frameWorldPoint } from '../../renderer/camera';
import type { WebSocketClient } from '../../session/WebSocketClient';
import { useSessionStore } from '../../session/store';
import { useToasts } from '../../session/toasts';
import { useRefusalToasts } from '../../session/useRefusalToasts';
import {
  DM_ENTITY_ALPHA,
  DOOR_CHIP_CEILING,
  DOOR_FILTER_THRESHOLD,
  doorAt,
  doorLabel,
  doorLook,
  doorRefusal,
  doorStatusLabel,
  filterDoors,
  groupDoors,
  liveDoors,
  visibleDoorChips,
} from './doors';
import { mountDoorLayer, trackDoorIds } from './DoorRenderer';
import { useDoorSelection } from './selection';

// The camera is Pixi's; what the panel owes it is one call with the door's world point.
vi.mock('../../renderer/camera', () => ({ frameWorldPoint: vi.fn() }));
const framed = vi.mocked(frameWorldPoint);

const door = (over: Partial<DoorChild> = {}): DoorChild =>
  ({
    id: 'd1',
    name: 'Gallery Door',
    childType: 'door',
    visible: true,
    wallId: 'w1',
    position: [4, 4],
    angle: 0,
    width: 1.6,
    style: 'single',
    state: 'closed',
    isSecret: false,
    roomA: 'r-a',
    roomB: 'r-b',
    ...over,
  }) as DoorChild;

const PLAIN = door();
const LOCKED = door({ id: 'd2', name: 'Reliquary Door', state: 'locked', position: [10, 4] });
const SECRET = door({ id: 'd3', name: 'Hidden Door', isSecret: true, position: [16, 4] });
const ARCHWAY = door({ id: 'd4', name: 'Crypt Arch', style: 'archway', position: [22, 4] });

const dungeonLayer = (children: DoorChild[]): Layer =>
  ({ id: 'l1', type: 'dungeon', children, standaloneWalls: [], rooms: [] }) as unknown as Layer;

const dm: PlayerInfo = { identityId: 'dm-1', name: 'Ayla', role: 'dm', connected: true };
const player: PlayerInfo = { identityId: 'p-2', name: 'Borin', role: 'player', connected: true };

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

function captureCommands(): Sent[] {
  const sent: Sent[] = [];
  useSessionStore.setState({
    client: { send: (msg: Sent) => sent.push(msg) } as unknown as WebSocketClient,
  });
  return sent;
}

/** The overlay's glyph container — one sprite per door the seat may work. */
const marksOf = (overlay: Container): Container =>
  (overlay.children.find((c) => String(c.label) === 'doorOverlay') as Container).children.find(
    (c) => String(c.label) === 'doorMarks',
  ) as Container;

beforeEach(() => {
  cleanup();
  framed.mockClear();
  useSessionStore.setState({ session: null, you: null, client: null, lastError: null });
  useToasts.setState({ toast: null });
  useDoorSelection.setState({ selectedId: null, filter: '' });
  useStore.setState({ layers: [dungeonLayer([PLAIN, LOCKED, SECRET])] });
});

describe('live door state', () => {
  it('seeds every authored door from the map until a command touches it', () => {
    const live = liveDoors(useStore.getState().layers, undefined, 'scene-1');
    expect(live.map((d) => [d.door.id, d.live])).toEqual([
      ['d1', { open: false, locked: false, revealed: true }],
      ['d2', { open: false, locked: true, revealed: true }],
      ['d3', { open: false, locked: false, revealed: false }],
    ]);
  });

  it('lets the session overlay win over the authored default', () => {
    const state: DoorsState = {
      byScene: { 'scene-1': { d2: { open: true, locked: false, revealed: true } } },
    };
    const live = liveDoors(useStore.getState().layers, state, 'scene-1');
    expect(live.find((d) => d.door.id === 'd2')?.live.open).toBe(true);
  });

  it('is empty before a map, and per scene', () => {
    expect(liveDoors([], undefined, 'scene-1')).toEqual([]);
    expect(liveDoors(useStore.getState().layers, undefined, null)).toHaveLength(3);
  });

  /**
   * The fourth browser gate found three door marks at full brightness on a player canvas
   * with nothing revealed. Marks are drawn above the fog mask on the strength of the server
   * having already cut the doors a player has not earned, so a redacted document carrying no
   * door children has to yield no marks — even with a doors slice still naming them.
   */
  it('draws nothing for a player whose map was cut of its doors', () => {
    const redacted: Layer[] = [
      { ...(useStore.getState().layers[0] as Layer & { children: unknown[] }), children: [] } as Layer,
    ];
    const stale: DoorsState = {
      byScene: { 'scene-1': { d1: { open: true, locked: false, revealed: true } } },
    };
    expect(liveDoors(redacted, stale, 'scene-1')).toEqual([]);
  });
});

describe('a press on a door, with token input on the same canvas', () => {
  /** The real canvas and a world that is the screen — one pixel per world unit. */
  function harness() {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const worldContainer = new Container();
    const layerContainer = new Container();
    layerContainer.label = 'layerContainer';
    worldContainer.addChild(layerContainer);
    const overlayContainer = new Container();
    const sceneGraph = {
      worldContainer,
      layerContainer,
      overlayContainer,
    } as unknown as SceneGraph;
    const engine = {
      canvas: () => canvas,
      screenToWorld: (x: number, y: number) => ({ x, y }),
      ticker: () => ({ add: () => {}, remove: () => {} }),
    } as unknown as RenderEngine;
    const press = (x: number, y: number) =>
      canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: x, clientY: y, bubbles: true }));
    return { canvas, sceneGraph, engine, overlayContainer, press, detach: () => canvas.remove() };
  }

  /**
   * Token input claims a press with `stopImmediatePropagation` from a capture listener on
   * this canvas (tokens/drag.ts), and the door overlay has to lose to it whichever of the two
   * mounted first: the rail mounts Doors before Tokens, the old sidebar the other way round.
   * Placing a token on a door used to place the token *and* swing the door.
   */
  it('lets token input win the press even when the door overlay registered first', () => {
    useSessionStore.setState({ session: session(), you: dm });
    const sent = captureCommands();
    const h = harness();
    const unmount = mountDoorLayer(h.engine, h.sceneGraph);
    // Token input, registered after the overlay — what the shell's mount order does.
    h.canvas.addEventListener('pointerdown', (e) => e.stopImmediatePropagation(), true);

    h.press(PLAIN.position[0], PLAIN.position[1]);
    h.press(PLAIN.position[0], PLAIN.position[1]);
    expect(sent, 'the press that placed a token also swung the door under it').toEqual([]);
    expect(useDoorSelection.getState().selectedId).toBeNull();

    unmount();
    h.detach();
  });

  /**
   * One click reads a door, two work it — the same split the canvas's DoorTool has. A single
   * press used to toggle, which meant no way to reach a door's lock/reveal buttons (they hang
   * off the selection) without also swinging it.
   */
  it('selects on one press and toggles on the second', () => {
    useSessionStore.setState({ session: session(), you: dm });
    const sent = captureCommands();
    const h = harness();
    const unmount = mountDoorLayer(h.engine, h.sceneGraph);

    h.press(PLAIN.position[0], PLAIN.position[1]);
    expect(sent).toEqual([]);
    expect(useDoorSelection.getState().selectedId).toBe('d1');

    h.press(PLAIN.position[0], PLAIN.position[1]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ module: 'doors', action: 'toggle', payload: { id: 'd1' } });
    // Still selected, so the menu the double-click acted through stays on screen.
    expect(useDoorSelection.getState().selectedId).toBe('d1');

    unmount();
    h.detach();
  });

  it('treats two slow presses as two single clicks, never a toggle', () => {
    vi.useFakeTimers();
    useSessionStore.setState({ session: session(), you: dm });
    const sent = captureCommands();
    const h = harness();
    const unmount = mountDoorLayer(h.engine, h.sceneGraph);

    h.press(PLAIN.position[0], PLAIN.position[1]);
    vi.advanceTimersByTime(600);
    h.press(PLAIN.position[0], PLAIN.position[1]);
    expect(sent).toEqual([]);

    unmount();
    h.detach();
    vi.useRealTimers();
  });

  /** D2 — the DM works the doors. A player's press has nothing to hit. */
  it('gives a player no click target and no mark', () => {
    useSessionStore.setState({ session: session(), you: player });
    const sent = captureCommands();
    const h = harness();
    const unmount = mountDoorLayer(h.engine, h.sceneGraph);

    h.press(PLAIN.position[0], PLAIN.position[1]);
    h.press(PLAIN.position[0], PLAIN.position[1]);
    expect(sent).toEqual([]);
    expect(useDoorSelection.getState().selectedId).toBeNull();
    expect(marksOf(h.overlayContainer).children).toEqual([]);

    unmount();
    h.detach();
  });

  /** An archway is a hole in a wall: nothing to mark, nothing to swing (the server agrees). */
  it('draws no mark for an archway, and will not toggle one', () => {
    useStore.setState({ layers: [dungeonLayer([ARCHWAY, PLAIN])] });
    useSessionStore.setState({ session: session(), you: dm });
    const sent = captureCommands();
    const h = harness();
    const unmount = mountDoorLayer(h.engine, h.sceneGraph);

    expect(marksOf(h.overlayContainer).children).toHaveLength(1);
    h.press(ARCHWAY.position[0], ARCHWAY.position[1]);
    h.press(ARCHWAY.position[0], ARCHWAY.position[1]);
    expect(sent).toEqual([]);
    expect(useDoorSelection.getState().selectedId).toBeNull();

    unmount();
    h.detach();
  });

  it('draws one glyph per door for the DM, and reuses it across redraws', () => {
    useSessionStore.setState({ session: session(), you: dm });
    const h = harness();
    const unmount = mountDoorLayer(h.engine, h.sceneGraph);

    const marks = marksOf(h.overlayContainer);
    expect(marks.children).toHaveLength(3);
    const first = marks.children[0];

    act(() => useDoorSelection.getState().select('d1'));
    expect(marks.children).toHaveLength(3);
    expect(marks.children[0], 'a redraw minted a fresh sprite per door').toBe(first);

    unmount();
    h.detach();
  });
});

describe('the door art a player is shown', () => {
  /** Overlay container plus the multiply the screen overlays rank against. */
  function harness() {
    const worldContainer = new Container();
    const layerContainer = new Container();
    layerContainer.label = 'layerContainer';
    worldContainer.addChild(layerContainer);
    const overlayContainer = new Container();
    const sceneGraph = { worldContainer, layerContainer, overlayContainer } as unknown as SceneGraph;
    const engine = {
      canvas: () => document.createElement('canvas'),
      ticker: () => ({ add: () => {}, remove: () => {} }),
    } as unknown as RenderEngine;
    return { sceneGraph, overlayContainer, engine };
  }

  const artOf = (overlay: Container): Container =>
    overlay.children.find((c) => String(c.label) === 'doorOverlay')!.children[0] as Container;

  /**
   * The gate measured 262 warm-wood pixels in a door's box on the DM seat and 0 on the
   * player's. Core draws door art into the world container, which on a player's screen is
   * under the fog scrim and the lighting multiply — and the scrim only cuts room polygons,
   * so the door band between two rooms is never cut out of it. The art is redrawn in the
   * overlay that already beats the mask, for the doors the server let this seat hold.
   */
  it('draws the art above the mask for a player', () => {
    useSessionStore.setState({ session: session(), you: player });
    const { sceneGraph, overlayContainer, engine } = harness();
    const unmount = mountDoorLayer(engine, sceneGraph);
    expect(artOf(overlayContainer).children.length).toBeGreaterThan(0);
    unmount();
  });

  it('leaves the DM’s seat alone, where the world copy is already lit', () => {
    useSessionStore.setState({ session: session(), you: dm });
    const { sceneGraph, overlayContainer, engine } = harness();
    const unmount = mountDoorLayer(engine, sceneGraph);
    expect(artOf(overlayContainer).children).toEqual([]);
    unmount();
  });

  /** A seat holding no doors draws no art — the redaction leak, at the other end. */
  it('draws nothing at all when the player holds no doors', () => {
    useStore.setState({ layers: [dungeonLayer([])] });
    useSessionStore.setState({ session: session(), you: player });
    const { sceneGraph, overlayContainer, engine } = harness();
    const unmount = mountDoorLayer(engine, sceneGraph);
    expect(artOf(overlayContainer).children).toEqual([]);
    unmount();
  });
});

// ── The stencil the marks wear ──────────────────────────────────────────────
// Reported from a player seat: two wooden doors floating on the cloud, far from the one room
// that had been revealed. Redaction was not the leak — in vision mode a room ships whole the
// moment any of it is swept, so the seat legitimately *held* those doors — the leak was
// drawing them above a mask that was still hiding the ground they stand on.

describe('a door mark reaches exactly as far as the map does', () => {
  /** Overlay container, a ticker whose callbacks the rows can run, and the fog's own layer. */
  function harness(fogChildren: Container[] | null) {
    const worldContainer = new Container();
    const layerContainer = new Container();
    layerContainer.label = 'layerContainer';
    worldContainer.addChild(layerContainer);
    const overlayContainer = new Container();
    if (fogChildren) {
      const fog = new Container();
      fog.label = 'playerFog';
      for (const child of fogChildren) fog.addChild(child);
      overlayContainer.addChild(fog);
    }
    const ticks: (() => void)[] = [];
    const sceneGraph = { worldContainer, layerContainer, overlayContainer } as unknown as SceneGraph;
    const engine = {
      canvas: () => document.createElement('canvas'),
      ticker: () => ({ add: (fn: () => void) => ticks.push(fn), remove: () => {} }),
    } as unknown as RenderEngine;
    return { sceneGraph, overlayContainer, engine, frame: () => ticks.forEach((fn) => fn()) };
  }

  const stencil = (label: string): Container => {
    const g = new Container();
    g.label = label;
    return g;
  };

  const doorLayerOf = (overlay: Container): Container =>
    overlay.children.find((c) => String(c.label) === 'doorOverlay') as Container;
  const artOf = (overlay: Container): Container => doorLayerOf(overlay).children[0] as Container;

  it('wears the fog’s shown stencil on a player’s seat', () => {
    const shown = stencil('shownMask');
    useSessionStore.setState({ session: session(), you: player });
    const { sceneGraph, overlayContainer, engine, frame } = harness([shown]);
    const unmount = mountDoorLayer(engine, sceneGraph);
    frame();

    expect(doorLayerOf(overlayContainer).mask).toBe(shown);
    expect(artOf(overlayContainer).visible).toBe(true);
    unmount();
  });

  it('never wears the live-sight stencil the chips do', () => {
    // The one substitution that would look right and be wrong: `sightMask` is live sight
    // alone, so a remembered room would lose the doors it has already shown the party.
    const sight = stencil('sightMask');
    useSessionStore.setState({ session: session(), you: player });
    const { sceneGraph, overlayContainer, engine, frame } = harness([sight]);
    const unmount = mountDoorLayer(engine, sceneGraph);
    frame();

    expect(doorLayerOf(overlayContainer).mask ?? null).toBeNull();
    unmount();
  });

  it('hides the player’s redraw when there is no stencil, rather than showing it', () => {
    // Fail-dark. A missing stencil is a fog layer that has not mounted, or a scene with no fog
    // at all; in neither case may this copy — which draws *above* the mask — be painted. The
    // map's own world copy is still there, under whatever cover the fog does draw.
    useSessionStore.setState({ session: session(), you: player });
    const { sceneGraph, overlayContainer, engine, frame } = harness(null);
    const unmount = mountDoorLayer(engine, sceneGraph);
    frame();

    expect(artOf(overlayContainer).children.length).toBeGreaterThan(0);
    expect(artOf(overlayContainer).visible).toBe(false);
    expect(doorLayerOf(overlayContainer).mask ?? null).toBeNull();
    unmount();
  });

  it('leaves the DM’s own view unmasked', () => {
    useSessionStore.setState({ session: session(), you: dm });
    const { sceneGraph, overlayContainer, engine, frame } = harness(null);
    const unmount = mountDoorLayer(engine, sceneGraph);
    frame();

    expect(doorLayerOf(overlayContainer).mask ?? null).toBeNull();
    expect(marksOf(overlayContainer).children).toHaveLength(3);
    unmount();
  });

  it('masks the DM’s marks while a sight preview is drawing a mask', () => {
    // The preview exists to show the DM what the seat sees. Marks floating over its fog would
    // make it lie about exactly the thing it is there to answer.
    const shown = stencil('shownMask');
    useSessionStore.setState({ session: session(), you: dm });
    const { sceneGraph, overlayContainer, engine, frame } = harness([shown]);
    const unmount = mountDoorLayer(engine, sceneGraph);
    frame();

    expect(doorLayerOf(overlayContainer).mask).toBe(shown);
    unmount();
  });
});

describe('how a door draws (D11 — the DM never loses visibility)', () => {
  it('draws a secret door at full opacity with a badge, never ghosted', () => {
    const look = doorLook(SECRET, { open: false, locked: false, revealed: false });
    expect(look.alpha).toBe(DM_ENTITY_ALPHA);
    expect(look.alpha).toBe(1);
    expect(look.badge).toBe('secret');
  });

  it('never dims anything, whatever the state', () => {
    for (const [d, live] of [
      [PLAIN, { open: false, locked: false, revealed: true }],
      [PLAIN, { open: true, locked: false, revealed: true }],
      [LOCKED, { open: false, locked: true, revealed: true }],
      [SECRET, { open: false, locked: false, revealed: false }],
      [SECRET, { open: true, locked: false, revealed: true }],
    ] as const) {
      expect(doorLook(d, live).alpha).toBe(1);
    }
  });

  it('carries open and shut in shape, not colour alone', () => {
    const shut = doorLook(PLAIN, { open: false, locked: false, revealed: true });
    const open = doorLook(PLAIN, { open: true, locked: false, revealed: true });
    expect(shut.filled).toBe(true);
    expect(open.filled).toBe(false);
    expect(shut.badge).toBeNull();
  });

  it('gives a locked door the same neutral mark as any other, on either seat', () => {
    // No saturated status colour over the door art (PRODUCT principle 1). Locked is said in
    // the panel row and in the toast a player gets for bumping one — `doorStatusLabel` and
    // `doorRefusal` below — never by turning the mark red on everyone's canvas.
    const plain = doorLook(PLAIN, { open: false, locked: false, revealed: true });
    const locked = doorLook(LOCKED, { open: false, locked: true, revealed: true });
    expect(locked).toEqual(plain);
    expect(locked.badge).toBeNull();
  });

  it('leaves a player’s canvas no state colour at all', () => {
    // Everything a player can hold: a plain door and a secret one the DM has revealed. An
    // unrevealed secret is never sent to them (D4), so the gold branch is the DM's alone.
    const plain = doorLook(PLAIN, { open: false, locked: false, revealed: true });
    for (const [d, live] of [
      [PLAIN, { open: true, locked: false, revealed: true }],
      [LOCKED, { open: false, locked: true, revealed: true }],
      [SECRET, { open: false, locked: false, revealed: true }],
    ] as const) {
      expect(doorLook(d, live).color).toBe(plain.color);
      expect(doorLook(d, live).badge).toBeNull();
    }
  });

  it('says the state in words too', () => {
    expect(doorStatusLabel(PLAIN, { open: true, locked: false, revealed: true })).toBe('Open');
    expect(doorStatusLabel(LOCKED, { open: false, locked: true, revealed: true })).toBe(
      'Closed · locked',
    );
    expect(doorStatusLabel(SECRET, { open: false, locked: false, revealed: false })).toBe(
      'Closed · secret',
    );
    expect(doorStatusLabel(SECRET, { open: false, locked: false, revealed: true })).toBe(
      'Closed · secret, revealed',
    );
  });

  it('names a door the way the map does', () => {
    expect(doorLabel(PLAIN, 0)).toBe('Gallery Door');
    expect(doorLabel(door({ name: '  ' }), 4)).toBe('Door 5');
  });
});

describe('doorAt', () => {
  const live = () => liveDoors([dungeonLayer([PLAIN, LOCKED, SECRET])], undefined, 'scene-1');

  it('picks the door under the point and nothing beyond its reach', () => {
    expect(doorAt(live(), 4.2, 4.1)?.door.id).toBe('d1');
    expect(doorAt(live(), 7, 4)).toBeUndefined();
  });

  it('prefers the nearer of two doors in reach', () => {
    const pair = liveDoors(
      [dungeonLayer([door({ id: 'a', position: [0, 0] }), door({ id: 'b', position: [0.5, 0] })])],
      undefined,
      'scene-1',
    );
    expect(doorAt(pair, 0.45, 0)?.door.id).toBe('b');
  });
});

describe('grouping, filtering and the popover ceiling (M3 §Doors)', () => {
  it('sorts open over secret over plain closed — Closed group is drawn first', () => {
    const state: DoorsState = {
      byScene: { 'scene-1': { d1: { open: true, locked: false, revealed: true } } },
    };
    const grouped = groupDoors(liveDoors(useStore.getState().layers, state, 'scene-1'));
    expect(grouped.open.map((d) => d.door.id)).toEqual(['d1']);
    expect(grouped.closed.map((d) => d.door.id)).toEqual(['d2']);
    expect(grouped.secret.map((d) => d.door.id)).toEqual(['d3']);
  });

  it('filters by name and falls back to the "Door N" index untouched', () => {
    const named = [door({ id: 'a', name: '' }), door({ id: 'b', name: 'Vault Door', position: [1, 0] })];
    const entries = liveDoors([dungeonLayer(named)], undefined, 'scene-1');
    expect(filterDoors(entries, 'vault').map((d) => d.door.id)).toEqual(['b']);
    expect(filterDoors(entries, '').map((d) => d.door.id)).toEqual(['a', 'b']);
  });

  it('stays uncapped under the threshold, caps Closed-first at and past it', () => {
    const plainDoors = (n: number, offset = 0) =>
      Array.from({ length: n }, (_, i) => door({ id: `d${i + offset}`, position: [i, 0] }));

    const below = liveDoors([dungeonLayer(plainDoors(24))], undefined, 'scene-1');
    expect(below).toHaveLength(24);
    expect(visibleDoorChips(below, '')).toHaveLength(24);

    const secretOne = door({ id: 's', isSecret: true, position: [99, 0] });
    const at = liveDoors([dungeonLayer([...plainDoors(24), secretOne])], undefined, 'scene-1');
    expect(at).toHaveLength(DOOR_FILTER_THRESHOLD);
    const capped = visibleDoorChips(at, '');
    expect(capped).toHaveLength(DOOR_CHIP_CEILING);
    // The 24 plain closed doors filled the cap first — the secret door lost its seat, the
    // same "Closed group first" priority the ledger names.
    expect(capped.some((d) => d.door.id === 's')).toBe(false);
  });
});

describe('the reveal beat — which doors are new enough to fade in', () => {
  it('fades nothing on a first paint: a fresh mount is not a reveal', () => {
    expect(trackDoorIds(null, ['d1', 'd2'])).toEqual({
      arrived: [],
      known: new Set(['d1', 'd2']),
    });
  });

  it('fades only the door that just arrived, not the ones already there', () => {
    const first = trackDoorIds(null, ['d1', 'd2']);
    expect(trackDoorIds(first.known, ['d1', 'd2', 'd3']).arrived).toEqual(['d3']);
  });

  it('does not re-fade the whole map when a delta reloads the document', () => {
    const known = trackDoorIds(null, ['d1', 'd2']).known;
    // The reload passes through a frame with no doors in hand; forgetting the set there
    // would make every door "new" again on the frame after.
    const empty = trackDoorIds(known, []);
    expect(empty).toEqual({ arrived: [], known });
    expect(trackDoorIds(empty.known, ['d1', 'd2']).arrived).toEqual([]);
  });
});

describe('a refused door', () => {
  const held = () => liveDoors(useStore.getState().layers, undefined, 'scene-1');

  it('reads the typed prefixes, never the sentence', () => {
    expect(doorRefusal(`${DOOR_LOCKED}: that door is locked`)).toMatch(/locked/i);
    expect(doorRefusal(`${UNKNOWN_DOOR}: no such door in that scene`)).toMatch(/no longer there/i);
    expect(doorRefusal('rooms.r-1.status needs wasEverRevealed')).toBeNull();
  });

  it('names the door the refusal named', () => {
    expect(doorRefusal(`${DOOR_LOCKED} d2: that door is locked`, held())).toBe(
      'Reliquary Door is locked.',
    );
    expect(doorRefusal(`${DOOR_CLOSED} d1: that space cannot be occupied`, held())).toBe(
      'Gallery Door is closed.',
    );
  });

  /**
   * The redactor blanks the name of a door onto a room nobody has entered (it names what is
   * behind it). "Door 3" would be a worse answer than the nameless sentence, and `undefined`
   * would be a bug on screen, so both fall back.
   */
  it('falls back to the nameless sentence rather than to a number', () => {
    const blank = liveDoors([dungeonLayer([door({ id: 'd9', name: '' })])], undefined, 'scene-1');
    expect(doorRefusal(`${DOOR_LOCKED} d9: that door is locked`, blank)).toBe(
      'The door is locked.',
    );
    // A door this seat does not hold at all — a stale id, or one the fog withheld.
    expect(doorRefusal(`${DOOR_CLOSED} d-gone: that space cannot be occupied`, held())).toBe(
      'The door is closed.',
    );
    expect(doorRefusal(`${DOOR_LOCKED}: that door is locked`, held())).toBe('The door is locked.');
  });

  /**
   * The ear is GameTable's, not this panel's. A player pulling a door has no popover open —
   * which is exactly why the panel-mounted version of this never reached them.
   */
  function RefusalEar() {
    useRefusalToasts();
    return null;
  }

  it('toasts the player who pulled a locked door', () => {
    useSessionStore.setState({ session: session(), you: player });
    render(<RefusalEar />);
    expect(useToasts.getState().toast).toBeNull();

    act(() =>
      useSessionStore.setState({
        lastError: {
          code: 'invalid-command',
          message: `${DOOR_LOCKED} d2: that door is locked`,
          at: 1,
        },
      }),
    );
    expect(useToasts.getState().toast?.message).toMatch(/locked/i);
    // No undo on a refusal — there is nothing to take back.
    expect(useToasts.getState().toast?.action).toBeUndefined();
  });

  it('gives the player who pulled a locked door exactly one toast, naming that door', () => {
    useSessionStore.setState({ session: session(), you: player });
    render(<RefusalEar />);

    const shown: string[] = [];
    const unsubscribe = useToasts.subscribe((s) => {
      if (s.toast) shown.push(s.toast.message);
    });
    // What the server actually hands back for `doors.toggle` on a locked door
    // (mechanics/doors/module.ts) — the sender gets it, so a player does too.
    act(() =>
      useSessionStore.setState({
        lastError: {
          code: 'invalid-command',
          message: `${DOOR_LOCKED} d2: that door is locked`,
          at: 7,
        },
      }),
    );
    unsubscribe();
    expect(shown).toEqual(['Reliquary Door is locked.']);
  });

  it('stays quiet for refusals that are not a door’s', () => {
    useSessionStore.setState({ session: session(), you: player });
    act(() =>
      useSessionStore.setState({
        lastError: { code: 'invalid-command', message: 'tokens: no such token', at: 2 },
      }),
    );
    expect(useToasts.getState().toast).toBeNull();
  });
});
