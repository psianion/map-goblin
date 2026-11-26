// A pack-measured kit's rock as saved on the layer (`DungeonLayer.rockLines`): which drawn
// outline each line was laid for. Pixi-free: the table server reads it with no catalog.

import type { RockLine } from '../store/types';

/** How near a point must lie to a rock line's edge to be on it, cells (its coordinates are rounded to 0.01). */
export const ROCK_EDGE_SLACK = 0.02;

type Pt = readonly [number, number];

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}

/** Whether `p` lies on the polyline `pts` (closed: with its closing edge) within ROCK_EDGE_SLACK. */
function onLine(p: Pt, pts: readonly Pt[], closed: boolean): boolean {
  const n = pts.length;
  if (n === 1) return segDist(p, pts[0], pts[0]) <= ROCK_EDGE_SLACK;
  for (let i = 0; i + 1 < n; i++) if (segDist(p, pts[i], pts[i + 1]) <= ROCK_EDGE_SLACK) return true;
  return closed && n > 2 && segDist(p, pts[n - 1], pts[0]) <= ROCK_EDGE_SLACK;
}

/** Whether `p` lies on the line's drawn edge. */
export function onRockEdge(p: Pt, line: RockLine): boolean {
  return onLine(p, line.edge, line.closed);
}

const wallMemo = new WeakMap<readonly RockLine[], RockLine[]>();

/** The walls' lines of a layer's rock lines, a plateau cliff's own left out: the list itself when it has none. Kept per list. */
export function wallLines(lines: RockLine[] | undefined): RockLine[] | undefined {
  if (!lines || !lines.some((l) => l.kind === 'cliff')) return lines;
  let walls = wallMemo.get(lines);
  if (!walls) wallMemo.set(lines, (walls = lines.filter((l) => l.kind !== 'cliff')));
  return walls;
}

/** Whether `line` was laid for the closed ring `ring` as it stands: each lies along the other. */
export function laidFor(line: RockLine, ring: readonly Pt[]): boolean {
  return ring.length > 0 && ring.every((p) => onLine(p, line.edge, line.closed)) && line.edge.every((p) => onLine(p, ring, true));
}

// ─── A drawn run along a rock line ─────────────────────────

/** A stretch of a drawn run this near a rock line's edge, and parallel to it, lies on it, cells. */
export const ALONG_EDGE = 0.05;
/**
 * A plateau cliff's own line is matched this far off its drawn run, cells: a stretch that runs on
 * into a wall starts on the wall's rock, so its first and last sides lie aslant of the drawn ones
 * by as much as the wall's rock lies off its edge.
 */
const ALONG_OWN = 0.45;
/** Shorter shared stretches are a touch or a crossing, not a run along the wall, cells. */
export const ALONG_MIN = 0.3;
/** Sine of the widest angle between a run and an edge still read as parallel (~7°). */
const PARALLEL_SIN = 0.12;
/** How far a line's rock may lie from its edge and still be the rock along it, cells. */
const ROCK_REACH = 1;
/** Positions along a line closer than this are one, cells. */
const JOIN = 0.02;

type V = [number, number];

/** A run's points with its stretches along rock lines laid on the rock (`alongRock`). */
export interface AlongRock {
  points: V[];
  /** Per segment of `points` (counted as the run's closedness counts them), the index of the drawn segment it stands for. */
  segs: number[];
  /** Per segment of `points`, the index into `replaced` of the stretch it lies along; -1 off every line. */
  on: number[];
  /** Each stretch replaced: its drawn points and the points that took their place, both in the run's order, and the line they came from. */
  replaced: { drawn: V[]; rock: V[]; line: RockLine }[];
}

/** A polyline with its arc lengths: `count` segments, a closed one's last wrapping to its first point. */
interface Path {
  pts: readonly Pt[];
  closed: boolean;
  cum: number[];
  total: number;
  count: number;
}

const dist = (a: Pt, b: Pt): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

function pathOf(pts: readonly Pt[], closed: boolean): Path {
  const count = closed ? pts.length : pts.length - 1;
  const cum = [0];
  for (let k = 0; k < count; k++) cum.push(cum[k] + dist(pts[k], pts[(k + 1) % pts.length]));
  return { pts, closed, cum, total: cum[count], count };
}

/** `s` as a position on the path: wrapped round a closed one, clamped to an open one. */
const wrap = (path: Path, s: number): number =>
  path.closed ? ((s % path.total) + path.total) % path.total : Math.max(0, Math.min(path.total, s));

/** The segment under `s`: the one starting there at a vertex, the last at an open path's end. */
function segAt(path: Path, s: number): number {
  const t = wrap(path, s);
  let k = 0;
  while (k + 1 < path.count && path.cum[k + 1] <= t + 1e-9) k++;
  return k;
}

function pointAt(path: Path, s: number): V {
  const k = segAt(path, s);
  const a = path.pts[k];
  const b = path.pts[(k + 1) % path.pts.length];
  const len = path.cum[k + 1] - path.cum[k];
  const u = len < 1e-12 ? 0 : (wrap(path, s) - path.cum[k]) / len;
  // At a vertex, the vertex itself.
  if (u * len < 1e-9) return [a[0], a[1]];
  if ((1 - u) * len < 1e-9) return [b[0], b[1]];
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
}

function tangentAt(path: Path, s: number): V {
  const k = segAt(path, s);
  const a = path.pts[k];
  const b = path.pts[(k + 1) % path.pts.length];
  return [b[0] - a[0], b[1] - a[1]];
}

/** The path's vertices strictly between `u` and `v` (a closed path's positions may run past its length), with their positions. */
function verticesBetween(path: Path, u: number, v: number): { p: V; s: number }[] {
  const out: { p: V; s: number }[] = [];
  const laps = path.closed ? [Math.floor(u / path.total), Math.floor(v / path.total)] : [0, 0];
  const last = path.closed ? path.count - 1 : path.count;
  for (let w = laps[0]; w <= laps[1]; w++) {
    for (let k = 0; k <= last; k++) {
      const s = w * path.total + path.cum[k];
      if (s > u + 1e-9 && s < v - 1e-9) out.push({ p: [path.pts[k][0], path.pts[k][1]], s });
    }
  }
  return out;
}

/** The path from `u` to `v`: its point at each end (when asked) and every vertex between. */
function subPath(path: Path, u: number, v: number, start: boolean, end: boolean): { p: V; s: number }[] {
  return [...(start ? [{ p: pointAt(path, u), s: u }] : []), ...verticesBetween(path, u, v), ...(end ? [{ p: pointAt(path, v), s: v }] : [])];
}

/** The nearest point of the path to `p` between `u` and `v` (the whole of it by default): its position and distance. */
function nearestOn(path: Path, p: Pt, u = 0, v = path.total): { s: number; d: number } {
  let best = { s: u, d: Infinity };
  const laps = path.closed ? [Math.floor(u / path.total), Math.floor(v / path.total)] : [0, 0];
  for (let w = laps[0]; w <= laps[1]; w++) {
    for (let k = 0; k < path.count; k++) {
      const s0 = w * path.total + path.cum[k];
      const lo = Math.max(u, s0);
      const hi = Math.min(v, w * path.total + path.cum[k + 1]);
      if (hi < lo) continue;
      const a = path.pts[k];
      const b = path.pts[(k + 1) % path.pts.length];
      const len = path.cum[k + 1] - path.cum[k];
      const along = len < 1e-12 ? 0 : ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / len;
      const s = Math.max(lo, Math.min(hi, s0 + along));
      const d = dist(p, pointAt(path, s));
      if (d < best.d) best = { s, d };
    }
  }
  return best;
}

/** A rock run both ways round: a run that ends where it starts is a closed loop. */
interface RockRun {
  fwd: Path;
  back: Path;
}

/** A position along the drawn path where a part of a stretch starts or ends: at `r`'s end `at` when a run of the rock stops there. */
interface Bound {
  s: number;
  r?: RockRun;
  at?: number;
}

/** How many points along a part of a stretch tell which way the rock runs against it. */
const DIRECTION_SAMPLES = 5;

function rockRunOf(run: readonly Pt[]): RockRun {
  const loop = run.length > 3 && dist(run[0], run[run.length - 1]) < JOIN;
  const pts = loop ? run.slice(0, -1) : run;
  return { fwd: pathOf(pts, loop), back: pathOf([...pts].reverse(), loop) };
}

/** A stretch of the drawn path, from `s0` to `s1`, on the edge of `line`; `full` when it is the whole of a closed path. */
interface Stretch {
  s0: number;
  s1: number;
  full: boolean;
  line: RockLine;
}

const cross = (a: Pt, b: Pt): number => a[0] * b[1] - a[1] * b[0];

/**
 * The stretches of `path` that lie on `line`'s edge: parallel to it, within ALONG_EDGE of it and
 * at least ALONG_MIN long, worked out segment by edge segment as ringCoincidences does.
 */
function stretchesOn(path: Path, line: RockLine): Stretch[] {
  const edge = line.edge;
  const reach = line.kind === 'cliff' ? ALONG_OWN : ALONG_EDGE;
  const edges = line.closed ? edge.length : edge.length - 1;
  const spans: [number, number][] = [];
  for (let k = 0; k < path.count; k++) {
    const a = path.pts[k];
    const b = path.pts[(k + 1) % path.pts.length];
    const L = path.cum[k + 1] - path.cum[k];
    if (L < 1e-9) continue;
    const t: V = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    for (let e = 0; e < edges; e++) {
      const p = edge[e];
      const q = edge[(e + 1) % edge.length];
      const Le = dist(p, q);
      if (Le < 1e-9 || Math.abs(cross(t, [q[0] - p[0], q[1] - p[1]])) / Le > PARALLEL_SIN) continue;
      const sp = (p[0] - a[0]) * t[0] + (p[1] - a[1]) * t[1];
      const sq = (q[0] - a[0]) * t[0] + (q[1] - a[1]) * t[1];
      if (Math.abs(sq - sp) < 1e-9) continue;
      const dp = cross(t, [p[0] - a[0], p[1] - a[1]]);
      const dq = cross(t, [q[0] - a[0], q[1] - a[1]]);
      let lo = Math.max(0, Math.min(sp, sq));
      let hi = Math.min(L, Math.max(sp, sq));
      // Distance from the segment's line along the edge is linear in s; keep where it is within reach.
      const slope = (dq - dp) / (sq - sp);
      if (Math.abs(slope) < 1e-12) {
        if (Math.abs(dp) > reach) continue;
      } else {
        const s1 = sp + (reach - dp) / slope;
        const s2 = sp + (-reach - dp) / slope;
        lo = Math.max(lo, Math.min(s1, s2));
        hi = Math.min(hi, Math.max(s1, s2));
      }
      if (hi - lo > 1e-6) spans.push([path.cum[k] + lo, path.cum[k] + hi]);
    }
  }
  spans.sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1] + JOIN) last[1] = Math.max(last[1], span[1]);
    else merged.push([span[0], span[1]]);
  }
  if (path.closed && merged.length > 0 && merged[0][0] <= JOIN && merged[merged.length - 1][1] >= path.total - JOIN) {
    if (merged.length === 1) return [{ s0: 0, s1: path.total, full: true, line }];
    const head = merged.shift()!;
    merged[merged.length - 1][1] = head[1] + path.total;
  }
  return merged.filter(([s0, s1]) => s1 - s0 >= ALONG_MIN).map(([s0, s1]) => ({ s0, s1, full: false, line }));
}

function boxOf(pts: readonly Pt[], pad: number): [number, number, number, number] {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
}

/**
 * A drawn run (`points`, `closed` as an edge run counts it) with every stretch that lies on a
 * rock line's `edge` replaced by that line's rock between the stretch's two ends, so what is
 * drawn or blocks along it stands on the wall's line. Matched by geometry, either way round:
 * the rock is taken the way the run goes. Where the rock stops along a stretch (a door, an
 * erased mouth) the drawn points are kept across the gap. `segs` maps each new segment to the
 * drawn one it stands for. A run along no rock line is handed back as it is. Pixi-free.
 */
export function alongRock(points: readonly Pt[], closed: boolean, lines: readonly RockLine[] | undefined): AlongRock {
  const count = closed ? points.length : points.length - 1;
  const same: AlongRock = { points: points as V[], segs: Array.from({ length: Math.max(0, count) }, (_, i) => i), on: new Array<number>(Math.max(0, count)).fill(-1), replaced: [] };
  if (!lines || lines.length === 0 || points.length < 2) return same;
  const path = pathOf(points, closed);
  if (path.total < ALONG_MIN) return same;
  const box = boxOf(points, ROCK_REACH);
  const found: Stretch[] = [];
  for (const line of lines) {
    if (line.edge.length < 2) continue;
    const b = boxOf(line.edge, 0);
    if (b[0] > box[2] || b[2] < box[0] || b[1] > box[3] || b[3] < box[1]) continue;
    found.push(...stretchesOn(path, line));
  }
  // The first line to claim a stretch keeps it.
  const whole = found.find((s) => s.full);
  const picked: Stretch[] = [];
  if (whole) picked.push(whole);
  else {
    for (const s of [...found].sort((x, y) => x.s0 - y.s0)) {
      const last = picked[picked.length - 1];
      if (!last || s.s0 >= last.s1 - JOIN) picked.push(s);
    }
    if (closed && picked.length > 1 && picked[picked.length - 1].s1 > picked[0].s0 + path.total + JOIN) picked.pop();
  }
  if (picked.length === 0) return same;

  // `on`: the stretch the segment from this point lies along, -1 for none.
  const out: { p: V; k: number; on: number }[] = [];
  const replaced: AlongRock['replaced'] = [];
  const emit = (pts: { p: V; s: number }[], on = -1) => {
    for (const { p, s } of pts) out.push({ p, k: segAt(path, s), on });
  };

  /** One stretch, laid on its line's rock: each part a run of the rock covers, the drawn points across each gap. */
  const layStretch = (st: Stretch) => {
    const on = replaced.length;
    const from = out.length;
    const runs = st.line.runs.filter((r) => r.length >= 2).map(rockRunOf);
    let [sa, sb] = [st.s0, st.s1];
    // Where a run of the rock ends along the stretch: a door or a mouth begins or ends there.
    const ends: Bound[] = [];
    for (const r of runs) {
      if (r.fwd.closed) continue;
      for (const at of [0, r.fwd.total]) {
        const n = nearestOn(path, pointAt(r.fwd, at), sa, sb);
        if (n.d > ROCK_REACH) continue;
        if (st.full) ends.push({ s: wrap(path, n.s), r, at });
        else if (n.s > sa + JOIN && n.s < sb - JOIN) ends.push({ s: n.s, r, at });
      }
    }
    ends.sort((x, y) => x.s - y.s);
    let first: Bound = { s: sa };
    if (st.full && ends.length > 0) {
      first = ends.shift()!;
      sa = first.s;
      sb = sa + path.total;
    }
    const bounds = [first, ...ends.filter((e) => e.s > sa + JOIN && e.s < sb - JOIN), { ...first, s: sb }];
    const rock: V[] = [];
    for (let i = 0; i + 1 < bounds.length; i++) {
      const [bu, bv] = [bounds[i], bounds[i + 1]];
      const [u, v] = [bu.s, bv.s];
      if (v - u < JOIN / 2) continue;
      const piece = rockPiece(runs, bu, bv, st.full && bounds.length === 2);
      if (piece) {
        // Each rock segment stands for the drawn segment its middle lies by; the last, which
        // hands over to what follows, for the one at the stretch's end.
        piece.forEach((p, j) => {
          const next = piece[j + 1];
          const k = next ? segAt(path, nearestOn(path, [(p[0] + next[0]) / 2, (p[1] + next[1]) / 2], u, v).s) : segAt(path, v);
          out.push({ p, k, on });
          rock.push(p);
        });
      } else {
        const drawn = subPath(path, u, v, true, true);
        emit(drawn, on);
        rock.push(...drawn.map((d) => d.p));
      }
    }
    // The segment on from the stretch's last point leaves it, unless it closes a whole ring.
    if (!st.full && out.length > from) out[out.length - 1].on = -1;
    replaced.push({ drawn: subPath(path, sa, sb, true, true).map((d) => d.p), rock, line: st.line });
  };

  /** The rock that covers the drawn path from `u` to `v`, taken the way the path runs; null where none does. */
  const rockPiece = (runs: RockRun[], bu: Bound, bv: Bound, full: boolean): V[] | null => {
    const [u, v] = [bu.s, bv.s];
    const mid = pointAt(path, (u + v) / 2);
    let best: { r: RockRun; d: number } | null = null;
    for (const r of runs) {
      const n = nearestOn(r.fwd, mid);
      // Past an open run's end is not along it.
      const atEnd = !r.fwd.closed && (n.s < JOIN || n.s > r.fwd.total - JOIN);
      if (!atEnd && n.d <= ROCK_REACH && (!best || n.d < best.d)) best = { r, d: n.d };
    }
    if (!best) return null;
    const { r } = best;
    // Which way round the rock runs against the path, by geometry: its direction summed over a
    // few points along the part, so a corner (where either side is nearest) cannot decide it.
    let way = 0;
    for (let i = 0; i < DIRECTION_SAMPLES; i++) {
      const s = u + ((i + 0.5) / DIRECTION_SAMPLES) * (v - u);
      const t = tangentAt(r.fwd, nearestOn(r.fwd, pointAt(path, s)).s);
      const tp = tangentAt(path, s);
      way += (t[0] * tp[0] + t[1] * tp[1]) / (Math.hypot(t[0], t[1]) * Math.hypot(tp[0], tp[1]) || 1);
    }
    const forward = way >= 0;
    const rock = forward ? r.fwd : r.back;
    // A bound at this run's own end cuts it there; any other where the drawn point is nearest.
    const cut = (b: Bound) =>
      b.r === r && b.at !== undefined ? (forward ? b.at : rock.total - b.at) : nearestOn(rock, pointAt(path, b.s)).s;
    const cu = cut(bu);
    let cv = cut(bv);
    if (rock.closed) {
      if (full) cv = cu + rock.total;
      else if (cv < cu) cv += rock.total;
    } else if (cv < cu) return null;
    return subPath(rock, cu, cv, true, true).map((d) => d.p);
  };

  if (closed) {
    picked.forEach((st, i) => {
      layStretch(st);
      if (st.full) return;
      const next = i + 1 < picked.length ? picked[i + 1].s0 : picked[0].s0 + path.total;
      emit(verticesBetween(path, st.s1, next));
    });
  } else {
    let at = 0;
    if (picked[0].s0 > JOIN) emit([{ p: pointAt(path, 0), s: 0 }]);
    for (const st of picked) {
      emit(verticesBetween(path, at, st.s0));
      layStretch(st);
      at = st.s1;
    }
    emit(verticesBetween(path, at, path.total));
    if (at < path.total - JOIN) emit([{ p: pointAt(path, path.total), s: path.total }]);
  }

  // One point where two pieces meet on it: the later one's segment goes on from there.
  const kept: { p: V; k: number; on: number }[] = [];
  for (const o of out) {
    const last = kept[kept.length - 1];
    if (last && dist(last.p, o.p) < 1e-6) {
      last.k = o.k;
      last.on = o.on;
    } else kept.push({ ...o });
  }
  if (closed && kept.length > 1 && dist(kept[0].p, kept[kept.length - 1].p) < 1e-6) kept.pop();
  const segCount = closed ? kept.length : kept.length - 1;
  const segsOf = kept.slice(0, segCount);
  return { points: kept.map((o) => o.p), segs: segsOf.map((o) => o.k), on: segsOf.map((o) => o.on), replaced };
}
