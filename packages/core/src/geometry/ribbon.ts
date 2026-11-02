// Path ribbons: the centreline a path's points describe, and the triangle
// strip, outline and edge strips built along it. Pure geometry in cells; the
// renderer, hit tests and the table all derive from the same functions so a
// path looks and picks the same everywhere.

import { flattenCubic } from '../shared/bezier';
import type { PathChild, PathPoint } from '../shared/types';
import { clipper2Engine } from './Clipper2Engine';
import type { Polygon } from './GeometryEngine';

type Vec2 = [number, number];

export type RibbonPoint = PathPoint;

/** Start and end treatments; `length` (taper and fade) in cells. */
export type RibbonEnds = PathChild['ends'];

export interface RibbonOptions {
  /** Max deviation of the flattened curve from the true one, cells. */
  tolerance?: number;
  miterLimit?: number;
  ends?: RibbonEnds;
  /** Texture start along U, cells. */
  offset?: number;
}

export const RIBBON_TOLERANCE = 0.02;
export const RIBBON_MITER_LIMIT = 2;
const CUT_ENDS: RibbonEnds = { start: 'cut', end: 'cut', length: 0 };
/** Extra samples laid inside each taper so the ease reads as a curve. */
const TAPER_STEPS = 8;
const EPS = 1e-9;

/**
 * The flattened centreline. Closed lines repeat their first sample at the end
 * (arc = length), so the strip closes on itself.
 */
export interface Centreline {
  xy: Vec2[];
  arc: number[];
  /** Full width per sample, after taper. */
  width: number[];
  height: number[];
  length: number;
  closed: boolean;
  /** Arc length at each input point, indexed like the input (a dropped duplicate shares its twin's). */
  pointArc: number[];
}

export interface RibbonMesh {
  /** x, y per vertex, cells. */
  positions: Float32Array;
  /** U = arc length in cells + offset, V = 0 on the first side, 1 on the second. */
  uvs: Float32Array;
  indices: Uint16Array | Uint32Array;
  /** Arc length per vertex; caps run below 0 and past the length. */
  arc: Float32Array;
  /** Path width per vertex (the sample's full width). */
  width: Float32Array;
  length: number;
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Centripetal Catmull-Rom tangent at `p`, as the in/out Bezier controls. */
function autoControls(prev: Vec2, p: Vec2, next: Vec2): { cin: Vec2; cout: Vec2 } {
  const d0 = Math.sqrt(dist(prev, p));
  const d1 = Math.sqrt(dist(p, next));
  const v: Vec2 = [0, 0];
  for (const k of [0, 1] as const) {
    v[k] = (p[k] - prev[k]) / d0 - (next[k] - prev[k]) / (d0 + d1) + (next[k] - p[k]) / d1;
  }
  return {
    cin: [p[0] - (v[0] * d0) / 3, p[1] - (v[1] * d0) / 3],
    cout: [p[0] + (v[0] * d1) / 3, p[1] + (v[1] * d1) / 3],
  };
}

/**
 * Linear interpolation in arc length between the samples that set a value;
 * held flat before the first and after the last. No setters = fallback.
 */
function interpolate(setters: { s: number; v: number }[], s: number, fallback: number): number {
  if (setters.length === 0) return fallback;
  if (s <= setters[0].s) return setters[0].v;
  for (let i = 1; i < setters.length; i++) {
    const b = setters[i];
    if (s <= b.s) {
      const a = setters[i - 1];
      const span = b.s - a.s;
      return span <= EPS ? b.v : a.v + ((b.v - a.v) * (s - a.s)) / span;
    }
  }
  return setters[setters.length - 1].v;
}

const smoothstep = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

const emptyLine = (closed: boolean): Centreline => ({
  xy: [], arc: [], width: [], height: [], length: 0, closed, pointArc: [],
});

/**
 * Flatten a path's points into a sampled centreline with width and height
 * per sample. Duplicate neighbours are dropped; fewer than two distinct
 * points give an empty line.
 */
export function sampleCentreline(
  points: readonly RibbonPoint[],
  closed: boolean,
  defaultWidth: number,
  options: RibbonOptions = {},
): Centreline {
  const tolerance = options.tolerance ?? RIBBON_TOLERANCE;
  const ends = options.ends ?? CUT_ENDS;

  const pts: RibbonPoint[] = [];
  /** Input index → index in `pts`. */
  const kept: number[] = [];
  for (const p of points) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-6) pts.push(p);
    kept.push(pts.length - 1);
  }
  if (closed && pts.length > 2) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) <= 1e-6) {
      pts.pop();
      for (let i = 0; i < kept.length; i++) if (kept[i] === pts.length) kept[i] = 0;
    }
  }
  if (pts.length < 2) return emptyLine(closed);

  const n = pts.length;
  const pos: Vec2[] = pts.map((p) => [p.x, p.y]);
  const controls = pts.map((p, i) => {
    const at = pos[i];
    if (p.handles === null) return { cin: at, cout: at };
    if (p.handles) {
      return {
        cin: [at[0] + p.handles.in[0], at[1] + p.handles.in[1]] as Vec2,
        cout: [at[0] + p.handles.out[0], at[1] + p.handles.out[1]] as Vec2,
      };
    }
    const reflect = (o: Vec2): Vec2 => [2 * at[0] - o[0], 2 * at[1] - o[1]];
    const prev = closed ? pos[(i - 1 + n) % n] : i > 0 ? pos[i - 1] : reflect(pos[1]);
    const next = closed ? pos[(i + 1) % n] : i < n - 1 ? pos[i + 1] : reflect(pos[n - 2]);
    return autoControls(prev, at, next);
  });

  const xy: Vec2[] = [];
  const pointSample: number[] = [];
  const push = (q: Vec2) => {
    const last = xy[xy.length - 1];
    if (!last || dist(last, q) > EPS) xy.push(q);
  };
  const segments = closed ? n : n - 1;
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % n;
    push(pos[i]);
    pointSample[i] = xy.length - 1;
    for (const q of flattenCubic(pos[i], controls[i].cout, controls[j].cin, pos[j], tolerance)) push(q);
  }
  push(closed ? pos[0] : pos[n - 1]);
  if (!closed) pointSample[n - 1] = xy.length - 1;

  let arc = [0];
  for (let i = 1; i < xy.length; i++) arc.push(arc[i - 1] + dist(xy[i - 1], xy[i]));
  const length = arc[arc.length - 1];
  if (length <= EPS) return emptyLine(closed);

  const pointArc = pts.map((_, i) => arc[pointSample[i]]);
  // Every point has a width (its own, else the path's); heights come from the points that
  // set one, so a bridge set at its two ends ramps between them.
  const settersOf = (key: 'width' | 'height') => {
    const own = pts
      .map((p, i) => ({ s: pointArc[i], v: key === 'width' ? (p.width ?? defaultWidth) : p.height }))
      .filter((e): e is { s: number; v: number } => typeof e.v === 'number' && Number.isFinite(e.v));
    if (!closed || own.length === 0) return own;
    // Closed lines wrap: the setters repeat one lap either side.
    return [
      ...own.map((e) => ({ s: e.s - length, v: e.v })),
      ...own,
      ...own.map((e) => ({ s: e.s + length, v: e.v })),
    ];
  };

  const taperStart = !closed && ends.start === 'taper' && ends.length > 0;
  const taperEnd = !closed && ends.end === 'taper' && ends.length > 0;
  let samples = xy;
  if (taperStart || taperEnd) {
    const extra: number[] = [];
    for (let k = 1; k <= TAPER_STEPS; k++) {
      const d = (ends.length * k) / TAPER_STEPS;
      if (taperStart && d < length) extra.push(d);
      if (taperEnd && length - d > 0) extra.push(length - d);
    }
    extra.sort((a, b) => a - b);
    const nxy: Vec2[] = [xy[0]];
    const narc = [0];
    let e = 0;
    for (let i = 1; i < xy.length; i++) {
      while (e < extra.length && extra[e] < arc[i] - EPS) {
        if (extra[e] > narc[narc.length - 1] + EPS) {
          const f = (extra[e] - arc[i - 1]) / (arc[i] - arc[i - 1]);
          nxy.push([xy[i - 1][0] + (xy[i][0] - xy[i - 1][0]) * f, xy[i - 1][1] + (xy[i][1] - xy[i - 1][1]) * f]);
          narc.push(extra[e]);
        }
        e++;
      }
      nxy.push(xy[i]);
      narc.push(arc[i]);
    }
    samples = nxy;
    arc = narc;
  }

  const widthSetters = settersOf('width');
  const heightSetters = settersOf('height');
  const width = arc.map((s) => {
    let w = interpolate(widthSetters, s, defaultWidth);
    if (taperStart) w *= smoothstep(s / ends.length);
    if (taperEnd) w *= smoothstep((length - s) / ends.length);
    return Math.max(0, w);
  });
  const height = arc.map((s) => interpolate(heightSetters, s, 0));
  return { xy: samples, arc, width, height, length, closed, pointArc: kept.map((k) => pointArc[k]) };
}

/** Signed lateral offsets of a strip's two sides at sample i (+ = left of travel). */
type Sides = (i: number) => [number, number];

interface StripOptions {
  tolerance: number;
  miterLimit: number;
  offset: number;
  capStart: boolean;
  capEnd: boolean;
}

const perp = (d: Vec2): Vec2 => [-d[1], d[0]];
const cross = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];
const orient = (a: Vec2, b: Vec2, c: Vec2): number =>
  cross([b[0] - a[0], b[1] - a[1]], [c[0] - a[0], c[1] - a[1]]);

function direction(a: Vec2, b: Vec2): Vec2 | null {
  const l = dist(a, b);
  return l > EPS ? [(b[0] - a[0]) / l, (b[1] - a[1]) / l] : null;
}

function rotate(v: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
}

/** Arc steps keeping a fan within `tolerance` of a circle of `radius`. */
function arcSteps(angle: number, radius: number, tolerance: number): number {
  if (radius <= tolerance) return 1;
  const step = 2 * Math.acos(1 - tolerance / radius);
  return Math.max(1, Math.ceil(Math.abs(angle) / step));
}

function segmentCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const r: Vec2 = [b[0] - a[0], b[1] - a[1]];
  const q: Vec2 = [d[0] - c[0], d[1] - c[1]];
  const den = cross(r, q);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross([c[0] - a[0], c[1] - a[1]], q) / den;
  const v = cross([c[0] - a[0], c[1] - a[1]], r) / den;
  if (t <= 1e-9 || t >= 1 - 1e-9 || v <= 1e-9 || v >= 1 - 1e-9) return null;
  return [a[0] + r[0] * t, a[1] + r[1] * t];
}

/**
 * Removes the loops a side's vertex line makes where it crosses itself at a bend: every vertex
 * inside a loop moves to the crossing point. Vertices are moved, never removed, so the pairs
 * stay paired. Only loops spanning a short arc (reach × the local width) are a bend's:
 * a road that crosses itself further along keeps both of its passes.
 */
function trimLoops(
  side: Vec2[],
  arc: readonly number[],
  width: readonly number[],
  gap: readonly boolean[],
  reach = 2.6,
): void {
  for (let i = 0; i < side.length - 3; i++) {
    if (gap[i + 1]) continue;
    const limit = arc[i] + reach * Math.max(width[i], 1e-3);
    let end = i + 2;
    while (end < side.length - 1 && arc[end] <= limit) end++;
    for (let j = end - 1; j >= i + 2; j--) {
      if (gap[j + 1]) continue;
      const x = segmentCross(side[i], side[i + 1], side[j], side[j + 1]);
      if (!x) continue;
      for (let k = i + 1; k <= j; k++) side[k] = x;
      i = j;
      break;
    }
  }
}

/**
 * The one strip builder every ribbon goes through: a pair of vertices per
 * sample along the averaged normal, mitred; past the mitre limit each leg ends
 * square through the corner and a fan fills the outside. Optional round caps,
 * loops cut out of the inside of tight bends, and a fold guard that collapses a
 * vertex onto the previous one rather than let a triangle turn over.
 */
function buildStrip(line: Centreline, sides: Sides, o: StripOptions): RibbonMesh {
  const { xy, arc, width } = line;
  const N = xy.length;
  const A: Vec2[] = [];
  const B: Vec2[] = [];
  const U: number[] = [];
  const VA: number[] = [];
  const VB: number[] = [];
  const S: number[] = [];
  const W: number[] = [];
  // GAP[k]: no quad joins pair k-1 to pair k. LOOSE[k]: the fold guard leaves pair k alone.
  const GAP: boolean[] = [];
  const LOOSE: boolean[] = [];

  // + when side A runs left of side B; every triangle keeps this winding.
  const [a0, b0] = sides(0);
  const sign = Math.sign(a0 - b0) || 1;

  const emit = (a: Vec2, b: Vec2, s: number, u: number, w: number, va = 0, vb = 1, gap = false, loose = false) => {
    GAP.push(gap);
    LOOSE.push(loose || gap);
    A.push(a);
    B.push(b);
    S.push(s);
    U.push(u);
    VA.push(va);
    VB.push(vb);
    W.push(w);
  };

  const back = (j: number): Vec2 | null => {
    for (let k = j; k > 0; k--) {
      const d = direction(xy[k - 1], xy[k]);
      if (d) return d;
    }
    return null;
  };
  const fwd = (j: number): Vec2 | null => {
    for (let k = j; k < N - 1; k++) {
      const d = direction(xy[k], xy[k + 1]);
      if (d) return d;
    }
    return null;
  };

  /** Round cap pairs at an open end: a half circle from the tip back to the edges. */
  const cap = (p: Vec2, d: Vec2, n: Vec2, la: number, lb: number, s: number, u: number, w: number, start: boolean) => {
    const half = (la - lb) / 2;
    const mid = (la + lb) / 2;
    const c: Vec2 = [p[0] + n[0] * mid, p[1] + n[1] * mid];
    const steps = arcSteps(Math.PI / 2, Math.abs(half), o.tolerance);
    for (let j = 0; j < steps; j++) {
      const k = start ? j : steps - 1 - j;
      const phi = (Math.PI / 2) * (k / steps);
      const along = (start ? -1 : 1) * Math.abs(half) * Math.cos(phi);
      const side = half * Math.sin(phi);
      const pa: Vec2 = [c[0] + d[0] * along + n[0] * side, c[1] + d[1] * along + n[1] * side];
      const pb: Vec2 = [c[0] + d[0] * along - n[0] * side, c[1] + d[1] * along - n[1] * side];
      const v = 0.5 - 0.5 * Math.sin(phi);
      emit(pa, pb, s + along, u + along, w, v, 1 - v);
    }
  };

  // Texture length the corner fans so far have added: the art runs on round a corner instead of smearing.
  let turnU = 0;
  for (let i = 0; i < N; i++) {
    const p = xy[i];
    const [la, lb] = sides(i);
    let din = back(i);
    let dout = fwd(i);
    if (line.closed) {
      if (i === 0) din = back(N - 1);
      if (i === N - 1) dout = fwd(0);
    }
    din = din ?? dout ?? [1, 0];
    dout = dout ?? din;
    const n0 = perp(din);
    const n1 = perp(dout);
    const sum: Vec2 = [n0[0] + n1[0], n0[1] + n1[1]];
    const sl = Math.hypot(sum[0], sum[1]);
    const m: Vec2 = sl > 1e-6 ? [sum[0] / sl, sum[1] / sl] : din;
    const scale = 1 / Math.max(m[0] * n0[0] + m[1] * n0[1], 1e-6);
    const turn = cross(din, dout);
    const turnSign = turn < 0 ? -1 : 1;
    const angle = Math.atan2(turn, din[0] * dout[0] + din[1] * dout[1]);
    let u = arc[i] + o.offset + turnU;

    if (i === 0 && o.capStart) cap(p, din, n0, la, lb, arc[i], u, width[i], true);

    const outer = (l: number) => l * turnSign < 0;
    const at = (d: Vec2, l: number): Vec2 => [p[0] + d[0] * l, p[1] + d[1] * l];
    if (scale > o.miterLimit) {
      // A sharp corner: each leg ends square through the corner point, a fan round the corner
      // fills the outside between the two ends, and the legs overlap on the inside, so the
      // inside is covered right into the corner (a clamped inner mitre left a notch there).
      emit(at(n0, la), at(n0, lb), arc[i], u, width[i]);
      if (outer(la) || outer(lb)) {
        const steps = arcSteps(angle, Math.max(Math.abs(la), Math.abs(lb)), o.tolerance);
        const fanU = Math.abs(angle) * Math.abs(outer(la) && outer(lb) ? (la + lb) / 2 : (outer(la) ? la : lb) / 2);
        // A side on the inside pivots on the centreline, with the V the centreline has.
        const vMid = la === lb ? 0.5 : la / (la - lb);
        for (let k = 0; k <= steps; k++) {
          const nk = rotate(n0, (angle * k) / steps);
          emit(
            outer(la) ? at(nk, la) : p,
            outer(lb) ? at(nk, lb) : p,
            arc[i], u + (fanU * k) / steps, width[i],
            outer(la) ? 0 : vMid,
            outer(lb) ? 1 : vMid,
            k === 0,
            true,
          );
        }
        u += fanU;
        turnU += fanU;
      }
      emit(at(n1, la), at(n1, lb), arc[i], u, width[i], 0, 1, true);
    } else {
      const k = Math.min(scale, o.miterLimit);
      emit(at(m, la * k), at(m, lb * k), arc[i], u, width[i]);
    }

    if (i === N - 1 && o.capEnd) cap(p, dout, n1, la, lb, arc[i], u, width[i], false);
  }

  // Where a side's offset line crosses itself (the inside of a bend tighter than the band),
  // cut the loop out at the crossing: the side runs along the true edge of the band's
  // union, so the inside of a bend is covered right up to its corner with no notch.
  trimLoops(A, S, W, GAP);
  trimLoops(B, S, W, GAP);
  // Fold guard: a vertex that would still turn its triangle over stays put. A vertex stays
  // pinned for at most a bend's length of arc, so one pinned far off cannot pin the rest of
  // the line behind it.
  let pinA = -1;
  let pinB = -1;
  const held = (pin: number, k: number) => pin < 0 || S[k] - S[pin] <= 2.6 * Math.max(W[k], 1e-3);
  for (let k = 1; k < A.length; k++) {
    if (LOOSE[k]) continue;
    if (orient(A[k - 1], B[k - 1], A[k]) * sign < -EPS && held(pinA, k)) {
      A[k] = A[k - 1];
      if (pinA < 0) pinA = k;
    } else pinA = -1;
    if (orient(B[k - 1], B[k], A[k]) * sign < -EPS && held(pinB, k)) {
      B[k] = B[k - 1];
      if (pinB < 0) pinB = k;
    } else pinB = -1;
  }

  const pairs = A.length;
  const positions = new Float32Array(pairs * 4);
  const uvs = new Float32Array(pairs * 4);
  const arcOut = new Float32Array(pairs * 2);
  const widthOut = new Float32Array(pairs * 2);
  for (let k = 0; k < pairs; k++) {
    positions.set([A[k][0], A[k][1], B[k][0], B[k][1]], k * 4);
    uvs.set([U[k], VA[k], U[k], VB[k]], k * 4);
    arcOut[k * 2] = arcOut[k * 2 + 1] = S[k];
    widthOut[k * 2] = widthOut[k * 2 + 1] = W[k];
  }
  const joined: number[] = [];
  for (let k = 1; k < pairs; k++) if (!GAP[k]) joined.push(k - 1);
  const indices = pairs * 2 > 65535 ? new Uint32Array(joined.length * 6) : new Uint16Array(joined.length * 6);
  joined.forEach((k, q) => {
    const a = k * 2;
    indices.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], q * 6);
  });
  return { positions, uvs, indices, arc: arcOut, width: widthOut, length: line.length };
}

const emptyMesh = (): RibbonMesh => ({
  positions: new Float32Array(0),
  uvs: new Float32Array(0),
  indices: new Uint16Array(0),
  arc: new Float32Array(0),
  width: new Float32Array(0),
  length: 0,
});

function stripOptions(line: Centreline, options: RibbonOptions, caps: boolean): StripOptions {
  const ends = options.ends ?? CUT_ENDS;
  return {
    tolerance: options.tolerance ?? RIBBON_TOLERANCE,
    miterLimit: options.miterLimit ?? RIBBON_MITER_LIMIT,
    offset: options.offset ?? 0,
    capStart: caps && !line.closed && ends.start === 'cut',
    capEnd: caps && !line.closed && ends.end === 'cut',
  };
}

/**
 * How far a closed line's band may reach on each side of each sample: toward the inside and
 * toward the outside of its ring.
 */
export interface ShoreReach {
  inward: number[];
  outward: number[];
}

/**
 * The path's own ribbon: V = 0 on its left edge, 1 on its right. `reach`, for a closed line,
 * caps how far the band spreads to each side of each sample (see `shoreReach`).
 */
export function buildRibbonMesh(line: Centreline, options: RibbonOptions = {}, reach?: ShoreReach): RibbonMesh {
  if (line.xy.length < 2) return emptyMesh();
  const insideLeft = signedRingArea(line) > 0;
  const sides = (i: number): [number, number] => {
    const half = line.width[i] / 2;
    if (!reach) return [half, -half];
    const inward = Math.min(half, reach.inward[i]);
    const outward = Math.min(half, reach.outward[i]);
    return insideLeft ? [inward, -outward] : [outward, -inward];
  };
  return buildStrip(line, sides, stripOptions(line, options, true));
}

/** Twice the signed area of a closed line's ring: positive when its inside lies left of travel. */
export function signedRingArea(line: Centreline): number {
  let s = 0;
  for (let i = 0; i < line.xy.length - 1; i++) s += line.xy[i][0] * line.xy[i + 1][1] - line.xy[i + 1][0] * line.xy[i][1];
  return s;
}

/**
 * For a closed line (a lake's shore): how far its band may reach to each side of each sample
 * before it meets the band coming from another stretch of the shore — half the distance to the
 * nearest part of the ring on that side, not counting the sample's own neighbourhood. A band
 * wider than the lake is narrow would otherwise cross itself inside and fold, and one wider
 * than a gap between two arms would overlap itself across the gap.
 */
export function shoreReach(line: Centreline): ShoreReach {
  const { xy, arc, width, length } = line;
  const n = xy.length;
  const halves = Array.from(width, (w) => w / 2);
  if (!line.closed || n < 4) return { inward: halves, outward: [...halves] };
  const insideSign = signedRingArea(line) > 0 ? 1 : -1;
  const inward: number[] = [];
  const outward: number[] = [];
  xy.forEach((p, i) => {
    const half = halves[i];
    const prev = xy[i === 0 ? n - 2 : i - 1];
    const next = xy[i === n - 1 ? 1 : i + 1];
    const dl = Math.hypot(next[0] - prev[0], next[1] - prev[1]) || 1;
    // The inward normal at the sample.
    const nx = (-(next[1] - prev[1]) / dl) * insideSign;
    const ny = ((next[0] - prev[0]) / dl) * insideSign;
    let inside = Infinity;
    let outside = Infinity;
    for (let k = 0; k < n - 1; k++) {
      const [ax, ay] = xy[k];
      const [bx, by] = xy[k + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2));
      const qx = ax + dx * t - p[0];
      const qy = ay + dy * t - p[1];
      const d = Math.hypot(qx, qy);
      // The same stretch round a bend or a corner is never more than about π/2 times farther
      // by arc than straight across; another stretch of shore (across an arm, across a gap) is.
      const gap = Math.abs(arc[k] + (arc[k + 1] - arc[k]) * t - arc[i]);
      if (Math.min(gap, length - gap) <= 2 * d + 1e-6) continue;
      if (qx * nx + qy * ny > 0) inside = Math.min(inside, d);
      else outside = Math.min(outside, d);
    }
    inward.push(Math.min(half, inside / 2));
    outward.push(Math.min(half, outside / 2));
  });
  return { inward: smoothReach(line, inward), outward: smoothReach(line, outward) };
}

/**
 * Evens out a reach along a closed line so the band's edge runs smooth: each sample takes the
 * least reach within half a width of arc either side, then neighbours are averaged.
 */
function smoothReach(line: Centreline, reach: number[]): number[] {
  const { arc, width, length } = line;
  const n = reach.length;
  const near = (i: number, j: number) => {
    const gap = Math.abs(arc[i] - arc[j]);
    return Math.min(gap, length - gap) <= width[i] / 2;
  };
  let out = reach.map((r, i) => {
    let least = r;
    for (let j = 0; j < n; j++) if (reach[j] < least && near(i, j)) least = reach[j];
    return least;
  });
  for (let pass = 0; pass < 2; pass++) {
    const prev = out;
    // The closing sample repeats the first, so neighbours wrap past it.
    out = prev.map((r, i) => (prev[i === 0 ? n - 2 : i - 1] + 2 * r + prev[i === n - 1 ? 1 : i + 1]) / 4);
  }
  return out;
}

/** Points → centreline → mesh in one call. */
export function buildRibbon(
  points: readonly RibbonPoint[],
  closed: boolean,
  defaultWidth: number,
  options: RibbonOptions = {},
): RibbonMesh {
  return buildRibbonMesh(sampleCentreline(points, closed, defaultWidth, options), options);
}

/** Meshes laid end to end as one: the pieces share their seam vertices, so they read as one strip. */
function joinMeshes(meshes: RibbonMesh[]): RibbonMesh {
  const parts = meshes.filter((m) => m.positions.length > 0);
  if (parts.length === 1) return parts[0];
  const vertices = parts.reduce((n, m) => n + m.positions.length / 2, 0);
  const indexCount = parts.reduce((n, m) => n + m.indices.length, 0);
  const out: RibbonMesh = {
    positions: new Float32Array(vertices * 2),
    uvs: new Float32Array(vertices * 2),
    indices: vertices > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount),
    arc: new Float32Array(vertices),
    width: new Float32Array(vertices),
    length: parts[0]?.length ?? 0,
  };
  let v = 0;
  let t = 0;
  for (const m of parts) {
    out.positions.set(m.positions, v * 2);
    out.uvs.set(m.uvs, v * 2);
    out.arc.set(m.arc, v);
    out.width.set(m.width, v);
    for (let k = 0; k < m.indices.length; k++) out.indices[t + k] = m.indices[k] + v;
    v += m.positions.length / 2;
    t += m.indices.length;
  }
  return out;
}

/**
 * A quarter ring of edge strip round a cut end's cap: from the side of the ribbon (at the end
 * sample) round to the tip, between radii `rIn` and `rOut` about the end point. U carries on
 * along the arc at the strip's mid radius, so the art runs round the cap without a jump.
 */
function capQuarter(
  center: Vec2,
  d: Vec2,
  n: Vec2,
  side: 1 | -1,
  rIn: number,
  rOut: number,
  start: boolean,
  s: number,
  tolerance: number,
): RibbonMesh {
  const steps = arcSteps(Math.PI / 2, rOut, tolerance);
  const rm = (rIn + rOut) / 2;
  const pairs = steps + 1;
  const positions = new Float32Array(pairs * 4);
  const uvs = new Float32Array(pairs * 4);
  const arc = new Float32Array(pairs * 2);
  const width = new Float32Array(pairs * 2).fill(rOut - rIn);
  for (let k = 0; k < pairs; k++) {
    // Start caps run from the tip to the side, end caps from the side to the tip: the strip's own direction.
    const phi = (Math.PI / 2) * (start ? 1 - k / steps : k / steps);
    const along = (start ? -1 : 1) * Math.sin(phi);
    const vx = n[0] * side * Math.cos(phi) + d[0] * along;
    const vy = n[1] * side * Math.cos(phi) + d[1] * along;
    positions.set([center[0] + vx * rIn, center[1] + vy * rIn, center[0] + vx * rOut, center[1] + vy * rOut], k * 4);
    const u = s + (start ? -1 : 1) * rm * phi;
    uvs.set([u, 0, u, 1], k * 4);
    arc[k * 2] = arc[k * 2 + 1] = u;
  }
  const indices = new Uint16Array(steps * 6);
  for (let k = 0; k < steps; k++) indices.set([k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2], k * 6);
  return { positions, uvs, indices, arc, width, length: 0 };
}

/**
 * Verge or bank strips laid outward from both edges, `stripWidth` wide.
 * V = 0 where a strip meets the ribbon and 1 at its outer edge, so one
 * fade-outward texture serves both sides. With `wrapCaps`, a strip carries on
 * round each cut end's round cap to its tip, so the verge follows the road's
 * outline instead of stopping square at the end.
 */
export function buildEdgeStrips(
  line: Centreline,
  stripWidth: number,
  options: RibbonOptions = {},
  inset = 0,
  wrapCaps = false,
): { left: RibbonMesh; right: RibbonMesh } {
  if (line.xy.length < 2 || stripWidth <= 0) return { left: emptyMesh(), right: emptyMesh() };
  const o = stripOptions(line, options, false);
  // An inset starts each strip that far inside the ribbon's edge, under its soft fade.
  const inner = (i: number) => Math.max(0, line.width[i] / 2 - inset);
  const left = buildStrip(line, (i) => [inner(i), line.width[i] / 2 + stripWidth], o);
  const right = buildStrip(line, (i) => [-inner(i), -line.width[i] / 2 - stripWidth], o);
  const ends = options.ends ?? CUT_ENDS;
  if (!wrapCaps || line.closed) return { left, right };
  const tolerance = options.tolerance ?? RIBBON_TOLERANCE;
  const last = line.xy.length - 1;
  const d0 = direction(line.xy[0], line.xy[1]) ?? [1, 0];
  const d1 = direction(line.xy[last - 1], line.xy[last]) ?? d0;
  const wrap = (side: 1 | -1, strip: RibbonMesh): RibbonMesh =>
    joinMeshes([
      ends.start === 'cut'
        ? capQuarter(line.xy[0], d0, perp(d0), side, inner(0), line.width[0] / 2 + stripWidth, true, line.arc[0], tolerance)
        : emptyMesh(),
      strip,
      ends.end === 'cut'
        ? capQuarter(line.xy[last], d1, perp(d1), side, inner(last), line.width[last] / 2 + stripWidth, false, line.arc[last], tolerance)
        : emptyMesh(),
    ]);
  return { left: wrap(1, left), right: wrap(-1, right) };
}

/**
 * The ribbon's outline for hit testing: each run of equal width offset with
 * round ends and joins, unioned. A closed line with `fill` also covers its
 * interior. A run whose width changes takes its wider end, so picks never miss.
 */
export function ribbonOutline(line: Centreline, fill = false): Polygon[] {
  const { xy, width } = line;
  if (xy.length < 2) return [];
  const spans: { half: number; pts: Polygon }[] = [];
  for (let i = 0; i < xy.length - 1; i++) {
    const half = Math.round(Math.max(width[i], width[i + 1]) * 5e5) / 1e6;
    const last = spans[spans.length - 1];
    if (last && last.half === half) last.pts.push(xy[i + 1]);
    else spans.push({ half, pts: [xy[i], xy[i + 1]] });
  }
  const pieces: Polygon[] = [];
  for (const span of spans) {
    if (span.half > 0) pieces.push(...clipper2Engine.inflateOpen([span.pts], span.half));
  }
  const interior: Polygon[] = fill && line.closed && xy.length > 3 ? [xy.slice(0, -1)] : [];
  if (spans.length === 1 && interior.length === 0) return pieces;
  return clipper2Engine.union(pieces, interior);
}
