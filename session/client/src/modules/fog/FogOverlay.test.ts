// D11's hover highlight, pinned at the layer that draws it.
//
// The pure half of the fog tool is checked in `fog.test.tsx`; what is only checkable here is
// the wiring — that a pointermove over an armed canvas reaches the overlay, changes what it
// draws, and draws it somewhere the DM can actually see.
//
// The browser gate read the highlight as byte-identical canvas checksums on and off a room.
// It was being drawn — into the world container, under the engine's screen-space lighting
// multiply, which on an unlit dungeon left 7% of it: 1.1/255 measured on the gate map. So
// the pin below is two-part, and the second part is the one that would have caught it —
// the highlight has to sit *above* the lighting composite, where the player's mask already
// lives for the same reason.
//
// Pixi's display objects need no GPU: `Graphics` records instructions into a context and
// only the renderer needs WebGL, so the draw is inspectable in jsdom.

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { Container, Ticker } from 'pixi.js';
import type { Room } from '@dnd/core/src/shared/types';
import type { Layer } from '@dnd/core/src/store/types';
import type { PlayerInfo, SessionState } from '@dnd/core/src/shared/protocol';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import type { SceneGraph } from '@dnd/core/src/engine/sceneGraph';
import { clearEngineSingleton, setEngineSingleton } from '@dnd/core/src/engine/engineSingleton';
import type { FogState } from '@dnd/mechanics/fog';
import { useSessionStore } from '../../session/store';
import { useActiveTool } from '../../session/tools';
import { mountFogOverlayWhenReady } from './FogOverlay';

const room = (id: string, x: number): Room => ({
  id,
  name: id,
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

const CRYPT = room('r-crypt', 0);
const HALL = room('r-hall', 10);

const dungeonLayer = (rooms: Room[]): Layer =>
  ({ id: 'l1', type: 'dungeon', children: [], standaloneWalls: [], rooms }) as unknown as Layer;

const dm: PlayerInfo = { identityId: 'dm-1', name: 'Ayla', role: 'dm', connected: true };

const fogWith = (rooms: FogState['byScene'][string]['rooms']): FogState => ({
  byScene: { 'scene-1': { rooms, concealBehindDoors: true } },
});

const session = (modules: Record<string, unknown> = {}): SessionState => ({
  protocolVersion: 3,
  sessionId: 's1',
  campaignId: 'c1',
  activeSceneId: 'scene-1',
  scenes: [{ id: 'scene-1', name: 'Crypt' }],
  players: [dm],
  modules,
});

/** World units are grid cells and the fixture rooms live at y 0..4, so 1px = 1 cell here. */
function fakeEngine(canvas: HTMLCanvasElement, ticker: Ticker): RenderEngine {
  return {
    canvas: () => canvas,
    ticker: () => ticker,
    screenToWorld: (sx: number, sy: number) => ({ x: sx, y: sy }),
  } as unknown as RenderEngine;
}

/** The two containers the overlay mounts into, plus the multiply it must draw above. */
function fakeSceneGraph(): SceneGraph {
  const worldContainer = new Container();
  const layerContainer = new Container();
  worldContainer.addChild(layerContainer);
  const overlayContainer = new Container();
  const lighting = new Container();
  lighting.label = 'lightingComposite';
  overlayContainer.addChild(lighting);
  return { worldContainer, layerContainer, overlayContainer } as unknown as SceneGraph;
}

interface Instruction {
  action: string;
  data?: { style?: { color?: number; alpha?: number; width?: number } };
}

type Painter = { context: { instructions: Instruction[] } };

/**
 * What one Graphics has drawn, as a value two frames can be compared by. Colour, alpha and
 * stroke width only — the geometry hangs off a texture-bearing style object that cannot be
 * serialised, and those three already separate a tint from a highlight.
 */
const signature = (paint: Painter | undefined): string =>
  (paint?.context.instructions ?? [])
    .map((i) => `${i.action}:${i.data?.style?.color}/${i.data?.style?.alpha}/${i.data?.style?.width}`)
    .join('|');

const layerNamed = (parent: Container, label: string): Container | undefined =>
  parent.children.find((c) => c.label === label) as Container | undefined;

/** The hover highlight, which lives above the lighting composite (D11 legibility). */
const drawn = (sceneGraph: SceneGraph): string =>
  signature(layerNamed(sceneGraph.overlayContainer, 'fogOverlay')?.children[0] as unknown as Painter);

/** The tint and explored glyph, which stay in the world under the DM's tokens and doors. */
const tinted = (sceneGraph: SceneGraph): string =>
  signature(layerNamed(sceneGraph.worldContainer, 'fogOverlay')?.children[0] as unknown as Painter);

let canvas: HTMLCanvasElement;
let sceneGraph: SceneGraph;
let ticker: Ticker;
let unmount: (() => void) | null = null;

const move = (x: number, y: number): void => {
  canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
};

beforeEach(() => {
  canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  sceneGraph = fakeSceneGraph();
  ticker = new Ticker();
  setEngineSingleton(fakeEngine(canvas, ticker), sceneGraph);
  useSessionStore.setState({
    session: session({ fog: fogWith({}) }),
    you: dm,
    client: null,
    mapData: { layers: [dungeonLayer([CRYPT, HALL])] },
  });
  useActiveTool.getState().setActiveTool(null);
});

afterEach(() => {
  unmount?.();
  unmount = null;
  ticker.destroy();
  clearEngineSingleton();
  canvas.remove();
});

describe('FogOverlay hover highlight (D11)', () => {
  it('redraws when the pointer enters a room while the tool is armed', () => {
    unmount = mountFogOverlayWhenReady();
    useActiveTool.getState().setActiveTool('fog');

    // Off every room — unzoned map is not hoverable (D6), so this is the baseline.
    move(7, 2);
    expect(drawn(sceneGraph), 'nothing is hovered yet').toBe('');

    move(2, 2);
    const hovering = drawn(sceneGraph);
    expect(hovering, 'the hover highlight never reached the overlay').not.toBe('');

    // …and it is the *hovered* room's highlight, redrawn, not a sticky first one.
    move(12, 2);
    expect(drawn(sceneGraph)).toBe(hovering);

    // Leaving the rooms puts it back exactly where it started.
    move(7, 2);
    expect(drawn(sceneGraph)).toBe('');
  });

  /**
   * The gate's actual failure. `addWorldOverlay` would put this under the engine's
   * screen-space lighting multiply, where an unlit dungeon leaves ~7% of it — drawn, and
   * invisible. The player's mask is above the composite for the same reason (D12).
   */
  it('draws the highlight above the lighting composite, not under it', () => {
    unmount = mountFogOverlayWhenReady();
    useActiveTool.getState().setActiveTool('fog');
    move(2, 2);

    const screen = sceneGraph.overlayContainer.children;
    const lighting = screen.findIndex((c) => c.label === 'lightingComposite');
    const cursor = screen.findIndex((c) => c.label === 'fogOverlay');
    expect(cursor).toBeGreaterThan(lighting);
    expect(drawn(sceneGraph)).not.toBe('');

    // The tint and glyph stay in the world, under the DM's tokens and doors (principle 3).
    expect(layerNamed(sceneGraph.worldContainer, 'fogOverlay')).toBeDefined();
    expect(tinted(sceneGraph), 'two unrevealed rooms carry the heavier tint').not.toBe('');
  });

  it('mirrors the camera, so the highlight sits on the room it names', () => {
    unmount = mountFogOverlayWhenReady();
    useActiveTool.getState().setActiveTool('fog');
    sceneGraph.worldContainer.position.set(120, -40);
    sceneGraph.worldContainer.scale.set(3);
    ticker.update(performance.now());

    const cursor = layerNamed(sceneGraph.overlayContainer, 'fogOverlay')!;
    expect([cursor.position.x, cursor.position.y]).toEqual([120, -40]);
    expect(cursor.scale.x).toBe(3);
  });

  it('draws nothing extra while the tool is not armed', () => {
    unmount = mountFogOverlayWhenReady();
    move(7, 2);
    move(2, 2);
    expect(drawn(sceneGraph)).toBe('');
  });

  it('is the DM’s layer alone — a player never gets a hover', () => {
    useSessionStore.setState({ you: { ...dm, role: 'player' } });
    unmount = mountFogOverlayWhenReady();
    useActiveTool.getState().setActiveTool('fog');
    move(2, 2);
    expect(drawn(sceneGraph)).toBe('');
    expect(layerNamed(sceneGraph.overlayContainer, 'fogOverlay')?.visible).toBe(false);
  });
});
