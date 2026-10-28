// Pure world-space bounds math. Lives in shared/ because the session server measures a
// map's frame off the raw document at redaction time, and everything else under engine/
// drags pixi in with it.

import type { AssetChild, DungeonLayer, Layer, MapSettings, TerrainData } from '../store/types';

export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Bounds of the placed art alone. Exported because a player's table camera asks for it on
 * its own: redaction strips their document down to children, so the map-wide floor ring
 * never ships and the sprites are often the only geometry there is.
 *
 * The true rotated box per sprite, the same formula `pointInAsset`'s caller uses in
 * hitTest. An earlier version took half the diagonal, which is rotation-safe but measures
 * every sprite as a square: an unrotated 16x22 battlemap came out 27x27, and since this
 * feeds the map frame, that slack became export size and fog cells.
 */
export function assetBounds(layers: readonly Layer[]): WorldBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    for (const child of (layer as DungeonLayer).children ?? []) {
      if (child.childType !== 'asset' || !child.visible) continue;
      const a = child as AssetChild;
      const scale = Math.abs(a.scale || 1);
      const halfW = (a.width * scale) / 2;
      const halfH = (a.height * scale) / 2;
      // Rotation is radians, matching sprite.rotation and hitTest.
      const cos = Math.abs(Math.cos(a.rotation || 0));
      const sin = Math.abs(Math.sin(a.rotation || 0));
      const rx = halfW * cos + halfH * sin;
      const ry = halfW * sin + halfH * cos;
      if (a.position.x - rx < minX) minX = a.position.x - rx;
      if (a.position.y - ry < minY) minY = a.position.y - ry;
      if (a.position.x + rx > maxX) maxX = a.position.x + rx;
      if (a.position.y + ry > maxY) maxY = a.position.y + ry;
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/**
 * The raw extent of everything drawn — floor geometry, water, standalone walls, placed
 * assets, painted terrain — with no allowance yet for how wide a wall is stroked. Null when
 * nothing is drawn.
 */
function drawnBounds(
  layers: readonly Layer[],
  terrainBounds: TerrainData['bounds'],
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
    // A wall drawn out past the floor is still map — the DM drew it, so it counts.
    for (const wall of dl.standaloneWalls ?? []) {
      for (const [x, y] of wall.points) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  // Placed art extends the map too — dropping an asset on empty ground grows the boundary
  const art = assetBounds(layers);
  if (art) {
    minX = Math.min(minX, art.minX);
    minY = Math.min(minY, art.minY);
    maxX = Math.max(maxX, art.maxX);
    maxY = Math.max(maxY, art.maxY);
  }

  // Painted terrain extends the map too
  if (terrainBounds) {
    minX = Math.min(minX, terrainBounds.minX);
    minY = Math.min(minY, terrainBounds.minY);
    maxX = Math.max(maxX, terrainBounds.maxX);
    maxY = Math.max(maxY, terrainBounds.maxY);
  }

  return isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/** How far wall strokes reach past the geometry that carries them. */
function strokePad(layers: readonly Layer[]): number {
  let pad = 0;
  for (const layer of layers) {
    if (layer.type !== 'dungeon') continue;
    const dl = layer as DungeonLayer;
    const s = dl.style;
    const wallW = s?.wallWidth ?? 0;
    // Wall strokes are centered on the polygon edge — half extends outward
    pad = Math.max(pad, wallW / 2);
    // A standalone wall carries its own width, which need not match the layer's
    for (const wall of dl.standaloneWalls ?? []) pad = Math.max(pad, (wall.width ?? wallW) / 2);
  }
  // Add a small extra margin for anti-aliasing
  return pad + 0.05;
}

/**
 * Axis-aligned bounds of everything drawn — floor geometry, water, standalone walls,
 * placed assets, painted terrain — padded for wall strokes. Null when the map
 * has nothing on it at all (callers that want an export-friendly default box add their own).
 */
export function computeContentBounds(
  layers: readonly Layer[],
  terrainBounds: TerrainData['bounds'] = null,
): WorldBounds | null {
  const b = drawnBounds(layers, terrainBounds);
  if (!b) return null;
  // Pad bounds to capture wall strokes that extend beyond floor geometry
  const pad = strokePad(layers);
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
}

/** Float slack for "drawn past the pinned edge": a sprite sized to the map is not past it. */
const EDGE_EPSILON = 1e-6;

/**
 * The map's confining rectangle: content bounds snapped out to the enclosing whole cells,
 * then one more cell all round, so there is always a full square of clear ground past the
 * outermost thing drawn. The player fog covers exactly this, so where the map ends and the
 * dotted void begins is one agreed-upon line. Null while nothing is drawn — an empty map is
 * all void, no frame.
 *
 * `fixedSize` is the DM pinning a minimum sheet instead of measuring one: that size,
 * anchored at the origin, is the frame for as long as everything drawn sits on it. It is a
 * floor, not a cap. Draw past one of its edges and the frame grows on that side — and only
 * that side — out to where the measured frame would put it, so the map never has drawn
 * geometry hanging off its edge into the void, the export or the fog. "Past" means the
 * geometry itself, not its stroke padding: a battlemap or a room built flush to the pinned
 * edge leaves the frame exactly where the DM pinned it. No tool clamps to this.
 */
export function computeMapFrame(
  layers: readonly Layer[],
  terrainBounds: TerrainData['bounds'] = null,
  fixedSize: MapSettings['fixedSize'] = null,
): WorldBounds | null {
  const drawn = drawnBounds(layers, terrainBounds);
  const pinned = fixedSize
    ? { minX: 0, minY: 0, maxX: fixedSize.width, maxY: fixedSize.height }
    : null;
  if (!drawn) return pinned;
  const pad = strokePad(layers);
  const measured = {
    minX: Math.floor(drawn.minX - pad) - 1,
    minY: Math.floor(drawn.minY - pad) - 1,
    maxX: Math.ceil(drawn.maxX + pad) + 1,
    maxY: Math.ceil(drawn.maxY + pad) + 1,
  };
  if (!pinned) return measured;
  return {
    minX: drawn.minX < pinned.minX - EDGE_EPSILON ? Math.min(pinned.minX, measured.minX) : pinned.minX,
    minY: drawn.minY < pinned.minY - EDGE_EPSILON ? Math.min(pinned.minY, measured.minY) : pinned.minY,
    maxX: drawn.maxX > pinned.maxX + EDGE_EPSILON ? Math.max(pinned.maxX, measured.maxX) : pinned.maxX,
    maxY: drawn.maxY > pinned.maxY + EDGE_EPSILON ? Math.max(pinned.maxY, measured.maxY) : pinned.maxY,
  };
}
