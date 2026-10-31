import { describe, it, expect, beforeEach } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { SelectTool } from './SelectTool';
import { getWallBounds, wallReach } from '../hitTest';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import type { RenderEngine } from '../RenderEngine';
import type { DungeonLayer } from '../../store/types';
import type { DoorChild, ShapeChild, WallSegment } from '../../shared/types';

// Same stand-in engine as SelectTool.test.ts: 50 screen px per world unit.
const ZOOM = 50;

if (typeof (globalThis as { CanvasRenderingContext2D?: unknown }).CanvasRenderingContext2D === 'undefined') {
  (globalThis as { CanvasRenderingContext2D?: unknown }).CanvasRenderingContext2D = class {};
}
const fakeCtx2D = new Proxy(
  {},
  {
    get: (target: Record<string, unknown>, prop) =>
      prop in target ? target[prop as string] : () => ({ width: 0, height: 0 }),
    set: (target: Record<string, unknown>, prop, value) => {
      target[prop as string] = value;
      return true;
    },
  },
);
HTMLCanvasElement.prototype.getContext = (() => fakeCtx2D) as unknown as typeof HTMLCanvasElement.prototype.getContext;

function makeEngine(overlay = new Container()): RenderEngine {
  const rect = { left: 0, top: 0 } as DOMRect;
  return {
    overlay: () => overlay,
    canvas: () => ({ getBoundingClientRect: () => rect }) as unknown as HTMLCanvasElement,
    stage: () => ({ scale: { x: ZOOM, y: ZOOM } }) as unknown as Container,
    worldToScreen: (wx: number, wy: number) => ({ x: wx * ZOOM, y: wy * ZOOM }),
  } as unknown as RenderEngine;
}

function ev(world: { x: number; y: number }, extra: Partial<PointerEvent> = {}): PointerEvent {
  return {
    clientX: world.x * ZOOM,
    clientY: world.y * ZOOM,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...extra,
  } as PointerEvent;
}

function click(tool: SelectTool, x: number, y: number, extra: Partial<PointerEvent> = {}): void {
  tool.onPointerDown({ x, y }, ev({ x, y }, extra));
  tool.onPointerUp({ x, y }, ev({ x, y }, extra));
}

function layer(): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.type === 'dungeon');
  if (!l) throw new Error('default state has no dungeon layer');
  return l;
}

function addWall(id: string, points: [number, number][]): WallSegment {
  const w: WallSegment = { id, points, wallType: 'normal', direction: 'both', color: '#000000', roughness: 0 };
  useStore.getState().addWall(layer().id, w);
  return w;
}

function addFloor(id: string): ShapeChild {
  const s: ShapeChild = {
    id,
    name: 'Floor',
    childType: 'shape',
    shapeType: 'polygon',
    visible: true,
    contours: [[[0, 0], [20, 0], [20, 20], [0, 20]]],
    roughnessEnabled: false,
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
  };
  useStore.getState().addChild(layer().id, s);
  return s;
}

function addDoor(id: string, position: [number, number], wallId: string): DoorChild {
  const d: DoorChild = {
    id,
    name: 'Door',
    childType: 'door',
    visible: true,
    wallId,
    position,
    angle: 0,
    width: 1,
    style: 'single',
    state: 'closed',
    isSecret: false,
  };
  useStore.getState().addChild(layer().id, d);
  return d;
}

const selected = () => useStore.getState().selection.selectedIds;

describe('SelectTool: drawn walls', () => {
  let tool: SelectTool;
  let overlay: Container;

  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    overlay = new Container();
    tool = new SelectTool(makeEngine(overlay));
  });

  it('a click on a drawn wall selects it, over the floor under it', () => {
    addFloor('floor');
    addWall('w', [[2, 10], [18, 10]]);
    click(tool, 9, 10.1);
    expect(selected()).toEqual(['w']);
  });

  it('a click beside the wall gets the floor, not the wall', () => {
    addFloor('floor');
    addWall('w', [[2, 10], [18, 10]]);
    click(tool, 9, 12);
    expect(selected()).toEqual(['floor']);
  });

  it('a door on the wall still wins', () => {
    addWall('w', [[2, 10], [18, 10]]);
    addDoor('d', [9, 10], 'w');
    click(tool, 9, 10);
    expect(selected()).toEqual(['d']);
  });

  it('Shift adds a wall to the selection and takes it back out', () => {
    addFloor('floor');
    addWall('w', [[2, 10], [18, 10]]);
    click(tool, 5, 5);
    click(tool, 9, 10, { shiftKey: true });
    expect(selected()).toEqual(['floor', 'w']);
    click(tool, 9, 10, { shiftKey: true });
    expect(selected()).toEqual(['floor']);
  });

  it('Ctrl takes the whole layer, its drawn walls with it', () => {
    addFloor('floor');
    addWall('w1', [[2, 10], [18, 10]]);
    addWall('w2', [[2, 15], [18, 15]]);
    click(tool, 9, 10, { ctrlKey: true });
    expect(new Set(selected())).toEqual(new Set(['floor', 'w1', 'w2']));
  });

  it('a press on a selected wall drags the whole selection with it, in one undo step', () => {
    const floor = addFloor('floor');
    addWall('w', [[2, 10], [18, 10]]);
    click(tool, 5, 5);
    click(tool, 9, 10, { shiftKey: true });
    // Walls move like everything else now: the floor and the wall go together.
    tool.onPointerDown({ x: 9, y: 10 }, ev({ x: 9, y: 10 }));
    tool.onPointerMove({ x: 12, y: 13 }, ev({ x: 12, y: 13 }));
    tool.onPointerUp({ x: 12, y: 13 }, ev({ x: 12, y: 13 }));
    const after = layer().children.find((c) => c.id === floor.id) as ShapeChild;
    expect(after.contours[0][0]).toEqual([floor.contours[0][0][0] + 3, floor.contours[0][0][1] + 3]);
    expect(layer().standaloneWalls.find((w) => w.id === 'w')!.points).toEqual([[5, 13], [21, 13]]);
    undoManager.undo();
    expect(undoManager.canUndo()).toBe(false);
    expect(layer().standaloneWalls.find((w) => w.id === 'w')!.points).toEqual([[2, 10], [18, 10]]);
  });

  it('hovering a wall sets it as the hovered id and outlines it at once', () => {
    addWall('w', [[2, 10], [18, 10]]);
    tool.onPointerMove({ x: 9, y: 10.1 }, ev({ x: 9, y: 10.1 }));
    expect(useStore.getState().selection.hoveredId).toBe('w');
    const hover = overlay.children.find((c) => c.label === 'selectHover') as Graphics;
    expect(hover.bounds.width).toBeGreaterThan(0);
  });

  it('a selected wall gets an outline every frame, and loses it when deselected', () => {
    addWall('w', [[2, 10], [18, 10]]);
    click(tool, 9, 10);
    tool.updateGizmo();
    const g = overlay.children.find((c) => c.label === 'selectWalls') as Graphics;
    expect(g.bounds.width).toBeGreaterThan(0);
    useStore.getState().setSelectedIds([]);
    tool.updateGizmo();
    expect(g.bounds.width).toBe(0);
  });

  it('a wall-only selection gets the same box as everything else, handles at its corners', () => {
    const w = addWall('w', [[2, 10], [18, 10]]);
    click(tool, 9, 10);
    tool.updateGizmo();
    const b = getWallBounds(w, wallReach(w, layer()));
    expect(tool.getHoverCursor((b.x + b.width) * ZOOM, (b.y + b.height) * ZOOM)).not.toBeNull();
  });

  it('the marquee takes a wall it crosses, not a loop it sits inside', () => {
    addWall('line', [[2, 10], [18, 10]]);
    addWall('loop', [[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]]);
    tool.onPointerDown({ x: 8, y: 8 }, ev({ x: 8, y: 8 }));
    tool.onPointerUp({ x: 12, y: 12 }, ev({ x: 12, y: 12 }));
    expect(selected()).toEqual(['line']);
  });

  it('a wall on a locked layer is not picked', () => {
    addWall('w', [[2, 10], [18, 10]]);
    useStore.getState().updateLayer(layer().id, { locked: true });
    click(tool, 9, 10);
    expect(selected()).toEqual([]);
  });

  it('walls switched off on the layer are not picked', () => {
    addWall('w', [[2, 10], [18, 10]]);
    useStore.getState().setSublayerVisibility(layer().id, 'walls', false);
    click(tool, 9, 10);
    expect(selected()).toEqual([]);
  });
});
