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
import { GRID_CELL_PX, bandSetArt, hasLiveTexture, isMeasuredBandSet, type CatalogEntry } from '../assets/packCatalog';
import { bandPiecesFor, caveBandPieces, jointsOf, type CaveKitPiece } from '../assets/caveWallKit';
import type { Polygon } from '../types/geometry';
import { clipper2Engine } from '../geometry/Clipper2Engine';
import type { DungeonLayer, ShapeChild } from '../store/types';
import { ringOwner } from '../shared/wallLook';
import {
  BAND_OUT,
  kitOut,
  kitOverlap,
  layCorners,
  offsetCurve,
  placePiece,
  resampleClosed,
  tangentAt,
  walkClosed,
  walkSpan,
  type Curve,
  type RingCorner,
  type Vec,
  type WalkOptions,
  type WalkPlacement,
} from './caveWalk';
import type { DoorGap } from './wallNodeRenderer';

/** Sample spacing of the curve the walk rides, in cells — the solver's. */
export const CURVE_STEP = 0.1;
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
export const LIVE_WALK: WalkOptions = { lap: true, splits: 4, fill: true };

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
 * corner lifted by {@link liftField} before rounding and put back after. `out` is the kit's
 * shove (`kitOut`): a thin line kit rides the edge itself.
 */
export function bandRide(base: Curve, closed: boolean, out = BAND_OUT): Curve {
  const lift = liftField(base, closed);
  // Every corner an ordinary one (no tip past a right angle, nothing turning
  // toward the void): the ride the band has always had, step for step, so a
  // plain ring or run lays exactly the pieces it did before.
  if (lift.every((l) => Math.abs(l - CORNER_LIFT) < 1e-9)) {
    if (closed) return offsetCurve(roundCorners(offsetCurve(base, out + CORNER_LIFT), true), -CORNER_LIFT);
    return shoveOpen(roundCorners(shoveOpen(base, out + CORNER_LIFT), false), -CORNER_LIFT);
  }
  const lifted = resampleCarrying(
    shoveEach(base, lift.map((l) => out + l), closed),
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
 * cover reaches that much further than the opening's half-width (see {@link gapReach}).
 */
function openSpans(ride: Curve, gaps: DoorGap[], ring: boolean, set: CaveKitPiece[]): [number, number][] | null {
  if (gaps.length === 0) return null;
  const n = ride.length;
  const covered = new Array<boolean>(n).fill(false);
  let any = false;
  for (const g of gaps) {
    const r = gapReach(g, set);
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
 * How far from a gap's middle the ride counts as inside it. Art with soft ends stops a
 * little short of the opening; a measured kit's cover ends where the ride is level with
 * the opening's own end, so its rock can be run right up to it (see {@link reachOpenings}).
 */
function gapReach(g: DoorGap, set: CaveKitPiece[]): number {
  return set.some((p) => p.exact) ? Math.hypot(g.width / 2, kitOut(set)) : g.width / 2 + BAND_OUT + CURVE_STEP;
}

/** Openings closer than this along the line touch. */
const WALL_END_JOIN = 0.01;
/** A gap further than this from every edge of a line is not on it. */
const ON_EDGE = 0.05;

/**
 * Where the wall stops beside each opening on `line` (a ring when `closed`): each gap laid
 * on the edge nearest it as its stretch along that edge, touching stretches joined (round
 * a vertex too, where the next edge is open from its start), and the two outer ends of
 * each joined opening.
 */
function wallEnds(line: Polygon, gaps: DoorGap[], closed: boolean): Vec[] {
  const pts: Vec[] = line.map(([x, y]) => [x, y]);
  if (closed) pts.push(pts[0]);
  const cum = arcLengths(pts);
  const total = cum[cum.length - 1];
  const spans: [number, number][] = [];
  for (const g of gaps) {
    let best: { d: number; e: number; s: number } | null = null;
    for (let e = 0; e + 1 < pts.length; e++) {
      const L = cum[e + 1] - cum[e];
      if (L < 1e-9) continue;
      const along = sub(pts[e + 1], pts[e]);
      const s = Math.max(0, Math.min(L, dot(sub(g.position, pts[e]), along) / L));
      const d = dist(g.position, add(pts[e], mul(along, s / L)));
      if (!best || d < best.d) best = { d, e, s };
    }
    if (!best || best.d > ON_EDGE) continue;
    const L = cum[best.e + 1] - cum[best.e];
    spans.push([cum[best.e] + Math.max(0, best.s - g.width / 2), cum[best.e] + Math.min(L, best.s + g.width / 2)]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const joined: [number, number][] = [];
  for (const [a, b] of spans) {
    const last = joined[joined.length - 1];
    if (last && a <= last[1] + WALL_END_JOIN) last[1] = Math.max(last[1], b);
    else joined.push([a, b]);
  }
  let ends = joined.flat();
  // An opening across a ring's seam is one opening: its ends at the seam are no wall's.
  if (closed && ends.length > 0 && ends[0] <= WALL_END_JOIN && ends[ends.length - 1] >= total - WALL_END_JOIN) {
    ends = ends.slice(1, -1);
  }
  return ends.map((s) => pointAtArc(pts, cum, s));
}

/**
 * A measured kit's run beside an opening, its end straights moved along their own chords
 * so the art stops level with the wall's end there (see {@link wallEnds}): the nearest
 * one to the end joint, within a cell. The art ends half the kit's overlap back from its
 * joint, so the joint is aimed that far past the wall end, into the opening. No piece goes
 * outside 0.8 to 1.25 times its drawn size; what that cannot make up is left. A kit with
 * no `exact` piece is returned untouched.
 */
function reachOpenings(run: WalkPlacement[], ends: Vec[], set: CaveKitPiece[]): WalkPlacement[] {
  if (run.length === 0 || ends.length === 0 || !set.some((p) => p.exact)) return run;
  const half = kitOverlap(set) / 2;
  const out = kitOut(set);
  const result = [...run];
  const reach = (k: number, end: boolean): void => {
    const pl = result[k];
    if (pl.piece.turnDeg !== 0) return;
    const joint = jointsOf(pl.piece, pl.at)[end ? 1 : 0];
    const wall = ends.reduce((a, b) => (dist(b, joint) < dist(a, joint) ? b : a));
    if (dist(wall, joint) > 1) return;
    const dir = norm(sub(pl.Q, pl.P));
    const L = dist(pl.P, pl.Q);
    const drawn = dist(...pl.piece.jointsCells);
    // Along the chord from the joint to the wall end, then half an overlap on past it.
    const want = dot(sub(wall, joint), dir) * (end ? 1 : -1) + half;
    const grow = Math.min(Math.max(want, 0.8 * drawn - L), MEET_STRETCH * drawn - L);
    const P = end ? pl.P : sub(pl.P, mul(dir, grow));
    const Q = end ? add(pl.Q, mul(dir, grow)) : pl.Q;
    result[k] = { ...pl, P, Q, at: placePiece(pl.piece, P, Q, out, 0, pl.nudge) };
  };
  reach(0, false);
  reach(result.length - 1, true);
  return result;
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
 * A band laid at `size` times the scale its kit was drawn at (a wall's width, see
 * `bandScale`). The walk and everything it measures in cells stay as they are: it
 * lays the line shrunk by `size`, door openings with it, and its answer is grown
 * back, so the rock is that much thinner, shorter and closer to the edge alike.
 */
function laidAtSize(
  size: number,
  line: Polygon,
  gaps: DoorGap[],
  lay: (line: Polygon, gaps: DoorGap[]) => WalkPlacement[],
): WalkPlacement[] {
  const inv = 1 / size;
  const placed = lay(
    line.map(([x, y]): [number, number] => [x * inv, y * inv]),
    gaps.map((g) => ({ ...g, position: [g.position[0] * inv, g.position[1] * inv], width: g.width * inv })),
  );
  return placed.map((pl) => ({
    ...pl,
    P: mul(pl.P, size),
    Q: mul(pl.Q, size),
    nudge: pl.nudge * size,
    at: { ...pl.at, position: { x: pl.at.position.x * size, y: pl.at.position.y * size }, scale: pl.at.scale * size },
  }));
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
  size = 1,
): WalkPlacement[] {
  if (size !== 1) return laidAtSize(size, poly, gaps, (p, g) => layBandRing(p, g, set));
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
  const ride = bandRide(base, true, kitOut(set));
  const spans = openSpans(ride, gaps, true, set);
  if (spans) {
    const ends = wallEnds(poly, gaps, true);
    return spans.flatMap(([from, to]) =>
      reachOpenings(meetNeighbours(laySpan(ride, set, from, to, { lap: true }), set, false), ends, set),
    );
  }
  const corners = cornerRing(poly, ride, set);
  if (corners?.short) return meetNeighbours(corners.placed, set, true);
  let walked: WalkPlacement[] = [];
  try {
    walked = walkClosed(ride, set, LIVE_WALK).placed;
  } catch {
    walked = [];
  }
  // A ring of straight sides the walk cut a corner of (a straight laid across it, or a
  // bend the wrong way) is laid corner first after all.
  if (corners && cutsCorner(walked, corners.turn)) return meetNeighbours(corners.placed, set, true);
  return meetNeighbours(walked, set, true);
}

/** A joint short of its lap by more than this, cells, is an opening (a door, a run's end). */
const MEET_SHORT = 0.75;
/** A joint whose two ends sit further apart than this sideways, cells, is an opening too. */
const MEET_SIDE = 0.5;
/** The most a piece is lengthened, as a share of the chord the walk gave it. */
const MEET_STRETCH = 1.25;
/** The most extra lap a turn at a joint asks for, cells: it covers the wedge on the outside. */
const MEET_TURN_LAP = 0.3;

/**
 * One laid run of a measured kit with its short joints closed. The walk closes a ring by
 * letting joints lap less than the kit's overlap; art drawn with soft ends hides that, but
 * art measured to butt shows every short lap as a hole in the wall. So each joint that laps
 * less than the overlap (plus a little for the turn there) where the art lands has one of
 * its two pieces lengthened along its own chord to make it up: the longer straight, else the earlier piece.
 * A joint far short or far apart sideways is an opening and is left. A kit with no `exact`
 * piece is returned untouched.
 */
export function meetNeighbours(placed: WalkPlacement[], set: CaveKitPiece[], ring: boolean): WalkPlacement[] {
  if (placed.length < 2 || !set.some((p) => p.exact)) return placed;
  const overlap = kitOverlap(set);
  const out = kitOut(set);
  const run = [...placed];
  const limit = run.map((pl) => dist(pl.P, pl.Q) * MEET_STRETCH);
  const chordAngle = (pl: WalkPlacement): number => Math.atan2(pl.Q[1] - pl.P[1], pl.Q[0] - pl.P[0]);
  const halfTurn = (pl: WalkPlacement): number => (pl.piece.turnDeg * Math.PI) / 360;
  for (let k = 0; k < run.length - (ring ? 0 : 1); k++) {
    const j = (k + 1) % run.length;
    const a = run[k];
    const b = run[j];
    // Travel at the joint, read off the earlier piece: a bend's chord turned on by half its turn.
    const exit = chordAngle(a) + halfTurn(a);
    const t: Vec = [Math.cos(exit), Math.sin(exit)];
    // Measured where the art's joints landed, not on the chords: each piece is shoved off its
    // own chord, and a bend's chord runs at an angle to travel, so that shove alone pulls its
    // joints back along travel and eats most of the lap the chords show.
    const d = sub(jointsOf(a.piece, a.at)[1], jointsOf(b.piece, b.at)[0]);
    const lap = dot(d, t);
    const entry = chordAngle(b) - halfTurn(b);
    const turn = Math.abs(Math.atan2(Math.sin(entry - exit), Math.cos(entry - exit)));
    const short = overlap + Math.min(MEET_TURN_LAP, 0.3 * Math.tan(turn / 2)) - lap;
    if (short <= 0 || short > MEET_SHORT || Math.abs(cross(d, t)) > MEET_SIDE) continue;
    const moveLater = b.piece.turnDeg === 0 && (a.piece.turnDeg !== 0 || b.piece.chordCells > a.piece.chordCells);
    const idx = moveLater ? j : k;
    const pl = run[idx];
    const dir = norm(sub(pl.Q, pl.P));
    const along = dot(dir, t);
    if (along <= 0) continue;
    const grow = Math.min(short / along, limit[idx] - dist(pl.P, pl.Q));
    if (grow <= 0) continue;
    const P = moveLater ? sub(pl.P, mul(dir, grow)) : pl.P;
    const Q = moveLater ? pl.Q : add(pl.Q, mul(dir, grow));
    run[idx] = { ...pl, P, Q, at: placePiece(pl.piece, P, Q, out, 0, pl.nudge) };
  }
  return run;
}

/** The art turns less than the ring's corners do, or a piece stood in where none fit. */
function cutsCorner(placed: WalkPlacement[], turn: number): boolean {
  if (placed.length === 0) return true;
  const turned = placed.reduce((sum, pl) => sum + pl.piece.turnDeg, 0);
  return placed.some((pl) => pl.branch === 'fallback') || Math.abs(turned - turn) > CUT_CORNER_DEG;
}

/** How far the art may turn from the ring's own corners before a corner counts as cut. */
const CUT_CORNER_DEG = 45;

/** A polygon vertex turning less than this is part of a straight side. */
const SIDE_TURN_DEG = 5;
/** A vertex turning at least this is a corner; anything between is a curve, left to the walk. */
const RING_CORNER_DEG = 60;

/**
 * A ring of straight sides laid corner first (`layCorners`): the smallest bends the kit
 * has on each corner, then straights at their own size between, lapping the bends. `short`
 * when some side has room for one straight at most once its corners are turned: the walk
 * leaves such a side nothing to lay but a piece across a corner. `turn` is the sum of the
 * ring's corner turns. Null for a ring with a curve in it.
 */
function cornerRing(
  poly: Polygon,
  ride: Curve,
  set: CaveKitPiece[],
): { placed: WalkPlacement[]; short: boolean; turn: number } | null {
  const pts: Vec[] = [];
  for (const p of poly) {
    const last = pts[pts.length - 1];
    if (!last || dist(last, p as Vec) > 1e-6) pts.push([p[0], p[1]]);
  }
  if (pts.length > 2 && dist(pts[0], pts[pts.length - 1]) <= 1e-6) pts.pop();
  const m = pts.length;
  if (m < 3) return null;
  const corners: RingCorner[] = [];
  for (let k = 0; k < m; k++) {
    const a = norm(sub(pts[k], pts[(k - 1 + m) % m]));
    const b = norm(sub(pts[(k + 1) % m], pts[k]));
    const turn = (Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]) * 180) / Math.PI;
    if (Math.abs(turn) < SIDE_TURN_DEG) continue;
    if (Math.abs(turn) < RING_CORNER_DEG) return null;
    corners.push({ at: cornerOnRide(ride, pts[k]), turn });
  }
  const shortest = Math.min(...set.filter((p) => p.turnDeg === 0).map((p) => p.chordCells));
  const laid = layCorners(ride, corners, set);
  if (!laid) return null;
  return {
    placed: laid.placed,
    short: Math.min(...laid.sides) < shortest * SHORT_SIDE,
    turn: corners.reduce((sum, c) => sum + c.turn, 0),
  };
}

/**
 * The ride index a polygon corner turns at: the middle of the stretch of ride within
 * CORNER_NEAR of it. The ride is rounded there, so the nearest point alone wanders along
 * the curve; the middle of the near stretch sits on the corner's bisector.
 */
function cornerOnRide(ride: Curve, corner: Vec): number {
  const n = ride.length;
  let near = 0;
  for (let i = 1; i < n; i++) if (dist(ride[i], corner) < dist(ride[near], corner)) near = i;
  const reach = Math.max(CORNER_NEAR, dist(ride[near], corner) + CURVE_STEP);
  let lo = 0;
  while (lo < n / 2 && dist(ride[(near - lo - 1 + n) % n], corner) <= reach) lo++;
  let hi = 0;
  while (hi < n / 2 && dist(ride[(near + hi + 1) % n], corner) <= reach) hi++;
  return near + (hi - lo) / 2;
}

/** How far from a polygon corner the ride counts as turning it, cells. */
const CORNER_NEAR = 1;

/** A side with less free run than this many shortest straights is short. */
const SHORT_SIDE = 2;

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
  size = 1,
): WalkPlacement[] {
  if (size !== 1) return laidAtSize(size, points, gaps, (p, g) => layBandChain(p, g, set));
  return layChain(points as Curve, gaps, set, { lap: true });
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
  const ride = padEnds(bandRide(base, false, kitOut(set)));
  const first = END_PAD;
  const last = ride.length - 1 - END_PAD;
  const spans = openSpans(ride, gaps, false, set) ?? [[first, last]];
  const ends = wallEnds(points as Polygon, gaps, false);
  return spans.flatMap(([from, to]) =>
    reachOpenings(meetNeighbours(laySpan(ride, set, Math.max(from, first), Math.min(to, last), opts), set, false), ends, set),
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
    // Walled floors only: a ground piece owns no ring of the union.
    shapes ??= layer.children.filter(
      (c): c is ShapeChild => c.childType === 'shape' && c.visible !== false && !c.ground,
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
  /** The size the band's rock was laid at (see `laidAtSize`); 1 when absent. */
  size?: number;
}

/**
 * The parts of segment a→b (length `L`, unit direction `t`) no door opening
 * takes, as `[s0, s1]` distances along it. A gap stops the strip where the
 * walk's span stops the rock (`openSpans`), plus a hair.
 */
function uncutIntervals(a: Vec, t: Vec, L: number, gaps: DoorGap[], size: number): [number, number][] {
  let out: [number, number][] = [[0, L]];
  for (const g of gaps) {
    const r = g.width / 2 + (BAND_OUT + 2 * CURVE_STEP) * size;
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
  const size = spec.size ?? 1;
  const reach = BAND_FILL_REACH * size;
  const tipTrim = TIP_FILL_TRIM * size;
  const segs = spec.closed ? n : n - 1;
  const tans: Vec[] = [];
  const lens: number[] = [];
  const keeps: [number, number][][] = [];
  let walked = 0;
  for (let k = 0; k < segs; k++) {
    const a = pts[k];
    const L = dist(a, pts[(k + 1) % n]);
    const t = norm(sub(pts[(k + 1) % n], a));
    let keep = uncutIntervals(a, t, L, spec.gaps, size);
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
      .map(([s0, s1]): [number, number] => [s0, Math.min(s1, lens[prev] - tipTrim)])
      .filter(([s0, s1]) => s1 - s0 > 1e-6);
    keeps[k] = keeps[k]
      .map(([s0, s1]): [number, number] => [Math.max(s0, tipTrim), s1])
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
 *
 * `waitFor` is told each piece whose art has not decoded yet, so the host can redraw
 * once it lands (as `placeNodes` does for stones).
 */
export function placeBand(
  parent: Container,
  placed: WalkPlacement[],
  art: Map<string, CatalogEntry>,
  tint: number,
  from: number,
  fill?: BandFillSpec,
  waitFor?: (textureId: string) => void,
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
    if (tex.width <= 1) {
      waitFor?.(entry.id);
      continue;
    }

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

/* ── Any outline ──────────────────────────────────────────────────────
 *
 * The band is not only a floor's: a Material brush patch has its border units
 * laid the same way round its outline. The rings are oriented as floor rings
 * are, so what lies outside the outline is the walk's void side, and each is
 * walked with the set's kit; holes walk the other way round, like a floor's.
 */

/**
 * A band set's kit laid round each of `rings` (outer rings and holes), one list a ring.
 * `gaps` are door openings on the outline: a ring stops its rock at each, as a floor ring does.
 * `size` is the size the rock is laid at (`bandScale` of the wall width).
 */
export function layOutlineBand(rings: Polygon[], set: CaveKitPiece[] = caveBandPieces(), gaps: DoorGap[] = [], size = 1): WalkPlacement[][] {
  return orientRings(rings).map((ring) => (ring.length < 3 ? [] : layBandRing(ring, gaps, set, size)));
}

/**
 * Draws `setId`'s border units round `rings` into `parent`, after what it holds, with the
 * ground under the rock shaded `fillColor` the way a floor's band strip is. The rock and
 * the strip stop at `gaps` (a painted cave's doors), and are laid at `size`. A measured
 * kit's rock is drawn to its own floor line, so it gets no strip. `waitFor` is told each
 * piece whose art has not decoded yet.
 */
export function drawOutlineBand(
  parent: Container,
  rings: Polygon[],
  setId: string,
  fillColor: number,
  gaps: DoorGap[] = [],
  size = 1,
  waitFor?: (textureId: string) => void,
): void {
  const art = bandSetArt(setId);
  const oriented = orientRings(rings);
  const laid = layOutlineBand(rings, bandPiecesFor(setId), gaps, size);
  const strip = !isMeasuredBandSet(setId);
  let at = parent.children.length;
  oriented.forEach((edge, i) => {
    at = placeBand(parent, laid[i], art, 0xffffff, at, strip ? { edge, closed: true, gaps, color: fillColor, size } : undefined, waitFor);
  });
}

/* ── A measured kit's floor ───────────────────────────────────────────
 *
 * The walk rounds corners and nudges pieces, so a kit's rock does not lie on the
 * authored edge: its floor line runs a little inside it here and outside it there,
 * and a corner sharper than any bend leaves floor past the rock's tip. The ink kit's
 * strip hid that under shaded ground; a measured kit has none, so the floor's paint
 * is fitted to the rock instead. Visual only: sight, rooms, fog, hit tests and node
 * editing keep reading the authored edge.
 */

/**
 * How far to the floor side of a laid piece's joint line its seat runs, in the
 * piece's cells. A kit's joints sit 0.36 to the void side of its floor line and the
 * rock is solid from the floor line to the joint line, so this is under the rock.
 */
export const SEAT_IN = 0.13;
/** Joint-line samples per cell, as the seat is traced. */
const SEAT_STEP = 0.25;
/** How far from the authored edge the paint may be fitted, in cells at size 1. */
export const FIT_REACH = 0.8;
/** How far past a door opening's half-width the paint keeps to the authored edge, cells. */
export const FIT_DOOR_PAD = 0.6;
/** How far a floor's own region may reach to fill the ground under its rock, cells. */
export const FIT_GROW = 0.6;

/** What a measured kit's rock asks of the floor under it: paint off `tips`, paint on `gaps`. */
export interface FloorFit {
  /** Floor past the rock. */
  tips: Polygon[];
  /** Ground between the floor and the rock. */
  gaps: Polygon[];
}

/**
 * The region one ring's rock seats on: each placement's joint line (its chord, bowed
 * as `fitArc` assumes for a bend) shifted SEAT_IN to the right of travel, the floor
 * side, chained in walk order and closed. A piece that carries its rock's spine gives
 * that instead, unshifted: it already runs under the rock. Empty for a ring the walk
 * laid nothing for.
 */
export function bandSeat(placed: WalkPlacement[]): Polygon[] {
  const chain: [number, number][] = [];
  for (const pl of placed) {
    if (pl.piece.spine) {
      // Mapped as jointsOf maps the joints: a mirrored piece's spine is already mirrored.
      const c = Math.cos(pl.at.rotation);
      const s = Math.sin(pl.at.rotation);
      for (const [x, y] of pl.piece.spine) {
        chain.push([pl.at.position.x + (x * c - y * s) * pl.at.scale, pl.at.position.y + (x * s + y * c) * pl.at.scale]);
      }
      continue;
    }
    const [J0, J1] = jointsOf(pl.piece, pl.at);
    const v = sub(J1, J0);
    const L = Math.hypot(v[0], v[1]);
    if (L < 1e-9) continue;
    const right: Vec = [-v[1] / L, v[0] / L];
    const phi = (Math.abs(pl.piece.turnDeg) * Math.PI) / 360;
    const R = phi > 1e-4 ? L / (2 * Math.sin(phi)) : 0;
    const sgn = -Math.sign(pl.piece.turnDeg);
    const seat = SEAT_IN * pl.at.scale;
    const steps = Math.max(1, Math.ceil(L / SEAT_STEP));
    for (let k = 0; k <= steps; k++) {
      const u = k / steps;
      const bow = R ? sgn * R * (Math.cos(phi * (2 * u - 1)) - Math.cos(phi)) : 0;
      chain.push(add(add(J0, mul(v, u)), mul(right, bow + seat)));
    }
  }
  return chain.length >= 3 ? clipper2Engine.union([chain], []) : [];
}

/** A circle as a polygon. */
function disc(c: Vec, r: number): Polygon {
  const n = 24;
  return Array.from({ length: n }, (_, k): [number, number] => [
    c[0] + r * Math.cos((2 * Math.PI * k) / n),
    c[1] + r * Math.sin((2 * Math.PI * k) / n),
  ]);
}

/**
 * Where the floor of `ring` (wound void-left, see {@link orientRings}) must be painted
 * off and on to meet the rock laid round it. Kept within FIT_REACH (times `size`) of
 * the authored edge, and clear of each door opening on the ring by FIT_DOOR_PAD.
 */
export function bandFloorFit(ring: Polygon, placed: WalkPlacement[], doors: DoorGap[] = [], size = 1): FloorFit {
  const seat = ring.length < 3 ? [] : bandSeat(placed);
  if (seat.length === 0) return { tips: [], gaps: [] };
  // A hole's floor is outside it, so what lies past the rock is the other way round.
  const hole = signedArea(ring) < 0;
  const outside = clipper2Engine.difference([ring], seat);
  const inside = clipper2Engine.difference(seat, [ring]);
  const near = clipper2Engine.inflateOpen([[...ring, ring[0]]], FIT_REACH * size);
  const open = doors.map((g) => disc(g.position, g.width / 2 + FIT_DOOR_PAD));
  const guard = (r: Polygon[]): Polygon[] => {
    const kept = r.length > 0 ? clipper2Engine.intersection(r, near) : r;
    return open.length > 0 && kept.length > 0 ? clipper2Engine.difference(kept, open) : kept;
  };
  return hole ? { tips: guard(inside), gaps: guard(outside) } : { tips: guard(outside), gaps: guard(inside) };
}

/** A walled floor's `region` as painted under a fitted rock: `(region − tips) ∪ (grown region ∩ gaps)`. */
export function fittedFloor(region: Polygon[], fit: FloorFit | undefined): Polygon[] {
  if (!fit || (fit.tips.length === 0 && fit.gaps.length === 0)) return region;
  const cut = fit.tips.length > 0 ? clipper2Engine.difference(region, fit.tips) : region;
  if (fit.gaps.length === 0) return cut;
  const add = clipper2Engine.intersection(clipper2Engine.inflate(region, FIT_GROW), fit.gaps);
  return add.length > 0 ? clipper2Engine.union(cut, add) : cut;
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
