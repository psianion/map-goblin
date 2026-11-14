// A tiled fill whose edge fades out instead of stopping: the Material brush's plain-texture
// patches and their water shores, and the Elevation tool's painted border all paint through here.
//
// The fade is a stack of nested regions of the same texture, each reaching a step further
// out and each at its own opacity (`nestedAlphas`), so where they stack the texture falls
// in even steps from full to nothing. Nested rather than side by side, so no seam can open
// between two steps. Render-time only: nothing saved changes.

import type { Container, Texture } from 'pixi.js';
import type { Polygon } from '../types/geometry';
import { BORDER_FADE, BORDER_WOBBLE, nestedAlphas, wobbleNoise, wobbleRings } from '../shared/plateauShade';
import { clipper2Engine } from '../geometry/Clipper2Engine';
import { paintTiled, type TiledLook } from './floorWallRenderer';

/** How many steps a soft edge fades in. */
export const SOFT_EDGE_STEPS = 8;

/** One step of a soft edge: the region it covers, and its opacity. */
export interface SoftLayer {
  rings: Polygon[];
  alpha: number;
}

/**
 * The steps of a soft edge `feather` wide. `grow(d)` is the region the fill covers out to `d`
 * past where it is still solid (grow(feather) is its whole extent). Each step reaches
 * (k + 1)/steps of the way out; the innermost is drawn solid, so the stack reads full there
 * and 1/steps in the outermost step.
 */
export function softEdgeLayers(grow: (d: number) => Polygon[], feather: number, steps = SOFT_EDGE_STEPS): SoftLayer[] {
  return nestedAlphas(1, steps)
    .map((alpha, k) => ({ rings: grow((feather * (k + 1)) / steps), alpha }))
    .filter((l) => l.rings.length > 0);
}

/**
 * The steps of a band `width` wide just outside `outline` (never inside it): crisp against the
 * outline, its outer `fade` of the width soft. A water patch's shore paints through here.
 */
export function outsideBandLayers(outline: Polygon[], width: number, fade: number): SoftLayer[] {
  return softEdgeLayers((d) => clipper2Engine.difference(clipper2Engine.inflate(outline, width - fade + d), outline), fade);
}

/**
 * The steps of a band `width` wide just inside a floor's own outline (`rings`: its outer ring,
 * then its holes): crisp on the outline, its inner BORDER_FADE of the width soft, its inner
 * edge wandering as a plateau's painted border's does, the same way every time for `seed`.
 */
export function innerBandLayers(rings: Polygon[], width: number, seed: number): SoftLayer[] {
  const [outer, ...holes] = rings.filter((r) => r.length >= 3);
  if (!outer) return [];
  const region = holes.length > 0 ? clipper2Engine.difference([outer], holes) : clipper2Engine.union([outer], []);
  const lines = region.map((r) => [...r, r[0]]);
  const fade = width * BORDER_FADE;
  const noise = wobbleNoise(seed);
  return softEdgeLayers((d) => {
    const reach = width - fade + d;
    const strips = lines.map((line) => wobbleRings(clipper2Engine.inflateOpen([line], reach), line, reach, width * BORDER_WOBBLE, noise));
    const band = strips.reduce((acc, s) => (acc.length === 0 ? clipper2Engine.union(s, []) : clipper2Engine.union(acc, s)), [] as Polygon[]);
    return clipper2Engine.intersection(band, region);
  }, fade);
}

/**
 * Tile `texture` over each step, as a floor is tiled, at the step's opacity. Every step is
 * laid from the box of them all: a step tiled from its own smaller box starts the texture
 * somewhere else, and the stack smears. `look` lays the texture as a floor's is (scale,
 * turn, offset, tint; its alpha scales every step); absent, at scale 1.
 */
export function paintSoftTiled(parent: Container, layers: readonly SoftLayer[], texture: Texture, look: TiledLook = { scale: 1 }): void {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const l of layers) {
    for (const [x, y] of l.rings.flat()) {
      bounds.minX = Math.min(bounds.minX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.maxY = Math.max(bounds.maxY, y);
    }
  }
  for (const l of layers) paintTiled(parent, l.rings, texture, { ...look, holes: true, alpha: l.alpha * (look.alpha ?? 1), bounds });
}
