import type { DungeonLayer } from '../store/types';
import type { Room, ThresholdSegment } from './types';
import { roomFaceCut, type RoomContext } from './roomFloor';
import { ROOM_GRID_SIZE } from '../store/roomSync';
import { computeArea, interiorPoint, isPathway, nextRoomNumber, pointInRing, readingOrder, roomFace } from './roomUtils';
import { asThresholds, faceDivides, faceIsPassage } from './passageSplit';

/** The smallest face Suggest offers as a room, square cells. */
const MIN_SUGGESTED_AREA = 1;

/*
 * Rooms the layer's geometry implies but nobody has placed yet: one per closed face that
 * holds no room. Existing rooms are never touched. Pure; the editor keeps the result in
 * `ui.roomSuggestions` as ghosts and `AcceptRoomsCommand` adds the ones the DM keeps.
 *
 * A walls-only import has no floor to cut. There the map frame stands in for the floor, and
 * only what the walls close off is offered (`roomFaceCut`).
 *
 * Each suggestion gets a uuid, the next free number and its name, and is anchored at a point
 * inside its face, numbered in reading order.
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
export function anchorOutside(face: [number, number][], faces: readonly [number, number][][]): [number, number] {
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

/**
 * Divide lines Suggest proposes where a floor narrows (plan 3.1): across every place a
 * chamber meets a passage or another chamber, in every face of the layer, each checked by
 * cutting along it. Fresh uuid per line. The layer's own divide lines are kept as they are.
 */
export function suggestDivides(layer: DungeonLayer, ctx: RoomContext): ThresholdSegment[] {
  const { faces, rings } = roomFaceCut(layer, ctx);
  return asThresholds(faces.flatMap((face) => faceDivides(face, rings)));
}

/**
 * Ghost rooms for every closed face with no room, given the divide lines the DM kept.
 * Faces are the ones the sync gives a room (`roomFaceCut`), so an accepted ghost keeps its
 * face. A face under a square cell is never offered. A face that reads as a corridor is
 * named `Passage N`, numbered in the same run as the rooms.
 */
export function suggestRooms(layer: DungeonLayer, ctx: RoomContext, divides: readonly ThresholdSegment[] = []): Room[] {
  const cut = roomFaceCut(layer, ctx, divides);
  const faces = cut.faces;

  // A room holds the smallest face round its pin; an outlined room, every face its outline covers.
  const rooms = layer.rooms ?? [];
  const areas = faces.map((f) => computeArea(f));
  const heldFaces = new Set<[number, number][]>();
  for (const r of rooms) {
    let best = -1;
    for (let i = 0; i < faces.length; i++) {
      if ((best < 0 || areas[i] < areas[best]) && pointInRing(r.anchor[0], r.anchor[1], faces[i])) best = i;
    }
    if (best >= 0) heldFaces.add(faces[best]);
  }
  const held = (face: [number, number][]): boolean =>
    heldFaces.has(face) ||
    rooms.some((r) => r.boundary && r.boundary.length >= 3 && pointInRing(...interiorPoint(face), roomFace(r)));

  const free = faces
    .filter((face, i) => areas[i] >= MIN_SUGGESTED_AREA && !held(face))
    .map((face) => ({ face, anchor: anchorOutside(face, faces), centroid: interiorPoint(face) }));
  let n = nextRoomNumber(rooms);
  return readingOrder(free).map(({ face, anchor }) => {
    const number = n++;
    const passage = isPathway(face, ROOM_GRID_SIZE) || faceIsPassage(face, cut.rings);
    return { id: crypto.randomUUID(), name: `${passage ? 'Passage' : 'Room'} ${number}`, number, anchor, face };
  });
}
