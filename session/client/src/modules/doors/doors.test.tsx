import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Container } from 'pixi.js';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import type { SceneGraph } from '@dnd/core/src/engine/sceneGraph';
import type { DoorChild } from '@dnd/core/src/shared/types';
import type { Layer } from '@dnd/core/src/store/types';
import { useStore } from '@dnd/core/src/store/store';
import { DOOR_LOCKED, UNKNOWN_DOOR, type DoorsState } from '@dnd/mechanics/doors';
import type { PlayerInfo, SessionState } from '@dnd/core/src/shared/protocol';
import { frameWorldPoint } from '../../renderer/camera';
import type { WebSocketClient } from '../../session/WebSocketClient';
import { useSessionStore } from '../../session/store';
import { useToasts } from '../../session/toasts';
import {
  DM_ENTITY_ALPHA,
  doorAt,
  doorLabel,
  doorLook,
  doorRefusal,
  doorStatusLabel,
  liveDoors,
} from './doors';
import { DoorPanel } from './DoorPanel';
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

const dungeonLayer = (children: DoorChild[]): Layer =>
  ({ id: 'l1', type: 'dungeon', children, standaloneWalls: [], rooms: [] }) as unknown as Layer;

const dm: PlayerInfo = { identityId: 'dm-1', name: 'Ayla', role: 'dm', connected: true };
const player: PlayerInfo = { identityId: 'p-2', name: 'Borin', role: 'player', connected: true };

function session(modules: Record<string, unknown> = {}): SessionState {
  return {
    protocolVersion: 3,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: 'scene-1',
    scenes: [{ id: 'scene-1', name: 'Crypt' }],
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

beforeEach(() => {
  cleanup();
  framed.mockClear();
  useSessionStore.setState({ session: null, you: null, client: null, lastError: null });
  useToasts.setState({ toast: null });
  useDoorSelection.getState().select(null);
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

describe('DoorPanel', () => {
  it('lists the scene’s doors and selects one on click, without touching its state', () => {
    useSessionStore.setState({ session: session(), you: player });
    const sent = captureCommands();
    render(<DoorPanel />);

    const rows = screen.getByTestId('door-list').querySelectorAll('li');
    expect(rows).toHaveLength(3);
    expect(rows[1].getAttribute('data-locked')).toBe('true');
    expect(rows[2].getAttribute('data-secret')).toBe('true');

    fireEvent.click(rows[0].querySelector('button')!);
    expect(sent).toHaveLength(0);
    expect(useDoorSelection.getState().selectedId).toBe('d1');
  });

  it('brings the picked door into view, on this client only', () => {
    useSessionStore.setState({ session: session(), you: player });
    const sent = captureCommands();
    render(<DoorPanel />);

    const rows = screen.getByTestId('door-list').querySelectorAll('li');
    const row = rows[1].querySelector('button')!;
    // A real <button>, so Enter and Space reach the same handler the pointer does — the
    // keyboard route to a door needs no separate key handling.
    expect(row.tagName).toBe('BUTTON');
    fireEvent.click(row);

    expect(framed.mock.calls).toEqual([[10, 4]]);
    // Framing is local: nothing about it goes on the wire, so no other seat moves.
    expect(sent).toHaveLength(0);
  });

  it('says a revealed secret door is still closed, until it is opened', () => {
    const revealed = (open: boolean): DoorsState => ({
      byScene: { 'scene-1': { d3: { open, locked: false, revealed: true } } },
    });
    useSessionStore.setState({ session: session({ doors: revealed(false) }), you: dm });
    useDoorSelection.getState().select('d3');
    render(<DoorPanel />);
    expect(screen.getByTestId('door-status').textContent).toBe('Revealed — still closed');

    // Not once it is open, and never for a door that was never a secret.
    cleanup();
    useSessionStore.setState({ session: session({ doors: revealed(true) }) });
    render(<DoorPanel />);
    expect(screen.queryByTestId('door-status')).toBeNull();

    cleanup();
    useDoorSelection.getState().select('d1');
    render(<DoorPanel />);
    expect(screen.queryByTestId('door-status')).toBeNull();
  });

  it('toggles the selected door only via the explicit control', () => {
    useSessionStore.setState({ session: session(), you: player });
    useDoorSelection.getState().select('d1');
    const sent = captureCommands();
    render(<DoorPanel />);

    fireEvent.click(screen.getByTestId('door-toggle'));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ module: 'doors', action: 'toggle', payload: { id: 'd1' } });
  });

  it('offers lock and reveal-secret to the DM only, but toggle to anyone', () => {
    useSessionStore.setState({ session: session(), you: dm });
    useDoorSelection.getState().select('d3');
    render(<DoorPanel />);
    expect(screen.getByTestId('door-lock').textContent).toBe('Lock');
    expect(screen.getByTestId('door-reveal-secret')).not.toBeNull();

    cleanup();
    useSessionStore.setState({ you: player });
    render(<DoorPanel />);
    expect(screen.getByTestId('door-toggle')).not.toBeNull();
    expect(screen.queryByTestId('door-lock')).toBeNull();
    expect(screen.queryByTestId('door-reveal-secret')).toBeNull();
  });

  it('unlocks what is locked, and reveals a secret once', () => {
    useSessionStore.setState({ session: session(), you: dm });
    useDoorSelection.getState().select('d2');
    const sent = captureCommands();
    render(<DoorPanel />);

    expect(screen.getByTestId('door-lock').textContent).toBe('Unlock');
    fireEvent.click(screen.getByTestId('door-lock'));
    expect(sent[0]).toMatchObject({ action: 'unlock', payload: { id: 'd2' } });
    // A plain door has no secret to reveal.
    expect(screen.queryByTestId('door-reveal-secret')).toBeNull();
  });

  it('disables reveal-secret once the secret is out', () => {
    const state: DoorsState = {
      byScene: { 'scene-1': { d3: { open: false, locked: false, revealed: true } } },
    };
    useSessionStore.setState({ session: session({ doors: state }), you: dm });
    useDoorSelection.getState().select('d3');
    render(<DoorPanel />);
    const button = screen.getByTestId('door-reveal-secret') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Secret revealed');
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
  it('reads the typed prefixes, never the sentence', () => {
    expect(doorRefusal(`${DOOR_LOCKED}: that door is locked`)).toMatch(/locked/i);
    expect(doorRefusal(`${UNKNOWN_DOOR}: no such door in that scene`)).toMatch(/no longer there/i);
    expect(doorRefusal('rooms.r-1.status needs wasEverRevealed')).toBeNull();
  });

  it('toasts the player who pulled a locked door', () => {
    useSessionStore.setState({ session: session(), you: player });
    render(<DoorPanel />);
    expect(useToasts.getState().toast).toBeNull();

    act(() =>
      useSessionStore.setState({
        lastError: { code: 'invalid-command', message: `${DOOR_LOCKED}: that door is locked`, at: 1 },
      }),
    );
    expect(useToasts.getState().toast?.message).toMatch(/locked/i);
    // No undo on a refusal — there is nothing to take back.
    expect(useToasts.getState().toast?.action).toBeUndefined();
  });

  it('gives the player who pulled a locked door exactly one toast, in plain words', () => {
    useSessionStore.setState({ session: session(), you: player });
    render(<DoorPanel />);

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
          message: `${DOOR_LOCKED}: that door is locked`,
          at: 7,
        },
      }),
    );
    unsubscribe();
    expect(shown).toEqual(['The door is locked.']);
  });

  it('stays quiet for refusals that are not a door’s', () => {
    useSessionStore.setState({ session: session(), you: player });
    render(<DoorPanel />);
    act(() =>
      useSessionStore.setState({
        lastError: { code: 'invalid-command', message: 'tokens: no such token', at: 2 },
      }),
    );
    expect(useToasts.getState().toast).toBeNull();
  });
});
