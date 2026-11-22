// The fog tool's arithmetic and vocabulary, kept away from Pixi and React so both can be
// checked without a GPU or a DOM. Rooms come off the loaded map (they are authored data,
// D1); the fog itself comes off the session's `fog` module slice.

import type { Polygon } from '@dnd/core/src/geometry/GeometryEngine';
import { computeMapFrame } from '@dnd/core/src/shared/mapBounds';
import type { Room, ZoneChild } from '@dnd/core/src/shared/types';
import type { Layer, SerializedMapData } from '@dnd/core/src/store/types';
import type { DoorsState } from '@dnd/mechanics/doors';
import {
  cellsCoveredByPolygon,
  sceneFogOf,
  toBytes,
  type Cell,
  type FogState,
  type Frame,
  type RegionMask,
  type RoomFogStatus,
  type SceneFog,
} from '@dnd/mechanics/fog';
import { liveDoors, type LiveDoor } from '../doors/doors';

/**
 * What a DM reads for each status. The word is the state; colour never carries it alone.
 * T11: a row revealed once and hidden again is fogged fully for players since T10, so it reads
 * Hidden, not Explored.
 */
export const FOG_STATUS_LABEL: Record<RoomFogStatus, string> = {
  never_revealed: 'Unrevealed',
  revealed: 'Revealed',
  re_hidden: 'Hidden',
};

/**
 * A room as the table holds it: `boundary` is the room's face. Both seats' documents come from
 * the server with every face already derived by core's `syncRooms` (the player's copy always;
 * the DM's through `?rooms=derived`).
 */
export type TableRoom = Room & { boundary: [number, number][] };

/** A room's face, whichever field holds it: the document's `boundary`, else a synced `face`. */
export const roomRing = (room: Room): [number, number][] => room.boundary ?? room.face ?? [];

/**
 * Every zoned area of the loaded map. Corridors are rooms (D6) — nothing filters them. A room the
 * server sent as a stand-in (`Room.standIn`) is art only, for the floor it lies under: it is never
 * a room the player holds, so the fog never counts it.
 */
export function roomsOfLayers(layers: readonly Layer[]): TableRoom[] {
  return layers.flatMap((layer) =>
    layer.type === 'dungeon'
      ? (layer.rooms ?? [])
          .filter((room) => !room.standIn)
          .map((room): TableRoom => (room.boundary ? (room as TableRoom) : { ...room, boundary: roomRing(room) }))
      : [],
  );
}

export function serverLayers(mapData: unknown): Layer[] {
  return (mapData as { layers?: Layer[] } | null)?.layers ?? [];
}

/**
 * The rooms of the document the server sent rather than core's store: it is already redacted to
 * exactly the rooms a player may know about, and its faces are the referee's own.
 */
export function serverRooms(mapData: unknown): TableRoom[] {
  return roomsOfLayers(serverLayers(mapData));
}

/**
 * The doors of the document the server sent, at the state the table is playing them: the
 * document's own door records carry the room ids the server redacted with, and live state comes
 * off the session's `doors` slice.
 */
export function serverDoors(
  mapData: unknown,
  doorsState: DoorsState | undefined,
  sceneId: string | null | undefined,
): LiveDoor[] {
  return liveDoors(serverLayers(mapData), doorsState, sceneId);
}

/** How many cells a record holds — what `__fogProbe.clearedCells` reports. */
export function regionCells(region: RegionMask | undefined): number {
  if (!region) return 0;
  const bytes = toBytes(region.bits);
  let n = 0;
  for (let bit = 0; bit < region.cols * region.rows; bit++) {
    if ((bytes[bit >>> 3] & (1 << (bit & 7))) !== 0) n++;
  }
  return n;
}

/** The scene's fog: an untouched scene, a missing slice and no active scene all read as fog off. */
export function sceneFog(state: FogState | undefined, sceneId: string | null | undefined): SceneFog {
  const scene = sceneId ? state?.byScene?.[sceneId] : undefined;
  return scene ?? sceneFogOf({ byScene: {} }, '');
}

export { roomFogOf as roomFog } from '@dnd/mechanics/fog';

/**
 * The rectangle a region cell is counted from, exactly as the server counts it.
 *
 * A player's copy arrives with the referee's own `frame` stamped on it; the DM's copy is the
 * authored file, which carries none — so the DM's is measured here with the very function the
 * server measured it with (`sceneMap.frame`). Same inputs, same arithmetic, so a cell the DM's
 * brush names is the cell the server writes.
 */
export function fogFrame(mapData: unknown): Frame | null {
  const doc = mapData as SerializedMapData | null;
  if (!doc) return null;
  return (
    doc.frame ??
    computeMapFrame(
      doc.layers ?? [],
      doc.mapSettings?.terrain?.bounds ?? null,
      doc.mapSettings?.fixedSize ?? null,
    )
  );
}

/**
 * The ground the map carries terrain paint on: the document's own switches, and the paint
 * itself as `decodePaintedArea` read it off the splat bitmaps (`paintedArea` on the session
 * store). Nothing painted, nothing switched on, or an empty palette ⇒ no painted ground at all.
 * Null while the decode is in flight, which reads here as no paint at all.
 */
export function paintedGround(mapData: unknown, decoded: Polygon[] | null): Polygon[] {
  const terrain = (mapData as SerializedMapData | null)?.mapSettings?.terrain;
  if (!terrain?.bounds || terrain.visible === false) return [];
  if (!(terrain.palette ?? []).some(Boolean)) return [];
  const { minX, minY, maxX, maxY } = terrain.bounds;
  if (!(maxX > minX && maxY > minY)) return [];
  return decoded ?? [];
}

/**
 * A world point as a region cell, or null off the frame — the `cellsCoveredByPolygon`
 * convention (cell `[col, row]` is the square whose centre is `minX + col + 0.5`), which is
 * what makes a brushed cell and a swept cell the same cell.
 */
export function cellAt(frame: Frame, x: number, y: number): Cell | null {
  const [col, row] = [Math.floor(x - frame.minX), Math.floor(y - frame.minY)];
  const [cols, rows] = [Math.round(frame.maxX - frame.minX), Math.round(frame.maxY - frame.minY)];
  return col < 0 || row < 0 || col >= cols || row >= rows ? null : [col, row];
}

/**
 * Rooms the region record has bits inside. The mask is decoded once for all the rooms rather
 * than per cell, and each room stops at its first set bit.
 */
export function partlySeenRooms(rooms: readonly Room[], region: RegionMask | undefined): Set<string> {
  const seen = new Set<string>();
  if (!region) return seen;
  const bytes = toBytes(region.bits);
  const frame = {
    minX: region.minX,
    minY: region.minY,
    maxX: region.minX + region.cols,
    maxY: region.minY + region.rows,
  };
  for (const room of rooms) {
    const ring = roomRing(room);
    if (ring.length < 3) continue;
    for (const [col, row] of cellsCoveredByPolygon(ring, frame)) {
      const bit = row * region.cols + col;
      if ((bytes[bit >>> 3] & (1 << (bit & 7))) !== 0) {
        seen.add(room.id);
        break;
      }
    }
  }
  return seen;
}

/**
 * Every authored explore lock in the layers handed over, as a rectangle each. Only ever
 * non-empty on the DM's copy: a zone is prep, and the redaction strips zones from a player's
 * document unconditionally.
 *
 * ponytail: a circle lock becomes its bounding box, which over-fences rather than under.
 */
export function exploreLocks(layers: readonly Layer[]): Polygon[] {
  return layers
    .flatMap((layer) => (layer.type === 'dungeon' ? layer.children : []))
    .filter((child): child is ZoneChild => child.childType === 'zone' && !!child.blocksAutoExplore)
    .flatMap((zone) => {
      const s = zone.shape;
      const box =
        s.kind === 'circle'
          ? [s.position.x - s.radius, s.position.y - s.radius, s.position.x + s.radius, s.position.y + s.radius]
          : // A point zone has no area to lock, and the server refuses it too (`exploreLocks`).
            s.kind === 'rect'
            ? [s.x, s.y, s.x + s.width, s.y + s.height]
            : null;
      if (!box) return [];
      const [x0, y0, x1, y1] = box;
      return [
        [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
        ] as Polygon,
      ];
    });
}

/**
 * Rooms an authored explore lock covers — the DM's badge for "the party's own sight will never
 * open this one". Box against box, not shape against polygon.
 */
export function lockedRooms(rooms: readonly Room[], layers: readonly Layer[]): Set<string> {
  const locks = exploreLocks(layers).map((poly) => [poly[0][0], poly[0][1], poly[2][0], poly[2][1]]);

  const locked = new Set<string>();
  if (locks.length === 0) return locked;
  for (const room of rooms) {
    const ring = roomRing(room);
    if (ring.length < 3) continue;
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    const [rx0, rx1, ry0, ry1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    if (locks.some(([x0, y0, x1, y1]) => x0 < rx1 && x1 > rx0 && y0 < ry1 && y1 > ry0)) {
      locked.add(room.id);
    }
  }
  return locked;
}
