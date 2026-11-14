// Soft erasing: a piece's fades. A brush erase with Feather, or below full Strength, does not
// only cut the piece's outline: it leaves a fade, where the fill fades out and what is under
// the piece shows through. A fade is the stroke's outline (`rings`), the cells inward over
// which the erase rises from nothing to its `depth`, and where it applies (`within`: the
// piece's share of the stroke when it was made). Fades live in the space of the piece's
// contours, follow it when it moves, and multiply: two passes at half leave a quarter.
//
// The renderer draws them into the piece's edge mask from the distance inside each fade
// (softMask.ts), eased across the feather; `fadeErasedAt` answers it at a point, unshaped.

import type { PieceFade, ShapeChild } from './types';
import type { Polygon } from '../types/geometry';
import { clipper2Engine } from '../geometry/Clipper2Engine';
import { applyShapeTransform } from './plateaus';
import { inRingsEvenOdd } from './pieces';
import { patchArea } from './materialPatch';

/** The brush's Feather when none is set: the outer half of its radius fades. */
export const FEATHER_DEFAULT = 0.5;

/** A fade reaching less than this of a region, in square cells, does not reach it. */
const MIN_REACH = 1e-6;

/** The brush's Feather, 0 to 1. */
export function featherOf(s: { feather?: number }): number {
  return Math.min(1, Math.max(0, s.feather ?? FEATHER_DEFAULT));
}

/** How much a fade erases past its feather, 0 to 1. */
export function fadeDepthOf(fade: Pick<PieceFade, 'depth'>): number {
  return Math.min(1, Math.max(0, fade.depth ?? 1));
}

function segmentDistance(x: number, y: number, [ax, ay]: [number, number], [bx, by]: [number, number]): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

/** How far a point lies from the nearest edge of `rings`, cells. */
function edgeDistance(x: number, y: number, rings: readonly Polygon[]): number {
  let d = Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) d = Math.min(d, segmentDistance(x, y, ring[i], ring[(i + 1) % ring.length]));
  }
  return d;
}

/**
 * How much of the fill `fade` takes at (x, y), 0 to 1: nothing at its outline, rising to its
 * depth `feather` cells inside and staying there further in; nothing outside its outline or
 * outside `within`.
 */
export function fadeErasedAt(fade: PieceFade, x: number, y: number): number {
  if (fade.within && !inRingsEvenOdd(x, y, fade.within)) return 0;
  if (!inRingsEvenOdd(x, y, fade.rings)) return 0;
  const depth = fadeDepthOf(fade);
  if (!(fade.feather > 0)) return depth;
  return depth * Math.min(1, edgeDistance(x, y, fade.rings) / fade.feather);
}

/** What of the fill is left at (x, y) under `fades`: what each fade leaves, multiplied. */
export function fadesKeepAt(fades: readonly PieceFade[] | undefined, x: number, y: number): number {
  return (fades ?? []).reduce((keep, fade) => keep * (1 - fadeErasedAt(fade, x, y)), 1);
}

/** `fades` with every ring put through `map`, and the feather scaled by `scale`. */
export function mapFades(fades: readonly PieceFade[], map: (ring: Polygon) => Polygon, scale = 1): PieceFade[] {
  return fades.map((fade) => {
    const out: PieceFade = { ...fade, rings: fade.rings.map(map), feather: fade.feather * scale };
    if (fade.within) out.within = fade.within.map(map);
    return out;
  });
}

/**
 * A piece's fades in the space its rings are drawn in: its transform baked in, as a cut or a
 * move bakes it into its contours. Undefined when it has none.
 */
export function bakedFades(shape: Pick<ShapeChild, 'fades' | 'transform'>): PieceFade[] | undefined {
  if (!shape.fades || shape.fades.length === 0) return undefined;
  const t = shape.transform;
  if (!t) return shape.fades;
  return mapFades(shape.fades, (ring) => applyShapeTransform(ring, t), Math.sqrt(Math.abs(t.scale[0] * t.scale[1])));
}

/** Where a fade acts: its outline, kept to `within`. */
export function fadeRegion(fade: PieceFade): Polygon[] {
  return fade.within ? clipper2Engine.intersection(fade.rings, fade.within) : fade.rings;
}

/** The fades that still reach `region` (a piece's outline after a cut); the others are dropped. */
export function fadesReaching(fades: readonly PieceFade[], region: Polygon[]): PieceFade[] {
  return fades.filter((fade) => patchArea(clipper2Engine.intersection(fadeRegion(fade), region)) > MIN_REACH);
}

/** `fades` cleared from `area`, as a paint stroke restores what they took; a fade left nowhere is dropped. */
export function clearFades(fades: readonly PieceFade[], area: Polygon[]): PieceFade[] {
  const out: PieceFade[] = [];
  for (const fade of fades) {
    const within = clipper2Engine.difference(fade.within ?? fade.rings, area);
    if (patchArea(within) > MIN_REACH) out.push({ ...fade, within });
  }
  return out;
}
