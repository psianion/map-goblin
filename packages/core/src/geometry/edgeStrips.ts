// Edge strips: a polyline's sampled centreline and the bands laid out from either side of
// it, mitred, with corner fans and loops trimmed out of tight bends. Pure geometry in
// cells; the plateau renderer lays its slope shade and offset lines with them.

import { flattenCubic } from '../shared/bezier';

type Vec2 = [number, number];

/** A point of a line. */
export interface StripPoint {
  x: number;
  y: number;
  /** Curve handles relative to the point. Absent = auto tangent (centripetal Catmull-Rom). null = sharp corner. */
  handles?: { in: [number, number]; out: [number, number] } | null;
}

/** Max deviation of the flattened curve from the true one, cells. */
const TOLERANCE = 0.02;
const MITER_LIMIT = 2;
const EPS = 1e-9;

/**
 * The flattened centreline. Closed lines repeat their first sample at the end
 * (arc = length), so the strip closes on itself.
 */
export interface Centreline {
  xy: Vec2[];
  arc: number[];
  /** Full width per sample. */
  width: number[];
  length: number;
  closed: boolean;
}

export interface StripMesh {
  /** x, y per vertex, cells. */
  positions: Float32Array;
  /** U = arc length in cells, V = 0 on the first side, 1 on the second. */
  uvs: Float32Array;
  indices: Uint16Array | Uint32Array;
  /** Arc length per vertex. */
  arc: Float32Array;
  /** Line width per vertex (the sample's full width). */
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

const emptyLine = (closed: boolean): Centreline => ({ xy: [], arc: [], width: [], length: 0, closed });

/**
 * Flatten points into a sampled centreline `width` cells wide. Duplicate neighbours are
 * dropped; fewer than two distinct points give an empty line.
 */
export function sampleCentreline(points: readonly StripPoint[], closed: boolean, width: number): Centreline {
  const pts: StripPoint[] = [];
  for (const p of points) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-6) pts.push(p);
  }
  if (closed && pts.length > 2) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) <= 1e-6) pts.pop();
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
  const push = (q: Vec2) => {
    const last = xy[xy.length - 1];
    if (!last || dist(last, q) > EPS) xy.push(q);
  };
  const segments = closed ? n : n - 1;
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % n;
    push(pos[i]);
    for (const q of flattenCubic(pos[i], controls[i].cout, controls[j].cin, pos[j], TOLERANCE)) push(q);
  }
  push(closed ? pos[0] : pos[n - 1]);

  const arc = [0];
  for (let i = 1; i < xy.length; i++) arc.push(arc[i - 1] + dist(xy[i - 1], xy[i]));
  const length = arc[arc.length - 1];
  if (length <= EPS) return emptyLine(closed);
  return { xy, arc, width: arc.map(() => Math.max(0, width)), length, closed };
}

/** Signed lateral offsets of a strip's two sides at sample i (+ = left of travel). */
type Sides = (i: number) => [number, number];

interface StripOptions {
  tolerance: number;
  miterLimit: number;
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
 * a line that crosses itself further along keeps both of its passes.
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
 * The strip builder: a pair of vertices per sample along the averaged normal, mitred; past
 * the mitre limit each leg ends square through the corner and a fan fills the outside. Loops
 * are cut out of the inside of tight bends, and a fold guard collapses a vertex onto the
 * previous one rather than let a triangle turn over.
 */
function buildStrip(line: Centreline, sides: Sides, o: StripOptions): StripMesh {
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
    let u = arc[i] + turnU;

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

const emptyMesh = (): StripMesh => ({
  positions: new Float32Array(0),
  uvs: new Float32Array(0),
  indices: new Uint16Array(0),
  arc: new Float32Array(0),
  width: new Float32Array(0),
  length: 0,
});

/**
 * Strips laid outward from both edges of the line, `stripWidth` wide. V = 0 where a strip
 * meets the line's edge and 1 at its outer edge.
 */
export function buildEdgeStrips(line: Centreline, stripWidth: number): { left: StripMesh; right: StripMesh } {
  if (line.xy.length < 2 || stripWidth <= 0) return { left: emptyMesh(), right: emptyMesh() };
  const o: StripOptions = { tolerance: TOLERANCE, miterLimit: MITER_LIMIT };
  const left = buildStrip(line, (i) => [line.width[i] / 2, line.width[i] / 2 + stripWidth], o);
  const right = buildStrip(line, (i) => [-line.width[i] / 2, -line.width[i] / 2 - stripWidth], o);
  return { left, right };
}
