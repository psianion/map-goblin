// The fog brush on the DM's map: the arithmetic between a pointer and a `region-set`, the
// batching that keeps a stroke from being one broadcast per cell, and the cursor.
//
// Pixi's display objects need no GPU: `Graphics` records instructions into a context and only
// the renderer needs WebGL, so the draw is inspectable in jsdom.

import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { Container, Ticker, type Graphics, type GraphicsPath, type Rectangle } from 'pixi.js';
import type { PlayerInfo, SessionState } from '@dnd/core/src/shared/protocol';
import type { RenderEngine } from '@dnd/core/src/engine/RenderEngine';
import type { SceneGraph } from '@dnd/core/src/engine/sceneGraph';
import { clearEngineSingleton, setEngineSingleton } from '@dnd/core/src/engine/engineSingleton';
import { useStore } from '@dnd/core/src/store/store';
import type { WebSocketClient } from '../../session/WebSocketClient';
import { useSessionStore } from '../../session/store';
import { useActiveTool } from '../../session/tools';
import { armBrush, useFogBrush } from './brush';
import { disc, mountFogOverlayWhenReady } from './FogOverlay';

const dm: PlayerInfo = { identityId: 'dm-1', name: 'Ayla', role: 'dm', connected: true };

const session = (): SessionState => ({
  protocolVersion: PROTOCOL_VERSION,
  sessionId: 's1',
  campaignId: 'c1',
  activeSceneId: 'scene-1',
  scenes: [{ id: 'scene-1', name: 'Crypt', mapId: 'scene-1' }],
  players: [dm],
  modules: { fog: { byScene: { 'scene-1': { on: true } } } },
});

/** World units are grid cells, so 1px = 1 cell here. */
function fakeEngine(canvas: HTMLCanvasElement, ticker: Ticker): RenderEngine {
  return {
    canvas: () => canvas,
    ticker: () => ticker,
    screenToWorld: (sx: number, sy: number) => ({ x: sx, y: sy }),
  } as unknown as RenderEngine;
}

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

/** A NON-ZERO origin, which is where off-by-ones hide. */
const FRAME = { minX: -1, minY: -1, maxX: 15, maxY: 5 };

interface Sent {
  module: string;
  action: string;
  payload: { levelId: string; op: string; cells: [number, number][] };
}

let canvas: HTMLCanvasElement;
let sceneGraph: SceneGraph;
let ticker: Ticker;
let unmount: (() => void) | null = null;
let sent: Sent[];

const pointer = (type: string, x: number, y: number, init: PointerEventInit = {}): void => {
  canvas.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, ...init }));
};
const up = (): void => {
  canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
};
const cellsOf = (list: Sent[]): string[] => list.flatMap((s) => s.payload.cells.map((c) => c.join()));
const cursorLayer = (): Container =>
  sceneGraph.overlayContainer.children.find((c) => c.label === 'fogOverlay') as Container;
const cursorDrawn = (): number =>
  ((cursorLayer().children[0] as unknown as { context: { instructions: unknown[] } }).context.instructions ?? []).length;
/** The cells the cursor fills, as "col,row" against FRAME, read off the rects it drew. */
const cursorCells = (): string[] => {
  const fill = cursorLayer().children[0] as Graphics;
  return fill.context.instructions
    .filter((i) => i.action === 'fill')
    .flatMap((i) => (i.data as { path: GraphicsPath }).path.shapePath.shapePrimitives.map((p) => p.shape as Rectangle))
    .flatMap((r) => {
      const out: string[] = [];
      for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x; x < r.x + r.width; x++) out.push(`${x - FRAME.minX},${y - FRAME.minY}`);
      return out;
    });
};

beforeEach(() => {
  canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  sceneGraph = fakeSceneGraph();
  ticker = new Ticker();
  setEngineSingleton(fakeEngine(canvas, ticker), sceneGraph);
  sent = [];
  useSessionStore.setState({
    session: session(),
    you: dm,
    client: { send: (msg: Sent) => sent.push(msg) } as unknown as WebSocketClient,
    mapData: { frame: FRAME, layers: [] },
  });
  useStore.setState({ levels: [{ id: 'level-1', name: 'Ground' }] } as never);
  useActiveTool.getState().setActiveTool(null);
  useFogBrush.setState({ op: 'clear', size: 1 });
  unmount = mountFogOverlayWhenReady();
});

afterEach(() => {
  unmount?.();
  unmount = null;
  ticker.destroy();
  clearEngineSingleton();
  canvas.remove();
});

describe('the fog brush', () => {
  it('clears the cell under the pointer on the level the DM is showing', () => {
    armBrush('clear');
    // World (0.5, 0.5) against a frame starting at (-1, -1) is cell [1, 1].
    pointer('pointerdown', 0.5, 0.5);
    up();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ module: 'fog', action: 'region-set', payload: { levelId: 'level-1', op: 'clear', cells: [[1, 1]] } });
  });

  it('writes to the shown level of a map with two', () => {
    useStore.setState({ levels: [{ id: 'upper', name: 'Upper' }, { id: 'lower', name: 'Lower' }], ui: { ...useStore.getState().ui, activeLevelId: 'lower' } } as never);
    armBrush('fog');
    pointer('pointerdown', 0.5, 0.5);
    up();
    expect(sent[0].payload).toMatchObject({ levelId: 'lower', op: 'fog' });
  });

  it('paints every cell the drag crossed, once each, in batches', () => {
    armBrush('clear');
    pointer('pointerdown', 0.5, 0.5);
    // One event thirteen cells along: the segment between is filled in, and twelve flush.
    pointer('pointermove', 13.5, 0.5);
    expect(sent).toHaveLength(1);
    expect(sent[0].payload.cells).toHaveLength(12);
    // Scrubbing back over painted ground sends nothing.
    pointer('pointermove', 0.5, 0.5);
    expect(sent).toHaveLength(1);
    up();
    const cells = cellsOf(sent);
    expect(cells).toHaveLength(14);
    expect(new Set(cells).size).toBe(14);
  });

  it('paints a disc as wide as the size', () => {
    useFogBrush.setState({ size: 3 });
    armBrush('clear');
    pointer('pointerdown', 4.5, 1.5);
    up();
    expect(cellsOf(sent).sort()).toEqual(disc([5, 2], 3).map((c) => c.join()).sort());
    expect(disc([0, 0], 3)).toHaveLength(9);
    expect(disc([0, 0], 1)).toEqual([[0, 0]]);
  });

  it('paints the other way with Alt held, decided once at the top of the stroke', () => {
    armBrush('clear');
    pointer('pointerdown', 0.5, 0.5, { altKey: true });
    pointer('pointermove', 2.5, 0.5);
    up();
    expect(sent.every((s) => s.payload.op === 'fog')).toBe(true);
    // The next stroke without Alt is the armed way again.
    pointer('pointerdown', 4.5, 0.5);
    up();
    expect(sent.at(-1)!.payload.op).toBe('clear');
  });

  it('sends nothing off the frame, and nothing while unarmed', () => {
    armBrush('clear');
    pointer('pointerdown', -40, -40);
    up();
    useActiveTool.getState().setActiveTool(null);
    pointer('pointerdown', 0.5, 0.5);
    up();
    expect(sent).toEqual([]);
  });

  it('draws its cursor above the lighting composite, only while armed', () => {
    pointer('pointermove', 2.5, 2.5);
    expect(cursorLayer().visible).toBe(false);
    armBrush('clear');
    pointer('pointermove', 3.5, 2.5);
    expect(cursorLayer().visible).toBe(true);
    expect(cursorDrawn()).toBeGreaterThan(0);
    useActiveTool.getState().setActiveTool(null);
    expect(cursorLayer().visible).toBe(false);
  });

  it('9: marks exactly the cells a stamp of that size sends, at the frame’s edge too', () => {
    for (const [size, x, y] of [
      [1, 4.5, 1.5],
      [3, 4.5, 1.5],
      [5, -0.5, -0.5],
      [5, 13.5, 3.5],
    ] as const) {
      useFogBrush.setState({ size });
      armBrush('clear');
      pointer('pointermove', x, y);
      const marked = cursorCells().sort();
      sent = [];
      pointer('pointerdown', x, y);
      up();
      expect(marked).toEqual(cellsOf(sent).sort());
      useActiveTool.getState().setActiveTool(null);
    }
  });
});
