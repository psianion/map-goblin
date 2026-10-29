// Cave band walls, drawn live.
//
// A layer whose wall texture names a cave band kit (see packCatalog's band
// sets) gets its rock laid by the cave walk at render time, the way a wall
// set's stones are composed along a spine: the walk answers with placements
// and this file turns them into pooled sprites. Nothing is written to the
// store, so the band follows every edit of the ring it rides, and a door on
// the ring simply splits the walk into the spans the opening leaves.

import { Graphics, Sprite, type Container, type Texture } from 'pixi.js';
import { layerFloorFallback } from './levelLook';
import { resolveTexture } from '../assets/textureLoader';
import { GRID_CELL_PX, hasLiveTexture, type CatalogEntry } from '../assets/packCatalog';
import { caveBandPieces, jointsOf, type CaveKitPiece } from '../assets/caveWallKit';
import type { Polygon } from '../types/geometry';
import type { DungeonLayer, ShapeChild } from '../store/types';
import { ringOwner } from '../shared/wallLook';
import {
  BAND_OUT,
  offsetCurve,
  resampleClosed,
  tangentAt,
  walkClosed,
  walkSpan,
  type Curve,
  type Vec,
  type WalkOptions,
  type WalkPlacement,
} from './caveWalk';
import type { DoorGap } from './wallNodeRenderer';

/** Sample spacing of the curve the walk rides, in cells — the solver's. */
const CURVE_STEP = 0.1;
/** Samples added past each free end of an open run so its end tangents are honest. */
const END_PAD = 4;
/**
 * Half-width, in samples, of the window that rounds a drawn corner before the
 * walk sees it, and how many passes of it. A rectangle's corner is a hard 90°
 * where no kit bend fits — the smallest inside bend spans two cells of arc and
 * misses an L by half a cell — so the walk fell back to a straight laid across
 * the corner and left the tip bare. Rounding the ride curve to roughly a cell's
 * radius gives every corner a bend's shape.
 *
 * Rounding alone cuts a convex corner by four tenths of the radius and leaves
 * the floor's sharp tip poking out past the rock, so the curve is lifted
 * CORNER_LIFT further into the void before it is rounded and brought back
 * after: a straight run lands where it always did, and a corner's rounding
 * happens that much further out, around the tip rather than through it.
 *
 * The lift follows the turn (see {@link liftField}): a tip sharper than a right
 * angle is lifted further, and a corner that turns toward the void (a hole's
 * corner, or a notch in an outer ring) is lifted toward the FLOOR instead,
 * because rounding cuts across the inside of a turn and there the inside is
 * the void. Lifted the old way a hole's ride shrank twice over and a small
 * hole came out as an oval blob in its middle.
 */
const CORNER_WINDOW = 6;
const CORNER_PASSES = 3;
const CORNER_LIFT = 0.25;
/** Samples either side a corner's turn is read across (0.8 cells). */
const TURN_REACH = 8;
/** A turn this far toward the void counts as a void-side corner. */
const VOID_TURN_DEG = 45;
/**
 * A corner turning more than this (either way) is beyond any bend in the kit:
 * the smallest bends turn 90° over two cells, and a rounded ride through a
 * 46° floor tip either cuts the tip off or tears the band. The ring is split
 * there into runs that each end past the tip (see {@link layBandRing}).
 */
const SHARP_TURN_DEG = 110;
/** Samples either side a sharp tip's turn is read across. */
const SHARP_REACH = 5;
/** How far a run split at a sharp tip carries on past it, in cells. */
const TIP_RUN_ON = 0.3;
/**
 * The walk options for the runs a sharp tip splits a band into, and for the
 * close of a ring (where walkClosed keeps the plain ring's start and piece
 * count, so only the closing piece moves). Everything else, the solver
 * included, walks with the defaults: a plain drawn run or a door-cut span lays
 * exactly the pieces it always has.
 */
const LIVE_WALK: WalkOptions = { lap: true, splits: 4, fill: true };

const add = (p: Vec, q: Vec): Vec => [p[0] + q[0], p[1] + q[1]];
const sub = (p: Vec, q: Vec): Vec => [p[0] - q[0], p[1] - q[1]];
const mul = (p: Vec, s: number): Vec => [p[0] * s, p[1] * s];
const dist = (p: Vec, q: Vec): number => Math.hypot(p[0] - q[0], p[1] - q[1]);
const norm = (p: Vec): Vec => {
  const l = Math.hypot(p[0], p[1]) || 1;
  return [p[0] / l, p[1] / l];
};

/**
 * One pass of a triangular moving average over an evenly sampled curve. A
 * closed curve wraps; an open one clamps at its ends so they stay put.
 */
function movingAvg(curve: Curve, halfWin: number, closed: boolean): Curve {
  const n = curve.length;
  const out: Curve = new Array(n);
  for (let i = 0; i < n; i++) {
    let sx = 0;
    let sy = 0;
    let wsum = 0;
    for (let k = -halfWin; k <= halfWin; k++) {
      const w = halfWin + 1 - Math.abs(k);
      const j = closed ? (((i + k) % n) + n) % n : Math.min(n - 1, Math.max(0, i + k));
      sx += curve[j][0] * w;
      sy += curve[j][1] * w;
      wsum += w;
    }
    out[i] = [sx / wsum, sy / wsum];
  }
  return out;
}

/** Round the corners of a sampled curve so every turn is a bend the kit can lay. */
function roundCorners(curve: Curve, closed: boolean): Curve {
  let out = curve;
  for (let p = 0; p < CORNER_PASSES; p++) out = movingAvg(out, CORNER_WINDOW, closed);
  return closed ? resampleClosed(out, CURVE_STEP) : resampleOpen(out, CURVE_STEP);
}

/** Signed turn in degrees across ±`reach` samples at every sample; positive turns toward the floor. */
function turnField(curve: Curve, closed: boolean, reach: number): number[] {
  const n = curve.length;
  const tan = (i: number): Vec =>
    closed ? tangentAt(curve, ((i % n) + n) % n) : tangentOpen(curve, Math.min(n - 1, Math.max(0, i)));
  return curve.map((_, i) => {
    const a = tan(i - reach);
    const b = tan(i + reach);
    return (Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]) * 180) / Math.PI;
  });
}

/** A triangular moving average over a sampled value. */
function smoothValues(v: number[], halfWin: number, passes: number, closed: boolean): number[] {
  let out = v;
  for (let p = 0; p < passes; p++) {
    const src = out;
    const n = src.length;
    out = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      let wsum = 0;
      for (let k = -halfWin; k <= halfWin; k++) {
        const w = halfWin + 1 - Math.abs(k);
        const j = closed ? (((i + k) % n) + n) % n : Math.min(n - 1, Math.max(0, i + k));
        sum += src[j] * w;
        wsum += w;
      }
      out[i] = sum / wsum;
    }
  }
  return out;
}

/**
 * How far each sample is lifted before the corners are rounded (see
 * CORNER_LIFT): the fixed lift on straights and floor-side corners, more on a
 * tip sharper than a right angle, and toward the floor where the turn is
 * toward the void.
 */
function liftField(curve: Curve, closed: boolean): number[] {
  const lift = turnField(curve, closed, TURN_REACH).map((t) =>
    t >= -VOID_TURN_DEG
      ? CORNER_LIFT * Math.max(1, Math.min(t, 179) / 90)
      : (-CORNER_LIFT * Math.min(-t, 179)) / 90,
  );
  return smoothValues(lift, CORNER_WINDOW, 2, closed);
}

/** Push every sample of a curve toward the void (left of travel) by its own distance. */
function shoveEach(curve: Curve, d: number[], closed: boolean): Curve {
  return curve.map((p, i) => {
    const t = closed ? tangentAt(curve, i) : tangentOpen(curve, i);
    return add(p, mul([t[1], -t[0]], d[i]));
  });
}

/** Re-sample a curve at spacing `h`, carrying a per-sample value along by linear interpolation. */
function resampleCarrying(
  pts: Curve,
  vals: number[],
  h: number,
  closed: boolean,
): { curve: Curve; vals: number[] } {
  const curve: Curve = [];
  const out: number[] = [];
  let carry = 0;
  const segs = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % pts.length;
    const L = dist(pts[i], pts[j]);
    if (L < 1e-9) continue;
    const d = norm(sub(pts[j], pts[i]));
    for (let s = carry; s < L; s += h) {
      curve.push(add(pts[i], mul(d, s)));
      out.push(vals[i] + (vals[j] - vals[i]) * (s / L));
    }
    carry = (((carry - L) % h) + h) % h;
  }
  if (!closed) {
    curve.push(pts[pts.length - 1]);
    out.push(vals[vals.length - 1]);
  }
  return { curve, vals: out };
}

/**
 * The curve the walk rides for a floor edge sampled at CURVE_STEP: BAND_OUT
 * toward the void, corners rounded to a radius the kit's bends can lay, each
 * corner lifted by {@link liftField} before rounding and put back after.
 */
export function bandRide(base: Curve, closed: boolean): Curve {
  const lift = liftField(base, closed);
  // Every corner an ordinary one (no tip past a right angle, nothing turning
  // toward the void): the ride the band has always had, step for step, so a
  // plain ring or run lays exactly the pieces it did before.
  if (lift.every((l) => Math.abs(l - CORNER_LIFT) < 1e-9)) {
    if (closed) return offsetCurve(roundCorners(offsetCurve(base, BAND_OUT + CORNER_LIFT), true), -CORNER_LIFT);
    return shoveOpen(roundCorners(shoveOpen(base, BAND_OUT + CORNER_LIFT), false), -CORNER_LIFT);
  }
  const lifted = resampleCarrying(
    shoveEach(base, lift.map((l) => BAND_OUT + l), closed),
    lift,
    CURVE_STEP,
    closed,
  );
  let rounded = lifted.curve;
  for (let p = 0; p < CORNER_PASSES; p++) rounded = movingAvg(rounded, CORNER_WINDOW, closed);
  const back = shoveEach(rounded, lifted.vals.map((l) => -l), closed);
  return closed ? resampleClosed(back, CURVE_STEP) : resampleOpen(back, CURVE_STEP);
}

/** Indices of the corners sharper than any kit bend (SHARP_TURN_DEG), one per corner. */
export function sharpCorners(curve: Curve, closed: boolean): number[] {
  const n = curve.length;
  const turn = turnField(curve, closed, SHARP_REACH).map(Math.abs);
  const out: number[] = [];
  const win = 2 * SHARP_REACH;
  for (let i = 0; i < n; i++) {
    if (turn[i] < SHARP_TURN_DEG) continue;
    if (!closed && (i < SHARP_REACH || i > n - 1 - SHARP_REACH)) continue;
    let peak = true;
    for (let k = -win; k <= win && peak; k++) {
      const j = closed ? (((i + k) % n) + n) % n : i + k;
      if (j < 0 || j >= n || j === i) continue;
      // the first sample of a flat-topped peak stands for it
      if (turn[j] > turn[i] || (turn[j] === turn[i] && j < i)) peak = false;
    }
    if (peak) out.push(i);
  }
  return out;
}

/**
 * One run of edge between two sharp tips (or a tip and a free end), carried on
 * past each tip end along its own direction, so the two runs that meet at a tip
 * cross there and the rock of both covers it.
 */
function layTipRun(
  run: Curve,
  headTip: boolean,
  tailTip: boolean,
  gaps: DoorGap[],
  set: CaveKitPiece[],
): WalkPlacement[] {
  const n = run.length;
  const t0 = norm(sub(run[Math.min(2, n - 1)], run[0]));
  const t1 = norm(sub(run[n - 1], run[Math.max(0, n - 3)]));
  return layChain(
    [
      ...(headTip ? [sub(run[0], mul(t0, TIP_RUN_ON))] : []),
      ...run,
      ...(tailTip ? [add(run[n - 1], mul(t1, TIP_RUN_ON))] : []),
    ],
    gaps,
    set,
    LIVE_WALK,
  );
}

/** Signed area; positive is clockwise in y-down screen space. */
function signedArea(poly: Polygon): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    area += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
  }
  return area / 2;
}

function pointInPolygon([x, y]: Vec, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Wind every ring so the floor is on the right of travel and the void on the
 * left, the handedness every kit measurement assumes (caveWallKit.ts). An
 * outer ring holds floor inside it and a hole holds void, so the two wind
 * opposite ways to keep the floor on the same hand: outer rings positive, holes
 * negative — the convention the merged floor already follows, re-asserted here
 * because a band laid the wrong way round puts every bend on the wrong corner.
 */
export function orientRings(polys: Polygon[]): Polygon[] {
  return polys.map((poly, i) => {
    if (poly.length < 3) return poly;
    let depth = 0;
    for (let j = 0; j < polys.length; j++) {
      if (j !== i && polys[j].length >= 3 && pointInPolygon(poly[0], polys[j])) depth++;
    }
    const hole = depth % 2 === 1;
    return signedArea(poly) > 0 !== hole ? poly : [...poly].reverse();
  });
}

/**
 * The index runs of `ride` no door opening covers, as `[from, to]` pairs the
 * walk can take straight (`to` is the last sample of the run, so on a ring a
 * run that crosses the seam simply counts past the array). Null when nothing is
 * cut, so the caller can lay the whole ring closed.
 *
 * A gap is measured on the floor edge and the ride sits BAND_OUT off it, so the
 * cover reaches that much further than the opening's half-width.
 */
function openSpans(ride: Curve, gaps: DoorGap[], ring: boolean): [number, number][] | null {
  if (gaps.length === 0) return null;
  const n = ride.length;
  const covered = new Array<boolean>(n).fill(false);
  let any = false;
  for (const g of gaps) {
    const r = g.width / 2 + BAND_OUT + CURVE_STEP;
    for (let i = 0; i < n; i++) {
      if (dist(ride[i], g.position) <= r) {
        covered[i] = true;
        any = true;
      }
    }
  }
  if (!any) return null;

  const spans: [number, number][] = [];
  // A ring is read from inside a cut so no run is split across the seam; a
  // chain is read from its start, where a cut may or may not be.
  const start = ring ? covered.indexOf(true) : 0;
  let from: number | null = null;
  for (let k = 0; k < n; k++) {
    const i = ring ? start + k : k;
    const open = !covered[i % n];
    if (open && from === null) from = i;
    if (!open && from !== null) {
      spans.push([from, i - 1]);
      from = null;
    }
  }
  if (from !== null) spans.push([from, (ring ? start : 0) + n - 1]);
  return spans;
}

/**
 * One span of the walk, kept from taking the frame down: the walk throws when
 * it cannot close, and a ring that is momentarily impossible mid-drag should
 * draw nothing rather than nothing ever again.
 */
function laySpan(
  ride: Curve,
  set: CaveKitPiece[],
  from: number,
  to: number,
  opts: WalkOptions = {},
): WalkPlacement[] {
  const spacing = dist(ride[0], ride[1]) || CURVE_STEP;
  // Shorter than the smallest stone: a sliver between two doors, left bare.
  if ((to - from) * spacing < Math.min(...set.map((p) => p.chordCells)) * 0.9) return [];
  try {
    return walkSpan(ride, set, from, to, { ...opts, close: true, ring: false }).placed;
  } catch {
    return [];
  }
}

/**
 * Lay a kit around a closed ring, wound void-left (see {@link orientRings}).
 * Door openings on the ring split it into runs that each close on their own
 * end, so the rock stops at the doorway instead of crossing it.
 *
 * A corner sharper than any bend (SHARP_TURN_DEG) splits it too: no rounding
 * of the ride lets the kit both reach such a tip and keep to the edges either
 * side of it, so the ring is laid as runs from tip to tip, each carried on past
 * its tips, and the rock of the two runs that meet at a tip covers it.
 */
export function layBandRing(
  poly: Polygon,
  gaps: DoorGap[] = [],
  set: CaveKitPiece[] = caveBandPieces(),
): WalkPlacement[] {
  if (poly.length < 3) return [];
  const base = resampleClosed(poly as Curve, CURVE_STEP);
  if (base.length < 8) return [];
  const tips = sharpCorners(base, true);
  if (tips.length) {
    const n = base.length;
    return tips.flatMap((from, k) => {
      let to = tips[(k + 1) % tips.length];
      if (to <= from) to += n;
      const run: Curve = [];
      for (let i = from; i <= to; i++) run.push(base[i % n]);
      return layTipRun(run, true, true, gaps, set);
    });
  }
  const ride = bandRide(base, true);
  const spans = openSpans(ride, gaps, true);
  if (spans) return spans.flatMap(([from, to]) => laySpan(ride, set, from, to));
  try {
    return walkClosed(ride, set, LIVE_WALK).placed;
  } catch {
    return [];
  }
}

/** Re-sample an open polyline at an even spacing `h`, keeping its last point. */
function resampleOpen(pts: Curve, h: number): Curve {
  const out: Curve = [];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const L = dist(a, b);
    if (L < 1e-9) continue;
    const d = norm(sub(b, a));
    for (let s = carry; s < L; s += h) out.push(add(a, mul(d, s)));
    carry = (((carry - L) % h) + h) % h;
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Unit direction of travel on an open curve, clamped at the ends instead of wrapped. */
function tangentOpen(curve: Curve, i: number): Vec {
  const n = curve.length;
  return norm(sub(curve[Math.min(n - 1, i + 2)], curve[Math.max(0, i - 2)]));
}

/**
 * `offsetCurve` for an open run: the same push toward the void (left of
 * travel), with the end tangents read inward rather than across the seam a
 * closed curve would have there.
 */
function shoveOpen(curve: Curve, d: number): Curve {
  const step = dist(curve[0], curve[1]) || CURVE_STEP;
  const shoved = curve.map((p, i) => {
    const t = tangentOpen(curve, i);
    return add(p, mul([t[1], -t[0]], d));
  });
  return resampleOpen(shoved, step);
}

/**
 * END_PAD straight samples past each end of an open ride, because the walk
 * itself reads tangents and chords modulo the array and would otherwise see
 * the run's far end right next to its start.
 */
function padEnds(ride: Curve): Curve {
  const step = dist(ride[0], ride[1]) || CURVE_STEP;
  const n = ride.length;
  const t0 = tangentOpen(ride, 0);
  const t1 = tangentOpen(ride, n - 1);
  const head: Curve = [];
  const tail: Curve = [];
  for (let k = END_PAD; k >= 1; k--) head.push(sub(ride[0], mul(t0, k * step)));
  for (let k = 1; k <= END_PAD; k++) tail.push(add(ride[n - 1], mul(t1, k * step)));
  return [...head, ...ride, ...tail];
}

/**
 * Lay a kit along an open run (a drawn wall that does not loop), void on the
 * left of the drawn direction. Each free end gets a piece closed onto it.
 */
export function layBandChain(
  points: Polygon,
  gaps: DoorGap[] = [],
  set: CaveKitPiece[] = caveBandPieces(),
): WalkPlacement[] {
  return layChain(points as Curve, gaps, set, {});
}

function layChain(points: Curve, gaps: DoorGap[], set: CaveKitPiece[], opts: WalkOptions): WalkPlacement[] {
  if (points.length < 2) return [];
  const base = resampleOpen(points, CURVE_STEP);
  if (base.length < 8) return [];
  // A drawn run with a tip sharper than any bend is laid as runs that cross
  // there, the way a ring is (see layBandRing).
  const tips = sharpCorners(base, false);
  if (tips.length) {
    const cuts = [0, ...tips, base.length - 1];
    return cuts.slice(0, -1).flatMap((from, k) => {
      return layTipRun(base.slice(from, cuts[k + 1] + 1), k > 0, k + 1 < cuts.length - 1, gaps, set);
    });
  }
  const ride = padEnds(bandRide(base, false));
  const first = END_PAD;
  const last = ride.length - 1 - END_PAD;
  const spans = openSpans(ride, gaps, false) ?? [[first, last]];
  return spans.flatMap(([from, to]) =>
    laySpan(ride, set, Math.max(from, first), Math.min(to, last), opts),
  );
}

/* ── Ground under the rock ─────────────────────────────────────────────
 *
 * The rock is separate pieces laid end to end, and where two of them meet on a
 * tight turn, or where a small hole's ring cannot reach a corner, the void shows
 * through between them. Behind the pieces each band draws a strip of ground in
 * a darker shade of its floor, over the band's own footprint: from the floor
 * edge out to where the rock's solid body reaches. On an ordinary ring the rock
 * covers all of it, so it only shows where the void used to.
 *
 * Visual only. Sight, rooms and hit tests read the authored edge, never this.
 */

/**
 * How far into the void the ground strip reaches, in cells from the floor edge.
 * A piece's joints land on the ride, BAND_OUT off the floor, and are shoved
 * another BAND_OUT out (placePiece), so the art's midline sits ~0.36 out. The
 * straights' solid body runs to ~0.6 and their outline is ragged past ~0.45,
 * so the strip stops short of the outline: hidden under the rock wherever rock
 * was laid, ground where it was not.
 */
export const BAND_FILL_REACH = 0.42;
/** How far back from a sharp floor tip the strip stops (see drawBandFill). */
const TIP_FILL_TRIM = 0.6;
/** The floor's tone is multiplied by this: ground in the rock's shadow, not a hole. */
export const BAND_FILL_SHADE = 0.68;

/** The floor a band stands on: its colour, and its texture when it has one. */
export interface BandFloor {
  floorColor: string;
  textureId?: string;
  /** The texture's tint, as the floor fill applies it. */
  textureTint?: string;
}

const hexColor = (hex: string | undefined, fallback: number): number => {
  if (!hex) return fallback;
  const v = parseInt(hex.replace('#', ''), 16);
  return isNaN(v) ? fallback : v;
};

const mulColor = (a: number, b: number): number => {
  const ch = (s: number): number => Math.round((((a >> s) & 255) * ((b >> s) & 255)) / 255);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

/** A colour darkened to the band's ground shade. */
export function shadeGround(color: number, shade = BAND_FILL_SHADE): number {
  const ch = (s: number): number => Math.round(((color >> s) & 255) * shade);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** One average per loaded texture; a texture swapped in under the same id (a pack update) misses. */
const toneCache = new Map<string, { src: Texture; tone: number | null }>();
const TONE_SAMPLE = 48;

/**
 * The average colour of a loaded texture, read once from a small downscale of
 * its source image and kept. Null when it has not loaded, or where there is no
 * canvas to read it with (tests, a worker): the caller falls back to the floor
 * colour.
 */
export function textureTone(textureId: string): number | null {
  const tex = resolveTexture(textureId);
  if (tex.width <= 1) return null;
  const hit = toneCache.get(textureId);
  if (hit && hit.src === tex) return hit.tone;
  let tone: number | null = null;
  try {
    const res = tex.source?.resource as CanvasImageSource | undefined;
    if (res && typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = c.height = TONE_SAMPLE;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        const f = tex.frame;
        const k = tex.source.resolution || 1;
        ctx.drawImage(res, f.x * k, f.y * k, f.width * k, f.height * k, 0, 0, TONE_SAMPLE, TONE_SAMPLE);
        const d = ctx.getImageData(0, 0, TONE_SAMPLE, TONE_SAMPLE).data;
        let r = 0;
        let g = 0;
        let b = 0;
        let w = 0;
        for (let i = 0; i < d.length; i += 4) {
          const a = d[i + 3];
          r += d[i] * a;
          g += d[i + 1] * a;
          b += d[i + 2] * a;
          w += a;
        }
        if (w > 0) tone = (Math.round(r / w) << 16) | (Math.round(g / w) << 8) | Math.round(b / w);
      }
    }
  } catch {
    tone = null;
  }
  toneCache.set(textureId, { src: tex, tone });
  return tone;
}

/** The ground colour behind a band on `floor`: its texture's tone (tinted), else its colour, shaded. */
export function bandFillColor(floor: BandFloor): number {
  const plain = hexColor(floor.floorColor, 0x808080);
  const tone = floor.textureId ? textureTone(floor.textureId) : null;
  if (tone === null) return shadeGround(plain);
  const tint = hexColor(floor.textureTint, 0xffffff);
  return shadeGround(tint === 0xffffff ? tone : mulColor(tone, tint));
}

/**
 * The floor each band of `layer` stands on, by ring index: the floor that owns
 * the ring (the same owner `ringStyles` reads pins from). Index -1 asks for a
 * drawn wall's, which takes the main floor's (ring 0), else the floor new
 * shapes on the layer get. Resolved lazily: only band rings ever ask.
 */
export function ringFloorOf(layer: DungeonLayer): (ring: number) => BandFloor {
  let shapes: ShapeChild[] | null = null;
  const memo = new Map<number, BandFloor>();
  // A floor with no texture of its own paints its level's, on a layer that names none.
  const fallback = layerFloorFallback(layer);
  const ofShape = (shape: ShapeChild | null): BandFloor => {
    const own = (shape?.styleOverrides as { floorColor?: string } | undefined)?.floorColor;
    const floorColor = own ?? layer.style.floorColor;
    if (!shape) {
      const t = layer.style.defaultTextureId ?? fallback;
      return { floorColor, textureId: hasLiveTexture(t) ? t : undefined };
    }
    const t = shape.textureId || fallback;
    return {
      floorColor,
      textureId: hasLiveTexture(t) ? t : undefined,
      textureTint: shape.textureTint,
    };
  };
  return (ring) => {
    const hit = memo.get(ring);
    if (hit) return hit;
    shapes ??= layer.children.filter(
      (c): c is ShapeChild => c.childType === 'shape' && c.visible !== false,
    );
    const rings = layer.mergedFloor ?? [];
    const poly = rings[ring < 0 ? 0 : ring];
    const out = ofShape(poly ? ringOwner(poly, shapes) : null);
    memo.set(ring, out);
    return out;
  };
}

/** What a band's ground strip is drawn along. */
export interface BandFillSpec {
  /** The floor edge (or a drawn wall's line), void on the left as the walk lays it. */
  edge: Polygon;
  closed: boolean;
  /** The door openings on it: the strip stops where the rock does. */
  gaps: DoorGap[];
  color: number;
}

/**
 * The parts of segment a→b (length `L`, unit direction `t`) no door opening
 * takes, as `[s0, s1]` distances along it. A gap stops the strip where the
 * walk's span stops the rock (`openSpans`), plus a hair.
 */
function uncutIntervals(a: Vec, t: Vec, L: number, gaps: DoorGap[]): [number, number][] {
  let out: [number, number][] = [[0, L]];
  for (const g of gaps) {
    const r = g.width / 2 + BAND_OUT + 2 * CURVE_STEP;
    const c = sub(g.position, a);
    const along = c[0] * t[0] + c[1] * t[1];
    const off = Math.abs(c[0] * t[1] - c[1] * t[0]);
    if (off >= r) continue;
    const half = Math.sqrt(r * r - off * off);
    const lo = along - half;
    const hi = along + half;
    out = out.flatMap(([s0, s1]): [number, number][] => {
      if (hi <= s0 || lo >= s1) return [[s0, s1]];
      const keep: [number, number][] = [];
      if (lo > s0) keep.push([s0, lo]);
      if (hi < s1) keep.push([hi, s1]);
      return keep;
    });
  }
  return out.filter(([s0, s1]) => s1 - s0 > 1e-6);
}

/** Arc length along the open polyline `pts` of the point on it nearest `p`. */
function arcPosition(pts: Vec[], p: Vec): number {
  let best = Infinity;
  let at = 0;
  let walked = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k];
    const d = sub(pts[k + 1], a);
    const L = Math.hypot(d[0], d[1]);
    if (L < 1e-9) continue;
    const s = Math.max(0, Math.min(L, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / L));
    const q = add(a, mul(d, s / L));
    const e = dist(p, q);
    if (e < best) {
      best = e;
      at = walked + s;
    }
    walked += L;
  }
  return at;
}

/**
 * Where along an open run the rock actually reaches: the span of its pieces'
 * joints, read back onto the line. An end piece closes on the run's end but the
 * walk may stop short of it, and a strip carried on past the last rock would be
 * ground lying in the open.
 */
export function rockSpan(line: Polygon, placed: WalkPlacement[]): [number, number] | null {
  if (!placed.length) return null;
  const pts = line as Vec[];
  let lo = Infinity;
  let hi = -Infinity;
  for (const pl of placed) {
    for (const j of jointsOf(pl.piece, pl.at)) {
      const s = arcPosition(pts, j);
      lo = Math.min(lo, s);
      hi = Math.max(hi, s);
    }
  }
  return [lo, hi];
}

/**
 * Draw a band's ground strip into `g`: a quad per stretch of edge from the
 * edge itself out to BAND_FILL_REACH on the void side, never back over the
 * floor (an overlap darkened the floor's own edge wherever no rock covered it).
 * At every corner that opens toward the void, a bevel across the notch the two
 * quads leave. A bevel, not a round: the rock rounds a corner on a tighter line
 * than the floor's tip, and a full-radius round poked out past it. At a corner
 * that turns toward the void the two quads would cross, and on a narrow notch
 * one would run past the other edge onto the floor, so both end on the miter.
 * `span` limits an open run to the stretch its rock covers (rockSpan).
 */
export function drawBandFill(g: Graphics, spec: BandFillSpec, span?: [number, number]): void {
  g.clear();
  const pts: Vec[] = [];
  for (const p of spec.edge as Vec[]) {
    if (!pts.length || dist(p, pts[pts.length - 1]) > 1e-6) pts.push(p);
  }
  if (spec.closed && pts.length > 2 && dist(pts[0], pts[pts.length - 1]) <= 1e-6) pts.pop();
  const n = pts.length;
  if (n < 2) return;
  const reach = BAND_FILL_REACH;
  const segs = spec.closed ? n : n - 1;
  const tans: Vec[] = [];
  const lens: number[] = [];
  const keeps: [number, number][][] = [];
  let walked = 0;
  for (let k = 0; k < segs; k++) {
    const a = pts[k];
    const L = dist(a, pts[(k + 1) % n]);
    const t = norm(sub(pts[(k + 1) % n], a));
    let keep = uncutIntervals(a, t, L, spec.gaps);
    if (span) {
      const lo = span[0] - walked;
      const hi = span[1] - walked;
      keep = keep
        .map(([s0, s1]): [number, number] => [Math.max(s0, lo), Math.min(s1, hi)])
        .filter(([s0, s1]) => s1 - s0 > 1e-6);
    }
    walked += L;
    tans.push(t);
    lens.push(L);
    keeps.push(keep);
  }
  const left = (t: Vec): Vec => [t[1], -t[0]];
  const reachesStart = (k: number): boolean => keeps[k].length > 0 && keeps[k][0][0] <= 1e-6;
  const reachesEnd = (k: number): boolean => {
    const keep = keeps[k];
    return keep.length > 0 && keep[keep.length - 1][1] >= lens[k] - 1e-6;
  };
  // What happens at vertex k, where segment k-1 meets segment k: null when the
  // strip does not run through it, else whether it opens toward the void (a
  // notch the quads leave, bevelled) or closes (the quads would cross; both end
  // on the miter instead, so neither pokes past the other edge onto the floor).
  const joint = (k: number): { open: boolean; miter: Vec; tip: boolean } | null => {
    if (!spec.closed && (k === 0 || k === n - 1)) return null;
    const prev = (k - 1 + segs) % segs;
    if (!reachesEnd(prev) || !reachesStart(k)) return null;
    const n0 = left(tans[prev]);
    const n1 = left(tans[k]);
    const open = tans[k][0] * n0[0] + tans[k][1] * n0[1] < 0;
    const sum = add(n0, n1);
    const c = 1 + n0[0] * n1[0] + n0[1] * n1[1];
    // A hairpin's miter runs off to infinity; past ~140° take a reach along the bisector.
    const miter = c > 0.25 ? add(pts[k], mul(sum, reach / c)) : add(pts[k], mul(norm(sum), reach));
    const t0 = tans[prev];
    const t1 = tans[k];
    const turn = (Math.acos(Math.max(-1, Math.min(1, t0[0] * t1[0] + t0[1] * t1[1]))) * 180) / Math.PI;
    return { open, miter, tip: open && turn > SHARP_TURN_DEG };
  };
  const joints = pts.map((_, k) => joint(k));
  // A floor tip sharper than any bend is where the rock of two runs crosses
  // (layBandRing), not where it reaches round: the strip stops short of it on
  // both edges and takes no bevel, or it would lie in the open past the rock.
  for (let k = 0; k < n; k++) {
    if (!joints[k]?.tip) continue;
    const prev = (k - 1 + segs) % segs;
    keeps[prev] = keeps[prev]
      .map(([s0, s1]): [number, number] => [s0, Math.min(s1, lens[prev] - TIP_FILL_TRIM)])
      .filter(([s0, s1]) => s1 - s0 > 1e-6);
    keeps[k] = keeps[k]
      .map(([s0, s1]): [number, number] => [Math.max(s0, TIP_FILL_TRIM), s1])
      .filter(([s0, s1]) => s1 - s0 > 1e-6);
  }
  for (let k = 0; k < segs; k++) {
    const a = pts[k];
    const t = tans[k];
    const nv = left(t);
    const keep = keeps[k];
    keep.forEach(([s0, s1], idx) => {
      const p0 = add(a, mul(t, s0));
      const p1 = add(a, mul(t, s1));
      const head = idx === 0 ? joints[k] : null;
      const tail = idx === keep.length - 1 ? joints[(k + 1) % n] : null;
      g.poly([
        ...p0,
        ...p1,
        ...(tail && !tail.open ? tail.miter : add(p1, mul(nv, reach))),
        ...(head && !head.open ? head.miter : add(p0, mul(nv, reach))),
      ]).fill({ color: spec.color });
    });
  }
  joints.forEach((j, k) => {
    if (!j?.open || j.tip) return;
    const v = pts[k];
    const n0 = left(tans[(k - 1 + segs) % segs]);
    const n1 = left(tans[k]);
    g.poly([...v, ...add(v, mul(n0, reach)), ...add(v, mul(n1, reach))]).fill({ color: spec.color });
  });
}

/**
 * Fill `parent` from index `from` with one sprite per placement, reusing the
 * sprites already there — the same pool `placeNodes` keeps for stones, so a
 * drag re-lays a band without allocating. Returns the next free index.
 *
 * With a `fill`, the band's ground strip ({@link drawBandFill}) goes first, one
 * pooled Graphics per band, so it sits under that band's rock. A band the walk
 * laid no rock for gets none: a hole too small to ring stays a hole.
 *
 * The pool holds sprites and strips side by side, so a slot is only reused for
 * its own kind; anything else is pushed along and trimmed off the tail.
 *
 * The kit measures every joint from the tile's centre, so the sprite pivots
 * there even when its texture arrived trimmed to the content rect; a mirrored
 * straight is drawn mirrored about that same centre, which is what its joints
 * already assume (caveWallKit.ts).
 */
export function placeBand(
  parent: Container,
  placed: WalkPlacement[],
  art: Map<string, CatalogEntry>,
  tint: number,
  from: number,
  fill?: BandFillSpec,
): number {
  let at = from;
  if (fill && placed.length > 0) {
    let g = parent.children[at];
    if (!(g instanceof Graphics)) {
      g = new Graphics();
      parent.addChildAt(g, at);
    }
    drawBandFill(g as Graphics, fill, fill.closed ? undefined : (rockSpan(fill.edge, placed) ?? undefined));
    at++;
  }
  for (const pl of placed) {
    const entry = art.get(pl.piece.key);
    if (!entry) continue;
    const tex = resolveTexture(entry.id);
    if (tex.width <= 1) continue;

    const slot = parent.children[at];
    let sprite: Sprite;
    if (slot instanceof Sprite) {
      sprite = slot;
      sprite.texture = tex;
    } else {
      sprite = new Sprite(tex);
      parent.addChildAt(sprite, at);
    }
    const cr = entry.contentRect;
    if (cr) {
      sprite.anchor.set((entry.naturalWidth / 2 - cr.x) / cr.w, (entry.naturalHeight / 2 - cr.y) / cr.h);
    } else {
      sprite.anchor.set(0.5, 0.5);
    }
    sprite.position.set(pl.at.position.x, pl.at.position.y);
    sprite.rotation = pl.at.rotation;
    // World units per texture pixel: the art is authored at GRID_CELL_PX per
    // cell, scaled by what the walk needed; a texture served at another
    // resolution is brought back to the authored size first.
    const px = cr ? cr.w : entry.naturalWidth;
    const s = ((px / tex.width) * pl.at.scale) / GRID_CELL_PX;
    sprite.scale.set(s, pl.at.flipY ? -s : s);
    sprite.tint = tint;
    at++;
  }
  return at;
}

/* ── Drawn walls on a band layer ──────────────────────────────────────
 *
 * A drawn wall has no floor of its own to say which side is void, and it can
 * lie right on a floor ring's edge (a keep's outer wall drawn along the outline
 * of its rooms). Laid as drawn, the first put its rock and dark lobes on the
 * floor whenever the line ran the "wrong" way, and the second laid a second
 * band beside the ring's own: two rows of rock along one edge.
 *
 * planDrawnBand answers both before anything is laid. Where the line lies on a
 * banded ring's edge the ring carries the rock (it knows which side is void),
 * and the wall keeps only the stretches off the ring. Each kept stretch is then
 * turned so the side the floor is on gets the pale floor-side shadow.
 */

/** A drawn line this close to a banded ring's edge, and parallel to it, is that edge. */
export const COINCIDE_TOL = 0.15;
/** Shorter shared stretches are a crossing or a touch, not a shared edge. */
const COINCIDE_MIN = 0.3;
/** Sine of the widest angle between a line and an edge still read as parallel (~7°). */
const PARALLEL_SIN = 0.12;
/** Shared stretches closer than this along the line are one. */
const COINCIDE_JOIN = 0.05;
/** How far either side of the line the floor is looked for, and how often. */
const SIDE_PROBE = 0.5;
const SIDE_STEP = 0.25;
/** A stretch of one verdict shorter than this takes its longer neighbour's. */
const SIDE_MIN = 1;
/**
 * How far a kept stretch of a drawn wall runs on into the stretch a ring
 * carries. Without it the wall's closing stone stopped short of the ring's
 * rock and a sliver of floor showed between the two at the hand-over.
 */
const HANDOVER_RUN_ON = 0.4;

/** A floor ring whose edge carries a band, wound void-left (orientRings). */
export interface BandRingRef {
  ring: number;
  poly: Polygon;
}

/** One stretch of a drawn wall its own band still lays, wound void-left. */
export interface DrawnBandRun {
  points: Polygon;
  closed: boolean;
}

export interface DrawnBandPlan {
  runs: DrawnBandRun[];
  /** The wall's door openings on a stretch a ring carries, handed to that ring. */
  ringGaps: DoorGap[];
}

/** An arc-length interval of a drawn line, and the ring whose edge it lies on. */
export interface Coincidence {
  from: number;
  to: number;
  ring: number;
}

const cross = (a: Vec, b: Vec): number => a[0] * b[1] - a[1] * b[0];
const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1];

/** Cumulative arc length at every vertex of a polyline. */
function arcLengths(pts: Vec[]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  return cum;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const boxOf = (pts: Vec[], pad = 0): Box => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
};
const boxesMeet = (a: Box, b: Box): boolean => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

/**
 * The stretches of a drawn line (its points in order, a loop's closing point
 * repeated) that lie on an edge of one of `rings`: parallel within PARALLEL_SIN,
 * within COINCIDE_TOL of it, and at least COINCIDE_MIN long. A segment-by-edge
 * test behind a bounding-box reject, so a keep's walls against its outline cost
 * next to nothing. Sorted by `from`; overlapping stretches are not merged, so
 * each keeps its ring.
 */
export function ringCoincidences(line: Polygon, rings: BandRingRef[]): Coincidence[] {
  const pts = line as Vec[];
  if (pts.length < 2 || rings.length === 0) return [];
  const lineBox = boxOf(pts, COINCIDE_TOL);
  const near = rings.filter((r) => r.poly.length >= 2 && boxesMeet(lineBox, boxOf(r.poly as Vec[], COINCIDE_TOL)));
  if (!near.length) return [];
  const cum = arcLengths(pts);
  const out: Coincidence[] = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k];
    const L = cum[k + 1] - cum[k];
    if (L < COINCIDE_MIN) continue;
    const t = mul(sub(pts[k + 1], a), 1 / L);
    const segBox = boxOf([a, pts[k + 1]], COINCIDE_TOL);
    for (const { ring, poly } of near) {
      const ring_ = poly as Vec[];
      for (let e = 0; e < ring_.length; e++) {
        const p = ring_[e];
        const q = ring_[(e + 1) % ring_.length];
        if (!boxesMeet(segBox, boxOf([p, q]))) continue;
        const Le = dist(p, q);
        if (Le < 1e-9 || Math.abs(cross(t, sub(q, p))) / Le > PARALLEL_SIN) continue;
        const sp = dot(sub(p, a), t);
        const sq = dot(sub(q, a), t);
        if (Math.abs(sq - sp) < 1e-9) continue;
        const dp = cross(t, sub(p, a));
        const dq = cross(t, sub(q, a));
        let lo = Math.max(0, Math.min(sp, sq));
        let hi = Math.min(L, Math.max(sp, sq));
        // Distance from the line along the edge is linear in s; keep where it is within tolerance.
        const slope = (dq - dp) / (sq - sp);
        if (Math.abs(slope) < 1e-12) {
          if (Math.abs(dp) > COINCIDE_TOL) continue;
        } else {
          const s1 = sp + (COINCIDE_TOL - dp) / slope;
          const s2 = sp + (-COINCIDE_TOL - dp) / slope;
          lo = Math.max(lo, Math.min(s1, s2));
          hi = Math.min(hi, Math.max(s1, s2));
        }
        if (hi - lo < COINCIDE_MIN) continue;
        out.push({ from: cum[k] + lo, to: cum[k] + hi, ring });
      }
    }
  }
  return out.sort((x, y) => x.from - y.from);
}

/** Union of sorted intervals, joining any closer than COINCIDE_JOIN. */
function mergeSpans(spans: { from: number; to: number }[]): [number, number][] {
  const out: [number, number][] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s.from <= last[1] + COINCIDE_JOIN) last[1] = Math.max(last[1], s.to);
    else out.push([s.from, s.to]);
  }
  return out;
}

/** The point at arc length `s` along a polyline with arc table `cum`. */
function pointAtArc(pts: Vec[], cum: number[], s: number): Vec {
  if (s <= 0) return pts[0];
  const total = cum[cum.length - 1];
  if (s >= total) return pts[pts.length - 1];
  let k = 0;
  while (k < cum.length - 2 && cum[k + 1] < s) k++;
  const L = cum[k + 1] - cum[k];
  return L < 1e-12 ? pts[k] : add(pts[k], mul(sub(pts[k + 1], pts[k]), (s - cum[k]) / L));
}

/**
 * The stretch [s0, s1] of a polyline as its own polyline. On a loop (`closed`,
 * closing point repeated) the stretch may run past the end and on round.
 */
function subLine(pts: Vec[], cum: number[], s0: number, s1: number, closed: boolean): Vec[] {
  const total = cum[cum.length - 1];
  if (closed && s1 > total + 1e-9) {
    const head = subLine(pts, cum, s0, total, false);
    const tail = subLine(pts, cum, 0, s1 - total, false);
    return [...head, ...tail.slice(1)];
  }
  const out: Vec[] = [pointAtArc(pts, cum, s0)];
  for (let i = 0; i < pts.length; i++) {
    if (cum[i] > s0 + 1e-9 && cum[i] < s1 - 1e-9) out.push(pts[i]);
  }
  out.push(pointAtArc(pts, cum, s1));
  return out;
}

/** Even-odd point-in-floor over every ring, holes included. */
function floorTest(floor: Polygon[]): (p: Vec) => boolean {
  const rings = floor.filter((r) => r.length >= 3).map((r) => ({ poly: r, box: boxOf(r as Vec[]) }));
  return (p) => {
    let inside = false;
    for (const { poly, box } of rings) {
      if (p[0] < box.x0 || p[0] > box.x1 || p[1] < box.y0 || p[1] > box.y1) continue;
      if (pointInPolygon(p, poly)) inside = !inside;
    }
    return inside;
  };
}

/** +1: the floor is on the right of travel (void left, as laid); -1: on the left; 0: both sides or neither. */
type Side = 1 | -1 | 0;

/** Stretches of one verdict along an open run, as [from, to, side] in arc length. */
function sideStretches(pts: Vec[], cum: number[], inFloor: (p: Vec) => boolean): [number, number, Side][] {
  const total = cum[cum.length - 1];
  const n = Math.max(1, Math.round(total / SIDE_STEP));
  const step = total / n;
  const groups: [number, number, Side][] = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5) * step;
    while (k < cum.length - 2 && cum[k + 1] < s) k++;
    const t = norm(sub(pts[k + 1], pts[k]));
    const p = pointAtArc(pts, cum, s);
    const left = inFloor(add(p, mul([t[1], -t[0]], SIDE_PROBE)));
    const right = inFloor(add(p, mul([-t[1], t[0]], SIDE_PROBE)));
    const side: Side = right && !left ? 1 : left && !right ? -1 : 0;
    const from = i * step;
    const last = groups[groups.length - 1];
    if (last && last[2] === side) last[1] = from + step;
    else groups.push([from, from + step, side]);
  }
  // A stretch with no verdict, or a short one, takes its longer neighbour's
  // (the longer, so the answer does not hang on which end the line began at).
  const settle = (g: [number, number, Side][], weak: (x: [number, number, Side]) => boolean): [number, number, Side][] => {
    const out = g.map((x): [number, number, Side] => [...x]);
    for (let i = 0; i < out.length; i++) {
      if (!weak(out[i])) continue;
      const a = out[i - 1];
      const b = out[i + 1];
      const la = a ? a[1] - a[0] : -1;
      const lb = b ? b[1] - b[0] : -1;
      if (la > lb && a[2] !== 0) out[i][2] = a[2];
      else if (lb > la && b[2] !== 0) out[i][2] = b[2];
      else if (la === lb && a && b && a[2] === b[2]) out[i][2] = a[2];
    }
    const merged: [number, number, Side][] = [];
    for (const x of out) {
      const last = merged[merged.length - 1];
      if (last && last[2] === x[2]) last[1] = x[1];
      else merged.push(x);
    }
    return merged;
  };
  return settle(
    settle(groups, (x) => x[1] - x[0] < SIDE_MIN),
    (x) => x[2] === 0,
  );
}

/**
 * The way a drawn line with floor on neither side, or on both (a divider
 * between two rooms of one floor), is laid: void toward the top left, so the
 * pale floor-side shadow falls down and to the right, the way the layer's wall
 * shadows fall. Read off the run's chord after the line has been put in its
 * canonical order, so it never depends on which end it was drawn from.
 */
function neutralSide(pts: Vec[]): Side {
  const d = sub(pts[pts.length - 1], pts[0]);
  // void normal is (d.y, -d.x): toward -x-y when d.x > d.y
  return d[0] - d[1] >= 0 ? 1 : -1;
}

/** The line in one fixed order (left end first; a loop wound positive), so both drawings of it are one. */
function canonicalLine(pts: Vec[], closed: boolean): Vec[] {
  if (closed) return signedArea(pts as Polygon) < 0 ? [...pts].reverse() : pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const flip = b[0] < a[0] - 1e-9 || (Math.abs(b[0] - a[0]) <= 1e-9 && b[1] < a[1]);
  return flip ? [...pts].reverse() : pts;
}

/**
 * What a drawn wall on a band layer lays, and what it hands to the rings.
 *
 * `floor` is every floor ring (for which side the floor is on); `rings` the
 * banded ones, wound void-left, that may carry a stretch of the wall instead
 * (pass none to keep the whole wall); `gaps` the wall's own door openings.
 *
 * - A stretch on a banded ring's edge (ringCoincidences) is left to the ring,
 *   and any door opening on it goes to the ring so its rock is cut there.
 * - Each stretch kept is turned so the floor is on its right (void left, as
 *   the walk lays it), read along the run; where that changes the run is
 *   split. Floor on both sides or neither: {@link neutralSide}. A loop with
 *   no shared stretch is one ring: the floor's side by majority, else void
 *   inside, so a pillar drawn in a room stands as rock with its shadow out.
 */
export function planDrawnBand(
  points: Polygon,
  floor: Polygon[],
  rings: BandRingRef[],
  gaps: DoorGap[] = [],
): DrawnBandPlan {
  const closed = points.length >= 4 && dist(points[0] as Vec, points[points.length - 1] as Vec) < 1e-9;
  const pts = canonicalLine(points as Vec[], closed);
  const cum = arcLengths(pts);
  const total = cum[cum.length - 1];
  if (total < 1e-9) return { runs: [], ringGaps: [] };
  const inFloor = floorTest(floor);

  const hits = ringCoincidences(pts as Polygon, rings);
  const ringGaps: DoorGap[] = [];
  for (const g of gaps) {
    const s = arcPosition(pts, g.position);
    if (dist(pointAtArc(pts, cum, s), g.position) > COINCIDE_TOL + 0.05) continue;
    const hit = hits.find((h) => s >= h.from - 1e-6 && s <= h.to + 1e-6);
    if (hit) ringGaps.push({ ...g, ring: hit.ring });
  }

  const shared = mergeSpans(hits);
  if (closed && shared.length === 0) {
    const sides = sideStretches(pts, cum, inFloor);
    const vote = sides.reduce((v, [a, b, side]) => v + side * (b - a), 0);
    // Wound positive the void is outside (orientRings): kept when the floor is
    // outside. No verdict either way: void inside, the other winding.
    const keep = vote > 1e-9;
    return { runs: [{ points: (keep ? pts : [...pts].reverse()) as Polygon, closed: true }], ringGaps };
  }

  // The stretches the wall still lays, in arc length, with how far each end
  // runs on into the shared stretch it meets (HANDOVER_RUN_ON, never past it),
  // so the wall's last stone tucks against the ring's rock. On a loop they run
  // round.
  const kept: [number, number, number, number][] = [];
  const runOn = (s: [number, number]): number => Math.min(HANDOVER_RUN_ON, s[1] - s[0]);
  if (closed) {
    for (let i = 0; i < shared.length; i++) {
      const next = i + 1 < shared.length ? shared[i + 1] : shared[0];
      const from = shared[i][1];
      const to = i + 1 < shared.length ? next[0] : next[0] + total;
      if (to - from > 1e-6) kept.push([from, to, runOn(shared[i]), runOn(next)]);
    }
  } else {
    let at = 0;
    let before: [number, number] | null = null;
    for (const s of shared) {
      if (s[0] - at > 1e-6) kept.push([at, s[0], before ? runOn(before) : 0, runOn(s)]);
      at = Math.max(at, s[1]);
      before = s;
    }
    if (total - at > 1e-6) kept.push([at, total, before ? runOn(before) : 0, 0]);
  }

  const runs: DrawnBandRun[] = [];
  for (const [a, b, head, tail] of kept) {
    // Sides are read on the stretch itself: the run-on lies on the ring's edge,
    // where the floor is on one side only, and would otherwise decide for it.
    const core = subLine(pts, cum, a, b, closed);
    const sides = sideStretches(core, arcLengths(core), inFloor);
    const run = subLine(pts, cum, a - head, b + tail, closed);
    const rc = arcLengths(run);
    const len = rc[rc.length - 1];
    sides.forEach(([s0, s1, side], k) => {
      const piece = subLine(run, rc, k === 0 ? 0 : s0 + head, k === sides.length - 1 ? len : s1 + head, false);
      if (piece.length < 2) return;
      const turn = side === 0 ? neutralSide(core) : side;
      runs.push({ points: (turn === 1 ? piece : [...piece].reverse()) as Polygon, closed: false });
    });
  }
  return { runs, ringGaps };
}
