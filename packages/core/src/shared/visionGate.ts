// The Lighting pass's half of player vision, as one pure rule the referee (session server)
// and every seat's mask (session client) both run: which level a sweep is taken on, which
// ground is dark enough to need light, and which edges a darkness source adds to the sight
// occluders. Geometry only; nothing here reads state.

import type { DungeonLayer, Layer, MapSettings } from '../store/types';
import type { Level, Mood } from './types';
import type { SkyFrame } from './sky';
import { isDarkRegion, levelMood, roomMood } from './regionGrade';
import { buildRoomIndex } from './roomIndex';
import { roomFace } from './roomUtils';

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
 * table's live room moods (`triggers.roomEdits`) lie over the authored chain. Rooms are
 * resolved once, here; the returned test is a room lookup and a set read.
 */
export function darkTest(
  map: { mapSettings: MapSettings; levels?: readonly Level[] },
  layers: readonly DungeonLayer[],
  levelId: string,
  sky: SkyFrame,
  roomMoods: Readonly<Record<string, { mood?: Mood }>> = {},
): DarkTest {
  const level = map.levels?.find((l) => l.id === levelId);
  const levelDark = isDarkRegion(levelMood(map.mapSettings, level), sky);
  const darkRooms = new Set<string>();
  const darkFaces: [number, number][][] = [];
  const litFaces: [number, number][][] = [];
  const rooms = layers.flatMap((layer) =>
    (layer.rooms ?? []).map((room) => {
      const mood = roomMood(map, layer, room);
      const live = roomMoods[room.id]?.mood;
      const face = roomFace(room);
      if (isDarkRegion(live ? { ...mood, mood: live } : mood, sky)) {
        darkRooms.add(room.id);
        if (face.length >= 3) darkFaces.push(face);
      } else if (face.length >= 3) {
        litFaces.push(face);
      }
      return room;
    }),
  );
  const index = buildRoomIndex(rooms);
  return {
    dark: (x, y) => {
      const room = index.roomAt(x, y);
      return room ? darkRooms.has(room.id) : levelDark;
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
  /** The faces of the rooms that are dark… */
  darkFaces: [number, number][][];
  /** …and of the ones that are not (lit rooms inside a dark level). */
  litFaces: [number, number][][];
}

/** A polygon's edges as sight occluders — how a darkness source blocks sight at its edge. */
export function polygonEdges(
  polygon: readonly [number, number][],
): { x1: number; y1: number; x2: number; y2: number; blocksLight: false; blocksSight: true }[] {
  const out: { x1: number; y1: number; x2: number; y2: number; blocksLight: false; blocksSight: true }[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const [x1, y1] = polygon[i]!;
    const [x2, y2] = polygon[(i + 1) % polygon.length]!;
    if (x1 === x2 && y1 === y2) continue;
    out.push({ x1, y1, x2, y2, blocksLight: false, blocksSight: true });
  }
  return out;
}
