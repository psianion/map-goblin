// The Material brush's patches: a freehand stroke, as wide as the brush, closes into one
// solid patch of a material (a band set: its border units, and the floor that fills it).
// A stroke that touches patches of the same material merges with them into one; Erase
// subtracts the stroke from every patch on the layer. Saved on the layer as Clipper rings
// (outer rings and holes wound opposite ways, filled non-zero).

import type { Polygon } from '../types/geometry';
import { clipper2Engine, isClipperReady } from '../geometry/Clipper2Engine';

export interface MaterialPatch {
  id: string;
  /** The band set whose border units go round the patch ('GG_Cave_Ink'). */
  material: string;
  /** The patch's outline: outer rings and holes, as the stroke and its merges left them. */
  rings: Polygon[];
  /** Rounded before the border goes on. */
  smooth: boolean;
  /** The material's border units laid round the outline. */
  border: boolean;
  /**
   * A water patch's shore: a floor texture id laid as a band on the land side, or 'none'.
   * Absent = the outdoor dirt floor. Only water patches carry it.
   */
  shore?: string;
  /** The shore band's width, cells. Absent = 0.5. */
  shoreWidth?: number;
  /** A pale line just inside the water along its edge. Absent = off. */
  shallowLine?: boolean;
  /** How high the patch stands, cells (whole or half, -10 to 10), as a floor's `height`. Absent = 0. */
  height?: number;
  /**
   * Ground: a plain texture patch whose stroke started off every floor. Kept whole and drawn
   * under the layer's floors, which simply cover it. Absent: a patch painted on a floor (kept
   * to the floors) or one saved before the flag (trimmed to the floors as it is drawn).
   */
  ground?: boolean;
}

/** The look a stroke paints with: what a patch is drawn with besides its outline. */
export type PatchLook = Pick<MaterialPatch, 'smooth' | 'border' | 'shore' | 'shoreWidth' | 'shallowLine' | 'height' | 'ground'>;

/**
 * Whether a patch shows only on its layer's floors: a plain texture's (a pack-scoped id; a
 * band set's carries no prefix, see materialKit's `isTextureMaterial`) that is not ground.
 * A band set's patch and a ground patch are drawn whole.
 */
export function keptToFloors(patch: Pick<MaterialPatch, 'material' | 'ground'>): boolean {
  return patch.material.includes(':') && !patch.ground;
}

/** A water shore's width, cells: the card's (this when unset), kept to SHORE_MIN_WIDTH..SHORE_MAX_WIDTH. */
export const SHORE_DEFAULT_WIDTH = 0.5;
export const SHORE_MIN_WIDTH = 0.25;
export const SHORE_MAX_WIDTH = 2;

export function shoreWidthOf(width: number | undefined): number {
  return Math.max(SHORE_MIN_WIDTH, Math.min(SHORE_MAX_WIDTH, width ?? SHORE_DEFAULT_WIDTH));
}

/** Whether a stroke of `material` in `look` merges with patch `p`: same material, same shore, same height, and ground with ground only. */
function mergesWith(p: MaterialPatch, material: string, look: PatchLook): boolean {
  return (
    p.material === material &&
    p.shore === look.shore &&
    p.shoreWidth === look.shoreWidth &&
    (p.shallowLine ?? false) === (look.shallowLine ?? false) &&
    (p.height ?? 0) === (look.height ?? 0) &&
    (p.ground ?? false) === (look.ground ?? false)
  );
}

/** How closely a smoothed outline keeps to the painted one before it is rounded, in cells. */
const SMOOTH_SIMPLIFY = 0.2;
/** Corner-cutting passes a smoothed outline gets: each rounds every corner further. */
const SMOOTH_PASSES = 3;
/** A patch smaller than this, in square cells, is gone (an erase that left crumbs). */
const MIN_AREA = 0.02;

function ringArea(ring: Polygon): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** The area the rings cover, holes taken out. */
export function patchArea(rings: readonly Polygon[]): number {
  return Math.abs(rings.reduce((n, r) => n + ringArea(r), 0));
}

/**
 * What a stroke along `points` with a brush of `radius` cells covers: the line grown by the
 * radius with round ends and joins. A single point is a disc.
 */
export function strokeArea(points: readonly [number, number][], radius: number): Polygon[] {
  if (points.length === 0 || radius <= 0) return [];
  const line: Polygon = points.length === 1 ? [points[0], [points[0][0] + 1e-3, points[0][1]]] : [...points];
  return clipper2Engine.inflateOpen([line], radius);
}

/**
 * `patches` with the stroke `area` painted in `material`: the patches of that material and
 * shore it touches merge with it into one (keeping the first one's id), taking the stroke's
 * Smooth and Border; the others stay as they were. The painted patch goes on top: last in
 * the list, so last among the ground patches or among the rest, whichever it is.
 */
export function paintPatch(
  patches: readonly MaterialPatch[],
  area: Polygon[],
  material: string,
  look: PatchLook,
  newId: string,
): MaterialPatch[] {
  if (area.length === 0) return [...patches];
  const touching = patches.filter(
    (p) => mergesWith(p, material, look) && clipper2Engine.intersection(p.rings, area).some((r) => Math.abs(ringArea(r)) > 1e-6),
  );
  const rings = clipper2Engine.union([...touching.flatMap((p) => p.rings), ...area], []);
  const merged: MaterialPatch = { id: touching[0]?.id ?? newId, material, rings, smooth: look.smooth, border: look.border };
  // Optional fields only when set, so a patch painted with the defaults saves as before.
  if (look.shore !== undefined) merged.shore = look.shore;
  if (look.shoreWidth !== undefined) merged.shoreWidth = look.shoreWidth;
  if (look.shallowLine) merged.shallowLine = true;
  if (look.height) merged.height = look.height;
  if (look.ground) merged.ground = true;
  return [...patches.filter((p) => !touching.includes(p)), merged];
}

/** `patches` with `area` cut out of every one; a patch cut away entirely goes. */
export function erasePatches(patches: readonly MaterialPatch[], area: Polygon[]): MaterialPatch[] {
  if (area.length === 0) return [...patches];
  return patches.flatMap((p) => {
    const rings = clipper2Engine.difference(p.rings, area);
    return patchArea(rings) < MIN_AREA ? [] : [{ ...p, rings }];
  });
}

/** One pass of Chaikin's corner cutting over a closed ring: each edge keeps its middle half. */
export function cutCorners(ring: Polygon): Polygon {
  const out: Polygon = [];
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
  }
  return out;
}

/**
 * The outline the patch is drawn to and its border laid along: its rings, or with Smooth
 * each ring simplified a little and its corners cut round, so the brush's scallops and the
 * stroke's corners become one smooth curve that stays inside the painted outline.
 */
export function patchOutline(patch: Pick<MaterialPatch, 'rings' | 'smooth'>): Polygon[] {
  if (!patch.smooth) return patch.rings;
  const hit = smoothed.get(patch.rings);
  if (hit) return hit;
  const outline = patch.rings.map((ring) => {
    let out = clipper2Engine.simplify([ring], SMOOTH_SIMPLIFY)[0] ?? ring;
    if (out.length < 3) return ring;
    for (let k = 0; k < SMOOTH_PASSES; k++) out = cutCorners(out);
    return out;
  });
  // Kept per stored rings, so asking what stands at a point does not smooth the patch again.
  if (isClipperReady()) smoothed.set(patch.rings, outline);
  return outline;
}

const smoothed = new WeakMap<readonly Polygon[], Polygon[]>();

/** Inside a set of rings by even-odd: holes count as outside. */
export function pointInRings(x: number, y: number, rings: readonly Polygon[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/**
 * Whether a patch covers a point as it is drawn: inside its outline (rounded, with Smooth),
 * and for a patch kept to the floors (`keptToFloors`) on a layer that has any, on the floor
 * too. `floor` is the layer's `mergedFloor`.
 */
export function patchCovers(
  patch: Pick<MaterialPatch, 'rings' | 'smooth' | 'material' | 'ground'>,
  floor: readonly Polygon[] | null | undefined,
  x: number,
  y: number,
): boolean {
  if (!pointInRings(x, y, patchOutline(patch))) return false;
  return !keptToFloors(patch) || !floor || floor.length === 0 || pointInRings(x, y, floor);
}

/** The patches' world bounds, in cells; null for none. */
export function patchesBounds(patches: readonly MaterialPatch[] | undefined): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of patches ?? []) {
    for (const ring of p.rings) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}
