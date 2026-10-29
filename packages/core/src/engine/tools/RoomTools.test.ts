import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../../geometry/Clipper2Engine';
import { RoomPolygonTool, RoomRectTool } from './RoomTools';
import { DivideTool, roomSplitBy, seedDivideStart, splitFace } from './DivideTool';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { setNotify } from '../../store/notify';
import type { DungeonLayer, ShapeChild } from '../../store/types';
import { refreshRooms } from '../../store/roomRefresh';

// jsdom sends emscripten down the browser path; hand it the bytes directly.
beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

function active(): DungeonLayer {
  const s = useStore.getState();
  const l = s.layers.find((x) => x.id === s.ui.activeLayerId);
  if (!l || l.type !== 'dungeon') throw new Error('no active dungeon layer');
  return l;
}

const shapes = (l: DungeonLayer): ShapeChild[] => l.children.filter((c): c is ShapeChild => c.childType === 'shape');

beforeEach(() => {
  undoManager.clear();
  useStore.getState().resetToDefault();
  setNotify({ warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() });
  const first = useStore.getState().layers.find((l) => l.type === 'dungeon')!;
  useStore.getState().setActiveLayerId(first.id);
  seedDivideStart(null);
  // View prefs survive a reset (they are per browser), so each test states its own.
  useStore.getState().setDividerMode('threshold');
  useStore.getState().setRoomWalls('with');
  useStore.getState().setEraseMode(false);
});

describe('RoomRectTool', () => {
  it('lands the floor and a numbered room anchored inside it as one undo step', () => {
    const tool = new RoomRectTool();
    tool.onPointerDown({ x: 0, y: 0 });
    tool.onPointerMove({ x: 6, y: 4 });
    tool.onPointerUp({ x: 6, y: 4 });

    const layer = active();
    expect(shapes(layer)).toHaveLength(1);
    expect(layer.rooms).toHaveLength(1);
    const room = layer.rooms![0];
    expect(room.name).toBe('Room 1');
    expect(room.number).toBe(1);
    expect(room.anchor).toEqual([3, 2]);
    expect(shapes(layer)[0].name).toBe('Room 1 floor');

    undoManager.undo();
    expect(shapes(active())).toHaveLength(0);
    expect(active().rooms ?? []).toHaveLength(0);
  });

  it('numbers the next room one past the highest', () => {
    const tool = new RoomRectTool();
    tool.onPointerDown({ x: 0, y: 0 });
    tool.onPointerUp({ x: 4, y: 4 });
    tool.onPointerDown({ x: 10, y: 0 });
    tool.onPointerUp({ x: 14, y: 4 });
    expect(active().rooms!.map((r) => [r.name, r.number])).toEqual([
      ['Room 1', 1],
      ['Room 2', 2],
    ]);
  });

  it('with Walls set to None the floor is pinned to no stones', () => {
    useStore.getState().setRoomWalls('none');
    const tool = new RoomRectTool();
    tool.onPointerDown({ x: 0, y: 0 });
    tool.onPointerUp({ x: 4, y: 4 });
    expect(shapes(active())[0].styleOverrides?.wallTextureSetId).toBe('');
  });

  it('draws even with the erase toggle on', () => {
    useStore.getState().setEraseMode(true);
    const tool = new RoomRectTool();
    tool.onPointerDown({ x: 0, y: 0 });
    tool.onPointerUp({ x: 4, y: 4 });
    expect(shapes(active())).toHaveLength(1);
    expect(active().rooms).toHaveLength(1);
  });
});

describe('RoomPolygonTool', () => {
  it('anchors an L-shaped room inside the L, not at its hollow centroid', () => {
    const tool = new RoomPolygonTool();
    for (const p of [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 6 },
      { x: 0, y: 6 },
    ]) {
      tool.onPointerDown(p);
      tool.onPointerUp(p);
    }
    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));
    const layer = active();
    expect(layer.rooms).toHaveLength(1);
    const [x, y] = layer.rooms![0].anchor;
    const inL = (x >= 0 && x <= 6 && y >= 0 && y <= 1) || (x >= 0 && x <= 1 && y >= 0 && y <= 6);
    expect(inL).toBe(true);
  });
});

/** A 10×4 floor with one room on it, faces synced. */
function hall(): DungeonLayer {
  const tool = new RoomRectTool();
  tool.onPointerDown({ x: 0, y: 0 });
  tool.onPointerUp({ x: 10, y: 4 });
  refreshRooms();
  return active();
}

describe('splitFace / roomSplitBy', () => {
  it('a wall-to-wall line cuts a face in two, larger half first', () => {
    const face: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 4],
      [0, 4],
    ];
    const halves = splitFace(face, { id: 't', points: [[3, 0], [3, 4]] });
    expect(halves).not.toBeNull();
    const xs = (r: [number, number][]) => r.map((p) => p[0]);
    expect(Math.max(...xs(halves![0]))).toBeCloseTo(10, 3);
    expect(Math.min(...xs(halves![1]))).toBeCloseTo(0, 3);
  });

  it('a line that stops short of a wall does not split', () => {
    const face: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 4],
      [0, 4],
    ];
    expect(splitFace(face, { id: 't', points: [[3, 0], [3, 2]] })).toBeNull();
  });

  it('finds the room the line crosses', () => {
    const layer = hall();
    const hit = roomSplitBy(layer, { id: 't', points: [[5, 0], [5, 4]] });
    expect(hit?.room.id).toBe(layer.rooms![0].id);
  });
});

describe('DivideTool', () => {
  it('a line cutting a room in two waits for the split dialog, writing nothing', () => {
    const layer = hall();
    const tool = new DivideTool();
    tool.onPointerDown({ x: 4, y: 0 });
    tool.onPointerMove({ x: 4, y: 4 });
    tool.onPointerUp({ x: 4, y: 4 });

    const split = useStore.getState().ui.pendingSplit;
    expect(split).not.toBeNull();
    expect(split!.layerId).toBe(layer.id);
    expect(split!.roomId).toBe(layer.rooms![0].id);
    expect(split!.threshold.points).toEqual([
      [4, 0],
      [4, 4],
    ]);
    expect(split!.halves).toHaveLength(2);
    expect(active().thresholds ?? []).toHaveLength(0);
  });

  it('a line through no room adds a threshold, one undo step', () => {
    const tool = new DivideTool();
    tool.onPointerDown({ x: 20, y: 0 });
    tool.onPointerUp({ x: 20, y: 4 });
    expect(useStore.getState().ui.pendingSplit).toBeNull();
    expect(active().thresholds).toHaveLength(1);
    undoManager.undo();
    expect(active().thresholds ?? []).toHaveLength(0);
  });

  it('in Wall mode it draws a real wall', () => {
    useStore.getState().setDividerMode('wall');
    hall();
    const tool = new DivideTool();
    tool.onPointerDown({ x: 4, y: 0 });
    tool.onPointerUp({ x: 4, y: 4 });
    expect(useStore.getState().ui.pendingSplit).toBeNull();
    expect(active().standaloneWalls).toHaveLength(1);
    expect(active().standaloneWalls[0].points).toEqual([
      [4, 0],
      [4, 4],
    ]);
  });

  it('a click starts a line the next click ends; Split here seeds the first point', () => {
    const tool = new DivideTool();
    tool.onPointerDown({ x: 20, y: 0 });
    tool.onPointerUp({ x: 20, y: 0 });
    expect(tool.isActive()).toBe(true);
    tool.onPointerDown({ x: 20, y: 4 });
    expect(active().thresholds).toHaveLength(1);

    seedDivideStart({ x: 30, y: 0 });
    tool.onPointerMove({ x: 30, y: 2 });
    expect(tool.getPreview()?.points[0]).toEqual({ x: 30, y: 0 });
    tool.onPointerDown({ x: 30, y: 4 });
    expect(active().thresholds).toHaveLength(2);
  });

  it('Escape drops the line', () => {
    const tool = new DivideTool();
    tool.onPointerDown({ x: 20, y: 0 });
    tool.onPointerUp({ x: 20, y: 0 });
    tool.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(tool.isActive()).toBe(false);
    expect(tool.getPreview()).toBeNull();
  });
});
