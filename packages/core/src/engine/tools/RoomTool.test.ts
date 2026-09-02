import { describe, it, expect, beforeEach } from 'vitest';
import { RoomTool } from './RoomTool';
import { useStore } from '../../store/store';
import { undoManager } from '../../store/undoManager';
import { setNotify } from '../../store/notify';
import type { DungeonLayer, RoomChild } from '../../store/types';
import { vi } from 'vitest';

function layerById(id: string): DungeonLayer {
  const l = useStore.getState().layers.find((x): x is DungeonLayer => x.id === id);
  if (!l || l.type !== 'dungeon') throw new Error(`no dungeon layer ${id}`);
  return l;
}

function roomsOf(id: string): RoomChild[] {
  return layerById(id).children.filter((c): c is RoomChild => c.childType === 'room');
}

/** A square loop, traced one sample at a time the way a freehand drag arrives. */
const LOOP: [number, number][] = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
];

describe('RoomTool', () => {
  let tool: RoomTool;
  let layerId: string;

  beforeEach(() => {
    undoManager.clear();
    useStore.getState().resetToDefault();
    setNotify({ warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() });
    tool = new RoomTool();
    layerId = useStore.getState().layers.find((l) => l.type === 'dungeon')!.id;
    useStore.getState().setActiveLayerId(layerId);
  });

  function trace(points: [number, number][]): void {
    tool.onPointerDown({ x: points[0][0], y: points[0][1] });
    for (const [x, y] of points.slice(1, -1)) tool.onPointerMove({ x, y });
    const last = points[points.length - 1];
    tool.onPointerUp({ x: last[0], y: last[1] });
  }

  it('closes the freehand loop on release and commits one RoomChild', () => {
    trace(LOOP);

    const rooms = roomsOf(layerId);
    expect(rooms).toHaveLength(1);
    // Implicitly closed: the release point is the last vertex, not a repeat of the first.
    expect(rooms[0].contours[0]).toEqual(LOOP);
    expect(rooms[0].name).toBe('Room 1');
    expect(useStore.getState().selection.selectedIds).toEqual([rooms[0].id]);
  });

  it('mints a fresh uuid per room and numbers the names in order', () => {
    trace(LOOP);
    trace(LOOP.map(([x, y]): [number, number] => [x + 10, y]));

    const rooms = roomsOf(layerId);
    expect(rooms.map((r) => r.name)).toEqual(['Room 1', 'Room 2']);
    expect(rooms[0].id).not.toBe(rooms[1].id);
  });

  it('undoes the placement as one entry', () => {
    trace(LOOP);
    undoManager.undo();
    expect(roomsOf(layerId)).toHaveLength(0);
  });

  it('cancels the in-progress loop on Escape and commits nothing', () => {
    tool.onPointerDown({ x: 0, y: 0 });
    tool.onPointerMove({ x: 4, y: 0 });
    tool.onPointerMove({ x: 4, y: 4 });
    expect(tool.isActive()).toBe(true);

    tool.onKeyDown({ key: 'Escape' } as KeyboardEvent);

    expect(tool.isActive()).toBe(false);
    expect(tool.getPreview()).toBeNull();
    tool.onPointerUp({ x: 0, y: 4 });
    expect(roomsOf(layerId)).toHaveLength(0);
  });

  it('throws away a click with no drag rather than committing a dot room', () => {
    tool.onPointerDown({ x: 2, y: 2 });
    tool.onPointerUp({ x: 2, y: 2 });

    expect(roomsOf(layerId)).toHaveLength(0);
  });

  it('previews the loop it will commit while the stroke is live', () => {
    tool.onPointerDown({ x: 0, y: 0 });
    tool.onPointerMove({ x: 4, y: 0 });

    expect(tool.getPreview()).toEqual({
      type: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
      ],
    });
  });
});
