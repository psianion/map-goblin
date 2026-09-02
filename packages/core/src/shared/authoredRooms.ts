// Turning what the DM drew into the room graph the rest of the app already
// consumes. Nothing downstream learns a new shape: a RoomChild becomes a plain
// `Room`, and a ConnectorChild gets the same roomA/roomB pair a door gets.

import type { AnyChild, ConnectorChild, Room, RoomChild } from './types';
import { flattenRing } from './bezier';
import { computeArea, computeCentroid, isPathway } from './roomUtils';
import { effectiveContours, effectiveTangents } from '../engine/tools/childTransform';
import { clipper2Engine } from '../geometry/Clipper2Engine';

/** The outer ring as downstream geometry sees it: transform baked, curves flattened. */
export function authoredRing(child: RoomChild | ConnectorChild): [number, number][] {
  return flattenRing(effectiveContours(child)[0] ?? [], effectiveTangents(child)?.[0]);
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
