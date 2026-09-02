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

/**
 * Where a connector's door mark is drawn, and how wide. A wall door anchors on its
 * wall; a connector has none, so the blob answers for itself: its centroid, the
 * direction it is longest in, and how far it runs that way.
 *
 * ponytail: the principal axis is the P1 approximation. P2 replaces it with the
 * span where the blob crosses the room boundary, which is the real doorway.
 */
export function connectorAnchor(child: ConnectorChild): {
  position: [number, number];
  angle: number;
  width: number;
} {
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
export function connectorToDoor(child: ConnectorChild): DoorChild {
  return {
    id: child.id,
    name: child.name,
    childType: 'door',
    visible: child.visible,
    wallId: '',
    ...connectorAnchor(child),
    style: child.kind === 'arch' ? 'archway' : child.style ?? 'single',
    state: child.state,
    isSecret: child.isSecret,
    roomA: child.roomA ?? null,
    roomB: child.roomB ?? null,
  };
}

/** Every RoomChild on a layer, in child order. */
export function authoredRoomChildren(children: readonly AnyChild[]): RoomChild[] {
  return children.filter((c): c is RoomChild => c.childType === 'room');
}

/** Every ConnectorChild on a layer, in child order. */
export function connectorChildren(children: readonly AnyChild[]): ConnectorChild[] {
  return children.filter((c): c is ConnectorChild => c.childType === 'connector');
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
 * Bind a connector to the two rooms its blob covers most.
 *
 * A door sits on a wall and probes perpendicularly off it (`bindDoorToRooms`); a
 * connector has no wall, so overlap area is the analogous signal. Fewer than two
 * overlapped rooms leaves both sides `null` — the joint is inert, joining
 * nothing, which is not an error. Three or more takes the two largest overlaps.
 *
 * ponytail: one Clipper2 boolean per candidate pair, AABB-rejected first.
 * Connectors are a handful per map; index the rooms if that stops being true.
 */
export function bindConnectorToRooms(
  connector: ConnectorChild,
  rooms: readonly Room[],
): { roomA: string | null; roomB: string | null } {
  const blob = authoredRing(connector);
  if (blob.length < 3) return { roomA: null, roomB: null };
  const box = boxOf(blob);
  const hits: { id: string; area: number }[] = [];
  for (const room of rooms) {
    if (room.boundary.length < 3) continue;
    if (!boxesOverlap(box, boxOf(room.boundary))) continue;
    const pieces = clipper2Engine.intersection([blob], [room.boundary]) as [number, number][][];
    let area = 0;
    for (const p of pieces) if (p.length >= 3) area += computeArea(p);
    if (area > 1e-9) hits.push({ id: room.id, area });
  }
  if (hits.length < 2) return { roomA: null, roomB: null };
  hits.sort((a, b) => b.area - a.area);
  return { roomA: hits[0].id, roomB: hits[1].id };
}
