import type { DungeonLayer } from '../store/types';
import type { Room, ThresholdSegment } from './types';
import type { Polygon } from '../geometry/GeometryEngine';
import { paintedGroundCuts, roomFaceCut, type FaceCut, type RoomContext } from './roomFloor';
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
 * only what the walls close off is offered (`roomFaceCut`). A layer drawn in ground alone (no
 * walled floor, no wall) offers its painted areas, one texture at a time (`paintedGroundCuts`),
 * as pinned rooms like any other.
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
 * The cuts Suggest reads: the layer's room faces (`roomFaceCut`), or on a layer drawn in
 * ground alone (no walled floor, no wall) one cut per painted texture (`paintedGroundCuts`).
 */
function suggestCuts(layer: DungeonLayer, ctx: RoomContext, divides: readonly ThresholdSegment[]): FaceCut[] {
  return paintedGroundCuts(layer, divides) ?? [roomFaceCut(layer, ctx, divides)];
}

/** Which faces hold a room already: the smallest face round each pin, and every face an outlined room covers. */
function heldFaces(rooms: readonly Room[], faces: readonly Polygon[]): (face: Polygon) => boolean {
  const areas = faces.map((f) => computeArea(f));
  const pinned = new Set<Polygon>();
  for (const r of rooms) {
    let best = -1;
    for (let i = 0; i < faces.length; i++) {
      if ((best < 0 || areas[i] < areas[best]) && pointInRing(r.anchor[0], r.anchor[1], faces[i])) best = i;
    }
    if (best >= 0) pinned.add(faces[best]);
  }
  return (face) =>
    pinned.has(face) || rooms.some((r) => r.boundary && r.boundary.length >= 3 && pointInRing(...interiorPoint(face), roomFace(r)));
}

/**
 * Divide lines Suggest proposes where a floor narrows (plan 3.1): across every place a
 * chamber meets a passage or another chamber, in every face of the layer, each checked by
 * cutting along it. Inside a face that already holds a room, only where that face has two
 * chambers or more: a passage is never cut off a room the DM made. Fresh uuid per line. The
 * layer's own divide lines are kept as they are.
 */
export function suggestDivides(layer: DungeonLayer, ctx: RoomContext): ThresholdSegment[] {
  const cuts = suggestCuts(layer, ctx, []);
  const held = heldFaces(layer.rooms ?? [], cuts.flatMap((c) => c.faces));
  return asThresholds(cuts.flatMap(({ faces, rings }) => faces.flatMap((face) => faceDivides(face, rings, held(face) ? 2 : 0))));
}

/**
 * Ghost rooms for every closed face with no room, given the divide lines the DM kept.
 * Faces are the ones the sync gives a room (`roomFaceCut`), so an accepted ghost keeps its
 * face; on a layer drawn in ground alone the sync finds a ghost's painted area under its pin
 * (`paintedAreaCuts`), so the room follows the floor. A face under a square cell is never
 * offered. A face that reads as a corridor is named `Passage N`, numbered in the same run as
 * the rooms.
 */
export function suggestRooms(layer: DungeonLayer, ctx: RoomContext, divides: readonly ThresholdSegment[] = []): Room[] {
  const cuts = suggestCuts(layer, ctx, divides);
  const faces = cuts.flatMap((c) => c.faces);
  const ringsOf = new Map<Polygon, Polygon[]>();
  for (const c of cuts) for (const f of c.faces) ringsOf.set(f, c.rings);

  const rooms = layer.rooms ?? [];
  const held = heldFaces(rooms, faces);
  const free = faces
    .filter((face) => computeArea(face) >= MIN_SUGGESTED_AREA && !held(face))
    .map((face) => ({ face, anchor: anchorOutside(face, faces), centroid: interiorPoint(face) }));
  let n = nextRoomNumber(rooms);
  return readingOrder(free).map(({ face, anchor }) => {
    const number = n++;
    const passage = isPathway(face, ROOM_GRID_SIZE) || faceIsPassage(face, ringsOf.get(face)!);
    return { id: crypto.randomUUID(), name: `${passage ? 'Passage' : 'Room'} ${number}`, number, anchor, face };
  });
}
