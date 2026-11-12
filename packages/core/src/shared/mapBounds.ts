// Pure world-space bounds math. Lives in shared/ because the session server measures a
// map's frame off the raw document at redaction time, and everything else under engine/
// drags pixi in with it.

import type { AssetChild, DungeonLayer, Layer, MapSettings, TerrainData } from '../store/types';
import { shapeRing } from './plateaus';
import { waterBounds } from './waterMask';
import { keptToFloors, patchesBounds } from './materialPatch';
import { pathwayBounds } from './pathway';
import { dropShadeWidth, slopeWidthOf } from './plateauShade';

/** How far past its ring a raised cliff's ledge and what hangs under it reach, cells. */
const CLIFF_REACH = 1.2;

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
 *
 * With `pinned`, an imported picture (objectType 'image') that hangs less than one cell past
 * a pinned edge is measured to that edge: a battlemap lined up on its grid keeps the part
 * cell at its border, and the frame cuts it rather than growing a ring of void around it.
 */
export function assetBounds(layers: readonly Layer[], pinned: WorldBounds | null = null): WorldBounds | null {
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
      let left = a.position.x - rx;
      let top = a.position.y - ry;
      let right = a.position.x + rx;
      let bottom = a.position.y + ry;
      if (pinned && a.objectType === 'image') {
        if (left < pinned.minX && left > pinned.minX - 1) left = pinned.minX;
        if (top < pinned.minY && top > pinned.minY - 1) top = pinned.minY;
        if (right > pinned.maxX && right < pinned.maxX + 1) right = pinned.maxX;
        if (bottom > pinned.maxY && bottom < pinned.maxY + 1) bottom = pinned.maxY;
      }
      if (left < minX) minX = left;
      if (top < minY) minY = top;
      if (right > maxX) maxX = right;
      if (bottom > maxY) maxY = bottom;
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/** The box of a layer's floors: its union when it has one, and its visible floor shapes. Null with neither. */
function floorBox(layer: DungeonLayer): WorldBounds | null {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const rings = [
    ...(layer.mergedFloor ?? []),
    ...(layer.children ?? []).flatMap((c) => (c.childType === 'shape' && c.visible ? [c.contours?.[0] ?? []] : [])),
  ];
  for (const ring of rings) {
    for (const [x, y] of ring) {
      box.minX = Math.min(box.minX, x);
      box.minY = Math.min(box.minY, y);
      box.maxX = Math.max(box.maxX, x);
      box.maxY = Math.max(box.maxY, y);
    }
  }
  return Number.isFinite(box.minX) ? box : null;
}

/**
 * The raw extent of everything drawn — floor geometry, plateaus, standalone walls, placed
 * assets, painted terrain — with no allowance yet for how wide a wall is stroked. Null when
 * nothing is drawn.
 */
function drawnBounds(
  layers: readonly Layer[],
  terrainBounds: TerrainData['bounds'],
  pinned: WorldBounds | null = null,
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
    // Floor shapes extend the map. Shapes are walked as well as
    // mergedFloor because mergedFloor is a derived cache that ships null in saved files —
    // on the server (which measures frames off raw documents) it is the only geometry
    // there is. `?? []` because documents straight off disk owe nobody a complete shape.
    for (const child of dl.children ?? []) {
      if (child.childType !== 'shape' || !child.visible) continue;
      for (const [x, y] of child.contours?.[0] ?? []) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    // Painted water is map, whether or not a floor lies under it.
    const water = waterBounds(dl.water);
    if (water) {
      minX = Math.min(minX, water.minX);
      minY = Math.min(minY, water.minY);
      maxX = Math.max(maxX, water.maxX);
      maxY = Math.max(maxY, water.maxY);
    }
    // And paths, out to their width.
    for (const child of dl.children ?? []) {
      if (child.childType !== 'pathway' || !child.visible) continue;
      const b = pathwayBounds(child);
      if (!b) continue;
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
    // So are Material brush patches, as far as they are drawn: paint on a floor shows no
    // further than the layer's floors (their box here: no union ships on the server).
    const floors = floorBox(dl);
    for (const patch of dl.materials ?? []) {
      const b = patchesBounds([patch]);
      if (!b) continue;
      if (floors && keptToFloors(patch)) {
        b.minX = Math.max(b.minX, floors.minX);
        b.minY = Math.max(b.minY, floors.minY);
        b.maxX = Math.min(b.maxX, floors.maxX);
        b.maxY = Math.min(b.maxY, floors.maxY);
        if (b.minX > b.maxX || b.minY > b.maxY) continue;
      }
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
    // A plateau is map too, out to where its edge falls: a slope's band (its card width), any
    // other edge's drop shade, and past that a cliff's ledge. A pit's edge falls inward and
    // reaches no further than its ring.
    for (const child of dl.children ?? []) {
      if (child.childType !== 'plateau' || !child.visible || (child.contours?.[0]?.length ?? 0) < 3) continue;
      const rise = child.height > 0 ? child.height : 0;
      const pad =
        rise === 0
          ? 0
          : child.edge === 'slope'
            ? slopeWidthOf(child.slopeWidth)
            : Math.max(dropShadeWidth(rise), child.edge === 'cliff' ? CLIFF_REACH : 0);
      for (const [x, y] of shapeRing(child, 0)) {
        minX = Math.min(minX, x - pad);
        minY = Math.min(minY, y - pad);
        maxX = Math.max(maxX, x + pad);
        maxY = Math.max(maxY, y + pad);
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
  const art = assetBounds(layers, pinned);
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
 * Axis-aligned bounds of everything drawn — floor geometry, plateaus, standalone walls,
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
  const pinned = fixedSize
    ? { minX: 0, minY: 0, maxX: fixedSize.width, maxY: fixedSize.height }
    : null;
  const drawn = drawnBounds(layers, terrainBounds, pinned);
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
