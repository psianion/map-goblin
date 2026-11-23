// The Lighting pass's half of player vision, as one pure rule the referee (session server)
// and every seat's mask (session client) both run: which level a sweep is taken on, which
// ground is dark enough to need light, and which edges a darkness source adds to the sight
// occluders. Geometry only; nothing here reads state.

import type { DungeonLayer, Layer, MapSettings } from '../store/types';
import type { Level } from './types';
import type { SkyFrame } from './sky';
import type { Environment } from './world';
import { clipper2Engine } from '../geometry/Clipper2Engine';
import { isDarkRegion, levelPlace, roomPlace } from './regionGrade';
import { buildRoomIndex } from './roomIndex';
import { pointInRing, roomFace, signedArea } from './roomUtils';
import { daylightSpill, spillLitArea, type Spill } from './daylightSpill';

/** The map's first level id ('' on a map with none) — where a token without a level stands. */
export function firstLevelId(map: { levels?: readonly Pick<Level, 'id'>[] }): string {
  return map.levels?.[0]?.id ?? '';
}

/** The level a layer belongs to: its own when the map has it, else the first. */
export function levelIdOf(map: { levels?: readonly Pick<Level, 'id'>[] }, layer: Pick<Layer, 'levelId'>): string {
  const levels = map.levels ?? [];
  return levels.some((l) => l.id === layer.levelId) ? layer.levelId : firstLevelId(map);
}

/** The dungeon layers on one level. A map with at most one level has every layer on it. */
export function layersOnLevel(
  map: { levels?: readonly Pick<Level, 'id'>[] },
  layers: readonly Layer[],
  levelId: string,
): DungeonLayer[] {
  const dungeon = layers.filter((l): l is DungeonLayer => l.type === 'dungeon');
  if ((map.levels?.length ?? 0) <= 1) return dungeon;
  return dungeon.filter((l) => levelIdOf(map, l) === levelId);
}

/** Whether a token (or anything carrying an optional `levelId`) stands on `levelId`. */
export function onLevel(map: { levels?: readonly Pick<Level, 'id'>[] }, item: { levelId?: string }, levelId: string): boolean {
  if ((map.levels?.length ?? 0) <= 1) return true;
  const own = item.levelId && map.levels!.some((l) => l.id === item.levelId) ? item.levelId : firstLevelId(map);
  return own === levelId;
}

/**
 * The darkness test for one level under one sky: true where the ground is dark enough that a
 * normal eye needs light (`isDarkRegion` of the room the point is in, else of the level). The
 * table's live room places (`triggers.roomEdits`) lie over the authored chain. Daylight
 * spilling into a dark room through an open edge (`daylightSpill`) lights its first cell, so
 * sight agrees with the drawn fade; `spills` defaults to the level's own. Rooms are resolved
 * once, here; the returned test is a room lookup and a set read.
 */
export function darkTest(
  map: { mapSettings: MapSettings; levels?: readonly Level[] },
  layers: readonly DungeonLayer[],
  levelId: string,
  sky: SkyFrame,
  roomPlaces: Readonly<Record<string, { place?: Environment }>> = {},
  spills?: readonly Spill[],
): DarkTest {
  const level = map.levels?.find((l) => l.id === levelId);
  const levelDark = isDarkRegion(levelPlace(map.mapSettings, level), sky);
  const darkRooms = new Set<string>();
  const darkFaceOf = new Map<string, [number, number][]>();
  const litFaces: [number, number][][] = [];
  const places: Record<string, Environment> = {};
  const rooms = layers.flatMap((layer) =>
    (layer.rooms ?? []).map((room) => {
      const place = roomPlaces[room.id]?.place ?? roomPlace(map, layer, room);
      places[room.id] = place;
      const face = roomFace(room);
      if (isDarkRegion(place, sky)) {
        darkRooms.add(room.id);
        if (face.length >= 3) darkFaceOf.set(room.id, face);
      } else if (face.length >= 3) {
        litFaces.push(face);
      }
      return room;
    }),
  );
  // The lit mouths of dark rooms, by room: a spill's first cell, from a side that is not dark.
  const mouths = new Map<string, [number, number][][]>();
  for (const spill of spills ?? daylightSpill(map, layers, levelId, places)) {
    if (!darkRooms.has(spill.roomId) || isDarkRegion(spill.from, sky)) continue;
    const area = spillLitArea(spill).filter((r) => signedArea(r) > 0);
    if (area.length === 0) continue;
    mouths.set(spill.roomId, [...(mouths.get(spill.roomId) ?? []), ...area]);
  }
  const darkFaces: [number, number][][] = [];
  for (const [id, face] of darkFaceOf) {
    const mouth = mouths.get(id);
    if (!mouth) {
      darkFaces.push(face);
      continue;
    }
    darkFaces.push(...clipper2Engine.difference([face], mouth).filter((r) => signedArea(r) > 0));
    litFaces.push(...mouth);
  }
  const index = buildRoomIndex(rooms);
  return {
    dark: (x, y) => {
      const room = index.roomAt(x, y);
      if (!room) return levelDark;
      if (!darkRooms.has(room.id)) return false;
      const mouth = mouths.get(room.id);
      return !mouth || !mouth.some((r) => pointInRing(x, y, r));
    },
    any: levelDark || darkRooms.size > 0,
    levelDark,
    darkFaces,
    litFaces,
  };
}

/** The darkness test for one level (see `darkTest`). */
export interface DarkTest {
  dark(x: number, y: number): boolean;
  /** Whether anything on the level is dark at all — false is the fast path: everything is lit. */
  any: boolean;
  /** Whether the level's own ground (outside every room) is dark. */
  levelDark: boolean;
  /** The faces of the rooms that are dark, their daylit mouths cut out… */
  darkFaces: [number, number][][];
  /** …and of the ones that are not (lit rooms inside a dark level), with those mouths. */
  litFaces: [number, number][][];
}
