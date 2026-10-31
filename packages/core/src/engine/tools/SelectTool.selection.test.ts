import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Container } from 'pixi.js';
import { SelectTool } from './SelectTool';
import { TransformGizmo } from './TransformGizmo';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { setNotify } from '../../store/notify';
import { setEditorDesk } from '../editorDesk';
import { setRoomPicking } from '../hitTest';
import { setMarqueeKinds } from '../marqueeFilter';
import type { RenderEngine } from '../RenderEngine';
import type { AnyChild, DungeonLayer } from '../../store/types';
import type { AssetChild, LightChild, ShapeChild, WallSegment } from '../../shared/types';

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

/** A pointer event at a world point, at ZOOM. */
const at = (x: number, y: number, extra: Partial<PointerEvent> = {}): PointerEvent =>
  ({ clientX: x * ZOOM, clientY: y * ZOOM, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...extra }) as PointerEvent;
const key = (k: string) => ({ key: k }) as KeyboardEvent;

const layer = (): DungeonLayer => useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
const sel = () => useStore.getState().selection.selectedIds;
const find = (id: string) => layer().children.find((c) => c.id === id);

function add<T extends AnyChild>(c: T, layerId = layer().id): T {
  useStore.getState().addChild(layerId, c);
  return c;
}

const asset = (id: string, x: number, y: number, extra: Partial<AssetChild> = {}): AssetChild =>
  add({
    id, name: id, childType: 'asset', visible: true, objectType: 'asset', assetId: 'a', position: { x, y },
    rotation: 0, scale: 1, width: 1, height: 1, tint: '#ffffff', flipX: false, flipY: false, ...extra,
  } as AssetChild);

const light = (id: string, x: number, y: number): LightChild =>
  add({
    id, name: id, childType: 'light', visible: true, color: '#ffffff', radius: 1, featherRadius: 1, intensity: 1,
    falloff: 'linear', position: { x, y },
  } as LightChild);

const floor = (id: string, x0: number, y0: number, x1: number, y1: number): ShapeChild =>
  add({
    id, name: id, childType: 'shape', visible: true, shapeType: 'rectangle', flipX: false, flipY: false,
    contours: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
  } as unknown as ShapeChild);

function wall(id: string, a: [number, number], b: [number, number], extra: Partial<WallSegment> = {}): WallSegment {
  const w = { id, points: [a, b], wallType: 'normal', direction: 'both', color: '#000', width: 0.5, roughness: 0, ...extra } as WallSegment;
  useStore.getState().addWall(layer().id, w);
  return w;
}

function click(tool: SelectTool, x: number, y: number, extra: Partial<PointerEvent> = {}): void {
  tool.onPointerDown({ x, y }, at(x, y, extra));
  tool.onPointerUp({ x, y }, at(x, y, extra));
}

function drag(tool: SelectTool, from: [number, number], to: [number, number], extra: Partial<PointerEvent> = {}): void {
  tool.onPointerDown({ x: from[0], y: from[1] }, at(from[0], from[1], extra));
  tool.onPointerMove({ x: to[0], y: to[1] }, at(to[0], to[1], extra));
  tool.onPointerUp({ x: to[0], y: to[1] }, at(to[0], to[1], extra));
}

describe('SelectTool — one selection path', () => {
  let tool: SelectTool;
  const warnings: string[] = [];

  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    setEditorDesk(DESK);
    setRoomPicking(false);
    setMarqueeKinds(null);
    useStore.getState().setMarqueeFilter('all');
    warnings.length = 0;
    setNotify({ info: () => {}, success: () => {}, error: () => {}, warning: (m: string) => warnings.push(m) } as never);
    tool = new SelectTool(makeEngine());
  });
  afterEach(() => {
    setEditorDesk(null);
    setRoomPicking(false);
    setMarqueeKinds(null);
    vi.restoreAllMocks();
  });

  it('Shift+marquee adds to the selection instead of clearing it', () => {
    asset('a', 1, 1);
    asset('b', 6, 6);
    click(tool, 1, 1);
    expect(sel()).toEqual(['a']);
    drag(tool, [5, 5], [7, 7], { shiftKey: true });
    expect([...sel()].sort()).toEqual(['a', 'b']);
  });

  it('Alt+marquee takes away from the selection', () => {
    asset('a', 1, 1);
    asset('b', 6, 6);
    drag(tool, [0, 0], [8, 8]);
    expect([...sel()].sort()).toEqual(['a', 'b']);
    drag(tool, [5, 5], [7, 7], { altKey: true });
    expect(sel()).toEqual(['a']);
  });

  it('a plain marquee replaces the selection', () => {
    asset('a', 1, 1);
    asset('b', 6, 6);
    click(tool, 1, 1);
    drag(tool, [5, 5], [7, 7]);
    expect(sel()).toEqual(['b']);
  });

  it('the kind filter keeps the marquee to the tab’s kinds', () => {
    asset('a', 1, 1);
    light('l', 2, 2);
    useStore.getState().setMarqueeFilter('tab');
    setMarqueeKinds(() => ['light']);
    drag(tool, [0, 0], [4, 4]);
    expect(sel()).toEqual(['l']);
  });

  it('“Everything” ignores the tab', () => {
    asset('a', 1, 1);
    light('l', 2, 2);
    setMarqueeKinds(() => ['light']);
    drag(tool, [0, 0], [4, 4]);
    expect([...sel()].sort()).toEqual(['a', 'l']);
  });

  it('collects a room only when the marquee covers its whole face', () => {
    setRoomPicking(true);
    useStore.setState((s) => {
      const l = s.layers.find((x) => x.type === 'dungeon') as DungeonLayer;
      l.rooms = [{ id: 'r', name: 'Hall', anchor: [2, 2], face: [[1, 1], [3, 1], [3, 3], [1, 3]] }];
    });
    drag(tool, [0.5, 0.5], [2.5, 2.5]);
    expect(sel()).not.toContain('r');
    drag(tool, [0.5, 0.5], [3.5, 3.5]);
    expect(sel()).toContain('r');
  });

  it('never collects a layer on a level not on show', () => {
    useStore.getState().addLevel({ id: 'lvl-up', name: 'Upstairs' });
    const other = { ...structuredClone(layer()), id: 'up', name: 'Up', children: [], standaloneWalls: [], levelId: 'lvl-up' };
    useStore.getState().addLayer(other as DungeonLayer);
    asset('here', 1, 1);
    add({ ...(find('here') as AssetChild), id: 'upstairs' } as AssetChild, 'up');
    drag(tool, [-1, -1], [3, 3]);
    expect(sel()).toContain('here');
    expect(sel()).not.toContain('upstairs');
  });

  it('on v2 a marquee takes a floor only when it covers the floor whole', () => {
    floor('f', 2, 2, 10, 10);
    asset('a', 4, 4);
    drag(tool, [1, 1], [5, 5]);
    expect(sel()).toEqual(['a']);
    drag(tool, [1, 1], [11, 11]);
    expect([...sel()].sort()).toEqual(['a', 'f']);
  });

  it('a press on a room that travels draws a marquee instead of moving anything', () => {
    setRoomPicking(true);
    useStore.setState((s) => {
      const l = s.layers.find((x) => x.type === 'dungeon') as DungeonLayer;
      l.rooms = [{ id: 'r', name: 'Hall', anchor: [5, 5], face: [[0, 0], [10, 0], [10, 10], [0, 10]] }];
    });
    asset('a', 3, 3);
    drag(tool, [2, 2], [4, 4]);
    expect(sel()).toEqual(['a']);
    click(tool, 6, 6);
    expect(sel()).toEqual(['r']);
  });

  it('a marquee collects locked props, so they can be unlocked from the card', () => {
    asset('a', 1, 1, { locked: true });
    drag(tool, [0, 0], [2, 2]);
    expect(sel()).toEqual(['a']);
  });

  it('a marquee skips hidden children and hidden walls', () => {
    asset('a', 1, 1, { visible: false });
    wall('w', [0, 1.5], [2, 1.5], { visible: false });
    drag(tool, [0, 0], [3, 3]);
    expect(sel()).toEqual([]);
  });

  it('a press on a locked prop selects it and never moves it', () => {
    asset('a', 1, 1, { locked: true });
    drag(tool, [1, 1], [4, 4]);
    expect(sel()).toEqual(['a']);
    expect((find('a') as AssetChild).position).toEqual({ x: 1, y: 1 });
    expect(undoManager.canUndo()).toBe(false);
  });

  it('a drawn wall moves under a plain press-and-drag, its door along, in one undo', () => {
    wall('w', [0, 0], [4, 0]);
    add({ id: 'd', name: 'd', childType: 'door', visible: true, wallId: 'w', position: [2, 0], angle: 0, width: 1, style: 'single', state: 'closed', isSecret: false } as AnyChild);
    drag(tool, [0.5, 0], [0.5, 2]);
    expect(layer().standaloneWalls[0].points).toEqual([[0, 2], [4, 2]]);
    undoManager.undo();
    expect(layer().standaloneWalls[0].points).toEqual([[0, 0], [4, 0]]);
    expect(undoManager.canUndo()).toBe(false);
  });

  it('Alt+click steps down the stack under the pointer and wraps', () => {
    floor('f', 0, 0, 4, 4);
    asset('p', 2, 2);
    click(tool, 2, 2, { altKey: true });
    expect(sel()).toEqual(['p']);
    click(tool, 2, 2, { altKey: true });
    expect(sel()).toEqual(['f']);
    click(tool, 2, 2, { altKey: true });
    expect(sel()).toEqual(['p']);
  });

  it('Alt+drag duplicates and moves the copy in one undo step', () => {
    asset('p', 2, 2);
    drag(tool, [2, 2], [5, 2], { altKey: true });
    const props = layer().children.filter((c) => c.childType === 'asset') as AssetChild[];
    expect(props).toHaveLength(2);
    expect(find('p')).toMatchObject({ position: { x: 2, y: 2 } });
    const copy = props.find((c) => c.id !== 'p')!;
    expect(copy.position).toEqual({ x: 5, y: 2 });
    expect(sel()).toEqual([copy.id]);
    undoManager.undo();
    expect(layer().children.filter((c) => c.childType === 'asset')).toHaveLength(1);
    expect(undoManager.canUndo()).toBe(false);
  });

  it('Esc mid-drag cancels the drag only; the selection stays', () => {
    asset('p', 2, 2);
    tool.onPointerDown({ x: 2, y: 2 }, at(2, 2));
    tool.onPointerMove({ x: 4, y: 2 }, at(4, 2));
    tool.onKeyDown(key('Escape'));
    expect((find('p') as AssetChild).position).toEqual({ x: 2, y: 2 });
    expect(sel()).toEqual(['p']);
    expect(tool.isActive()).toBe(true);
  });

  it('Esc with a selection clears it, and a second Esc has nothing to do', () => {
    asset('p', 2, 2);
    click(tool, 2, 2);
    expect(tool.isActive()).toBe(true);
    tool.onKeyDown(key('Escape'));
    expect(sel()).toEqual([]);
    expect(tool.isActive()).toBe(false);
  });

  it('Esc during an Alt+drag copy drops the copy and gives the selection back', () => {
    asset('p', 2, 2);
    tool.onPointerDown({ x: 2, y: 2 }, at(2, 2, { altKey: true }));
    tool.onPointerMove({ x: 5, y: 2 }, at(5, 2, { altKey: true }));
    tool.onKeyDown(key('Escape'));
    expect(layer().children.filter((c) => c.childType === 'asset')).toHaveLength(1);
    expect(sel()).toEqual([]);
  });

  it('a release the move hook takes reverts the move and commits nothing', () => {
    asset('p', 2, 2);
    const hook = vi.fn(() => true);
    tool.onMoveRelease = hook;
    drag(tool, [2, 2], [5, 5]);
    expect(hook).toHaveBeenCalledWith({ x: 5 * ZOOM, y: 5 * ZOOM }, ['p']);
    expect((find('p') as AssetChild).position).toEqual({ x: 2, y: 2 });
    expect(undoManager.canUndo()).toBe(false);
  });

  it('a release the hook declines commits the move as usual', () => {
    asset('p', 2, 2);
    tool.onMoveRelease = () => false;
    drag(tool, [2, 2], [5, 5]);
    expect((find('p') as AssetChild).position).toEqual({ x: 5, y: 5 });
  });

  it('tells the hover hook the pointer through a move, then null when it ends', () => {
    asset('p', 2, 2);
    const hover = vi.fn();
    tool.onMoveHover = hover;
    drag(tool, [2, 2], [5, 5]);
    expect(hover).toHaveBeenCalledWith({ x: 5 * ZOOM, y: 5 * ZOOM }, ['p']);
    expect(hover).toHaveBeenLastCalledWith(null, ['p']);
  });

  it('tells the hover hook null when Escape abandons a move', () => {
    asset('p', 2, 2);
    const hover = vi.fn();
    tool.onMoveHover = hover;
    tool.onPointerDown({ x: 2, y: 2 }, at(2, 2));
    tool.onPointerMove({ x: 4, y: 4 }, at(4, 4));
    expect(hover).toHaveBeenLastCalledWith({ x: 4 * ZOOM, y: 4 * ZOOM }, ['p']);
    tool.onKeyDown(key('Escape'));
    expect(hover).toHaveBeenLastCalledWith(null, expect.any(Array));
  });

  it('holds the live move while the hover hook reports a drop target', () => {
    asset('p', 2, 2);
    let overTile = false;
    tool.onMoveHover = (screen) => !!screen && overTile;
    tool.onPointerDown({ x: 2, y: 2 }, at(2, 2));
    tool.onPointerMove({ x: 4, y: 4 }, at(4, 4));
    expect((find('p') as AssetChild).position).toEqual({ x: 4, y: 4 });
    overTile = true;
    tool.onPointerMove({ x: 9, y: 9 }, at(9, 9));
    expect((find('p') as AssetChild).position).toEqual({ x: 4, y: 4 });
    tool.onPointerMove({ x: 12, y: 9 }, at(12, 9));
    expect((find('p') as AssetChild).position).toEqual({ x: 4, y: 4 });
  });

  it('follows the pointer again once the drop target is cleared', () => {
    asset('p', 2, 2);
    let overTile = true;
    tool.onMoveHover = (screen) => !!screen && overTile;
    tool.onPointerDown({ x: 2, y: 2 }, at(2, 2));
    tool.onPointerMove({ x: 6, y: 6 }, at(6, 6));
    expect((find('p') as AssetChild).position).toEqual({ x: 2, y: 2 });
    overTile = false;
    tool.onPointerMove({ x: 5, y: 3 }, at(5, 3));
    expect((find('p') as AssetChild).position).toEqual({ x: 5, y: 3 });
    tool.onPointerUp({ x: 5, y: 3 }, at(5, 3));
    expect((find('p') as AssetChild).position).toEqual({ x: 5, y: 3 });
  });

  it('picks with the raw pointer, not the snapped point it is handed', () => {
    asset('a', 1, 1);
    // Snapped to (0, 0), which is off the prop; the pointer itself is on it.
    tool.onPointerDown({ x: 0, y: 0 }, at(1.2, 1.2));
    tool.onPointerUp({ x: 0, y: 0 }, at(1.2, 1.2));
    expect(sel()).toEqual(['a']);
  });

  it('a hidden wall never answers a click', () => {
    wall('w', [0, 1], [4, 1], { visible: false });
    click(tool, 2, 1);
    expect(sel()).toEqual([]);
  });

  it('the v1 editor keeps Alt+drag as its region cut', () => {
    setEditorDesk(null);
    asset('a', 1, 1);
    click(tool, 1, 1);
    drag(tool, [0, 0], [3, 3], { altKey: true });
    // The legacy cut clears the object selection and selects floor, not objects.
    expect(sel()).toEqual([]);
  });

  it('Ctrl+click toggles every child and wall on the layer', () => {
    asset('a', 1, 1);
    wall('w', [5, 5], [6, 5]);
    click(tool, 1, 1, { ctrlKey: true });
    expect([...sel()].sort()).toEqual(['a', 'w']);
  });

  it('Shift+click toggles one member', () => {
    asset('a', 1, 1);
    asset('b', 3, 3);
    click(tool, 1, 1);
    click(tool, 3, 3, { shiftKey: true });
    expect([...sel()].sort()).toEqual(['a', 'b']);
    click(tool, 3, 3, { shiftKey: true });
    expect(sel()).toEqual(['a']);
  });

  it('metric: a gizmo drag over 50 walls and 200 props writes no undo entry per move, one on release', () => {
    for (let i = 0; i < 50; i++) wall(`w${i}`, [i, 20], [i + 0.5, 20]);
    for (let i = 0; i < 200; i++) asset(`p${i}`, (i % 20) * 1.5, Math.floor(i / 20) * 1.5);
    useStore.getState().setSelectedIds([...Array.from({ length: 50 }, (_, i) => `w${i}`), ...Array.from({ length: 200 }, (_, i) => `p${i}`)]);
    const exec = vi.spyOn(undoManager, 'execute');
    tool.onPointerDown({ x: 0, y: 0 }, at(0, 0));
    let moves = 0;
    for (let i = 1; i <= 20; i++) {
      tool.onPointerMove({ x: i * 0.1, y: 0 }, at(i * 0.1, 0));
      moves++;
    }
    const duringMoves = exec.mock.calls.length;
    tool.onPointerUp({ x: 2, y: 0 }, at(2, 0));
    console.log(`[metric] gizmo drag on 50 walls + 200 props: ${moves} pointermoves, ${duringMoves} commands during moves, ${exec.mock.calls.length - duringMoves} on release`);
    expect(duringMoves).toBe(0);
    expect(exec.mock.calls.length).toBe(1);
    expect(layer().standaloneWalls[0].points[0][0]).toBeCloseTo(2);
  });

  it('metric: a marquee over 1,000 objects and 100 walls on one layer resolves within a frame', () => {
    for (let i = 0; i < 1000; i++) asset(`p${i}`, (i % 40) * 1.2, Math.floor(i / 40) * 1.2);
    for (let i = 0; i < 100; i++) wall(`w${i}`, [i * 0.4, 40], [i * 0.4 + 0.3, 40]);
    tool.onPointerDown({ x: -1, y: -1 }, at(-1, -1));
    tool.onPointerMove({ x: 60, y: 60 }, at(60, 60));
    const t0 = performance.now();
    tool.onPointerUp({ x: 60, y: 60 }, at(60, 60));
    const ms = performance.now() - t0;
    console.log(`[metric] marquee over 1000 objects + 100 walls: ${ms.toFixed(2)} ms, ${sel().length} selected`);
    expect(sel()).toHaveLength(1100);
    expect(ms).toBeLessThanOrEqual(16);
  });
});

describe('SelectTool — lights by their marker, walls by their length, Alt on a handle', () => {
  let tool: SelectTool;

  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    setEditorDesk(DESK);
    setRoomPicking(false);
    setMarqueeKinds(null);
    useStore.getState().setMarqueeFilter('all');
    setNotify({ info: () => {}, success: () => {}, error: () => {}, warning: () => {} } as never);
    tool = new SelectTool(makeEngine());
  });
  afterEach(() => {
    setEditorDesk(null);
    vi.restoreAllMocks();
  });

  const wideLight = (id: string, x: number, y: number): LightChild => {
    const l = light(id, x, y);
    useStore.getState().updateChild(layer().id, id, { radius: 6 });
    return l;
  };

  it('a marquee leaves a light whose marker is outside it, however far its radius reaches', () => {
    wideLight('fire', 10, 10);
    drag(tool, [5, 5], [8, 8]);
    expect(sel()).toEqual([]);
  });

  it('a marquee takes a light whose marker is inside it', () => {
    wideLight('fire', 10, 10);
    drag(tool, [9, 9], [11, 11]);
    expect(sel()).toEqual(['fire']);
  });

  it('the box of a prop and a light wraps the light’s marker, not its radius', () => {
    asset('p', 1, 1);
    wideLight('fire', 5, 5);
    useStore.getState().setSelectedIds(['p', 'fire']);
    const update = vi.spyOn(TransformGizmo.prototype, 'update');
    tool.updateGizmo();
    const [box, config] = update.mock.calls.at(-1)!;
    // Prop 0.5..1.5, marker 4.5..5.5: five squares a side.
    expect(box.width / ZOOM).toBeCloseTo(5);
    expect(box.height / ZOOM).toBeCloseTo(5);
    expect(config?.chip).toBe('5.0 × 5.0 sq');
  });

  it('one drawn wall’s box reads its length', () => {
    wall('w', [0, 0], [3.5, 0]);
    useStore.getState().setSelectedIds(['w']);
    const update = vi.spyOn(TransformGizmo.prototype, 'update');
    tool.updateGizmo();
    expect(update.mock.calls.at(-1)![1]?.chip).toBe('3.5 sq');
  });

  it('Alt press and release on a handle cycles instead of resizing', () => {
    floor('f', 0, 0, 4, 4);
    asset('p', 2, 2);
    click(tool, 2, 2);
    tool.updateGizmo();
    expect(sel()).toEqual(['p']);
    // The south-east corner handle of the prop's box.
    click(tool, 2.5, 2.5, { altKey: true });
    expect(sel()).toEqual(['f']);
    expect((find('p') as AssetChild).width).toBe(1);
    expect(undoManager.canUndo()).toBe(false);
  });

  it('Alt press on a handle that travels resizes about the centre', () => {
    asset('p', 2, 2);
    click(tool, 2, 2);
    tool.updateGizmo();
    drag(tool, [2.5, 2.5], [3, 3], { altKey: true });
    const p = find('p') as AssetChild;
    expect(sel()).toEqual(['p']);
    expect(p.width * p.scale).toBeGreaterThan(1.5);
    expect(p.position).toEqual({ x: 2, y: 2 });
    expect(undoManager.canUndo()).toBe(true);
  });
});
