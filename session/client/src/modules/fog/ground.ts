// What share of the map the players still have under fog, for the Fog card's caption.
//
// Measured against ground, not the frame: Clear all fills each level's whole frame, and a map
// is mostly void round its rooms, so a share of the frame would read "40% fogged" on a map the
// players can see every inch of. Ground is what the referee lets the brush clear (the walk
// grid's ground, `session/server/src/fog/walk.ts`): the level's base ground, its visible
// ground pieces, its walled floors, or, with none of those, the whole frame.

import type { Polygon } from '@dnd/core/src/geometry/GeometryEngine';
import { baseGroundOf, inRingsEvenOdd, isGroundPiece, pieceRings } from '@dnd/core/src/shared/pieces';
import type { ShapeChild } from '@dnd/core/src/shared/types';
import { layersOnLevel } from '@dnd/core/src/shared/visionGate';
import type { Layer, Level, MapSettings } from '@dnd/core/src/store/types';
import { rebaseRegion, regionOf, toBytes, type Frame, type RegionMask } from '@dnd/mechanics/fog';

export interface GroundMap {
  layers: readonly Layer[];
  levels: readonly Level[];
  mapSettings: Pick<MapSettings, 'ground'>;
}

interface Shape {
  rings: Polygon[];
  /** Where a piece kept to the floors may show; absent = anywhere it covers. */
  kept?: Polygon[];
}

function boxOf(rings: readonly Polygon[]): [number, number, number, number] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings) {
    for (const [x, y] of ring) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return [x0, y0, x1, y1];
}

/** One level's ground as one byte per cell of `grid` (1 = ground), or null for "all of it". */
export function groundCells(map: GroundMap, levelId: string, grid: RegionMask): Uint8Array | null {
  const level = map.levels.find((l) => l.id === levelId) ?? null;
  if (baseGroundOf(map.mapSettings, level)) return null;
  const layers = layersOnLevel(map, map.layers, levelId);
  const shapes: Shape[] = [];
  for (const layer of layers) {
    const floor = layer.mergedFloor ?? [];
    if (floor.length > 0) shapes.push({ rings: floor });
    for (const child of layer.children ?? []) {
      if (!isGroundPiece(child) || child.visible === false) continue;
      const kept = (child as ShapeChild).keptToFloors && floor.length > 0 ? floor : undefined;
      shapes.push({ rings: pieceRings(child), kept });
    }
  }
  if (shapes.length === 0) return null;
  const cells = new Uint8Array(grid.cols * grid.rows);
  for (const shape of shapes) {
    const [x0, y0, x1, y1] = boxOf(shape.rings);
    const c0 = Math.max(0, Math.floor(x0 - grid.minX));
    const c1 = Math.min(grid.cols - 1, Math.ceil(x1 - grid.minX));
    const r0 = Math.max(0, Math.floor(y0 - grid.minY));
    const r1 = Math.min(grid.rows - 1, Math.ceil(y1 - grid.minY));
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const i = row * grid.cols + col;
        if (cells[i]) continue;
        const [x, y] = [grid.minX + col + 0.5, grid.minY + row + 0.5];
        if (inRingsEvenOdd(x, y, shape.rings) && (!shape.kept || inRingsEvenOdd(x, y, shape.kept))) cells[i] = 1;
      }
    }
  }
  return cells;
}

/** Per level, its ground on the frame's grid. Built once per map, since it walks every shape. */
export function groundOfMap(map: GroundMap, frame: Frame): { levelId: string; cells: Uint8Array | null }[] | null {
  const grid = regionOf(frame);
  if (!grid) return null;
  const ids = map.levels.length > 0 ? map.levels.map((l) => l.id) : ['level-1'];
  return ids.map((levelId) => ({ levelId, cells: groundCells(map, levelId, grid) }));
}

/**
 * The share of the map's ground still under fog, 0 to 1, across every level. `ground` is
 * {@link groundOfMap}'s answer for the same frame. One with no ground at all reads as fogged.
 */
export function foggedShare(
  ground: readonly { levelId: string; cells: Uint8Array | null }[],
  cleared: Record<string, RegionMask> | undefined,
  frame: Frame,
): number {
  const grid = regionOf(frame);
  if (!grid) return 1;
  const n = grid.cols * grid.rows;
  let total = 0;
  let open = 0;
  for (const { levelId, cells } of ground) {
    const mask = rebaseRegion(cleared?.[levelId], frame);
    const bits = mask ? toBytes(mask.bits) : null;
    for (let i = 0; i < n; i++) {
      if (cells && !cells[i]) continue;
      total++;
      if (bits && (bits[i >>> 3] & (1 << (i & 7))) !== 0) open++;
    }
  }
  return total === 0 ? 1 : 1 - open / total;
}
