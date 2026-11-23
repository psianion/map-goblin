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
import { BAND_DRAWN_WIDTH, GRID_CELL_PX, bandSetArt, hasLiveTexture, isMeasuredBandSet, type CatalogEntry } from '../assets/packCatalog';
import { bandPiecesFor, caveBandPieces, jointsOf, kitConnectors, placeOnChord, type CaveKitPiece } from '../assets/caveWallKit';
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
function openSpans(ride: Curve, gaps: DoorGap[], ring: boolean): [number, number][] | null {
  if (gaps.length === 0) return null;
  const n = ride.length;
  const covered = new Array<boolean>(n).fill(false);
  let any = false;
  for (const g of gaps) {
    const r = gapReach(g);
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
 * How far from a gap's middle the ride counts as inside it: art with soft ends stops a
 * little short of the opening. (A measured kit is laid stretch by stretch instead, see
 * {@link layWallRuns}.)
 */
function gapReach(g: DoorGap): number {
  return g.width / 2 + BAND_OUT + CURVE_STEP;
}

/** Openings closer than this along the line touch. */
const WALL_END_JOIN = 0.01;
/** A gap further than this from every edge of a line is not on it. */
const ON_EDGE = 0.05;

/**
 * A measured kit along `line` (a ring when `closed`) with openings on it: each stretch of
 * wall between the openings (see {@link openingArcs}), and between a chain's own ends and
 * them, laid as a chain of its own, carried half the kit's overlap past each wall end along
 * its own direction so the art stops exactly there. A stretch shorter than EXACT_SLIVER is
 * left bare. Null when no gap lies on the line; none for a ring open all round.
 */
function layWallRuns(line: Polygon, gaps: DoorGap[], set: CaveKitPiece[], closed: boolean, opts: WalkOptions): WalkPlacement[] | null {
  const { pts, cum, joined } = openingArcs(line, gaps, closed);
  if (joined.length === 0) return null;
  const total = cum[cum.length - 1];
  if (closed && joined.length === 1 && joined[0][1] - joined[0][0] >= total - WALL_END_JOIN) return [];
  const half = kitOverlap(set) / 2;
  // Each stretch from where it opens to where it closes, and whether an opening bounds each end.
  const stretches: [number, number, boolean, boolean][] = joined.slice(1).map((o, k) => [joined[k][1], o[0], true, true]);
  if (closed) {
    stretches.push([joined[joined.length - 1][1], joined[0][0] + total, true, true]);
  } else {
    stretches.unshift([0, joined[0][0], false, true]);
    stretches.push([joined[joined.length - 1][1], total, true, false]);
  }
  return stretches.flatMap(([from, to, open0, open1]) => {
    if (to - from < EXACT_SLIVER) return [];
    const run = subLine(pts, cum, from, to, closed);
    const n = run.length;
    if (n < 2) return [];
    const t0 = norm(sub(run[1], run[0]));
    const t1 = norm(sub(run[n - 1], run[n - 2]));
    const carried: Vec[] = [...(open0 ? [sub(run[0], mul(t0, half))] : []), ...run, ...(open1 ? [add(run[n - 1], mul(t1, half))] : [])];
    return layChain(carried, [], set, opts);
  });
}

/**
 * The openings on `line` as {@link layWallRuns} finds them: `[from, to]` along the arc of `pts`
 * (the line, its first point repeated at the end when `closed`), in order, touching ones
 * joined and one across a ring's seam running on past its end.
 */
function openingArcs(line: Polygon, gaps: DoorGap[], closed: boolean): { pts: Vec[]; cum: number[]; joined: [number, number][] } {
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
  // An opening across a ring's seam is one opening: its ends at the seam are no wall's.
  if (closed && joined.length > 1 && joined[0][0] <= WALL_END_JOIN && joined[joined.length - 1][1] >= total - WALL_END_JOIN) {
    joined[joined.length - 1][1] = total + joined.shift()![1];
  }
  return { pts, cum, joined };
}

/**
 * How far a measured piece's rock may run from the outline it is walked along, cells. The
 * shape gate holds a piece's chord to the curve it rides, but a piece that carries its rock's
 * spine can run off the outline where its chord does not (a square corner's spine on a round
 * one), and a long straight's spine across a curve leaves floor outside it.
 */
const CURVE_KEEP = 0.3;

/**
 * What a measured kit's walk along `base` (the outline, sampled; a ring when `closed`) may lay:
 * a piece whose spine, where it carries one, stays within CURVE_KEEP of the outline over its
 * whole length. None for a kit with no `exact` piece.
 */
function keepsToOutline(base: Curve, closed: boolean, set: CaveKitPiece[]): WalkOptions['accept'] {
  if (!set.some((p) => p.exact)) return undefined;
  const out = kitOut(set);
  // The outline's segments by the cell they cross, so a point looks at those near it only.
  const cells = new Map<string, number[]>();
  const cell = (x: number, y: number): string => `${Math.floor(x)},${Math.floor(y)}`;
  const segs = closed ? base.length : base.length - 1;
  for (let i = 0; i < segs; i++) {
    const a = base[i];
    const b = base[(i + 1) % base.length];
    for (let x = Math.floor(Math.min(a[0], b[0])); x <= Math.floor(Math.max(a[0], b[0])); x++) {
      for (let y = Math.floor(Math.min(a[1], b[1])); y <= Math.floor(Math.max(a[1], b[1])); y++) {
        const k = `${x},${y}`;
        const list = cells.get(k);
        if (list) list.push(i);
        else cells.set(k, [i]);
      }
    }
  }
  const near = (p: Vec): boolean => {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const i of cells.get(cell(p[0] + dx, p[1] + dy)) ?? []) {
          if (segmentDist(p, base[i], base[(i + 1) % base.length]) <= CURVE_KEEP) return true;
        }
      }
    }
    return false;
  };
  return (piece, P, Q, nudge) => {
    if (!piece.spine) return true;
    const at = placePiece(piece, P, Q, out, 0, nudge);
    return pieceSeat({ piece, P, Q, i: 0, nudge, branch: 'walk', at }).every(near);
  };
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
 *
 * A measured kit on a ring of straight sides is laid corner by corner instead (see
 * {@link layExactRing}), and on any other ring with openings stretch by stretch between
 * them (see {@link layWallRuns}); round a curve it lays only pieces that keep to it (see
 * {@link keepsToOutline}).
 */
export function layBandRing(
  poly: Polygon,
  gaps: DoorGap[] = [],
  set: CaveKitPiece[] = caveBandPieces(),
  size = 1,
): WalkPlacement[] {
  return keptLaying('ring', poly, gaps, set, size, () => {
    if (size !== 1) return laidAtSize(size, poly, gaps, (p, g) => layBandRing(p, g, set));
    return pushBends(layRing(poly, gaps, set), set);
  });
}

/** The most layings kept per kit before the oldest are dropped. */
const KEPT_LAYINGS = 512;
const keptLayings = new WeakMap<CaveKitPiece[], Map<string, WalkPlacement[]>>();

/**
 * A measured kit's laying of one ring or run, kept while its outline, its gaps, its size and the
 * kit are the same: a rebuild lays every ring of a layer, and on a drag all but one are as they
 * were. Laying is pure, so what is kept is what would be laid again; callers never change it.
 * Any other kit is laid afresh every time, as it always was.
 */
function keptLaying(kind: string, line: Polygon, gaps: DoorGap[], set: CaveKitPiece[], size: number, lay: () => WalkPlacement[]): WalkPlacement[] {
  if (!set.some((p) => p.exact)) return lay();
  let kept = keptLayings.get(set);
  if (!kept) keptLayings.set(set, (kept = new Map()));
  const key = `${kind}|${size}|${JSON.stringify(line)}|${JSON.stringify(gaps.map((g) => [g.position, g.width]))}`;
  const hit = kept.get(key);
  if (hit) return hit;
  const laid = lay();
  if (kept.size >= KEPT_LAYINGS) kept.delete(kept.keys().next().value!);
  kept.set(key, laid);
  return laid;
}

function layRing(poly: Polygon, gaps: DoorGap[], set: CaveKitPiece[]): WalkPlacement[] {
  if (poly.length < 3) return [];
  const base = resampleClosed(poly as Curve, CURVE_STEP);
  if (base.length < 8) return [];
  const measured = set.some((p) => p.exact);
  const exact = measured ? layExactRing(poly, gaps, set) : null;
  if (exact) return exact;
  // A measured kit's ring with openings on it is laid stretch by stretch between them.
  const runs = measured && gaps.length > 0 ? layWallRuns(poly, gaps, set, true, { lap: true }) : null;
  if (runs) return runs;
  const cuts = measured ? [] : gaps;
  const tips = sharpCorners(base, true);
  if (tips.length) {
    const n = base.length;
    return tips.flatMap((from, k) => {
      let to = tips[(k + 1) % tips.length];
      if (to <= from) to += n;
      const run: Curve = [];
      for (let i = from; i <= to; i++) run.push(base[i % n]);
      return layTipRun(run, true, true, cuts, set);
    });
  }
  const ride = bandRide(base, true, kitOut(set));
  const spans = openSpans(ride, cuts, true);
  if (spans) {
    return spans.flatMap(([from, to]) => meetNeighbours(trimLaps(fullSize(laySpan(ride, set, from, to, { lap: true }), set), set, false), set, false));
  }
  const corners = cornerRing(poly, ride, set);
  if (corners?.short) return meetNeighbours(trimLaps(fullSize(corners.placed, set), set, true), set, true);
  let walked: WalkPlacement[] = [];
  try {
    walked = walkClosed(ride, set, { ...LIVE_WALK, accept: keepsToOutline(base, true, set) }).placed;
  } catch {
    walked = [];
  }
  // A ring of straight sides the walk cut a corner of (a straight laid across it, or a
  // bend the wrong way) is laid corner first after all.
  if (corners && cutsCorner(walked, corners.turn)) return meetNeighbours(trimLaps(fullSize(corners.placed, set), set, true), set, true);
  return meetNeighbours(trimLaps(fullSize(walked, set), set, true), set, true);
}

/**
 * How far each arm of a corner's bend may run from the side it lies along, degrees: a 90
 * degree bend is turned onto a corner of 50 to 130, its arms splitting the difference.
 */
const EXACT_TURN_TOL = 20;
/** A vertex turning at least this is a corner of a straight-sided ring laid bend by bend; 5 to this is a curve. */
const EXACT_CORNER_DEG = 30;
/** A bend whose rock passes further than this from its corner, cells, would leave the corner bare. */
const BEND_HUG = 0.45;
/** A bend whose rock strays further than this from the two sides it joins, cells, is too round for the corner. */
const BEND_STRAY = 0.75;
/** The scale every straight of a stretch is kept inside when any choice of straights allows it. */
const EXACT_FIT: [number, number] = [0.85, 1.2];
/**
 * The scale a stretch no choice fits inside EXACT_FIT may go to: a piece's size, as every
 * measured piece is held to. Past it the straights lap the pieces either side a little more,
 * or a little less.
 */
const EXACT_REACH: [number, number] = [0.85, 1.25];
/** A stretch shorter than this, cells, is left to the lap of the pieces either side. */
const EXACT_SLIVER = 0.25;
/** The length, cells, straights' drawn lengths are summed to when a stretch's fill is chosen. */
const FILL_STEP = 0.01;
/** The scales a stretch's straights are chosen within, tightest first (see {@link fillStretch}). */
const FILL_BANDS: [number, number][] = [[0.9, 1.1], EXACT_FIT];

/**
 * A measured kit round a ring of straight sides: each opening bridged straight between its
 * wall ends, on every corner of the bridged ring a bend chosen for the room either side (see
 * below), at its drawn size with its two joints on the joint lines of the sides it joins, and
 * each stretch of wall left between bends and openings filled with straights scaled alike so
 * their art runs exactly from end to end (see {@link fillStretch}), their joints on the same
 * lines. A side's joint line is the drawn edge moved twice the kit's shove into the void: the
 * ride's shove and the piece's.
 *
 * A corner takes a bend turning its way whose arms each lie within EXACT_TURN_TOL of the side
 * they run along, and whose rock passes within BEND_HUG of the corner and strays no further
 * than BEND_STRAY from its sides: the largest such bend, its twin picked by where the corner
 * is, then smaller ones where two bends would lap on a side or an opening reaches into one. A
 * side too short for any pair keeps the smallest. A corner no bend suits, or one an opening
 * reaches into whatever the bend, gets none: the stretches either side run on to where their
 * joint lines meet (no further past a convex corner than at a right angle) and cross there.
 *
 * Placements in walk order, starting after an opening when there is one. Null when the
 * bridged ring has a curve in it (a vertex turning between 5 and EXACT_CORNER_DEG).
 */
function layExactRing(poly: Polygon, gaps: DoorGap[], set: CaveKitPiece[]): WalkPlacement[] | null {
  const { pts, cum, joined } = openingArcs(poly, gaps, true);
  const total = cum[cum.length - 1];
  if (joined.length === 1 && joined[0][1] - joined[0][0] >= total - WALL_END_JOIN) return null;
  const at = (s: number): Vec => pointAtArc(pts, cum, s % total);
  const openings: [Vec, Vec][] = joined.map(([a, b]) => [at(a), at(b)]);
  // The ring with each opening bridged: every stretch of wall, from where it opens to where it closes.
  let bridged: Vec[] = pts.slice(0, -1);
  if (joined.length > 0) {
    bridged = joined.flatMap(([, from], k) => {
      const to = k + 1 < joined.length ? joined[k + 1][0] : joined[0][0] + total;
      const inner = cum
        .slice(0, -1)
        .map((c, i) => ({ i, d: (((c - from) % total) + total) % total }))
        .filter(({ d }) => d > 1e-9 && d < to - from - 1e-9)
        .sort((p, q) => p.d - q.d)
        .map(({ i }) => pts[i]);
      return [at(from), ...inner, at(to)];
    });
  }
  const corners = ringCorners(bridged, EXACT_CORNER_DEG);
  if (!corners) return null;
  const m = corners.length;

  const half = kitOverlap(set) / 2;
  const out = kitOut(set);
  const sides = corners.map((c, k) => {
    const V = c.p;
    const W = corners[(k + 1) % m].p;
    const u = norm(sub(W, V));
    return { V, u, len: dist(V, W), origin: add(V, mul([u[1], -u[0]], out)) };
  });
  const along = (k: number, p: Vec): number => dot(sub(p, sides[k].V), sides[k].u);
  // How far past corner k along the side into it the two sides' joint lines meet.
  const reach = (k: number): number => 2 * out * Math.tan((corners[k].turn * Math.PI) / 360);
  // A bend on corner k with its joints on the two joint lines, its arms as long, relative to
  // each other, as the bend's own are from where they meet, and spread so the bend keeps its
  // drawn size: on a corner turning less than the bend its arms open out from the sides.
  const bendAt = (k: number, piece: CaveKitPiece): WalkPlacement => {
    const uIn = sides[(k - 1 + m) % m].u;
    const uOut = sides[k].u;
    const meet = add(add(corners[k].p, mul([uIn[1], -uIn[0]], 2 * out)), mul(uIn, reach(k)));
    const [J0, J1] = piece.jointsCells;
    const span = sub(J1, J0);
    const h = (piece.turnDeg * Math.PI) / 360;
    const chord = Math.atan2(span[1], span[0]);
    const eIn: Vec = [Math.cos(chord - h), Math.sin(chord - h)];
    const eOut: Vec = [Math.cos(chord + h), Math.sin(chord + h)];
    const a = cross(span, eOut) / cross(eIn, eOut);
    const b = cross(span, eIn) / cross(eOut, eIn);
    const spread = Math.hypot(span[0], span[1]) / (Math.hypot(...add(mul(uIn, a), mul(uOut, b))) || 1);
    const j0 = sub(meet, mul(uIn, a * spread));
    const j1 = add(meet, mul(uOut, b * spread));
    const d = norm(sub(j1, j0));
    const right: Vec = [-d[1], d[0]];
    const P = add(j0, mul(right, out));
    const Q = add(j1, mul(right, out));
    return { piece, P, Q, i: 0, nudge: 0, branch: 'corner', at: placePiece(piece, P, Q, out, 0, 0) };
  };
  // Each corner's bends that suit it, largest first, twins together: [size][twin].
  const choices = corners.map((c, k): WalkPlacement[][] => {
    const V = c.p;
    const prev = corners[(k - 1 + m) % m].p;
    const next = corners[(k + 1) % m].p;
    const suits = set
      .filter((p) => p.turnDeg !== 0 && !p.flipY && Math.sign(p.turnDeg) === Math.sign(c.turn) && Math.abs(p.turnDeg - c.turn) / 2 <= EXACT_TURN_TOL)
      .map((p) => bendAt(k, p))
      .filter((pl) => {
        const rock = seatLine([pl]) as Vec[];
        const hug = Math.min(...rock.map((q, i) => (i > 0 ? segmentDist(V, rock[i - 1], q) : dist(V, q))));
        const stray = Math.max(...rock.map((q) => Math.min(segmentDist(q, prev, V), segmentDist(q, V, next))));
        return hug <= BEND_HUG && stray <= BEND_STRAY;
      })
      .sort((p, q) => q.piece.chordCells - p.piece.chordCells);
    const sizes: WalkPlacement[][] = [];
    for (const pl of suits) {
      const last = sizes[sizes.length - 1];
      if (last && Math.abs(last[0].piece.chordCells - pl.piece.chordCells) < 0.05) last.push(pl);
      else sizes.push([pl]);
    }
    return sizes;
  });
  const onSide: { w0: number; w1: number }[][] = corners.map(() => []);
  for (const [W0, W1] of openings) {
    const k = sides.findIndex((s, j) => [W0, W1].every((W) => segmentDist(W, s.V, corners[(j + 1) % m].p) <= ON_EDGE));
    if (k < 0) return null;
    onSide[k].push({ w0: along(k, W0), w1: along(k, W1) });
  }
  onSide.forEach((list) => list.sort((p, q) => p.w0 - q.w0));
  // The size each corner takes, and its twin by where the corner is.
  const size = choices.map(() => 0);
  const bendOf = (k: number): WalkPlacement | null => {
    const twins = choices[k][size[k]];
    if (!twins) return null;
    const [x, y] = corners[k].p;
    return twins[((Math.imul(Math.round(x * 100), 7919) ^ Math.round(y * 100)) >>> 0) % twins.length];
  };
  // Where the straights beside corner k's bend start and end along their sides: where the
  // bend's art ends, or, for a bend turned off its side, as far back as makes their joint lap
  // in full along the bend's own travel there.
  const besideBend = (k: number, end: boolean): number => {
    const pl = bendOf(k)!;
    const side = end ? k : (k - 1 + m) % m;
    const turn = ((end ? 1 : -1) * pl.piece.turnDeg * Math.PI) / 360;
    const chord = Math.atan2(pl.Q[1] - pl.P[1], pl.Q[0] - pl.P[0]) + turn;
    const cos = Math.max(0.5, dot([Math.cos(chord), Math.sin(chord)], sides[side].u));
    const back = half * pl.at.scale * (2 / cos - 1);
    return along(side, jointsOf(pl.piece, pl.at)[end ? 1 : 0]) + (end ? -back : back);
  };
  const startOf = (k: number): number => besideBend(k, true);
  const endOf = (k: number): number => besideBend(k, false);
  // An opening reaching into corner k's bend.
  const blocked = (k: number): boolean =>
    onSide[k].some((o) => o.w0 < startOf(k)) || onSide[(k - 1 + m) % m].some((o) => o.w1 > endOf(k));
  for (let k = 0; k < m; k++) {
    while (choices[k][size[k]] && blocked(k)) size[k]++;
  }
  // Two bends lapping on a side beyond a joint's lap: the larger is made smaller, while either can be.
  for (let pass = 0; pass < 4 * m; pass++) {
    let changed = false;
    for (let k = 0; k < m; k++) {
      const j = (k + 1) % m;
      if (!bendOf(k) || !bendOf(j) || endOf(j) - startOf(k) >= -WALL_END_JOIN) continue;
      const smaller = (c: number): boolean => size[c] + 1 < choices[c].length;
      const pick = [k, j].filter(smaller).sort((p, q) => bendOf(q)!.piece.chordCells - bendOf(p)!.piece.chordCells)[0];
      if (pick === undefined) continue;
      size[pick]++;
      changed = true;
    }
    if (!changed) break;
  }
  const bends = corners.map((_, k) => bendOf(k));
  const starts = sides.map((_, k) => (bends[k] ? startOf(k) : 0));
  const ends = sides.map((_, k) => (bends[(k + 1) % m] ? endOf((k + 1) % m) : 0));
  // A side's rock runs to where the joint lines meet at a corner left without a bend.
  const dropped = bends.map((b) => b === null);
  // Where no bend suits the corner at all, on past it as far again as makes the two cross
  // with their joint lapping in full; beside an opening they stop where the joint lines meet.
  const runOn = (k: number): number => {
    const cos = Math.cos((corners[k].turn * Math.PI) / 180);
    const lap = choices[k].length === 0 ? half * (2 / (1 + Math.max(0, cos)) - 1) : 0;
    return (corners[k].turn > 0 ? Math.min(reach(k), 2 * out) : reach(k)) + lap;
  };

  const straights = set.filter((p) => p.turnDeg === 0);
  let mirror = 0;
  /** A stretch from t0 to t1 along side k; a scale held inside EXACT_REACH keeps the art to a wall end, else centred. */
  const fill = (k: number, t0: number, t1: number, wall0: boolean, wall1: boolean): WalkPlacement[] => {
    const L = t1 - t0;
    if (L < EXACT_SLIVER) return [];
    const { origin, u } = sides[k];
    const start = add(origin, mul(u, t0));
    const { pieces, f } = fillStretch(L, straights, 2 * half, Math.round(start[0] * 100) * 7919 + Math.round(start[1] * 100));
    const left = L - pieces.reduce((sum, p) => sum + p.chordCells - 2 * half, 0) * f;
    let s = t0 + (wall0 === wall1 ? left / 2 : wall1 ? left : 0);
    return pieces.map((kind) => {
      const same = straights.filter((p) => p.key === kind.key);
      const piece = same[mirror++ % same.length];
      const P = add(origin, mul(u, s - half * f));
      s += (piece.chordCells - 2 * half) * f;
      const Q = add(origin, mul(u, s + half * f));
      return { piece, P, Q, i: 0, nudge: 0, branch: 'side', at: placePiece(piece, P, Q, out, 0, 0) };
    });
  };
  // Walk order, an opening marked as null where it falls.
  const seq: (WalkPlacement | null)[] = [];
  sides.forEach((side, k) => {
    if (!dropped[k]) seq.push(bends[k]);
    let cursor = dropped[k] ? -runOn(k) : starts[k];
    let atWall = false;
    const last = dropped[(k + 1) % m] ? side.len + runOn((k + 1) % m) : ends[k];
    for (const o of onSide[k]) {
      seq.push(...fill(k, cursor, Math.min(o.w0, last), atWall, o.w0 <= last), null);
      atWall = o.w1 >= cursor;
      cursor = Math.max(cursor, o.w1);
    }
    seq.push(...fill(k, cursor, last, atWall, false));
  });
  const cut = seq.indexOf(null);
  return [...seq.slice(cut + 1), ...seq.slice(0, Math.max(cut, 0))].filter((pl): pl is WalkPlacement => pl !== null);
}

/**
 * The straights a stretch whose art runs `L` cells is filled with, and the one scale they all
 * take: the fewest pieces, longest first, whose scale lies in the first of FILL_BANDS any
 * choice fits; else, its scale held inside EXACT_REACH, the drawn length that leaves no hole and
 * laps the pieces either side least, on the fewest pieces. The order the pieces run in is picked by `seed`.
 * Each straight's art is its chord less `overlap`.
 */
function fillStretch(L: number, straights: CaveKitPiece[], overlap: number, seed: number): { pieces: CaveKitPiece[]; f: number } {
  const kinds = straights
    .filter((p, k) => p.chordCells > overlap && straights.findIndex((q) => q.key === p.key) === k)
    .sort((a, b) => b.chordCells - a.chordCells);
  const steps = kinds.map((p) => Math.max(1, Math.round((p.chordCells - overlap) / FILL_STEP)));
  const mix = (...xs: number[]): number => xs.reduce((h, x) => Math.imul(h ^ x, 0x01000193) >>> 0, 0x811c9dc5);
  // The best way to each drawn length, in FILL_STEP units, as a count of each kind: the fewest
  // pieces, then the most of the longest kind.
  // Long enough that some choice covers the stretch held at the smallest scale it may take.
  const top = Math.max(Math.ceil(L / EXACT_REACH[0] / FILL_STEP) + Math.max(...steps), Math.min(...steps));
  const count = new Array<number>(top + 1).fill(Infinity);
  const made = new Array<number[] | null>(top + 1).fill(null);
  count[0] = 0;
  made[0] = kinds.map(() => 0);
  /** `a`, with one more of kind `j` when given, runs longer pieces than `b` of as many. */
  const longer = (a: number[], b: number[], j = -1): boolean => {
    for (let i = 0; i < a.length; i++) {
      const n = a[i] + (i === j ? 1 : 0);
      if (n !== b[i]) return n > b[i];
    }
    return false;
  };
  for (let t = 0; t < top; t++) {
    const from = made[t];
    if (!from) continue;
    steps.forEach((step, j) => {
      const n = t + step;
      if (n > top) return;
      const c = count[t] + 1;
      if (c < count[n] || (c === count[n] && longer(from, made[n]!, j))) {
        const v = [...from];
        v[j]++;
        count[n] = c;
        made[n] = v;
      }
    });
  }
  const scale = (t: number): number => L / (t * FILL_STEP);
  let best = -1;
  for (const [lo, hi] of FILL_BANDS) {
    for (let t = 1; t <= top; t++) {
      if (!made[t] || scale(t) < lo || scale(t) > hi) continue;
      if (best < 0 || count[t] < count[best] || (count[t] === count[best] && longer(made[t]!, made[best]!))) best = t;
    }
    if (best >= 0) break;
  }
  if (best < 0) {
    // Held inside EXACT_REACH, a drawn length covers this much: the one that leaves no hole and
    // laps its neighbours least, then the fewest pieces.
    const covers = (t: number): number => t * FILL_STEP * Math.min(EXACT_REACH[1], Math.max(EXACT_REACH[0], scale(t)));
    const better = (t: number, than: number): boolean => {
      const hole = Math.max(0, L - covers(t)) - Math.max(0, L - covers(than));
      if (Math.abs(hole) > 1e-9) return hole < 0;
      const d = Math.abs(covers(t) - L) - Math.abs(covers(than) - L);
      return d < -1e-9 || (Math.abs(d) <= 1e-9 && count[t] < count[than]);
    };
    for (let t = 1; t <= top; t++) if (made[t] && (best < 0 || better(t, best))) best = t;
  }
  const pieces = made[best]!.flatMap((n, j) => Array.from({ length: n }, () => kinds[j]));
  const order = pieces.map((p, k) => ({ p, h: mix(seed, k) })).sort((a, b) => a.h - b.h).map(({ p }) => p);
  const drawn = order.reduce((sum, p) => sum + p.chordCells - overlap, 0);
  return { pieces: order, f: Math.min(EXACT_REACH[1], Math.max(EXACT_REACH[0], L / drawn)) };
}

/** Distance from `p` to the segment a–b. */
function segmentDist(p: Vec, a: Vec, b: Vec): number {
  const v = sub(b, a);
  const L2 = dot(v, v);
  const s = L2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), v) / L2)) : 0;
  return dist(p, add(a, mul(v, s)));
}

/** A measured kit's piece laid below this share of its drawn size is put back to full size. */
const FULL_SIZE_BELOW = 0.9;

/**
 * One laid run of a measured kit with no piece squashed. The walk closes a ring or a span by
 * scaling its closing piece, and rock drawn to a size reads as a thinner wall shrunk, so a
 * piece below FULL_SIZE_BELOW of its drawn size is put back to that size about the middle of
 * its own chord, lapping its neighbours further. A kit with no `exact` piece is returned untouched.
 */
function fullSize(placed: WalkPlacement[], set: CaveKitPiece[]): WalkPlacement[] {
  if (!set.some((p) => p.exact)) return placed;
  const out = kitOut(set);
  return placed.map((pl) => {
    if (pl.at.scale >= FULL_SIZE_BELOW) return pl;
    const mid = mul(add(pl.P, pl.Q), 0.5);
    const half = mul(norm(sub(pl.Q, pl.P)), dist(...pl.piece.jointsCells) / 2);
    const P = sub(mid, half);
    const Q = add(mid, half);
    return { ...pl, P, Q, at: placePiece(pl.piece, P, Q, out, 0, pl.nudge) };
  });
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
 * How the joint from `a` to the next piece `b` meets: `t` the travel there, read off the
 * earlier piece (a bend's chord turned on by half its turn); `lap` how far `a`'s end runs
 * past `b`'s start along it; `want` the lap the joint asks for, the kit's overlap plus a
 * little for the turn there; `side` how far apart the two ends sit across travel.
 */
function jointLap(a: WalkPlacement, b: WalkPlacement, overlap: number): { t: Vec; lap: number; want: number; side: number } {
  const chordAngle = (pl: WalkPlacement): number => Math.atan2(pl.Q[1] - pl.P[1], pl.Q[0] - pl.P[0]);
  const halfTurn = (pl: WalkPlacement): number => (pl.piece.turnDeg * Math.PI) / 360;
  const exit = chordAngle(a) + halfTurn(a);
  const t: Vec = [Math.cos(exit), Math.sin(exit)];
  // Measured where the art's joints landed, not on the chords: each piece is shoved off its
  // own chord, and a bend's chord runs at an angle to travel, so that shove alone pulls its
  // joints back along travel and eats most of the lap the chords show.
  const d = sub(jointsOf(a.piece, a.at)[1], jointsOf(b.piece, b.at)[0]);
  const entry = chordAngle(b) - halfTurn(b);
  const turn = Math.abs(Math.atan2(Math.sin(entry - exit), Math.cos(entry - exit)));
  return { t, lap: dot(d, t), want: overlap + Math.min(MEET_TURN_LAP, 0.3 * Math.tan(turn / 2)), side: Math.abs(cross(d, t)) };
}

/** A joint lapping more than this over what it wants, cells, has a straight pulled back. */
const TRIM_OVER = 0.3;
/** The least share of its drawn size a straight is pulled back to before another is swapped in. */
const TRIM_LEAST = 0.8;

/**
 * One laid run of a measured kit with no straight running on past the piece it meets. Putting
 * a squashed piece back to full size (see {@link fullSize}) moves its start back under the
 * straight before it, and that straight was laid up to where the small piece began, so its
 * flat-cut end pokes out past the turn. Each joint lapping more than TRIM_OVER over what it
 * wants has its earlier straight's end pulled back along its own chord to the wanted lap, or,
 * after a bend, the later straight's start pushed on; two bends are left. A straight that would
 * go below TRIM_LEAST of its drawn size is swapped for the kit's straight nearest the length
 * left, if that one fits inside TRIM_LEAST to MEET_STRETCH of its own size; else it is left.
 * An opening is left as {@link meetNeighbours} leaves it. A kit with no `exact` piece is
 * returned untouched.
 */
function trimLaps(placed: WalkPlacement[], set: CaveKitPiece[], ring: boolean): WalkPlacement[] {
  if (placed.length < 2 || !set.some((p) => p.exact)) return placed;
  const overlap = kitOverlap(set);
  const out = kitOut(set);
  const run = [...placed];
  for (let k = 0; k < run.length - (ring ? 0 : 1); k++) {
    const j = (k + 1) % run.length;
    const { t, lap, want, side } = jointLap(run[k], run[j], overlap);
    const over = lap - want;
    if (over <= TRIM_OVER || side > MEET_SIDE) continue;
    const moveLater = run[k].piece.turnDeg !== 0;
    if (moveLater && run[j].piece.turnDeg !== 0) continue;
    const idx = moveLater ? j : k;
    const pl = run[idx];
    const dir = norm(sub(pl.Q, pl.P));
    const along = dot(dir, t);
    if (along <= 0) continue;
    const P = moveLater ? add(pl.P, mul(dir, over / along)) : pl.P;
    const Q = moveLater ? pl.Q : sub(pl.Q, mul(dir, over / along));
    const L = dist(P, Q);
    const piece = L < TRIM_LEAST * dist(...pl.piece.jointsCells) ? nearestStraight(set, L, pl.piece) : pl.piece;
    if (!piece) continue;
    run[idx] = { ...pl, piece, P, Q, at: placePiece(piece, P, Q, out, 0, pl.nudge) };
  }
  return run;
}

/**
 * The kit's straight whose drawn length is nearest `L`, the twin with `like`'s mirror flag
 * where there is one; null when laid over `L` it would sit outside TRIM_LEAST to
 * MEET_STRETCH of its own drawn size.
 */
function nearestStraight(set: CaveKitPiece[], L: number, like: CaveKitPiece): CaveKitPiece | null {
  const drawn = (p: CaveKitPiece): number => dist(...p.jointsCells);
  const straights = set.filter((p) => p.turnDeg === 0);
  const nearest = Math.min(...straights.map((p) => Math.abs(drawn(p) - L)));
  const near = straights.filter((p) => Math.abs(drawn(p) - L) === nearest);
  const piece = near.find((p) => !!p.flipY === !!like.flipY) ?? near[0];
  const s = L / drawn(piece);
  return s < TRIM_LEAST || s > MEET_STRETCH ? null : piece;
}

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
  for (let k = 0; k < run.length - (ring ? 0 : 1); k++) {
    const j = (k + 1) % run.length;
    const a = run[k];
    const b = run[j];
    const { t, lap, want, side } = jointLap(a, b, overlap);
    const short = want - lap;
    if (short <= 0 || short > MEET_SHORT || side > MEET_SIDE) continue;
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

/* ── Joints that bend ─────────────────────────────────────────────────
 *
 * A measured kit's pieces end square, so where two of them meet at an angle a wedge
 * opens on the outside of the turn, (rock width / 2) × tan(turn / 2) across at the
 * rock's face, and the floor fitted up to the rock's line shows through it; where two
 * pieces' rock lines pass beside each other rather than cross, the step between them opens
 * a notch the same way. A kit that ships connectors (round lumps of its rock) gets one laid
 * over each such joint; a kit with none has the two pieces run on a little further over
 * each other where they bend.
 */

/** A wedge narrower than this across, cells at size 1, is left. */
const WEDGE_LEAST = 0.05;
/** The most each piece is run on over the other at a bend, cells at size 1. */
const BEND_PUSH = 0.25;
/** The largest share of its drawn size a piece runs on to at a bend: the most a straight is fitted to. */
const BEND_PUSH_SCALE = 1.2;
/** The sizes a connector is laid between, as shares of its drawn size. */
const CONNECTOR_SCALE: [number, number] = [0.6, 1];
/** The widest a connector's body is laid, as a share of the rock's width. */
const CONNECTOR_SPAN = 1.4;

/** One joint between two pieces laid in a row: `a` then `b`, at index `k` and the next. */
interface BentJoint {
  k: number;
  j: number;
  /** How wide the wedge on the outside of the turn opens at the rock's face, cells. */
  wedge: number;
  /** Where the two rock lines join (they cross there, or pass `step` apart), and that step. */
  at: Vec;
  step: number;
}

/**
 * The joints of a laid run (in walk order, the last onto the first where they meet) that
 * bend enough to open a wedge, or whose rock lines step apart enough to open a notch: two
 * pieces short of each other or apart sideways (an opening: a door, a mouth, a run's end)
 * are no joint. At `size`, the rock is BAND_DRAWN_WIDTH times that wide.
 */
function bentJoints(placed: WalkPlacement[], set: CaveKitPiece[], size: number): BentJoint[] {
  if (placed.length < 2) return [];
  const overlap = kitOverlap(set);
  const out: BentJoint[] = [];
  for (let k = 0; k < placed.length; k++) {
    const j = (k + 1) % placed.length;
    const a = placed[k];
    const b = placed[j];
    const { t, lap, want, side } = jointLap(a, b, overlap * size);
    if ((want - lap) / size > MEET_SHORT || side / size > MEET_SIDE) continue;
    const entry = Math.atan2(b.Q[1] - b.P[1], b.Q[0] - b.P[0]) - (b.piece.turnDeg * Math.PI) / 360;
    const turn = Math.abs(Math.atan2(Math.sin(entry - Math.atan2(t[1], t[0])), Math.cos(entry - Math.atan2(t[1], t[0]))));
    // Pieces that already run on past each other further than the joint asks (two straights
    // crossing at a corner no bend suits) cover that much of it.
    const wedge = ((BAND_DRAWN_WIDTH * size) / 2) * Math.tan(Math.min(turn, (SHARP_TURN_DEG * Math.PI) / 180) / 2) - Math.max(0, lap - want);
    // Where the two rock lines join, as the rock line itself joins them: where they cross, or
    // the middle of the step between them where they pass.
    const [sa, sb] = [pieceSeat(a), pieceSeat(b)];
    joinSeats(sa, sb, SEAT_LAP_REACH * a.at.scale);
    const [pa, pb] = sa.length > 0 && sb.length > 0 ? [sa[sa.length - 1], sb[0]] : [jointsOf(a.piece, a.at)[1], jointsOf(b.piece, b.at)[0]];
    const step = dist(pa, pb);
    if (Math.max(wedge, step) > WEDGE_LEAST * size) out.push({ k, j, wedge, at: mul(add(pa, pb), 0.5), step });
  }
  return out;
}

/**
 * The connectors a laid run of `set` (at `size`) takes: over each joint that bends (see
 * {@link bentJoints}), centred on the joint on the rock's line, the smallest connector whose
 * body reaches the rock's face from there, laid between CONNECTOR_SCALE of its drawn size and
 * no wider than CONNECTOR_SPAN times the rock; where none reaches, the largest. Turned by an
 * angle seeded from where it lies, so a redraw lays the same. They change no rock line, no
 * blocking and no floor fit: they are drawn over the pieces and nothing else reads them.
 * Empty for a kit with no connectors.
 */
export function bandConnectors(placed: WalkPlacement[], set: CaveKitPiece[], size = 1): WalkPlacement[] {
  const connectors = kitConnectors(set);
  if (connectors.length === 0) return [];
  // A kept laying (see keptLaying) keeps its connectors too.
  const hit = keptConnectors.get(placed);
  if (hit && hit.size === size) return hit.value;
  const value = layConnectors(placed, set, size, connectors);
  keptConnectors.set(placed, { size, value });
  return value;
}

const keptConnectors = new WeakMap<WalkPlacement[], { size: number; value: WalkPlacement[] }>();

function layConnectors(placed: WalkPlacement[], set: CaveKitPiece[], size: number, connectors: CaveKitPiece[]): WalkPlacement[] {
  const reach = (BAND_DRAWN_WIDTH * size) / 2;
  const widest = (CONNECTOR_SPAN * BAND_DRAWN_WIDTH * size) / 2;
  return bentJoints(placed, set, size).map(({ at: centre, step }) => {
    const need = reach + step / 2;
    const piece = connectors.find((c) => c.radius! * CONNECTOR_SCALE[1] * size >= need) ?? connectors[connectors.length - 1];
    const r = piece.radius! * size;
    const scale = size * Math.min(CONNECTOR_SCALE[1], widest / r, Math.max(CONNECTOR_SCALE[0], need / r));
    const h = (Math.imul(Math.round(centre[0] * 100), 7919) ^ Math.imul(Math.round(centre[1] * 100), 104729)) >>> 0;
    const rotation = (h / 4294967296) * 2 * Math.PI;
    const [cx, cy] = piece.jointsCells[0];
    const off: Vec = [(cx * Math.cos(rotation) - cy * Math.sin(rotation)) * scale, (cx * Math.sin(rotation) + cy * Math.cos(rotation)) * scale];
    return { piece, P: centre, Q: centre, i: 0, nudge: 0, branch: 'connector', at: { position: { x: centre[0] - off[0], y: centre[1] - off[1] }, rotation, scale, flipY: false } };
  });
}

/** A laid run as drawn: its pieces, then the connectors over its joints (see {@link bandConnectors}), above them. */
export function withConnectors(placed: WalkPlacement[], set: CaveKitPiece[], size = 1): WalkPlacement[] {
  const connectors = bandConnectors(placed, set, size);
  return connectors.length === 0 ? placed : [...placed, ...connectors];
}

/**
 * A laid run of a measured kit with no connectors, each joint that bends (see
 * {@link bentJoints}) closed by running its two pieces on over each other along their own
 * chords, half the wedge each, no more than BEND_PUSH and no piece past BEND_PUSH_SCALE of its
 * drawn size; what is left past that is left. A bend keeps its drawn size, as it was laid to
 * its corner: the straight beside it takes the whole wedge. Only the art moves: the chord the
 * walk gave each piece (`P`, `Q`) stays, so the runs the rock is read as stay too. Laid at
 * size 1. Any other kit is returned untouched.
 */
function pushBends(placed: WalkPlacement[], set: CaveKitPiece[]): WalkPlacement[] {
  if (!set.some((p) => p.exact) || kitConnectors(set).length > 0) return placed;
  const joints = bentJoints(placed, set, 1);
  if (joints.length === 0) return placed;
  // A piece's art stops half the kit's overlap (at its scale) in from each joint, so it grows
  // by the art's own length, not the chord's: the end not run on keeps its art where it was.
  const inset = kitOverlap(set) / 2;
  const artLength = (pl: WalkPlacement): number => pl.piece.chordCells - 2 * inset;
  // How far each straight's art runs on at its start and at its end.
  const ext = placed.map(() => [0, 0]);
  const grow = (idx: number, by: number, atEnd: boolean): void => {
    const pl = placed[idx];
    if (pl.piece.turnDeg !== 0 || artLength(pl) <= 0) return;
    const room = (BEND_PUSH_SCALE - pl.at.scale) * artLength(pl) - ext[idx][0] - ext[idx][1];
    ext[idx][atEnd ? 1 : 0] += Math.max(0, Math.min(by, BEND_PUSH, room));
  };
  for (const { k, j, wedge } of joints) {
    if (wedge <= WEDGE_LEAST) continue;
    const [bentA, bentB] = [placed[k].piece.turnDeg !== 0, placed[j].piece.turnDeg !== 0];
    grow(k, bentB ? wedge : wedge / 2, true);
    grow(j, bentA ? wedge : wedge / 2, false);
  }
  return placed.map((pl, i) => {
    const [head, tail] = ext[i];
    if (head + tail <= 0) return pl;
    const [J0, J1] = jointsOf(pl.piece, pl.at);
    const dir = norm(sub(J1, J0));
    // The inset grows with the scale: each joint moves out by that as well.
    const more = (inset * (head + tail)) / artLength(pl);
    return { ...pl, at: placeOnChord(pl.piece, sub(J0, mul(dir, head + more)), add(J1, mul(dir, tail + more))) };
  });
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
  const found = ringCorners(poly);
  if (!found) return null;
  const corners: RingCorner[] = found.map((c) => ({ at: cornerOnRide(ride, c.p), turn: c.turn }));
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
 * A ring's corners in order, each vertex turning at least `corner` with its signed turn,
 * degrees; null for a ring with a curve in it (a vertex turning between SIDE_TURN_DEG and that).
 */
function ringCorners(poly: Polygon, corner = RING_CORNER_DEG): { p: Vec; turn: number }[] | null {
  const pts: Vec[] = [];
  for (const p of poly) {
    const last = pts[pts.length - 1];
    if (!last || dist(last, p as Vec) > 1e-6) pts.push([p[0], p[1]]);
  }
  if (pts.length > 2 && dist(pts[0], pts[pts.length - 1]) <= 1e-6) pts.pop();
  const m = pts.length;
  if (m < 3) return null;
  const corners: { p: Vec; turn: number }[] = [];
  for (let k = 0; k < m; k++) {
    const a = norm(sub(pts[k], pts[(k - 1 + m) % m]));
    const b = norm(sub(pts[(k + 1) % m], pts[k]));
    const turn = (Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]) * 180) / Math.PI;
    if (Math.abs(turn) < SIDE_TURN_DEG) continue;
    if (Math.abs(turn) < corner) return null;
    corners.push({ p: pts[k], turn });
  }
  return corners;
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
  return keptLaying('chain', points, gaps, set, size, () => {
    if (size !== 1) return laidAtSize(size, points, gaps, (p, g) => layBandChain(p, g, set));
    return pushBends(layChain(points as Curve, gaps, set, { lap: true }), set);
  });
}

function layChain(points: Curve, gaps: DoorGap[], set: CaveKitPiece[], opts: WalkOptions): WalkPlacement[] {
  if (points.length < 2) return [];
  // A measured kit's run with openings on it is laid stretch by stretch between them.
  const measured = set.some((p) => p.exact);
  const runs = measured && gaps.length > 0 ? layWallRuns(points as Polygon, gaps, set, false, opts) : null;
  if (runs) return runs;
  const cuts = measured ? [] : gaps;
  const base = resampleOpen(points, CURVE_STEP);
  if (base.length < 8) return [];
  // A drawn run with a tip sharper than any bend is laid as runs that cross
  // there, the way a ring is (see layBandRing).
  const tips = sharpCorners(base, false);
  if (tips.length) {
    const ends = [0, ...tips, base.length - 1];
    return ends.slice(0, -1).flatMap((from, k) => {
      return layTipRun(base.slice(from, ends[k + 1] + 1), k > 0, k + 1 < ends.length - 1, cuts, set);
    });
  }
  const ride = padEnds(bandRide(base, false, kitOut(set)));
  const first = END_PAD;
  const last = ride.length - 1 - END_PAD;
  const spans = openSpans(ride, cuts, false) ?? [[first, last]];
  const walk = { ...opts, accept: keepsToOutline(base, false, set) };
  return spans.flatMap(([from, to]) =>
    meetNeighbours(trimLaps(fullSize(laySpan(ride, set, Math.max(from, first), Math.min(to, last), walk), set), set, false), set, false),
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
 * piece whose art has not decoded yet; `onLaid` each ring as the walk took it, with what it laid.
 * `laid` is what {@link layOutlineBand} laid for these rings already, when the caller has it.
 */
export function drawOutlineBand(
  parent: Container,
  rings: Polygon[],
  setId: string,
  fillColor: number,
  gaps: DoorGap[] = [],
  size = 1,
  waitFor?: (textureId: string) => void,
  onLaid?: (ring: Polygon, placed: WalkPlacement[]) => void,
  laid: WalkPlacement[][] = layOutlineBand(rings, bandPiecesFor(setId), gaps, size),
): void {
  const art = bandSetArt(setId);
  const oriented = orientRings(rings);
  const strip = !isMeasuredBandSet(setId);
  const set = bandPiecesFor(setId);
  let at = parent.children.length;
  oriented.forEach((edge, i) => {
    onLaid?.(edge, laid[i]);
    at = placeBand(parent, withConnectors(laid[i], set, size), art, 0xffffff, at, strip ? { edge, closed: true, gaps, color: fillColor, size } : undefined, waitFor);
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
  const chain = seatLine(placed, true);
  return chain.length >= 3 ? clipper2Engine.union([chain], []) : [];
}

/** One placement's seat (see {@link bandSeat}), in walk order. */
function pieceSeat(pl: WalkPlacement): Vec[] {
  if (pl.piece.spine) {
    // Mapped as jointsOf maps the joints: a mirrored piece's spine is already mirrored.
    const c = Math.cos(pl.at.rotation);
    const s = Math.sin(pl.at.rotation);
    return pl.piece.spine.map(([x, y]): Vec => [pl.at.position.x + (x * c - y * s) * pl.at.scale, pl.at.position.y + (x * s + y * c) * pl.at.scale]);
  }
  const [J0, J1] = jointsOf(pl.piece, pl.at);
  const v = sub(J1, J0);
  const L = Math.hypot(v[0], v[1]);
  if (L < 1e-9) return [];
  const right: Vec = [-v[1] / L, v[0] / L];
  const phi = (Math.abs(pl.piece.turnDeg) * Math.PI) / 360;
  const R = phi > 1e-4 ? L / (2 * Math.sin(phi)) : 0;
  const sgn = -Math.sign(pl.piece.turnDeg);
  const seat = SEAT_IN * pl.at.scale;
  const steps = Math.max(1, Math.ceil(L / SEAT_STEP));
  const out: Vec[] = [];
  for (let k = 0; k <= steps; k++) {
    const u = k / steps;
    const bow = R ? sgn * R * (Math.cos(phi * (2 * u - 1)) - Math.cos(phi)) : 0;
    out.push(add(add(J0, mul(v, u)), mul(right, bow + seat)));
  }
  return out;
}

/** How far back from each end of two lapping seats their crossing is looked for, cells at size 1. */
const SEAT_LAP_REACH = 1;

/**
 * Two neighbouring seats `a` then `b` cut to their joint, so the chain does not double back
 * where they lap: where `a`'s last stretch crosses `b`'s first, both end there; where they
 * pass without crossing, both end where the two come nearest. Changes both in place.
 */
function joinSeats(a: Vec[], b: Vec[], reach: number): void {
  if (a.length < 2 || b.length < 2) return;
  const arcFrom = (pts: Vec[], fromEnd: boolean): number[] => {
    const out = [0];
    for (let i = 1; i < pts.length; i++) {
      const [p, q] = fromEnd ? [pts[pts.length - i], pts[pts.length - 1 - i]] : [pts[i - 1], pts[i]];
      out.push(out[i - 1] + dist(p, q));
    }
    return out;
  };
  const tailArc = arcFrom(a, true);
  const headArc = arcFrom(b, false);
  // The crossing nearest a's end, among a's last and b's first stretch.
  for (let i = a.length - 2; i >= 0 && tailArc[a.length - 2 - i] <= reach; i--) {
    for (let j = 0; j + 1 < b.length && headArc[j] <= reach; j++) {
      const r = sub(a[i + 1], a[i]);
      const s = sub(b[j + 1], b[j]);
      const den = cross(r, s);
      if (Math.abs(den) < 1e-12) continue;
      const w = sub(b[j], a[i]);
      const t = cross(w, s) / den;
      const u = cross(w, r) / den;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      const x = add(a[i], mul(r, t));
      a.splice(i + 1, a.length - i - 1, x);
      b.splice(0, j + 1, x);
      return;
    }
  }
  // No crossing: each ends where the two come nearest, and the chain steps across there.
  const nearest = (p: Vec, q: Vec, x: Vec): Vec => {
    const r = sub(q, p);
    const L2 = dot(r, r);
    return add(p, mul(r, L2 > 0 ? Math.max(0, Math.min(1, dot(sub(x, p), r) / L2)) : 0));
  };
  let best = { d: Infinity, i: a.length - 2, j: 0, pa: a[a.length - 1], pb: b[0] };
  for (let i = a.length - 2; i >= 0 && tailArc[a.length - 2 - i] <= reach; i--) {
    for (let j = 0; j + 1 < b.length && headArc[j] <= reach; j++) {
      // Two segments that do not cross come nearest at an end of one of them.
      for (const [pa, pb] of [
        [a[i], nearest(b[j], b[j + 1], a[i])],
        [a[i + 1], nearest(b[j], b[j + 1], a[i + 1])],
        [nearest(a[i], a[i + 1], b[j]), b[j]],
        [nearest(a[i], a[i + 1], b[j + 1]), b[j + 1]],
      ] as [Vec, Vec][]) {
        const d = dist(pa, pb);
        if (d < best.d - 1e-9) best = { d, i, j, pa, pb };
      }
    }
  }
  a.splice(best.i + 1, a.length - best.i - 1, best.pa);
  b.splice(0, best.j + 1, best.pb);
}

/**
 * The line `bandSeat` closes: the placements' seats chained in walk order, each cut to its
 * joint with the next (see {@link joinSeats}), the last with the first when `closed`.
 */
export function seatLine(placed: WalkPlacement[], closed = false): [number, number][] {
  const seats = placed.map((pl) => ({ line: pieceSeat(pl), reach: SEAT_LAP_REACH * pl.at.scale })).filter((s) => s.line.length > 0);
  for (let k = 0; k + 1 < seats.length; k++) joinSeats(seats[k].line, seats[k + 1].line, seats[k].reach);
  if (closed && seats.length > 2) joinSeats(seats[seats.length - 1].line, seats[0].line, seats[seats.length - 1].reach);
  return seats.flatMap((s) => s.line);
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

/**
 * Floor thinner than twice this, and slits in it as thin, are swept out of a fitted floor,
 * cells. The floor cut off past the rock and the ground added under it both meet the floor
 * along the authored edge exactly: edge to edge the cut left hairlines of floor along that
 * edge out to the corner it took, and the join a slit of no width with spikes at its ends.
 */
const FIT_SEAM = 0.01;

/** A walled floor's `region` as painted under a fitted rock: `(region − tips) ∪ (grown region ∩ gaps)`. */
export function fittedFloor(region: Polygon[], fit: FloorFit | undefined): Polygon[] {
  if (!fit || (fit.tips.length === 0 && fit.gaps.length === 0)) return region;
  const cut = fit.tips.length > 0 ? clipper2Engine.difference(region, fit.tips) : region;
  const add = fit.gaps.length > 0 ? clipper2Engine.intersection(clipper2Engine.inflate(region, FIT_GROW), fit.gaps) : [];
  const joined = add.length > 0 ? clipper2Engine.union(cut, add) : cut;
  // Shrunk, grown twice as far and shrunk back: hairlines go, then slits close.
  return clipper2Engine.inflate(clipper2Engine.inflate(clipper2Engine.inflate(joined, -FIT_SEAM), 2 * FIT_SEAM), -FIT_SEAM);
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
