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
import { floorEdgeOpenSpans } from '../shared/caveFloor';
import { clipper2Engine } from '../geometry/Clipper2Engine';
import { paintTiled, type TiledLook } from './floorWallRenderer';
import { fittedFloor, type FloorFit } from './caveBandRenderer';

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
 * With a floor fit (`fit`) the outline is the floor's as painted under a measured kit's rock.
 */
export function innerBandLayers(rings: Polygon[], width: number, seed: number, fit?: FloorFit): SoftLayer[] {
  const [outer, ...holes] = rings.filter((r) => r.length >= 3);
  if (!outer) return [];
  const drawn = holes.length > 0 ? clipper2Engine.difference([outer], holes) : clipper2Engine.union([outer], []);
  const region = fittedFloor(drawn, fit);
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

/** How far in from a cave mouth its floor fades from nothing to full, cells. */
export const MOUTH_FADE = 1;
/** How far a mouth's fade wanders either way, as a share of how far in each step reaches. */
const MOUTH_WOBBLE = 0.15;

/**
 * The mouths of a layer's caves: each stretch of a floor ring's edge (`rings`) that lies on an
 * erased opening (`openings`), as a line. Doors are not mouths. Empty with no openings.
 */
export function mouthLines(rings: readonly Polygon[], openings: readonly Polygon[] | undefined): Polygon[] {
  if (!openings || openings.length === 0) return [];
  const out: Polygon[] = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      for (const [t0, t1] of floorEdgeOpenSpans(a, b, openings)) {
        const at = (t: number): [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        out.push([at(t0), at(t1)]);
      }
    }
  }
  return out;
}

/**
 * The steps a floor `region` is painted in where it meets cave mouths (`mouths`): full from
 * MOUTH_FADE in from each mouth's line, nothing at the line, and between in even steps, each
 * step's inner edge wandering as a soft fill's does (the same way every time for `seed`). Only
 * ever less floor than `region`: nothing is added outside the cave, and the floor beside the
 * rock either side of a mouth keeps its fitted edge. Paint only. Empty when no mouth comes near
 * the region: it is painted whole, as it always was.
 */
export function mouthFadeLayers(region: Polygon[], mouths: readonly Polygon[], seed: number, steps = SOFT_EDGE_STEPS): SoftLayer[] {
  if (mouths.length === 0 || region.length === 0) return [];
  const zone = clipper2Engine.inflateOpen([...mouths], MOUTH_FADE * (1 + MOUTH_WOBBLE));
  if (clipper2Engine.intersection(region, zone).length === 0) return [];
  const noise = wobbleNoise(seed);
  return nestedAlphas(1, steps)
    .map((alpha, k) => {
      // The solid step first: it keeps furthest from the mouths.
      const reach = (MOUTH_FADE * (steps - k)) / steps;
      const near = mouths.flatMap((line) => wobbleRings(clipper2Engine.inflateOpen([line], reach), line, reach, MOUTH_WOBBLE * reach, noise));
      return { rings: near.length > 0 ? clipper2Engine.difference(region, clipper2Engine.union(near, [])) : region, alpha };
    })
    .filter((l) => l.rings.length > 0);
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
