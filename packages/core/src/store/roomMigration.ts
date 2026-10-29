import type { Layer, Level, Room, SerializedMapData } from './types';
import type { RingGeometry } from '../shared/types';
import { interiorPoint, readingOrder } from '../shared/roomUtils';

/*
 * Rooms became anchored places (and maps gained levels). This turns a document
 * written before that into the new shape, once, on the way in: the editor's
 * `loadFromFile` runs it for every path that opens a map (the v1 sidebar, the v2
 * home page, a file import), and the session server runs it on the documents it
 * stores. Pure — no store, no engine — and idempotent: a migrated document is
 * stamped `roomsVersion: 2` and comes back untouched apart from the level check.
 */

/** A room as files before roomsVersion 2 wrote it: a detected face with a hash id. */
interface LegacyRoom {
  id: string;
  name?: string;
  boundary?: [number, number][];
  centroid?: [number, number];
  number?: number;
  anchor?: [number, number];
  [key: string]: unknown;
}

type LegacyRoomChild = RingGeometry & { id: string; name?: string; childType: 'room' };

const uuid = (): string => crypto.randomUUID();

/** The outer ring of a drawn room, with its baked transform applied. Curves are read at their vertices. */
function ringOf(child: RingGeometry): [number, number][] {
  const ring = child.contours?.[0] ?? [];
  const t = child.transform;
  if (!t) return ring;
  const cos = Math.cos(t.rotate);
  const sin = Math.sin(t.rotate);
  return ring.map(([x, y]): [number, number] => {
    const sx = x * t.scale[0];
    const sy = y * t.scale[1];
    return [sx * cos - sy * sin + t.translate[0], sx * sin + sy * cos + t.translate[1]];
  });
}

/** Whether a document still needs the room half of the migration. */
export function needsRoomMigration(data: Pick<SerializedMapData, 'mapSettings'>): boolean {
  return data.mapSettings?.roomsVersion !== 2;
}

/**
 * Every layer in exactly one level. Absent levels become one level named after the
 * map holding every layer; a layer naming no known level joins the first one. Runs
 * on every load, migrated or not, because a hand-edited or partly redacted document
 * can arrive with either half missing.
 */
function withLevels(data: SerializedMapData): { levels: Level[]; layers: Layer[] } {
  const levels: Level[] =
    Array.isArray(data.levels) && data.levels.length > 0
      ? data.levels
      : [{ id: uuid(), name: data.mapSettings?.name || 'Level 1' }];
  const known = new Set(levels.map((l) => l.id));
  const layers = (data.layers ?? []).map((layer) =>
    known.has(layer.levelId) ? layer : ({ ...layer, levelId: levels[0].id } as Layer),
  );
  return { levels, layers };
}

/**
 * The migration itself, per dungeon layer:
 *
 * 1. Each drawn room child becomes a `Room` with the child's id and name, anchored
 *    at a point inside its ring; the child goes. Each connector child goes too.
 * 2. Each existing detected room keeps its `room-xxxx` hash as its permanent id,
 *    anchored inside its old face; the face itself is dropped (it is derived now).
 *    An id already taken anywhere on the map gets a fresh uuid instead.
 * 3. `roomNameOverrides[id]` becomes the room's name, and the map is deleted.
 * 4. With no room numbered yet, rooms are numbered 1..n in reading order.
 * 5. Levels (see `withLevels`), and `roomsVersion = 2`.
 */
export function migrateRooms(data: SerializedMapData): SerializedMapData {
  const migrate = needsRoomMigration(data);
  const leveled = withLevels(data);
  if (!migrate) {
    const unchanged = leveled.levels === data.levels && leveled.layers.every((l, i) => l === data.layers[i]);
    return unchanged ? data : { ...data, levels: leveled.levels, layers: leveled.layers };
  }

  const taken = new Set<string>();
  const claim = (id: string): string => {
    const free = id && !taken.has(id) ? id : uuid();
    taken.add(free);
    return free;
  };

  const layers = leveled.layers.map((layer): Layer => {
    if (layer.type !== 'dungeon') return layer;
    const raw = layer as unknown as Record<string, unknown> & {
      children?: { id: string; childType: string; name?: string }[];
      rooms?: LegacyRoom[];
      roomNameOverrides?: Record<string, string>;
    };
    const overrides = raw.roomNameOverrides ?? {};
    const children = raw.children ?? [];

    // Drawn rooms first: on a layer that had them, `rooms` was a mirror of these
    // children (same ids), so the detected list below only adds what they did not.
    const drawn = children.filter((c): c is LegacyRoomChild & { childType: 'room' } => c.childType === 'room');
    const drawnIds = new Set(drawn.map((c) => c.id));
    const rooms: Room[] = [];
    for (const child of drawn) {
      const ring = ringOf(child);
      if (ring.length < 3) continue;
      const id = claim(child.id);
      rooms.push({ id, name: overrides[child.id] ?? child.name ?? 'Room', anchor: interiorPoint(ring) });
    }
    for (const old of raw.rooms ?? []) {
      if (drawnIds.has(old.id)) continue;
      const anchor =
        old.anchor ??
        (old.boundary && old.boundary.length >= 3 ? interiorPoint(old.boundary) : (old.centroid ?? null));
      if (!anchor) continue;
      const room: Room = { id: claim(old.id), name: overrides[old.id] ?? old.name ?? 'Room', anchor };
      if (typeof old.number === 'number') room.number = old.number;
      // Kept so reading order below matches where the room was drawn; syncRooms
      // replaces it on the first pass and a save strips it.
      if (old.centroid) room.centroid = old.centroid;
      rooms.push(room);
    }

    if (rooms.length > 0 && rooms.every((r) => r.number === undefined)) {
      readingOrder(rooms).forEach((r, i) => {
        r.number = i + 1;
      });
    }
    for (const r of rooms) delete r.centroid;

    const next: Record<string, unknown> = {
      ...raw,
      children: children.filter((c) => c.childType !== 'room' && c.childType !== 'connector'),
    };
    delete next.roomNameOverrides;
    if (rooms.length > 0 || raw.rooms !== undefined) next.rooms = rooms;
    return next as unknown as Layer;
  });

  return {
    ...data,
    mapSettings: { ...data.mapSettings, roomsVersion: 2 },
    levels: leveled.levels,
    layers,
  };
}
