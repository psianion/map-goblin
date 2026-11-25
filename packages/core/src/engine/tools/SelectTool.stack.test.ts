// Picking stacked objects with Select: click again on the same spot to go one deeper (never on
// the second half of a double-click), the Pick only filter and hidden lights in the walk, the
// hover count the hint reads, and a box over hidden lights saying where they went.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Container } from 'pixi.js';
import { CLICK_AGAIN_MIN_MS, SelectTool, hiddenLightsNote } from './SelectTool';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { setNotify } from '../../store/notify';
import { setEditorDesk } from '../editorDesk';
import { crowdCount, pickHereAt, pickStats, setLightPicking, setRoomPicking } from '../hitTest';
import { setMarqueeKinds } from '../marqueeFilter';
import type { RenderEngine } from '../RenderEngine';
import type { AnyChild, DungeonLayer } from '../../store/types';
import type { AssetChild, LightChild, ShapeChild } from '../../shared/types';

if (typeof (globalThis as { CanvasRenderingContext2D?: unknown }).CanvasRenderingContext2D === 'undefined') {
  (globalThis as { CanvasRenderingContext2D?: unknown }).CanvasRenderingContext2D = class {};
}
const fakeCtx2D = new Proxy(
  {},
  {
    get: (target: Record<string, unknown>, prop) => (prop in target ? target[prop as string] : () => ({ width: 0, height: 0 })),
    set: (target: Record<string, unknown>, prop, value) => {
      target[prop as string] = value;
      return true;
    },
  },
);
HTMLCanvasElement.prototype.getContext = (() => fakeCtx2D) as unknown as typeof HTMLCanvasElement.prototype.getContext;

const ZOOM = 50;
const DESK = { desk: '#eeeeee', dot: '#cccccc', sheet: '#ffffff', ink: '#111111' };

function makeEngine(): RenderEngine {
  const overlayContainer = new Container();
  const rect = { left: 0, top: 0 } as DOMRect;
  return {
    overlay: () => overlayContainer,
    canvas: () => ({ getBoundingClientRect: () => rect }) as unknown as HTMLCanvasElement,
    stage: () => ({ scale: { x: ZOOM, y: ZOOM } }) as unknown as Container,
    worldToScreen: (wx: number, wy: number) => ({ x: wx * ZOOM, y: wy * ZOOM }),
    screenToWorld: (sx: number, sy: number) => ({ x: sx / ZOOM, y: sy / ZOOM }),
  } as unknown as RenderEngine;
}

const at = (x: number, y: number, extra: Partial<PointerEvent> = {}): PointerEvent =>
  ({ clientX: x * ZOOM, clientY: y * ZOOM, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...extra }) as PointerEvent;

const layer = (): DungeonLayer => useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
const sel = () => useStore.getState().selection.selectedIds;

function add<T extends AnyChild>(c: T): T {
  useStore.getState().addChild(layer().id, c);
  return c;
}
const asset = (id: string, x: number, y: number): AssetChild =>
  add({
    id, name: id, childType: 'asset', visible: true, objectType: 'asset', assetId: 'a', position: { x, y },
    rotation: 0, scale: 1, width: 1, height: 1, tint: '#ffffff', flipX: false, flipY: false,
  } as AssetChild);
const light = (id: string, x: number, y: number): LightChild =>
  add({
    id, name: id, childType: 'light', visible: true, color: '#ffffff', radius: 1, featherRadius: 1, intensity: 1,
    falloff: 'linear', position: { x, y },
  } as LightChild);
const floor = (id: string): ShapeChild =>
  add({
    id, name: id, childType: 'shape', visible: true, shapeType: 'rectangle', flipX: false, flipY: false,
    contours: [[[0, 0], [4, 0], [4, 4], [0, 4]]],
  } as unknown as ShapeChild);

/** A plain press and release at (x, y) at `ms` on the clock. */
function press(tool: SelectTool, x: number, y: number, ms: number): void {
  vi.spyOn(performance, 'now').mockReturnValue(ms);
  tool.onPointerDown({ x, y }, at(x, y));
  tool.onPointerUp({ x, y }, at(x, y));
}

/** A single click: a press, then the double-click window going by with no second press. */
function clickAt(tool: SelectTool, x: number, y: number, ms: number): void {
  press(tool, x, y, ms);
  vi.advanceTimersByTime(CLICK_AGAIN_MIN_MS);
}

const stackIds = (x: number, y: number) => pickHereAt([x, y], { zoom: ZOOM }).map((e) => e.hit.id);

describe('Select: picking stacked objects', () => {
  let tool: SelectTool;
  const notes: string[] = [];

  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    setEditorDesk(DESK);
    setRoomPicking(false);
    setLightPicking(null);
    setMarqueeKinds(null);
    useStore.getState().setMarqueeFilter('all');
    notes.length = 0;
    setNotify({ info: (m: string) => notes.push(m), success: () => {}, error: () => {}, warning: () => {} } as never);
    tool = new SelectTool(makeEngine());
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    setEditorDesk(null);
    setLightPicking(null);
    setMarqueeKinds(null);
    vi.restoreAllMocks();
  });

  it('a click again on the same spot goes one deeper each time, and wraps', () => {
    floor('f');
    asset('p', 2, 2);
    light('L', 2, 2);
    const stack = stackIds(2, 2);
    expect(stack).toHaveLength(3);
    clickAt(tool, 2, 2, 1000);
    expect(sel()).toEqual([stack[0]]);
    clickAt(tool, 2, 2, 1000 + CLICK_AGAIN_MIN_MS);
    expect(sel()).toEqual([stack[1]]);
    clickAt(tool, 2, 2, 1000 + 2 * CLICK_AGAIN_MIN_MS);
    expect(sel()).toEqual([stack[2]]);
    clickAt(tool, 2, 2, 1000 + 3 * CLICK_AGAIN_MIN_MS);
    expect(sel()).toEqual([stack[0]]);
    // Clicks only select: nothing moved, nothing on the undo stack.
    expect(undoManager.canUndo()).toBe(false);
  });

  it('the second click of a double-click keeps the pick, so the double-click acts on the top', () => {
    asset('p', 2, 2);
    floor('f');
    clickAt(tool, 2, 2, 1000);
    clickAt(tool, 2, 2, 1000 + CLICK_AGAIN_MIN_MS - 1);
    expect(sel()).toEqual(['p']);
    // A later single click on the spot still goes deeper.
    clickAt(tool, 2, 2, 1000 + 2 * CLICK_AGAIN_MIN_MS);
    expect(sel()).toEqual(['f']);
  });

  it('a double-click on a spot clicked a while ago never walks the stack: no step, no note', () => {
    asset('p', 2, 2);
    floor('f');
    clickAt(tool, 2, 2, 1000);
    notes.length = 0;
    // Its first click is a click again, but the step down waits out the window...
    press(tool, 2, 2, 3000);
    expect(sel()).toEqual(['p']);
    // ...and the second press, inside it, cancels the step.
    press(tool, 2, 2, 3150);
    vi.advanceTimersByTime(2 * CLICK_AGAIN_MIN_MS);
    expect(sel()).toEqual(['p']);
    expect(notes.some((n) => n.includes(' of '))).toBe(false);
  });

  it('a click again steps down only once the double-click window has passed', () => {
    asset('p', 2, 2);
    floor('f');
    clickAt(tool, 2, 2, 1000);
    press(tool, 2, 2, 2000);
    vi.advanceTimersByTime(CLICK_AGAIN_MIN_MS - 1);
    expect(sel()).toEqual(['p']);
    vi.advanceTimersByTime(1);
    expect(sel()).toEqual(['f']);
  });

  it('a hover walks the stack once a move, for both the pick and the count', () => {
    floor('f');
    asset('p', 2, 2);
    light('L', 2, 2);
    const walks = pickStats.walks;
    tool.onPointerMove({ x: 2, y: 2 }, at(2, 2));
    expect(pickStats.walks - walks).toBe(1);
    expect(useStore.getState().selection.hoveredId).toBe(stackIds(2, 2)[0]);
  });

  it('a click somewhere else, or a press that drags, is not a click again', () => {
    asset('p', 2, 2);
    floor('f');
    clickAt(tool, 2, 2, 1000);
    clickAt(tool, 3.5, 3.5, 2000);
    expect(sel()).toEqual(['f']);
    clickAt(tool, 2, 2, 3000);
    expect(sel()).toEqual(['p']);
    vi.spyOn(performance, 'now').mockReturnValue(4000);
    tool.onPointerDown({ x: 2, y: 2 }, at(2, 2));
    tool.onPointerMove({ x: 2.5, y: 2 }, at(2.5, 2));
    tool.onPointerUp({ x: 2.5, y: 2 }, at(2.5, 2));
    expect(sel()).toEqual(['p']);
  });

  it('keeps to Pick only, and Lights reaches a light whose icon is hidden', () => {
    asset('p', 2, 2);
    light('L1', 2, 2);
    light('L2', 2, 2);
    setLightPicking((l) => l.id !== 'L2');
    setMarqueeKinds(() => ['light']);
    useStore.getState().setMarqueeFilter('tab');
    // Topmost first: the light added last.
    expect(stackIds(2, 2)).toEqual(['L2', 'L1']);
    clickAt(tool, 2, 2, 1000);
    const first = sel()[0];
    clickAt(tool, 2, 2, 2000);
    const second = sel()[0];
    expect(new Set([first, second])).toEqual(new Set(['L1', 'L2']));
  });

  it('over hidden lights alone, a click picks nothing and a click again picks the top one of them', () => {
    light('L1', 2, 2);
    light('L2', 2, 2);
    // Hidden, except a selected one keeps its icon (the editor's Light icons rule).
    setLightPicking((l) => sel().includes(l.id));
    clickAt(tool, 2, 2, 1000);
    expect(sel()).toEqual([]);
    clickAt(tool, 2, 2, 2000);
    expect(sel()).toEqual(['L2']);
    clickAt(tool, 2, 2, 3000);
    expect(sel()).toEqual(['L1']);
  });

  it('counts what stands under the pointer for the hint, rooms and floors left out', () => {
    floor('f');
    asset('p', 2, 2);
    light('L', 2, 2);
    tool.onPointerMove({ x: 2, y: 2 }, at(2, 2));
    expect(useStore.getState().selection.hoverCount).toBe(2);
    tool.onPointerMove({ x: 3.5, y: 3.5 }, at(3.5, 3.5));
    expect(useStore.getState().selection.hoverCount).toBe(0);
    expect(crowdCount(pickHereAt([3.5, 3.5], { zoom: ZOOM }), true)).toBe(1);
  });

  it('a box over hidden lights and nothing else says where they went', () => {
    light('L1', 2, 2);
    light('L2', 2.2, 2);
    setLightPicking(() => false);
    tool.onPointerDown({ x: 1, y: 1 }, at(1, 1));
    tool.onPointerMove({ x: 3, y: 3 }, at(3, 3));
    tool.onPointerUp({ x: 3, y: 3 }, at(3, 3));
    expect(sel()).toEqual([]);
    expect(notes).toContain(hiddenLightsNote(2));
    expect(hiddenLightsNote(4)).toBe('4 hidden lights here, turn on Light icons or right-click to pick');
  });
});
