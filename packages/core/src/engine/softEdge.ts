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
import { distanceOut, distanceToLines, fallOff, fieldOf, insideOf, keptRamp, rampGrid, type Ramp } from './rampMask';

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

/** How far past a cave mouth its floor runs out onto the ground, fading from full to nothing, cells. */
export const MOUTH_FADE = 1;
/** How far a mouth's run-out wanders either way, as a share of how far out it reaches. */
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
 * How a floor `region` is painted where it meets cave mouths (`mouths`): full up to a mouth's
 * line, then run out past it onto the ground, fading from full at the region's edge to nothing
 * about MOUTH_FADE out, how far wandering a little (the same way every time for `seed`). Beside
 * a mouth, past the rock's tapered ends, the run-out shortens back to the region's own edge
 * over the next MOUTH_FADE, so nowhere round it does the floor stop on a hard edge. Inside the
 * region nothing changes. Paint only. Null when no mouth comes near the region's box: it is
 * painted as it always was.
 */
export function mouthRamp(region: Polygon[], mouths: readonly Polygon[], seed: number): Ramp | null {
  if (mouths.length === 0 || region.length === 0) return null;
  const long = MOUTH_FADE * (1 + MOUTH_WOBBLE);
  // Past this from every mouth the floor keeps its own edge.
  const side = MOUTH_FADE + long;
  const box = boxOfRings(region);
  const close = mouths.filter((m) => m.some(([x, y]) => x >= box[0] - side && x <= box[2] + side && y >= box[1] - side && y <= box[3] + side));
  if (close.length === 0) return null;
  // The run-out reads the region only near the mouths: kept while that and the region's box are,
  // so painting elsewhere on the floor works none of it out again.
  const mbox = boxOfRings(close as Polygon[]);
  const pad = side + long + 2 * RAMP_PAD;
  const near: Polygon = [
    [mbox[0] - pad, mbox[1] - pad],
    [mbox[2] + pad, mbox[1] - pad],
    [mbox[2] + pad, mbox[3] + pad],
    [mbox[0] - pad, mbox[3] + pad],
  ];
  const local = clipper2Engine.intersection(region, [near]);
  return keptRamp('mouth', [box, close, seed, local], () => {
    const reach = clipper2Engine.inflateOpen(close as Polygon[], side);
    const clip = clipper2Engine.union(region, reach);
    const grid = rampGrid(clip, RAMP_PAD);
    if (!grid) return null;
    const noise = wobbleNoise(seed);
    // A texel or two past `side` too, so the field is nothing at the run-out's outline.
    const { d, qx, qy } = distanceToLines(
      close.map((m) => ({ pts: m, closed: false })),
      grid,
      side + 2 / grid.res,
    );
    // How far each texel near the mouths lies outside the region, worked out over that corner of the grid only.
    const i0 = Math.max(0, Math.floor((near[0][0] - grid.x) * grid.res));
    const j0 = Math.max(0, Math.floor((near[0][1] - grid.y) * grid.res));
    const i1 = Math.min(grid.width, Math.ceil((near[2][0] - grid.x) * grid.res));
    const j1 = Math.min(grid.height, Math.ceil((near[2][1] - grid.y) * grid.res));
    const sub = { x: grid.x + i0 / grid.res, y: grid.y + j0 / grid.res, res: grid.res, width: Math.max(1, i1 - i0), height: Math.max(1, j1 - j0) };
    const out = distanceOut(local, sub);
    return {
      field: fieldOf(grid, (_x, _y, k) => {
        if (d[k] === Infinity) return 1;
        const i = (k % grid.width) - i0;
        const j = Math.floor(k / grid.width) - j0;
        if (i < 0 || j < 0 || i >= sub.width || j >= sub.height) return 1;
        // Full out to MOUTH_FADE from the mouth, then shortening to nothing by `side`.
        const length = MOUTH_FADE * (1 + MOUTH_WOBBLE * noise(qx[k], qy[k])) * fallOff(d[k], MOUTH_FADE, side - MOUTH_FADE);
        return fallOff(out[j * sub.width + i], 0, length);
      }),
      clip,
    };
  });
}

/** The box round `rings`: min x, min y, max x, max y. */
function boxOfRings(rings: readonly Polygon[]): [number, number, number, number] {
  const b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of rings) for (const [x, y] of r) [b[0], b[1], b[2], b[3]] = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
  return b;
}
