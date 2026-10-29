import type { DungeonLayer, Room } from './types';
import type { Polygon } from '../geometry/GeometryEngine';
import { roomFaces } from '../engine/roomDetection';
import { computeMergedFloor } from '../engine/mergedFloor';
import { bindDoorToRooms } from '../shared/roomBinding';
import { faceMetrics, pointInRing } from '../shared/roomUtils';
import { buildRoomIndex, type RoomIndex } from '../shared/roomIndex';
import { resolveDoors, resolveWalls, toOcclusionDoors } from '../shared/wallResolve';

/*
 * Geometry refresh for rooms. Pure: no store, so the session server runs the same
 * function on a scene it loads and the table and the editor agree on every face.
 * The editor applies the result through `store/roomRefresh.ts`.
 */

/**
 * World units are grid cells — 1 unit = 1 cell everywhere in the editor, so the
 * grid parameter is a constant rather than a store read.
 */
export const ROOM_GRID_SIZE = 1;

/** What a door's two sides are bound to: a room id, or null for no room there. */
export interface DoorRooms {
  roomA: string | null;
  roomB: string | null;
}

export interface RoomSyncResult {
  /**
   * `layer.rooms` with the derived fields refreshed. A room whose derived fields did
   * not move is the same object as before, and when none moved this is the layer's
   * own array — so a no-op sync hands the store nothing new to react to.
   */
  rooms: Room[];
  /** The binding every resolved door should carry. A detached door is absent. */
  doorRooms: Map<string, DoorRooms>;
  /** Whether `rooms` differs from `layer.rooms`. */
  changed: boolean;
  /** Cell → room index over `rooms`. */
  index: RoomIndex;
}

function bboxOf(ring: readonly [number, number][]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of ring) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

function sameRing(a: readonly [number, number][] | undefined, b: readonly [number, number][] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false;
  return true;
}

function sameIds(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]);
}

/**
 * The faces a layer's rooms can sit in: merged floor minus standalone walls minus
 * thresholds. Exposed for Suggest, which proposes rooms on the faces nobody holds.
 */
export function layerFaces(layer: DungeonLayer, gridSize = ROOM_GRID_SIZE): Polygon[] {
  // A layer fresh off disk carries `mergedFloor: null` until the engine unions it;
  // the server never has one. Union it here rather than reading "no floor".
  const floor: Polygon[] = layer.mergedFloor ?? computeMergedFloor(layer) ?? [];
  return roomFaces(floor, layer.standaloneWalls, gridSize, layer.style?.wallWidth ?? 0, layer.thresholds ?? []);
}

/**
 * Refresh one dungeon layer's rooms from its geometry:
 *
 * 1. Cutters: the standalone walls and the thresholds (0.1 of a cell wide).
 * 2. Faces: the merged floor minus the cutters. A layer with no floor has no faces
 *    — Suggest is what covers a walls-only import.
 * 3. Each room's face is the one holding its anchor. None does: the room is
 *    `orphaned` and keeps the face it last had. Two anchors in one face both get
 *    it; the overlay flags that, and the DM merges by hand.
 * 4. A room with a hand-traced `boundary` (image-only maps) takes that as its face.
 * 5. Doors bind to the rooms on either side, and each room lists its doors.
 *
 * Never creates or removes a room: rooms are authored, this only places them.
 */
export function syncRooms(layer: DungeonLayer, gridSize = ROOM_GRID_SIZE): RoomSyncResult {
  const before = layer.rooms ?? [];
  const needFaces = before.some((r) => !(r.boundary && r.boundary.length >= 3));
  const faces = needFaces ? layerFaces(layer, gridSize) : [];
  const boxes = faces.map(bboxOf);

  const faceAt = (x: number, y: number): Polygon | null => {
    for (let i = 0; i < faces.length; i++) {
      const [x0, y0, x1, y1] = boxes[i];
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      if (pointInRing(x, y, faces[i])) return faces[i];
    }
    return null;
  };

  // Faces first, doors second: binding reads the faces just placed.
  const placed = before.map((room) => {
    const own = room.boundary && room.boundary.length >= 3 ? room.boundary : null;
    const hit = own ?? faceAt(room.anchor[0], room.anchor[1]);
    return { room, face: hit ?? room.face, orphaned: !hit };
  });
  const provisional: Room[] = placed.map(({ room, face }) => ({ ...room, face }));

  // Bind against resolved geometry, not the authored fields: a door on a floor-ring
  // edge has no `wallId` to look up, and both position and angle on the child go
  // stale the moment the wall under it is edited. A detached door is absent from
  // this list and keeps whatever it was bound to last.
  const walls = resolveWalls(layer);
  const bindable = toOcclusionDoors(resolveDoors(layer, walls));
  const doorRooms = new Map<string, DoorRooms>();
  const doorsOf = new Map<string, string[]>();
  for (const door of bindable) {
    const bound = bindDoorToRooms(door, walls, provisional);
    doorRooms.set(door.id, bound);
    for (const id of new Set([bound.roomA, bound.roomB])) {
      if (!id) continue;
      let list = doorsOf.get(id);
      if (!list) doorsOf.set(id, (list = []));
      list.push(door.id);
    }
  }

  let changed = before.length !== placed.length;
  const rooms = placed.map(({ room, face, orphaned }) => {
    const metrics = face && face.length >= 3 ? faceMetrics(face, gridSize) : null;
    const doors = doorsOf.get(room.id) ?? [];
    const same =
      sameRing(room.face, face) &&
      (room.orphaned === true) === orphaned &&
      sameIds(room.doors ?? [], doors) &&
      room.doors !== undefined &&
      (metrics
        ? room.area === metrics.area &&
          room.isPathway === metrics.isPathway &&
          room.centroid?.[0] === metrics.centroid[0] &&
          room.centroid?.[1] === metrics.centroid[1]
        : room.area === undefined);
    if (same) return room;
    changed = true;
    const next: Room = { ...room, doors };
    if (face) next.face = face;
    else delete next.face;
    if (metrics) Object.assign(next, metrics);
    else {
      delete next.centroid;
      delete next.area;
      delete next.isPathway;
    }
    if (orphaned) next.orphaned = true;
    else delete next.orphaned;
    return next;
  });

  const out = changed ? rooms : before;
  return { rooms: out, doorRooms, changed, index: buildRoomIndex(out, gridSize) };
}
