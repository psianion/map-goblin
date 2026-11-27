// The host wizard's starting-room picker, kept out of the page so it is testable without a DOM.
//
// The list is the scene's rooms in the order the editor numbered them, each named the way the
// table names rooms everywhere else ("N · name"). The default is the map's own pick,
// `mapSettings.startingRoomId`, set in the editor's rooms list ("Start the table here"), when
// it still names a room on the map. Each room carries its level, so a map with several levels
// can be listed level by level.

import { roomLabel } from '@dnd/core/src/shared/prep';
import type { Level } from '@dnd/core/src/shared/types';
import { levelIdOf } from '@dnd/core/src/shared/visionGate';
import { computeMapFrame } from '@dnd/core/src/shared/mapBounds';
import type { Layer, MapSettings } from '@dnd/core/src/store/types';
import { roomRing, serverLayers, serverRooms } from '../modules/fog/fog';

export interface StartingRoomOption {
  id: string;
  label: string;
  /** '' on a map with no levels. A room on a layer whose level is unknown is on the first. */
  levelId: string;
  levelName: string;
  /** The room's outline, for the tile's picture (table fix pass F18). Absent when unknown. */
  outline?: [number, number][];
}

export interface StartingRoomPicker {
  rooms: StartingRoomOption[];
  /** The map's levels, in the map's order. */
  levels: Pick<Level, 'id' | 'name'>[];
  /** '' = none, the table starts dark. */
  defaultRoomId: string;
  /** The map's party start (decision f), when it sets one. */
  partyStart?: NonNullable<MapSettings['partyStart']>;
  /** The middle of the map's frame: the start offered when there is no party start and no room. */
  centre: { x: number; y: number } | null;
}

/** A file saved before rooms carried their own names kept them in a per-layer override map. */
function legacyNames(layers: readonly Layer[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const layer of layers) {
    const overrides = (layer as { roomNameOverrides?: Record<string, string> }).roomNameOverrides;
    for (const [id, name] of Object.entries(overrides ?? {})) names.set(id, name);
  }
  return names;
}

export function startingRoomsOf(mapData: unknown): StartingRoomPicker {
  const rooms = serverRooms(mapData);
  const layers = serverLayers(mapData);
  const names = legacyNames(layers);
  const levels = (mapData as { levels?: Level[] } | null)?.levels ?? [];
  const levelOfRoom = new Map<string, string>();
  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    for (const room of layer.rooms ?? []) levelOfRoom.set(room.id, levelIdOf({ levels }, layer));
  }
  // A room with no shape (its floor gone, never placed) is nowhere to start: it is left out.
  const ordered = rooms
    .map((room, i) => ({ room, i, ring: roomRing(room) }))
    .filter(({ ring }) => ring.length >= 3)
    .sort((a, b) => (a.room.number ?? Infinity) - (b.room.number ?? Infinity) || a.i - b.i)
    .map(({ room, i, ring }) => {
      const levelId = levelOfRoom.get(room.id) ?? '';
      return {
        id: room.id,
        label: roomLabel({ ...room, name: names.get(room.id) ?? room.name }) || `Room ${i + 1}`,
        levelId,
        levelName: levels.find((l) => l.id === levelId)?.name ?? '',
        outline: ring,
      };
    });
  const settings = (mapData as { mapSettings?: Partial<MapSettings> } | null)?.mapSettings;
  const wanted = settings?.startingRoomId;
  const start = settings?.partyStart;
  const partyStart = start && Number.isFinite(start.x) && Number.isFinite(start.y) ? start : undefined;
  const frame = computeMapFrame(layers, settings?.terrain?.bounds ?? null, settings?.fixedSize ?? null);
  return {
    rooms: ordered,
    levels: levels.map(({ id, name }) => ({ id, name })),
    defaultRoomId: wanted && ordered.some((room) => room.id === wanted) ? wanted : '',
    ...(partyStart ? { partyStart } : {}),
    centre: frame ? { x: (frame.minX + frame.maxX) / 2, y: (frame.minY + frame.maxY) / 2 } : null,
  };
}
