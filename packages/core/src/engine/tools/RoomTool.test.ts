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

  it('never reuses the name of a room that has been removed', () => {
    trace(LOOP);
    trace(LOOP.map(([x, y]): [number, number] => [x + 10, y]));
    useStore.getState().removeChild(layerId, roomsOf(layerId)[0].id);

    trace(LOOP.map(([x, y]): [number, number] => [x + 20, y]));
    expect(roomsOf(layerId).map((r) => r.name)).toEqual(['Room 2', 'Room 3']);
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

  it('throws away a near-straight drag rather than committing a sliver room', () => {
    // A 5×0.24 ribbon: its wiggle clears MIN_AREA (1.2) but its mean width is
    // under a quarter cell — the live-walk sliver, as a fixture.
    trace([[0, 0], [2, 0], [5, 0], [5, 0.24], [2, 0.24], [0, 0.24]]);
    expect(roomsOf(layerId)).toHaveLength(0);

    // The narrowest honest corridor still commits: half a cell wide.
    trace([[0, 2], [3, 2], [6, 2], [6, 2.6], [3, 2.6], [0, 2.6]]);
    expect(roomsOf(layerId)).toHaveLength(1);
  });

  /**
   * Every vertex of a committed room becomes a boundary occluder (O1), and the raw trace is
   * one vertex every 0.2wu: eight rooms and eight joints traced by hand came out at 2640
   * occluder walls with `extractWallSegments` at 20ms cold. The trace is simplified on
   * commit, which is the loop the DM drew to within less than the width of the line it is
   * drawn with.
   */
  it('thins a hand-jittery trace to a ring the sweep can walk', () => {
    const R = 6;
    const STEPS = 160;
    const jittery: [number, number][] = [];
    for (let i = 0; i < STEPS; i++) {
      const a = (i / STEPS) * Math.PI * 2;
      const r = R + (i % 2 ? 0.05 : -0.05);
      jittery.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    trace(jittery);

    const ring = roomsOf(layerId)[0].contours[0];
    expect(ring.length).toBeLessThan(STEPS / 3);
    // Still a loop, and still that loop: an implicitly-closed ring enclosing the same area.
    expect(ring.length).toBeGreaterThan(6);
    const area =
      Math.abs(
        ring.reduce((sum, [x, y], i) => {
          const [nx, ny] = ring[(i + 1) % ring.length];
          return sum + x * ny - nx * y;
        }, 0),
      ) / 2;
    expect(area).toBeGreaterThan(Math.PI * R * R * 0.9);
    expect(area).toBeLessThan(Math.PI * R * R * 1.05);
  });

  /**
   * Entering the outline editor is the room tool's second half: a press inside a room
   * edits it, a press on ground draws a new one.
   *
   * The releases below are called without a matching press on purpose — that is what the
   * app does. Once `shapeNodeEditId` is set the canvas answers every pointerdown itself
   * (handle hits become outline drags, misses are swallowed) and no tool hears it; the
   * release still comes through, and it is the only part of that gesture this tool sees.
   */
  describe('editing a room that is already there', () => {
    /** Two rooms side by side, neither overlapping the other. */
    function twoRooms(): [RoomChild, RoomChild] {
      trace(LOOP);
      trace(LOOP.map(([x, y]): [number, number] => [x + 10, y]));
      const rooms = roomsOf(layerId);
      return [rooms[0], rooms[1]];
    }

    const nodeEditId = () => useStore.getState().tools.shapeNodeEditId;

    it('brings a room’s corners up on a press inside it, and traces nothing', () => {
      const [room] = twoRooms();

      tool.onPointerDown({ x: 2, y: 2 });
      tool.onPointerUp({ x: 2, y: 2 });

      expect(nodeEditId()).toBe(room.id);
      // The mode owns the screen: setShapeNodeEdit drops the selection so the gizmo
      // is not drawn around the room whose corners are up.
      expect(useStore.getState().selection.selectedIds).toEqual([]);
      expect(roomsOf(layerId)).toHaveLength(2);
    });

    it('moves the edit to the other room in one press', () => {
      const [first, second] = twoRooms();
      tool.onPointerDown({ x: 2, y: 2 });
      tool.onPointerUp({ x: 2, y: 2 });
      expect(nodeEditId()).toBe(first.id);

      tool.onPointerUp({ x: 12, y: 2 });

      expect(nodeEditId()).toBe(second.id);
    });

    it('puts the room down on a press off the ring, without starting a loop', () => {
      const [first] = twoRooms();
      tool.onPointerDown({ x: 2, y: 2 });
      tool.onPointerUp({ x: 2, y: 2 });
      expect(nodeEditId()).toBe(first.id);

      tool.onPointerUp({ x: 30, y: 30 });

      expect(nodeEditId()).toBeNull();
      expect(tool.isActive()).toBe(false);
      expect(roomsOf(layerId)).toHaveLength(2);
    });

    /**
     * The insert marker sits on the edge itself, so half its pick radius is outside the
     * ring. Exiting there would drop the DM out of the mode on the click that added a
     * vertex.
     */
    it('stays in the mode for a press that merely brushed the outline', () => {
      const [first] = twoRooms();
      tool.onPointerDown({ x: 2, y: 2 });
      tool.onPointerUp({ x: 2, y: 2 });

      tool.onPointerUp({ x: -0.2, y: 2 });

      expect(nodeEditId()).toBe(first.id);
    });

    it('still traces a new loop from ground no room covers', () => {
      twoRooms();
      trace(LOOP.map(([x, y]): [number, number] => [x + 20, y]));

      expect(roomsOf(layerId)).toHaveLength(3);
      expect(useStore.getState().tools.shapeNodeEditId).toBeNull();
    });
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
