import { describe, it, expect } from 'vitest';
import { edgeRoom, edgeStyles, ringStyles, roomsPinWalls, roomWallPins } from './wallLook';
import { createDungeonLayer } from '../store/factories';
import type { DungeonLayer, Room } from '../store/types';

/*
 * Per-edge wall styles: an outline edge draws with the look of the room on its floor
 * side. With no room or area pinning a wall key — nearly every map — every ring answers
 * null and the renderers keep the per-ring path untouched.
 */

const square = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** One 20×10 floor ring, split down x = 10 into two rooms. */
function layer(rooms: Room[], extra: Partial<DungeonLayer> = {}): DungeonLayer {
  const base = createDungeonLayer('L', 'level');
  return {
    ...base,
    // Ring edges: 0 top-left→top-mid, 1 top-mid→top-right, 2 right side,
    // 3 bottom-right→bottom-mid, 4 bottom-mid→bottom-left, 5 left side.
    mergedFloor: [
      [
        [0, 0],
        [10, 0],
        [20, 0],
        [20, 10],
        [10, 10],
        [0, 10],
      ],
    ],
    rooms,
    ...extra,
  };
}

const west = (look?: Room['look'], areaId?: string): Room => ({
  id: 'west',
  name: 'West',
  anchor: [5, 5],
  face: square(0, 0, 10, 10),
  ...(look ? { look } : {}),
  ...(areaId ? { areaId } : {}),
});
const east: Room = { id: 'east', name: 'East', anchor: [15, 5], face: square(10, 0, 20, 10) };

describe('edgeStyles', () => {
  it('with no wall pins every ring answers null (the per-ring path)', () => {
    const l = layer([west({ floorTint: '#ff0000' }), east]);
    expect(roomsPinWalls(l)).toBe(false);
    expect(edgeStyles(l)).toEqual([null]);
  });

  it('a room pinning a wall tint styles only the edges bounding its floor', () => {
    const l = layer([west({ wallTextureTint: '#00ff00' }), east]);
    const [edges] = edgeStyles(l);
    expect(edges).not.toBeNull();
    const ring = ringStyles(l)[0];
    expect(edges!.map((s) => s.wallTextureTint)).toEqual([
      '#00ff00',
      ring.wallTextureTint,
      ring.wallTextureTint,
      ring.wallTextureTint,
      '#00ff00',
      '#00ff00',
    ]);
    // Edges that resolve alike share one style object: renderers batch by identity.
    expect(edges![0]).toBe(edges![4]);
    expect(edges![1]).toBe(ring);
  });

  it("an area's pin reaches its rooms, and a room's own pin wins over it", () => {
    const areas = [{ id: 'a', name: 'Wing', look: { wallTextureTint: '#0000ff', wallWidth: 0.8 } }];
    const room = west({ wallTextureTint: '#ff00ff' }, 'a');
    expect(roomWallPins(room, areas)).toEqual({ wallTextureTint: '#ff00ff', wallWidth: 0.8 });
    const l = layer([room, { ...east, areaId: 'a' }], { areas });
    const [edges] = edgeStyles(l);
    expect(edges![0].wallTextureTint).toBe('#ff00ff');
    expect(edges![1].wallTextureTint).toBe('#0000ff');
    expect(edges![1].wallWidth).toBe(0.8);
  });

  it('is memoised on the layer inputs', () => {
    const l = layer([west({ wallTextureTint: '#00ff00' }), east]);
    expect(edgeStyles(l)).toBe(edgeStyles(l));
  });

  it("an edge's room is probed just inside the floor; an orphan claims nothing", () => {
    const rooms = [west(), east];
    expect(edgeRoom(rooms, [0, 0], [10, 0])?.id).toBe('west');
    expect(edgeRoom(rooms, [20, 0], [20, 10])?.id).toBe('east');
    expect(edgeRoom([{ ...east, orphaned: true }], [20, 0], [20, 10])).toBeNull();
  });
});
