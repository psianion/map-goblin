import type { Room } from './types';
import { pointInRing, roomFace } from './roomUtils';

/**
 * Which room a point is in, and which grid cells a room covers.
 *
 * Every consumer that used to walk every room's ring per query (the server's scene
 * map and vision, the table's fog, prep's pin check, the editor's hit test) asks
 * this instead. Faces are bucketed by grid cell once, so a query tests only the
 * handful of rooms whose bounds touch that cell.
 */
export interface RoomIndex {
  /** The room whose face holds the point, or null. A live face wins over an orphan's stale one. */
  roomAt(x: number, y: number): Room | null;
  /** The cells, as `[col, row]`, whose centres lie inside the room's face. Empty for an unknown id. */
  cellsOf(roomId: string): readonly [number, number][];
}

/** Bucket key for a cell. Cells are integers well inside ±2^20 on any real map. */
const key = (col: number, row: number): number => (col + 0x100000) * 0x200000 + (row + 0x100000);

/**
 * Index `rooms` by grid cell. `cellScale` is the bucket size in world units — the
 * editor's world unit is one cell, so 1 is the normal value.
 */
export function buildRoomIndex(rooms: readonly Room[], cellScale = 1): RoomIndex {
  const s = cellScale > 0 ? cellScale : 1;
  // Live faces first, so a point inside both a room's face and an orphan's
  // remembered one answers the live room.
  const ordered = [...rooms].sort((a, b) => Number(a.orphaned === true) - Number(b.orphaned === true));
  const buckets = new Map<number, Room[]>();
  const bounds = new Map<string, [number, number, number, number]>();
  for (const room of ordered) {
    const face = roomFace(room);
    if (face.length < 3) continue;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of face) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    bounds.set(room.id, [x0, y0, x1, y1]);
    for (let col = Math.floor(x0 / s); col <= Math.floor(x1 / s); col++) {
      for (let row = Math.floor(y0 / s); row <= Math.floor(y1 / s); row++) {
        const k = key(col, row);
        let list = buckets.get(k);
        if (!list) buckets.set(k, (list = []));
        list.push(room);
      }
    }
  }

  const cells = new Map<string, [number, number][]>();
  return {
    roomAt(x, y) {
      const list = buckets.get(key(Math.floor(x / s), Math.floor(y / s)));
      if (!list) return null;
      for (const room of list) if (pointInRing(x, y, roomFace(room))) return room;
      return null;
    },
    cellsOf(roomId) {
      const hit = cells.get(roomId);
      if (hit) return hit;
      const box = bounds.get(roomId);
      const room = rooms.find((r) => r.id === roomId);
      const out: [number, number][] = [];
      if (box && room) {
        const face = roomFace(room);
        const [x0, y0, x1, y1] = box;
        for (let col = Math.floor(x0 / s); col <= Math.floor(x1 / s); col++) {
          for (let row = Math.floor(y0 / s); row <= Math.floor(y1 / s); row++) {
            if (pointInRing((col + 0.5) * s, (row + 0.5) * s, face)) out.push([col, row]);
          }
        }
      }
      cells.set(roomId, out);
      return out;
    },
  };
}

const memo = new WeakMap<readonly Room[], RoomIndex>();

/**
 * The index for a layer's `rooms` array, built once per array. `syncRooms` hands
 * the store a new array whenever a face moves, and any room edit does too, so the
 * array's identity is exactly the cache key — nothing on the layer to strip on save.
 */
export function roomIndexOf(rooms: readonly Room[] | undefined): RoomIndex {
  const list = rooms ?? EMPTY;
  let hit = memo.get(list);
  if (!hit) memo.set(list, (hit = buildRoomIndex(list)));
  return hit;
}

const EMPTY: readonly Room[] = [];
