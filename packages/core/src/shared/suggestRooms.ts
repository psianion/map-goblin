import type { DungeonLayer } from '../store/types';
import type { Room } from './types';
import type { WorldBounds } from './mapBounds';
import { roomFaces } from '../engine/roomDetection';
import { computeMergedFloor } from '../engine/mergedFloor';
import { ROOM_GRID_SIZE } from '../store/roomSync';
import { interiorPoint, nextRoomNumber, pointInRing, readingOrder, roomFace } from './roomUtils';
import { caveCutters } from './caveFloor';

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
function ringArea(ring: readonly [number, number][]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a / 2);
}

/**
 * Where a proposed room is anchored: inside its face and outside every face nested in it
 * (a cave painted inside a floor), so the room round a cave never lands on the cave. The
 * widest run of an even-odd scan over the face and the faces inside it.
 */
function anchorOutside(face: [number, number][], faces: readonly [number, number][][]): [number, number] {
  const p = interiorPoint(face);
  const area = ringArea(face);
  const inner = faces.filter((f) => f !== face && ringArea(f) < area && pointInRing(...interiorPoint(f), face));
  if (!inner.some((f) => pointInRing(p[0], p[1], f))) return p;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of face) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  let best = p;
  let bestWidth = 0;
  for (let k = 1; k <= 24; k++) {
    const y = minY + ((maxY - minY) * k) / 25;
    const xs: number[] = [];
    for (const ring of [face, ...inner]) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (xs[i + 1] - xs[i] > bestWidth) {
        bestWidth = xs[i + 1] - xs[i];
        best = [(xs[i] + xs[i + 1]) / 2, y];
      }
    }
  }
  return best;
}

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
    // A painted cave's edge cuts like a threshold, so a cave inside a floor is proposed on its own.
    [...(layer.thresholds ?? []), ...caveCutters(layer)],
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
    .map((face) => ({ face, anchor: anchorOutside(face, faces), centroid: interiorPoint(face) }));
  let n = nextRoomNumber(rooms);
  return readingOrder(free).map(({ face, anchor }) => {
    const number = n++;
    return { id: crypto.randomUUID(), name: `Room ${number}`, number, anchor, face };
  });
}
