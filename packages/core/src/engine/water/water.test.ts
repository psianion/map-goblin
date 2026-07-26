import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Clipper2 runs as WASM that is never loaded in unit tests; its real methods
// degrade to identity, which would hide whether the tool inflates at all.
// Stub it so river ribbons and lake winding are deterministic.
vi.mock('../../geometry/Clipper2Engine', () => ({
  clipper2Engine: {
    inflateOpen: vi.fn((paths: [number, number][][], delta: number) => {
      const path = paths[0];
      const [sx, sy] = path[0];
      const [ex, ey] = path[path.length - 1];
      return [[[sx, sy - delta], [ex, ey - delta], [ex, ey + delta], [sx, sy + delta]]];
    }),
    union: vi.fn((subjects: [number, number][][]) => subjects),
  },
}));

import { WaterTool } from '../tools/WaterTool';
import { clipper2Engine } from '../../geometry/Clipper2Engine';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { setNotify } from '../../store/notify';
import type { RenderEngine } from '../RenderEngine';
import type { WaterChild } from '../../shared/types';
import type { DungeonLayer } from '../../store/types';

// ─── Helpers ──────────────────────────────────────────────

/** Only rawWorld() touches the engine, and only when given a PointerEvent. */
function makeEngine(): RenderEngine {
  return {
    canvas: () => ({ getBoundingClientRect: () => ({ left: 10, top: 20 }) }),
    screenToWorld: (sx: number, sy: number) => ({ x: sx / 100, y: sy / 100 }),
  } as unknown as RenderEngine;
}

function dungeonLayer(): DungeonLayer {
  return useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
}

function waterChildren(): WaterChild[] {
  return dungeonLayer().children.filter((c): c is WaterChild => c.childType === 'water');
}

/** Freehand drag: down, moves, up. Points are world coords (no event → no snapping path). */
function dragRiver(tool: WaterTool, points: [number, number][]): void {
  tool.onPointerDown({ x: points[0][0], y: points[0][1] });
  for (const [x, y] of points.slice(1)) tool.onPointerMove({ x, y });
  tool.onPointerUp();
}

function clickLake(tool: WaterTool, points: [number, number][]): void {
  for (const [x, y] of points) tool.onPointerDown({ x, y });
}

function keyDown(tool: WaterTool, key: string): void {
  tool.onKeyDown({ key } as KeyboardEvent);
}

function makeWater(id: string, contour: [number, number][], extra?: Partial<WaterChild>): WaterChild {
  return {
    id,
    name: id,
    childType: 'water',
    visible: true,
    waterType: 'lake',
    contours: [contour],
    textureId: 'water-still-a-01',
    textureScale: 1,
    tint: '#9fc8e8',
    opacity: 0.9,
    bankTextureId: '',
    bankWidth: 0.5,
    flowSpeed: 0,
    flowAngle: 0,
    ...extra,
  };
}

const warnings: string[] = [];

beforeEach(() => {
  useStore.getState().resetToDefault();
  undoManager.clear();
  warnings.length = 0;
  setNotify({
    error: () => {},
    success: () => {},
    info: () => {},
    warning: (m: string) => warnings.push(m),
  });
  vi.clearAllMocks();
});

afterEach(() => {
  useStore.getState().setEraseMode(false);
});

// ─── River mode ───────────────────────────────────────────

describe('WaterTool — river mode', () => {
  it('a drag becomes a closed water body inflated to the configured width', () => {
    const tool = new WaterTool(makeEngine());
    useStore.getState().updateWaterSettings({ mode: 'river', width: 3 });

    dragRiver(tool, [[0, 0], [5, 0], [10, 0]]);

    const waters = waterChildren();
    expect(waters).toHaveLength(1);
    expect(waters[0].waterType).toBe('river');
    // Stroke is inflated by half the configured width, not left as a bare polyline.
    expect(clipper2Engine.inflateOpen).toHaveBeenCalledWith([[[0, 0], [5, 0], [10, 0]]], 1.5);
    expect(waters[0].contours[0]).toHaveLength(4);
  });

  it('flow angle follows the stroke direction', () => {
    const tool = new WaterTool(makeEngine());
    useStore.getState().updateWaterSettings({ mode: 'river' });

    dragRiver(tool, [[0, 0], [0, 5], [0, 10]]); // straight down = +Y

    expect(waterChildren()[0].flowAngle).toBeCloseTo(Math.PI / 2);
  });

  it('a stroke that never moved adds nothing', () => {
    const tool = new WaterTool(makeEngine());
    useStore.getState().updateWaterSettings({ mode: 'river' });

    tool.onPointerDown({ x: 4, y: 4 });
    tool.onPointerUp();

    expect(waterChildren()).toHaveLength(0);
  });

  it('collects points no denser than the spacing threshold', () => {
    const tool = new WaterTool(makeEngine());
    useStore.getState().updateWaterSettings({ mode: 'river' });

    // 0.1 apart — under RIVER_POINT_SPACING (0.3), so the middles are dropped.
    dragRiver(tool, [[0, 0], [0.1, 0], [0.2, 0], [0.5, 0]]);

    expect(clipper2Engine.inflateOpen).toHaveBeenCalledWith([[[0, 0], [0.5, 0]]], expect.any(Number));
  });

  it('right-click does not start a stroke', () => {
    const tool = new WaterTool(makeEngine());
    useStore.getState().updateWaterSettings({ mode: 'river' });

    tool.onPointerDown({ x: 0, y: 0 }, { button: 2 } as PointerEvent);
    tool.onPointerMove({ x: 5, y: 0 });
    tool.onPointerUp();

    expect(waterChildren()).toHaveLength(0);
  });

  it('recomputes raw world coords from the event, bypassing grid snap', () => {
    const tool = new WaterTool(makeEngine());
    useStore.getState().updateWaterSettings({ mode: 'river' });

    // The snapped point (0,0) is what the tool receives; the event says otherwise.
    tool.onPointerDown({ x: 0, y: 0 }, { button: 0, clientX: 110, clientY: 220 } as PointerEvent);
    tool.onPointerMove({ x: 0, y: 0 }, { clientX: 610, clientY: 220 } as PointerEvent);
    tool.onPointerUp();

    // (110-10)/100 = 1, (220-20)/100 = 2 — unsnapped, not the (0,0) handed in.
    expect(clipper2Engine.inflateOpen).toHaveBeenCalledWith([[[1, 2], [6, 2]]], expect.any(Number));
  });
});

// ─── Lake mode ────────────────────────────────────────────

describe('WaterTool — lake mode', () => {
  beforeEach(() => useStore.getState().updateWaterSettings({ mode: 'lake' }));

  it('Enter closes a polygon of three or more vertices', () => {
    const tool = new WaterTool(makeEngine());

    clickLake(tool, [[0, 0], [4, 0], [4, 4]]);
    keyDown(tool, 'Enter');

    const waters = waterChildren();
    expect(waters).toHaveLength(1);
    expect(waters[0].waterType).toBe('lake');
    expect(waters[0].contours[0]).toHaveLength(3);
  });

  it('lakes are still — flow speed is zeroed even when the brush has one', () => {
    const tool = new WaterTool(makeEngine());
    useStore.getState().updateWaterSettings({ flowSpeed: 0.9 });

    clickLake(tool, [[0, 0], [4, 0], [4, 4]]);
    keyDown(tool, 'Enter');

    expect(waterChildren()[0].flowSpeed).toBe(0);
  });

  it('winding is normalized through clipper so bank normals face outward', () => {
    const tool = new WaterTool(makeEngine());

    clickLake(tool, [[0, 0], [4, 0], [4, 4]]);
    keyDown(tool, 'Enter');

    expect(clipper2Engine.union).toHaveBeenCalledWith([[[0, 0], [4, 0], [4, 4]]], []);
  });

  it('Enter with fewer than three vertices adds nothing', () => {
    const tool = new WaterTool(makeEngine());

    clickLake(tool, [[0, 0], [4, 0]]);
    keyDown(tool, 'Enter');

    expect(waterChildren()).toHaveLength(0);
  });

  it('Escape discards an in-progress polygon', () => {
    const tool = new WaterTool(makeEngine());

    clickLake(tool, [[0, 0], [4, 0], [4, 4]]);
    expect(tool.isActive()).toBe(true);

    keyDown(tool, 'Escape');

    expect(tool.isActive()).toBe(false);
    expect(tool.getPreview()).toBeNull();
    keyDown(tool, 'Enter'); // the discarded vertices must not resurface
    expect(waterChildren()).toHaveLength(0);
  });

  it('preview is an open line under three vertices and a polygon at three', () => {
    const tool = new WaterTool(makeEngine());

    clickLake(tool, [[0, 0], [4, 0]]);
    expect(tool.getPreview()?.type).toBe('line');

    clickLake(tool, [[4, 4]]);
    expect(tool.getPreview()?.type).toBe('polygon');
  });
});

// ─── Layer guard, naming, undo ────────────────────────────

describe('WaterTool — layer handling', () => {
  it('warns and draws nothing when the active layer is not a dungeon layer', () => {
    const tool = new WaterTool(makeEngine());
    const bg = useStore.getState().layers.find((l) => l.type !== 'dungeon')!;
    useStore.getState().setActiveLayerId(bg.id);
    useStore.getState().updateWaterSettings({ mode: 'river' });

    dragRiver(tool, [[0, 0], [5, 0]]);

    expect(waterChildren()).toHaveLength(0);
    expect(warnings).toContain('Select a dungeon layer to draw water');
  });

  it('names bodies by kind and running count within the layer', () => {
    const tool = new WaterTool(makeEngine());
    useStore.getState().updateWaterSettings({ mode: 'river' });
    dragRiver(tool, [[0, 0], [5, 0]]);
    dragRiver(tool, [[0, 5], [5, 5]]);

    useStore.getState().updateWaterSettings({ mode: 'lake' });
    clickLake(tool, [[0, 0], [4, 0], [4, 4]]);
    keyDown(tool, 'Enter');

    expect(waterChildren().map((w) => w.name)).toEqual(['River 1', 'River 2', 'Lake 3']);
  });

  it('drawing is undoable and redoable', () => {
    const tool = new WaterTool(makeEngine());
    useStore.getState().updateWaterSettings({ mode: 'river' });

    dragRiver(tool, [[0, 0], [5, 0]]);
    expect(waterChildren()).toHaveLength(1);

    undoManager.undo();
    expect(waterChildren()).toHaveLength(0);

    undoManager.redo();
    expect(waterChildren()).toHaveLength(1);
  });
});

// ─── Erase ────────────────────────────────────────────────

describe('WaterTool — erase mode', () => {
  const square: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];

  beforeEach(() => useStore.getState().setEraseMode(true));

  it('removes the body under the cursor', () => {
    const tool = new WaterTool(makeEngine());
    useStore.getState().addChild(dungeonLayer().id, makeWater('w1', square));

    tool.onPointerDown({ x: 5, y: 5 });

    expect(waterChildren()).toHaveLength(0);
  });

  it('leaves bodies alone when the click misses', () => {
    const tool = new WaterTool(makeEngine());
    useStore.getState().addChild(dungeonLayer().id, makeWater('w1', square));

    tool.onPointerDown({ x: 50, y: 50 });

    expect(waterChildren()).toHaveLength(1);
  });

  it('erases the topmost overlapping body only', () => {
    const tool = new WaterTool(makeEngine());
    const layerId = dungeonLayer().id;
    useStore.getState().addChild(layerId, makeWater('bottom', square));
    useStore.getState().addChild(layerId, makeWater('top', square));

    tool.onPointerDown({ x: 5, y: 5 });

    expect(waterChildren().map((w) => w.id)).toEqual(['bottom']);
  });

  it('skips hidden bodies', () => {
    const tool = new WaterTool(makeEngine());
    useStore.getState().addChild(dungeonLayer().id, makeWater('w1', square, { visible: false }));

    tool.onPointerDown({ x: 5, y: 5 });

    expect(waterChildren()).toHaveLength(1);
  });

  it('erasing is undoable', () => {
    const tool = new WaterTool(makeEngine());
    useStore.getState().addChild(dungeonLayer().id, makeWater('w1', square));

    tool.onPointerDown({ x: 5, y: 5 });
    expect(waterChildren()).toHaveLength(0);

    undoManager.undo();
    expect(waterChildren()).toHaveLength(1);
  });
});
