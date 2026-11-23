// A fill whose edge fades out instead of stopping: a floor's painted border, a water patch's
// shore, and a cave's floor where it meets a mouth all fade through here.
//
// Each fade is a true ramp (rampMask.ts): its opacity worked out texel by texel from the
// distance to the outline or line it fades from, eased, drawn by softPiece.ts's `paintRamp`.
// Never steps. Render-time only: nothing saved changes.

import type { Polygon } from '../types/geometry';
import { BORDER_FADE, BORDER_WOBBLE, wobbleNoise } from '../shared/plateauShade';
import { floorEdgeOpenSpans } from '../shared/caveFloor';
import { clipper2Engine } from '../geometry/Clipper2Engine';
import { fittedFloor, type FloorFit } from './caveBandRenderer';
import { ease } from './softMask';
import { distanceOut, distanceToLines, fallOff, fieldOf, insideOf, keptRamp, rampGrid, unit, type Ramp } from './rampMask';

/** How far past the region a fade's grid reaches, cells: its edge texels filter down to its outline. */
const RAMP_PAD = 0.1;

/**
 * A band `width` wide just outside `outline` (never inside it), less `water` (every water piece
 * on the layer: water meeting water has no bank between the two): full against the outline,
 * its outer `fade` of the width easing out to nothing. A water patch's shore paints through
 * here. Null where nothing is left of it.
 */
export function outsideBandRamp(outline: Polygon[], width: number, fade: number, water: Polygon[]): Ramp | null {
  return keptRamp('outside', [outline, width, fade, water], () => {
    const band = clipper2Engine.difference(clipper2Engine.inflate(outline, width), outline);
    const clip = water.length > 0 && band.length > 0 ? clipper2Engine.difference(band, water) : band;
    const grid = rampGrid(clip, RAMP_PAD);
    if (!grid) return null;
    const d = distanceOut(outline, grid);
    // Full on the water's side too: the clip cuts it crisp there, with no texel's blur.
    return { field: fieldOf(grid, (_x, _y, k) => fallOff(d[k], width - fade, fade)), clip };
  });
}

/**
 * A band `width` wide just inside a floor's own outline (`rings`: its outer ring, then its
 * holes): full on the outline, its inner BORDER_FADE of the width easing out to nothing, its
 * inner edge wandering as a plateau's painted border's does, the same way every time for
 * `seed`. With a floor fit (`fit`) the outline is the floor's as painted under a measured
 * kit's rock. Null for a floor with no outline.
 */
export function innerBandRamp(rings: Polygon[], width: number, seed: number, fit?: FloorFit): Ramp | null {
  const [outer, ...holes] = rings.filter((r) => r.length >= 3);
  if (!outer) return null;
  return keptRamp('inner', [rings, width, seed, fit ?? null], () => {
    const drawn = holes.length > 0 ? clipper2Engine.difference([outer], holes) : clipper2Engine.union([outer], []);
    const region = fittedFloor(drawn, fit);
    const grid = rampGrid(region, RAMP_PAD);
    if (!grid) return null;
    const fade = width * BORDER_FADE;
    const wander = width * BORDER_WOBBLE;
    const noise = wobbleNoise(seed);
    // Measured from the nearest point of the outline, so the wander moves each texel in from it
    // alike; full outside it too, where the clip cuts it crisp with no texel's blur.
    const inside = insideOf(region, grid);
    const { d, qx, qy } = distanceToLines(
      region.map((pts) => ({ pts, closed: true })),
      grid,
      width + wander,
    );
    return { field: fieldOf(grid, (_x, _y, k) => (!inside[k] ? 1 : d[k] === Infinity ? 0 : fallOff(d[k] - wander * noise(qx[k], qy[k]), width - fade, fade))), clip: region };
  });
}

/** How far in from a cave mouth its floor fades from nothing to full, cells. */
export const MOUTH_FADE = 1;
/** How far a mouth's fade wanders either way, as a share of how far in it reaches. */
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
 * How a floor `region` is painted where it meets cave mouths (`mouths`): nothing at a mouth's
 * line, full MOUTH_FADE in from it, eased between, how far in wandering a little (the same
 * way every time for `seed`). Only ever less floor than `region`: nothing is added outside the
 * cave, and the floor beside the rock either side of a mouth keeps its fitted edge. Paint
 * only. Null when no mouth comes near the region: it is painted whole, as it always was.
 */
export function mouthRamp(region: Polygon[], mouths: readonly Polygon[], seed: number): Ramp | null {
  if (mouths.length === 0 || region.length === 0) return null;
  return keptRamp('mouth', [region, mouths, seed], () => {
    const reach = MOUTH_FADE * (1 + MOUTH_WOBBLE);
    const zone = clipper2Engine.inflateOpen([...mouths], reach);
    if (clipper2Engine.intersection(region, zone).length === 0) return null;
    const grid = rampGrid(region, RAMP_PAD);
    if (!grid) return null;
    const noise = wobbleNoise(seed);
    const { d, qx, qy } = distanceToLines(
      mouths.map((m) => ({ pts: m, closed: false })),
      grid,
      reach,
    );
    return { field: fieldOf(grid, (_x, _y, k) => (d[k] === Infinity ? 1 : ease(unit(d[k] / (MOUTH_FADE * (1 + MOUTH_WOBBLE * noise(qx[k], qy[k]))))))), clip: region };
  });
}
