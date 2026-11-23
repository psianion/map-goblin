// A measured kit's pieces, bent where they meet.
//
// Each piece of a measured kit is drawn rigid with square ends, so where two meet at an
// angle a wedge opens on the outside of the turn and the art's baked shadow parts with it.
// A piece whose end meets a neighbour at an angle is drawn as a mesh instead, its art bent
// near that end so the end lies on the line that splits the joint's angle: the two
// neighbours then meet with no gap and no overlap, rock and shadow alike. A piece whose run
// stops at an erased mouth or a cliff's free end, with no end piece there, narrows to a
// rounded tip instead. Width never changes under a bend, and nothing here moves a joint,
// a rock line or anything the walk laid: it is how the art is drawn, nothing more.
//
// In a piece's own frame u runs along it and v is the offset from its rock line (the line
// through its joints), positive to the floor side (the right of travel). All distances are
// in cells times the size the piece's stretch was laid at, so everything follows wall width.

import { jointsOf } from '../assets/caveWallKit';
import { GRID_CELL_PX } from '../assets/packCatalog';
import type { Vec, WalkPlacement } from './caveWalk';

/** A joint turning more than this, degrees, is laid rigid as before: corner pieces are for those. */
export const MITRE_MOST_DEG = 60;
/** The least bend zone, cells at size 1. */
const BEND_LEAST = 0.3;
/** The bend zone per cell of offset per unit of a joint's slope: long enough that the art never folds. */
const BEND_PER_OFFSET = 1.6;
/** How far back from its tip a tapered end narrows, cells at size 1, and at most this share of the piece. */
const TAPER_REACH = 0.8;
const TAPER_SHARE = 0.6;
/**
 * The most a bent end is moved across to meet its neighbour's rock line, cells at size 1: a small
 * step between two neighbours' lines is closed, a larger one (where the walk laid them so) only eased.
 */
const STEP_MOST = 0.1;
/** How far each bent end is drawn past the line it meets its neighbour on, in the art's own pixels: no hairline shows. */
const END_OVERLAP_PX = 0.5;

const add = (p: Vec, q: Vec): Vec => [p[0] + q[0], p[1] + q[1]];
const sub = (p: Vec, q: Vec): Vec => [p[0] - q[0], p[1] - q[1]];
const mul = (p: Vec, s: number): Vec => [p[0] * s, p[1] * s];
const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1];
const dist = (p: Vec, q: Vec): number => Math.hypot(p[0] - q[0], p[1] - q[1]);
const right = (t: Vec): Vec => [-t[1], t[0]];

const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const ramp = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);

/** One end of a piece bent to meet its neighbour. */
export interface BendEnd {
  /** Where the two meet: the middle of the overlap their joints leave. */
  at: Vec;
  /** The joint's turn from this piece's travel to the next's, radians, positive toward the floor side. */
  turn: number;
}

/** How a piece is drawn bent: its ends (`a` at its first joint, `b` at its second), each mitred or tapered. */
export interface PieceBend {
  a?: BendEnd;
  b?: BendEnd;
  /** Each end narrowed to a tip: an open end with no end piece laid there. */
  taper?: [boolean, boolean];
  /** The size the piece's stretch was laid at: every distance here is cells times this. */
  unit: number;
  /** How far before each joint the piece's art ends: half the kit's overlap at the piece's scale. */
  half: number;
  /** Half the kit's rock width at the stretch's size: where a taper narrows to when the pack measures no middle. */
  rockHalf: number;
}

/** A joint's slope: the share of its offset each point of a bent end moves along the piece. */
export function mitreSlope(turn: number): number {
  return -Math.tan(turn / 2);
}

/** The bend zone at offset `v`, and how it ramps: never less than the least zone, never more than `cap`. */
function zone(v: number, tMax: number, unit: number, cap: number): [number, (x: number) => number] {
  const want = Math.max(BEND_LEAST * unit, BEND_PER_OFFSET * Math.abs(v) * tMax);
  return want <= cap ? [want, smooth] : [cap, ramp];
}

/**
 * Where a point `u` along a straight piece `L` long, `v` off its rock line, is drawn along it when
 * its ends meet joints of slopes `tA` and `tB` (see {@link mitreSlope}): moved along by its offset
 * times the slope near each end, over a zone just long enough that the art never folds, so each
 * end lies on the line splitting its joint. Its offset is unchanged.
 */
export function mitreAlong(u: number, v: number, L: number, tA: number, tB: number, unit = 1): number {
  const [e, r] = zone(v, Math.max(Math.abs(tA), Math.abs(tB)), unit, L / 2);
  return u + v * tB * r((u - (L - e)) / e) - v * tA * r((e - u) / e);
}

/** The width left at `q` of the way along a tapered end (0 where it starts, 1 at the tip): a quarter circle. */
export function taperWidth(q: number): number {
  const x = Math.min(1, Math.max(0, q));
  return Math.sqrt(Math.max(0, 1 - x * x));
}

/**
 * A laid piece's direction of travel at each of its joints: its chord turned back by half its
 * turn at the first and on by half at the second, as an arc does.
 */
export function endTangents(pl: WalkPlacement): [Vec, Vec] {
  const [J0, J1] = jointsOf(pl.piece, pl.at);
  const a = Math.atan2(J1[1] - J0[1], J1[0] - J0[0]);
  const h = (pl.piece.turnDeg * Math.PI) / 360;
  return [
    [Math.cos(a - h), Math.sin(a - h)],
    [Math.cos(a + h), Math.sin(a + h)],
  ];
}

/** One bent end, worked out once for every point drawn. */
interface EndFrame {
  /** 0 for the first joint, 1 for the second. */
  k: 0 | 1;
  /** Outward along the piece at this end, and the floor side. */
  out: Vec;
  n: Vec;
  /** The frame's origin: where it meets its neighbour, or the joint of an open end. */
  o: Vec;
  /** How far past the origin, outward, the art ends. */
  artEnd: number;
  /** How far its rock line passes the origin, to the floor side. */
  side: number;
  /** The joint's slope; null for an end only tapered. */
  slope: number | null;
  taper: boolean;
  /** The middle of the solid rock along this end: [outward, offset] pairs, outward rising. */
  middle: Vec[] | null;
}

/**
 * Where each point of `pl`'s art is drawn, bent as its `bend` asks: the identity for a piece
 * with none. Points are world positions of the piece laid rigid, as its sprite would draw them.
 */
export function bendWarp(pl: WalkPlacement): (p: Vec) => Vec {
  const bend = pl.bend;
  if (!bend || (!bend.a && !bend.b && !bend.taper?.some(Boolean))) return (p) => p;
  const { unit, half } = bend;
  const [J0, J1] = jointsOf(pl.piece, pl.at);
  const tangents = endTangents(pl);
  const chord = dist(J0, J1);
  const curved = pl.piece.turnDeg !== 0;
  const L = bend.a && bend.b ? dist(bend.a.at, bend.b.at) : chord;
  // A bend's two arms each take one end: the zones stay in their own arm.
  const cap = curved ? L / 3 : L / 2;
  const slopes = [bend.a ? mitreSlope(bend.a.turn) : 0, bend.b ? mitreSlope(bend.b.turn) : 0];
  const tMax = Math.max(Math.abs(slopes[0]), Math.abs(slopes[1]));
  // A bend's points are measured in from an end round its arc, about the centre its two end
  // normals meet at: along the end's tangent, the middle of an arm that curves away lies close in.
  // Taken from where its art ends, so every point of an end's edge lies square to the centre.
  const [n0, n1] = [right(tangents[0]), right(tangents[1])];
  const [E0, E1] = [add(J0, mul(tangents[0], half)), sub(J1, mul(tangents[1], half))];
  const den = n0[0] * n1[1] - n0[1] * n1[0];
  const centre: Vec | null = curved && Math.abs(den) > 1e-6 ? add(E0, mul(n0, ((E1[0] - E0[0]) * n1[1] - (E1[1] - E0[1]) * n1[0]) / den)) : null;
  const middle = pl.piece.middle?.map(([x, y]): Vec => {
    const c = Math.cos(pl.at.rotation);
    const s = Math.sin(pl.at.rotation);
    return [pl.at.position.x + (x * c - y * s) * pl.at.scale, pl.at.position.y + (x * s + y * c) * pl.at.scale];
  });
  const overlap = (END_OVERLAP_PX / GRID_CELL_PX) * pl.at.scale;
  const taperLen = Math.min(TAPER_REACH * unit, TAPER_SHARE * chord);
  const ends: EndFrame[] = [];
  for (const k of [0, 1] as const) {
    const mitre = k === 0 ? bend.a : bend.b;
    const taper = !mitre && !!bend.taper?.[k];
    if (!mitre && !taper) continue;
    const t = tangents[k];
    const out = k === 0 ? mul(t, -1) : t;
    const n = right(t);
    const J = k === 0 ? J0 : J1;
    const o = mitre ? mitre.at : J;
    const artEnd = dot(sub(sub(J, mul(out, half)), o), out);
    // How far its rock line passes the meeting point to the floor side: the step between two
    // neighbours' lines, which each takes half of so their rock and shadow run on unbroken.
    const side = dot(sub(J, o), n);
    const mid2 = middle
      ? middle
          .map((p): Vec => [dot(sub(p, o), out), dot(sub(p, o), n)])
          .sort((x, y) => x[0] - y[0])
      : null;
    ends.push({ k, out, n, o, artEnd, side, slope: mitre ? slopes[k] : null, taper, middle: mid2 && mid2.length >= 2 ? mid2 : null });
  }
  const middleAt = (e: EndFrame, s: number): number => {
    const m = e.middle;
    if (!m) return -bend.rockHalf;
    if (s <= m[0][0]) return m[0][1];
    if (s >= m[m.length - 1][0]) return m[m.length - 1][1];
    let i = 0;
    while (m[i + 1][0] < s) i++;
    const f = (s - m[i][0]) / (m[i + 1][0] - m[i][0] || 1);
    return m[i][1] + (m[i + 1][1] - m[i][1]) * f;
  };
  return (p) => {
    let moved = p;
    for (const e of ends) {
      const rel = sub(p, e.o);
      const s = dot(rel, e.out);
      const w = dot(rel, e.n);
      // How far in from the art's end: straight back along the piece, or round a bend's arc.
      let inward = e.artEnd - s;
      if (centre) {
        const end = add(e.o, mul(e.out, e.artEnd));
        const r0 = sub(end, centre);
        const v = sub(p, centre);
        // Art past the centre (none of the rock) is measured straight back, as a straight's is.
        if (dot(r0, v) > 0) {
          const turned = Math.atan2(r0[0] * v[1] - r0[1] * v[0], dot(r0, v));
          const into = r0[0] * -e.out[1] - r0[1] * -e.out[0];
          inward = Math.sign(into) * turned * Math.hypot(r0[0], r0[1]);
        }
      }
      if (e.slope !== null) {
        // Its art's end and rock line brought onto the meeting point (the line only so far, see
        // STEP_MOST), spread back over the piece's half; then its offset from the meeting point there.
        const spread = ramp(1 - inward / cap);
        const step = Math.max(-STEP_MOST * unit, Math.min(STEP_MOST * unit, -e.side));
        const x = w + step;
        const [z, r] = zone(x, tMax, unit, cap);
        const bendAt = r((z - inward) / z);
        // Where the zone is held to the piece's half, art far off the rock line (its tile's clear
        // margin) moves no further than keeps it from folding.
        const most = (0.9 * z) / Math.max(Math.abs(e.slope), 1e-9);
        const xHeld = Math.max(-most, Math.min(most, x));
        const along = Math.max(-cap / 2, Math.min(cap / 2, -e.artEnd));
        moved = add(moved, add(mul(e.out, (xHeld * e.slope + overlap) * bendAt + along * spread), mul(e.n, step * spread)));
      }
      if (e.taper && taperLen > 0) {
        const q = 1 - inward / taperLen;
        if (q > 0) {
          const c = middleAt(e, s);
          moved = add(moved, mul(e.n, (c - w) * (1 - taperWidth(q))));
        }
      }
    }
    return moved;
  };
}

/**
 * Where a point `q` drawn by `pl`'s bent art lies on the piece laid rigid: the inverse of
 * {@link bendWarp}, found by iterating it. Close to the tip of a taper, where many points are
 * drawn at one, any of them may come back.
 */
export function unbend(pl: WalkPlacement, q: Vec): Vec {
  if (!pl.bend) return q;
  const warp = bendWarp(pl);
  let p = q;
  for (let i = 0; i < 24; i++) {
    const d = sub(warp(p), q);
    if (Math.hypot(d[0], d[1]) < 1e-7) break;
    p = sub(p, d);
  }
  return p;
}

/** Columns and rows a bent piece's mesh is cut into, per cell of art at size 1: fine where it bends. */
const MESH_FINE = 25;
const MESH_COARSE = 2;
const MESH_ROWS = 6;

/** How far in from each end of `pl` its bend or taper reaches, cells: no further than its art's offsets ask for. */
function bendReach(pl: WalkPlacement, across: number): [number, number] {
  const bend = pl.bend;
  if (!bend) return [0, 0];
  const L = bend.a && bend.b ? dist(bend.a.at, bend.b.at) : dist(...jointsOf(pl.piece, pl.at));
  const cap = pl.piece.turnDeg !== 0 ? L / 3 : L / 2;
  const tMax = Math.max(bend.a ? Math.abs(mitreSlope(bend.a.turn)) : 0, bend.b ? Math.abs(mitreSlope(bend.b.turn)) : 0);
  const bent = Math.min(cap, Math.max(BEND_LEAST * bend.unit, BEND_PER_OFFSET * across * tMax));
  const tapered = Math.min(TAPER_REACH * bend.unit, TAPER_SHARE * dist(...jointsOf(pl.piece, pl.at)));
  return [0, 1].map((k) => Math.max(k === 0 ? (bend.a ? bent : 0) : bend.b ? bent : 0, bend.taper?.[k] ? tapered : 0)) as [number, number];
}

/**
 * The mesh a bent piece is drawn as: its art's rectangle (`local`, its four corners from the top
 * left round, in world units) cut into a grid fine near its bent ends, each point bent by
 * {@link bendWarp}, with the texture's own corners as uvs.
 */
export function bentMesh(pl: WalkPlacement, corners: [Vec, Vec, Vec, Vec]): { positions: Float32Array; uvs: Float32Array; indices: Uint32Array } {
  const warp = bendWarp(pl);
  const [tl, tr, , bl] = corners;
  const ux = sub(tr, tl);
  const uy = sub(bl, tl);
  const W = Math.hypot(ux[0], ux[1]);
  const H = Math.hypot(uy[0], uy[1]);
  const unit = pl.bend?.unit ?? 1;
  const [t0, t1] = endTangents(pl);
  // A straight whose art runs along the texture's width is cut finely near its bent ends only.
  const xAlong = pl.piece.turnDeg === 0 && W > 0 && Math.abs(dot(mul(ux, 1 / W), t1)) > 0.99;
  const fine = MESH_FINE / unit;
  // The furthest any of its art lies off its rock line: half its texture's height either side of the middle, and then some.
  const reach = bendReach(pl, H);
  const cuts = (len: number, ends: [number, number]): number[] => {
    if (!xAlong) {
      const n = Math.max(4, Math.ceil(len * fine * 0.4));
      return Array.from({ length: n + 1 }, (_, i) => i / n);
    }
    // Fine over the reach of a bend or a taper from each end that has one, coarse between.
    const out = new Set<number>([0, 1]);
    for (const [k, far] of ends.entries()) {
      const r = Math.min(len, far + 0.05 * unit);
      if (far <= 0) continue;
      const n = Math.ceil(r * fine);
      for (let i = 0; i <= n; i++) out.add(k === 0 ? (r * i) / n / len : 1 - (r * i) / n / len);
    }
    const n = Math.max(1, Math.ceil(len * MESH_COARSE));
    for (let i = 0; i <= n; i++) out.add(i / n);
    return [...out].sort((a, b) => a - b);
  };
  // Which end of the texture's width is the piece's first joint.
  const startLeft = dot(ux, t0) >= 0;
  const xs = cuts(W, startLeft ? reach : [reach[1], reach[0]]);
  const rows = xAlong ? Math.max(MESH_ROWS, Math.ceil((H / unit) * MESH_ROWS)) : Math.max(4, Math.ceil(H * fine * 0.4));
  const ys = Array.from({ length: rows + 1 }, (_, i) => i / rows);
  const positions = new Float32Array(xs.length * ys.length * 2);
  const uvs = new Float32Array(xs.length * ys.length * 2);
  let i = 0;
  for (const y of ys) {
    for (const x of xs) {
      const p = warp(add(tl, add(mul(ux, x), mul(uy, y))));
      positions[i] = p[0];
      positions[i + 1] = p[1];
      uvs[i] = x;
      uvs[i + 1] = y;
      i += 2;
    }
  }
  const cols = xs.length;
  const indices = new Uint32Array((cols - 1) * rows * 6);
  let j = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c + 1 < cols; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      indices.set([a, b, e, a, e, d], j);
      j += 6;
    }
  }
  return { positions, uvs, indices };
}
