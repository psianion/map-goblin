// Pure world-space bounds math. Lives in shared/ because the session server measures a
// map's frame off the raw document at redaction time, and everything else under engine/
// drags pixi in with it.

import type { DungeonLayer, Layer, TerrainData } from '../store/types';

export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Axis-aligned bounds of everything drawn — floor geometry, water, painted terrain —
 * padded for wall strokes and shadows. Null when the map has nothing on it at all
 * (callers that want an export-friendly default box add their own).
 */
export function computeContentBounds(
  layers: readonly Layer[],
  terrainBounds: TerrainData['bounds'] = null,
): WorldBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    const dl = layer as DungeonLayer;
    if (dl.mergedFloor) {
      for (const polygon of dl.mergedFloor) {
        for (const [x, y] of polygon) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    // Floor shapes and water bodies both extend the map. Shapes are walked as well as
    // mergedFloor because mergedFloor is a derived cache that ships null in saved files —
    // on the server (which measures frames off raw documents) it is the only geometry
    // there is. `?? []` because documents straight off disk owe nobody a complete shape.
    for (const child of dl.children ?? []) {
      if ((child.childType !== 'water' && child.childType !== 'shape') || !child.visible) continue;
      for (const [x, y] of child.contours?.[0] ?? []) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  // Painted terrain extends the map too
  if (terrainBounds) {
    minX = Math.min(minX, terrainBounds.minX);
    minY = Math.min(minY, terrainBounds.minY);
    maxX = Math.max(maxX, terrainBounds.maxX);
    maxY = Math.max(maxY, terrainBounds.maxY);
  }

  if (!isFinite(minX)) return null;

  // Pad bounds to capture wall strokes and shadows that extend beyond floor geometry
  let pad = 0;
  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    const dl = layer as DungeonLayer;
    const s = dl.style;
    const wallW = s?.wallWidth ?? 0;
    // Wall strokes are centered on the polygon edge — half extends outward
    pad = Math.max(pad, wallW / 2);
    // Shadow is offset from the floor
    if (s?.shadowEnabled) {
      pad = Math.max(pad, Math.abs(s.shadowOffset?.x ?? 0) + wallW / 2);
      pad = Math.max(pad, Math.abs(s.shadowOffset?.y ?? 0) + wallW / 2);
    }
  }
  // Add a small extra margin for anti-aliasing
  pad += 0.05;

  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

/**
 * The map's confining rectangle: content bounds snapped out to whole cells plus one cell
 * of air. The line-grid fills it and the player fog covers it, so the two always agree on
 * where the map ends and the dotted void begins. Null while nothing is drawn — an empty
 * map is all void, no frame.
 */
export function computeMapFrame(
  layers: readonly Layer[],
  terrainBounds: TerrainData['bounds'] = null,
): WorldBounds | null {
  const b = computeContentBounds(layers, terrainBounds);
  if (!b) return null;
  return {
    minX: Math.floor(b.minX) - 1,
    minY: Math.floor(b.minY) - 1,
    maxX: Math.ceil(b.maxX) + 1,
    maxY: Math.ceil(b.maxY) + 1,
  };
}
