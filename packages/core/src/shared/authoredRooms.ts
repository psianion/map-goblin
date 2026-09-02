// Turning what the DM drew into the room graph the rest of the app already
// consumes. Nothing downstream learns a new shape: a RoomChild becomes a plain
// `Room`, and a ConnectorChild gets the same roomA/roomB pair a door gets.

import type { AnyChild, ConnectorChild, DoorChild, Room, RoomChild } from './types';
import { flattenRing } from './bezier';
import { computeArea, computeCentroid, isPathway } from './roomUtils';
import { clipper2Engine } from './../geometry/Clipper2Engine';

/**
 * The outer ring as downstream geometry sees it: curves flattened, transform baked.
 *
 * Flatten first, bake second — the reverse of `childTransform.effectiveContours`, and the
 * same answer either way: the bake is affine, so it commutes with the subdivision. Doing it
 * in this order is what keeps this module free of `engine/`, which matters because the
 * session server reads it and pulling `engine/tools` in drags the whole editor (and the DOM
 * it types against) behind it.
 *
 * ponytail: the flattening tolerance is therefore measured before the scale. A connector
 * blown up ten times reads a shade coarser; bake first if that ever shows.
 */
export function authoredRing(child: RoomChild | ConnectorChild): [number, number][] {
  const ring = flattenRing(child.contours[0] ?? [], child.tangents?.[0]);
  const t = child.transform;
  if (!t) return ring;
  const [cos, sin] = [Math.cos(t.rotate), Math.sin(t.rotate)];
  return ring.map(([px, py]): [number, number] => {
    const [sx, sy] = [px * t.scale[0], py * t.scale[1]];
    return [cos * sx - sin * sy + t.translate[0], sin * sx + cos * sy + t.translate[1]];
  });
}

const SPAN_EPS = 1e-9;

function pointInRing(x: number, y: number, ring: readonly [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The stretches of the segment `a`→`b` that run inside `ring`, as parameter
 * intervals along it. This is the doorway: where a connector's blob swallows a
 * stretch of a room's boundary, that stretch is not wall, it is the opening.
 *
 * Cut the segment at every crossing, then keep the pieces whose midpoint is
 * inside — the textbook clip, and exact for the concave freehand loops the room
 * tool draws, which a convex-only method would get wrong.
 *
 * ponytail: O(edges) per query, no index. A map holds a handful of connectors and
 * the promotion is memoized per layer; index the ring if that stops being true.
 */
export function spansInside(
  a: readonly [number, number],
  b: readonly [number, number],
  ring: readonly [number, number][],
): [number, number][] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const cuts = [0, 1];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < SPAN_EPS) continue;
    const t = ((p[0] - a[0]) * ey - (p[1] - a[1]) * ex) / den;
    const u = ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / den;
    if (t > SPAN_EPS && t < 1 - SPAN_EPS && u >= 0 && u <= 1) cuts.push(t);
  }
  cuts.sort((m, n) => m - n);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [t0, t1] = [cuts[i], cuts[i + 1]];
    if (t1 - t0 < SPAN_EPS) continue;
    const m = (t0 + t1) / 2;
    if (!pointInRing(a[0] + dx * m, a[1] + dy * m, ring)) continue;
    const last = out[out.length - 1];
    if (last && t0 - last[1] < SPAN_EPS) last[1] = t1;
    else out.push([t0, t1]);
  }
  return out;
}

/**
 * Every doorway a connector cuts: one entry per stretch of a room boundary its
 * blob swallows, in the shape the occlusion split already reads a door in.
 */
export function connectorCrossings(
  child: ConnectorChild,
  boundaries: readonly (readonly [number, number][])[],
): { position: [number, number]; angle: number; width: number }[] {
  const blob = authoredRing(child);
  const out: { position: [number, number]; angle: number; width: number }[] = [];
  if (blob.length < 3) return out;
  for (const ring of boundaries) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < SPAN_EPS) continue;
      for (const [t0, t1] of spansInside(a, b, blob)) {
        const m = (t0 + t1) / 2;
        out.push({
          position: [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m],
          angle: Math.atan2(b[1] - a[1], b[0] - a[0]),
          width: (t1 - t0) * len,
        });
      }
    }
  }
  return out;
}

/**
 * Where a connector's door mark is drawn, and how wide.
 *
 * A wall door anchors on its wall; a connector has none, so the boundary it
 * crosses answers for it: the widest stretch of room edge its blob swallows is
 * the doorway, and the mark sits in the middle of that, along it. Which also
 * settles the twin's re-anchoring — sitting *on* a boundary edge, the nearest
 * wall to it is its own doorway, not whatever real wall happened to stand near
 * the blob's middle.
 *
 * With no boundary crossed — a joint drawn in the void, or a caller with no rooms
 * to hand — the blob still answers for itself: its centroid, the direction it is
 * longest in, and how far it runs that way.
 */
export function connectorAnchor(
  child: ConnectorChild,
  boundaries: readonly (readonly [number, number][])[] = [],
): {
  position: [number, number];
  angle: number;
  width: number;
} {
  let best: { position: [number, number]; angle: number; width: number } | null = null;
  for (const cross of connectorCrossings(child, boundaries)) {
    if (!best || cross.width > best.width) best = cross;
  }
  if (best) return best;
  const ring = authoredRing(child);
  if (ring.length < 2) return { position: ring[0] ?? [0, 0], angle: 0, width: 1 };
  const [cx, cy] = computeCentroid(ring);
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of ring) {
    const dx = x - cx;
    const dy = y - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const [ux, uy] = [Math.cos(angle), Math.sin(angle)];
  let lo = Infinity;
  let hi = -Infinity;
  for (const [x, y] of ring) {
    const t = (x - cx) * ux + (y - cy) * uy;
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  return { position: [cx, cy], angle, width: Math.max(hi - lo, 1e-6) };
}

/**
 * The connector as the door lane reads it — the whole of C1/C3 in one shape.
 *
 * Everything that plays a door already speaks `DoorChild`: the scene index, the live
 * state machine, the redactor's `doorKept`/`facing`, the table's glyph and its
 * double-click. Handing them a door twin rather than teaching each one about blobs is
 * why none of them changes. `kind:'arch'` is `'archway'`, which the existing machinery
 * already forces open, refuses commands on and draws no mark for.
 *
 * `wallId` is the floor-anchored door's own `''`: there is no wall to point at, and the
 * anchor above is the whole of what places it.
 */
export function connectorToDoor(
  child: ConnectorChild,
  boundaries: readonly (readonly [number, number][])[] = [],
): DoorChild {
  return {
    id: child.id,
    name: child.name,
    childType: 'door',
    visible: child.visible,
    wallId: '',
    ...connectorAnchor(child, boundaries),
    style: child.kind === 'arch' ? 'archway' : child.style ?? 'single',
    state: child.state,
    isSecret: child.isSecret,
    roomA: child.roomA ?? null,
    roomB: child.roomB ?? null,
  };
}

/**
 * The next free `"{prefix} {n}"` on a layer.
 *
 * Counting how many already exist gets this wrong the moment one is deleted:
 * place two, delete the first, place again and the count says 2 — a second
 * "Connector 2", and now the layers panel and the DM's own notes name two
 * different joints the same thing. Reading the highest number actually in use
 * instead means a name is only ever handed out once per layer.
 */
export function nextAuthoredName(children: readonly AnyChild[], prefix: string): string {
  const pattern = new RegExp(`^${prefix} (\\d+)$`);
  let highest = 0;
  for (const child of children) {
    // NaN when the name is not `"{prefix} {digits}"` at all, and NaN > n is false.
    const n = Number(pattern.exec(child.name)?.[1]);
    if (n > highest) highest = n;
  }
  return `${prefix} ${highest + 1}`;
}

/** Every RoomChild on a layer, in child order. */
export function authoredRoomChildren(children: readonly AnyChild[]): RoomChild[] {
  return children.filter((c): c is RoomChild => c.childType === 'room');
}

/** Every ConnectorChild on a layer, in child order. */
export function connectorChildren(children: readonly AnyChild[]): ConnectorChild[] {
  return children.filter((c): c is ConnectorChild => c.childType === 'connector');
}

/** The drawn rooms' outer rings, ready for geometry — the occluders and the doorways. */
export function authoredBoundaries(children: readonly AnyChild[]): [number, number][][] {
  return authoredRoomChildren(children)
    .filter((room) => room.visible !== false)
    .map(authoredRing);
}

/**
 * A drawn room as the `Room` the store, server and fog all read.
 *
 * The id is the child's own uuid — never `computeStableRoomId`, whose centroid
 * hash is precisely the churn authored rooms exist to stop. `isPathway` runs the
 * same heuristic `buildRoom` runs, so a corridor behaves identically whichever
 * source drew it.
 */
export function roomChildToRoom(child: RoomChild, gridSize: number): Room {
  const boundary = authoredRing(child);
  return {
    id: child.id,
    name: child.name,
    boundary,
    centroid: computeCentroid(boundary),
    area: computeArea(boundary),
    isPathway: isPathway(boundary, gridSize),
  };
}

type Box = { minX: number; minY: number; maxX: number; maxY: number };

function boxOf(ring: readonly [number, number][]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

/**
 * How far past its own outline a joint still counts as touching a room, world
 * units. Rooms are drawn to the wall they stop at, so two rooms either side of a
 * seam are a wall's width apart and a blob spanning that gap overlaps neither by
 * much — a bit over a wall width is what closes it.
 */
const BIND_TOLERANCE = 0.75;

/** Rooms the polygon set overlaps, with how much of each, largest last-sorted by the caller. */
function overlapHits(
  blob: readonly (readonly [number, number][])[],
  rooms: readonly Room[],
): { id: string; area: number }[] {
  const box = boxOf(blob.flat());
  const hits: { id: string; area: number }[] = [];
  for (const room of rooms) {
    if (room.boundary.length < 3) continue;
    if (!boxesOverlap(box, boxOf(room.boundary))) continue;
    const pieces = clipper2Engine.intersection(
      blob as [number, number][][],
      [room.boundary as [number, number][]],
    ) as [number, number][][];
    let area = 0;
    for (const p of pieces) if (p.length >= 3) area += computeArea(p);
    if (area > 1e-9) hits.push({ id: room.id, area });
  }
  return hits;
}

/**
 * Bind a connector to the two rooms its blob covers most.
 *
 * A door sits on a wall and probes perpendicularly off it (`bindDoorToRooms`); a
 * connector has no wall, so overlap area is the analogous signal. Three or more
 * overlapped rooms takes the two largest.
 *
 * Area alone is precision-fragile, though, and that is what a DM actually hits:
 * the blob is an ellipse whose tips are the drag's own endpoints, so it tapers to
 * nothing exactly where it meets a room, and the rooms it joins stop at the wall
 * between them rather than touching. Drag across a seam a shade short and both
 * overlaps round to nothing — the joint binds silently to neither. So a miss
 * retries against the blob grown by `BIND_TOLERANCE`, which is the same measure
 * `bindDoorToRooms` takes stepping off its wall, just taken in every direction at
 * once because a connector has no wall to step off. Fewer than two rooms even
 * then leaves both sides `null` — the joint is inert, joining nothing, which is
 * not an error, and the overlay draws it as unlinked.
 *
 * ponytail: one Clipper2 boolean per candidate pair, AABB-rejected first, and a
 * second pass only on the miss. Connectors are a handful per map; index the rooms
 * if that stops being true.
 */
export function bindConnectorToRooms(
  connector: ConnectorChild,
  rooms: readonly Room[],
): { roomA: string | null; roomB: string | null } {
  const blob = authoredRing(connector);
  if (blob.length < 3) return { roomA: null, roomB: null };
  let hits = overlapHits([blob], rooms);
  if (hits.length < 2) hits = overlapHits(clipper2Engine.inflate([blob], BIND_TOLERANCE), rooms);
  if (hits.length < 2) return { roomA: null, roomB: null };
  hits.sort((a, b) => b.area - a.area);
  return { roomA: hits[0].id, roomB: hits[1].id };
}
