import type { DungeonLayer } from '../store/types';
import type { Room } from './types';
import type { WorldBounds } from './mapBounds';
import { roomFaces } from '../engine/roomDetection';
import { computeMergedFloor } from '../engine/mergedFloor';
import { ROOM_GRID_SIZE } from '../store/roomSync';
import { interiorPoint, nextRoomNumber, pointInRing, readingOrder, roomFace } from './roomUtils';

/** How close a face's edge may come to the frame before it counts as the outside. */
const FRAME_EPSILON = 1e-3;

/**
 * Rooms the layer's geometry implies but nobody has placed yet: one per face of
 * (floor − walls − thresholds) that holds no room's anchor. Existing rooms are
 * never touched. Pure; the editor keeps the result in `ui.roomSuggestions` as
 * ghosts and `AcceptRoomsCommand` adds the ones the DM keeps.
 *
 * A walls-only import has no floor to cut. There the map frame stands in for the
 * floor, and the face left touching the frame — the outside of every wall — is
 * dropped, so what remains is what the walls enclose.
 *
 * Each suggestion gets a uuid, the next free number and the name `Room N`, and is
 * anchored at a point inside its face, numbered in reading order.
 */
export function suggestRooms(layer: DungeonLayer, frame: WorldBounds | null): Room[] {
  const mergedFloor = layer.mergedFloor ?? computeMergedFloor(layer) ?? [];
  const wallsOnly = mergedFloor.length === 0;
  if (wallsOnly && !frame) return [];
  const floor = wallsOnly
    ? [
        [
          [frame!.minX, frame!.minY],
          [frame!.maxX, frame!.minY],
          [frame!.maxX, frame!.maxY],
          [frame!.minX, frame!.maxY],
        ] as [number, number][],
      ]
    : mergedFloor;
  let faces = roomFaces(
    floor,
    layer.standaloneWalls,
    ROOM_GRID_SIZE,
    layer.style?.wallWidth ?? 0,
    layer.thresholds ?? [],
  );
  if (wallsOnly) {
    faces = faces.filter((face) =>
      face.every(
        ([x, y]) =>
          x > frame!.minX + FRAME_EPSILON &&
          x < frame!.maxX - FRAME_EPSILON &&
          y > frame!.minY + FRAME_EPSILON &&
          y < frame!.maxY - FRAME_EPSILON,
      ),
    );
  }

  const rooms = layer.rooms ?? [];
  const held = (face: [number, number][]): boolean =>
    rooms.some(
      (r) =>
        pointInRing(r.anchor[0], r.anchor[1], face) ||
        // A hand-traced room holds whatever face its own outline covers.
        (r.boundary && r.boundary.length >= 3 && pointInRing(...interiorPoint(face), roomFace(r))),
    );

  const free = faces
    .filter((face) => !held(face))
    .map((face) => ({ face, anchor: interiorPoint(face), centroid: interiorPoint(face) }));
  let n = nextRoomNumber(rooms);
  return readingOrder(free).map(({ face, anchor }) => {
    const number = n++;
    return { id: crypto.randomUUID(), name: `Room ${number}`, number, anchor, face };
  });
}
