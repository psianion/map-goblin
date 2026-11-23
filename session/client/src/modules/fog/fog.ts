// The fog tool's arithmetic and vocabulary, kept away from Pixi and React so both can be
// checked without a GPU or a DOM. Rooms come off the loaded map (they are authored data,
// D1); the fog itself comes off the session's `fog` module slice.

import type { Polygon } from '@dnd/core/src/geometry/GeometryEngine';
import { computeMapFrame } from '@dnd/core/src/shared/mapBounds';
import type { Room } from '@dnd/core/src/shared/types';
import type { Layer, SerializedMapData } from '@dnd/core/src/store/types';
import type { DoorsState } from '@dnd/mechanics/doors';
import {
  sceneFogOf,
  toBytes,
  type Cell,
  type FogState,
  type Frame,
  type RegionMask,
  type SceneFog,
} from '@dnd/mechanics/fog';
import { liveDoors, type LiveDoor } from '../doors/doors';

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

/** A block of cells to look at: the first column and row, and how many of each. */
export interface CellBox {
  col: number;
  row: number;
  cols: number;
  rows: number;
}

/** A run of cells along one row, `[col, row, length]`: one rect to fill. */
export type CellRun = [number, number, number];

/** The cells of a box that are in a set, as one run per unbroken stretch of each row. */
export function cellRuns(box: CellBox, inSet: (col: number, row: number) => boolean): CellRun[] {
  const runs: CellRun[] = [];
  for (let row = box.row; row < box.row + box.rows; row++) {
    let start = -1;
    for (let col = box.col; col <= box.col + box.cols; col++) {
      const on = col < box.col + box.cols && inSet(col, row);
      if (on && start < 0) start = col;
      if (!on && start >= 0) {
        runs.push([start, row, col - start]);
        start = -1;
      }
    }
  }
  return runs;
}

/** A line along cell edges, as the grid corners it turns at (`[col, row]`, a corner per cell). */
export interface CellChain {
  points: [number, number][];
  /** A ring, whose last point joins its first; open where it runs into the box's edge unlined. */
  closed: boolean;
}

/**
 * The line between the cells of a set and the cells beside them, along cell edges, merged into
 * as few chains as it takes and with a point only where the line turns. An edge is drawn where a
 * cell in the box is in the set and its neighbour is not and `edgeTo` the neighbour (default:
 * every neighbour, the box's outside included).
 *
 * Each edge runs with the set on the same hand, so following edges end to end walks the set's
 * outline and an L of cells comes back as one ring of six corners.
 */
export function cellOutline(
  box: CellBox,
  inSet: (col: number, row: number) => boolean,
  edgeTo: (col: number, row: number) => boolean = () => true,
): CellChain[] {
  const key = (x: number, y: number): string => `${x},${y}`;
  const out = new Map<string, [number, number][]>();
  const incoming = new Map<string, number>();
  let left = 0;
  const edge = (x0: number, y0: number, x1: number, y1: number): void => {
    const from = key(x0, y0);
    const list = out.get(from);
    if (list) list.push([x1, y1]);
    else out.set(from, [[x1, y1]]);
    incoming.set(key(x1, y1), (incoming.get(key(x1, y1)) ?? 0) + 1);
    left++;
  };
  const lined = (col: number, row: number): boolean => !inSet(col, row) && edgeTo(col, row);
  for (let row = box.row; row < box.row + box.rows; row++) {
    for (let col = box.col; col < box.col + box.cols; col++) {
      if (!inSet(col, row)) continue;
      if (lined(col, row - 1)) edge(col + 1, row, col, row);
      if (lined(col - 1, row)) edge(col, row, col, row + 1);
      if (lined(col, row + 1)) edge(col, row + 1, col + 1, row + 1);
      if (lined(col + 1, row)) edge(col + 1, row + 1, col + 1, row);
    }
  }

  const walk = (start: [number, number]): [number, number][] => {
    const points: [number, number][] = [start];
    let at = start;
    for (;;) {
      const next = out.get(key(at[0], at[1]))?.pop();
      if (!next) return points;
      left--;
      points.push(next);
      at = next;
    }
  };
  /** Drop every point the line runs straight through. */
  const corners = (points: [number, number][], closed: boolean): [number, number][] => {
    const turns = (a: [number, number], b: [number, number], c: [number, number]): boolean =>
      (b[0] - a[0]) * (c[1] - b[1]) !== (b[1] - a[1]) * (c[0] - b[0]);
    const n = points.length;
    return points.filter((p, i) => {
      if (!closed && (i === 0 || i === n - 1)) return true;
      return turns(points[(i - 1 + n) % n]!, p, points[(i + 1) % n]!);
    });
  };

  const chains: CellChain[] = [];
  // Open chains first, one from each corner for every line that starts there and none ends…
  const starts = [...out].map(([from, list]) => [from, list.length - (incoming.get(from) ?? 0)] as const);
  for (const [from, n] of starts) {
    const [x, y] = from.split(',').map(Number) as [number, number];
    for (let i = 0; i < n; i++) chains.push({ points: corners(walk([x, y]), false), closed: false });
  }
  // …then every ring left over.
  for (const [from, list] of out) {
    const [x, y] = from.split(',').map(Number) as [number, number];
    while (left > 0 && list.length > 0) {
      const points = walk([x, y]);
      points.pop();
      chains.push({ points: corners(points, true), closed: true });
    }
  }
  return chains;
}
