// The Material brush's patches: a freehand stroke, as wide as the brush, closes into one
// solid patch of a material (a band set: its border units, and the floor that fills it).
// A stroke that touches patches of the same material merges with them into one; Erase
// subtracts the stroke from every patch on the layer. Saved on the layer as Clipper rings
// (outer rings and holes wound opposite ways, filled non-zero).

import type { Polygon } from '../types/geometry';
import { clipper2Engine } from '../geometry/Clipper2Engine';

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
  /** The outline is a wall: it blocks light and sight and takes doors. Absent = false. */
  wall?: boolean;
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
 * `patches` with the stroke `area` painted in `material`: the patches of that material it
 * touches merge with it into one (keeping the first one's id and place), taking the
 * stroke's Smooth, Border and Wall; the others stay as they were.
 */
export function paintPatch(
  patches: readonly MaterialPatch[],
  area: Polygon[],
  material: string,
  look: { smooth: boolean; border: boolean; wall?: boolean },
  newId: string,
): MaterialPatch[] {
  if (area.length === 0) return [...patches];
  const touching = patches.filter(
    (p) => p.material === material && clipper2Engine.intersection(p.rings, area).some((r) => Math.abs(ringArea(r)) > 1e-6),
  );
  const rings = clipper2Engine.union([...touching.flatMap((p) => p.rings), ...area], []);
  const merged: MaterialPatch = { id: touching[0]?.id ?? newId, material, rings, smooth: look.smooth, border: look.border };
  // Absent rather than false, so a patch painted without it saves as it always did.
  if (look.wall) merged.wall = true;
  const out: MaterialPatch[] = [];
  let placed = false;
  for (const p of patches) {
    if (!touching.includes(p)) out.push(p);
    else if (!placed) {
      out.push(merged);
      placed = true;
    }
  }
  if (!placed) out.push(merged);
  return out;
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
function cutCorners(ring: Polygon): Polygon {
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
  return patch.rings.map((ring) => {
    let out = clipper2Engine.simplify([ring], SMOOTH_SIMPLIFY)[0] ?? ring;
    if (out.length < 3) return ring;
    for (let k = 0; k < SMOOTH_PASSES; k++) out = cutCorners(out);
    return out;
  });
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
