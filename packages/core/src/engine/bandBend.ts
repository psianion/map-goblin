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
  /** On a bend: where its art ends, from the centre, that distance, and which way round is inward. */
  r0: Vec;
  r0Len: number;
  intoSign: number;
  /** The step across to the neighbour's rock line, and how far along the art's end is brought, both held. */
  step: number;
  along: number;
}

/** A piece's warp, scalar: writes where (x, y) is drawn into `out`. */
type Warp = (x: number, y: number, out: Vec) => void;

/**
 * Where each point of `pl`'s art is drawn, bent as its `bend` asks: the identity for a piece
 * with none. Points are world positions of the piece laid rigid, as its sprite would draw them.
 */
export function bendWarp(pl: WalkPlacement): (p: Vec) => Vec {
  const warp = warpOf(pl)?.at;
  if (!warp) return (p) => p;
  return (p) => {
    const out: Vec = [0, 0];
    warp(p[0], p[1], out);
    return out;
  };
}

/** A piece's warp worked out once (see {@link warpOf}): the warp, its bent ends and their zones. */
interface PieceWarp {
  at: Warp;
  ends: EndFrame[];
  /** The longest a bend zone may be, and the steepest joint's slope. */
  cap: number;
  tMax: number;
  /** The least bend zone, and how far back a tapered end narrows, at the piece's size. */
  least: number;
  taperLen: number;
  /** Where a taper narrows to when the pack measures no middle. */
  rockHalf: number;
}

/** {@link bendWarp}'s work, done once per piece; null for a piece drawn unbent. */
function warpOf(pl: WalkPlacement): PieceWarp | null {
  const bend = pl.bend;
  if (!bend || (!bend.a && !bend.b && !bend.taper?.some(Boolean))) return null;
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
    // How far in from the art's end a point of a bend lies is measured round its arc, from here.
    const r0 = centre ? sub(add(o, mul(out, artEnd)), centre) : ([0, 0] as Vec);
    const into = r0[0] * -out[1] - r0[1] * -out[0];
    ends.push({
      k,
      out,
      n,
      o,
      artEnd,
      side,
      slope: mitre ? slopes[k] : null,
      taper,
      middle: mid2 && mid2.length >= 2 ? mid2 : null,
      r0,
      r0Len: Math.hypot(r0[0], r0[1]),
      intoSign: Math.sign(into),
      step: Math.max(-STEP_MOST * unit, Math.min(STEP_MOST * unit, -side)),
      along: Math.max(-cap / 2, Math.min(cap / 2, -artEnd)),
    });
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
  const least = BEND_LEAST * unit;
  const [cx, cy] = centre ?? [0, 0];
  const at: Warp = (px, py, result) => {
    let mx = px;
    let my = py;
    for (const e of ends) {
      const rx = px - e.o[0];
      const ry = py - e.o[1];
      const s = rx * e.out[0] + ry * e.out[1];
      const w = rx * e.n[0] + ry * e.n[1];
      // How far in from the art's end: straight back along the piece, or round a bend's arc.
      let inward = e.artEnd - s;
      if (centre) {
        const vx = px - cx;
        const vy = py - cy;
        const d = e.r0[0] * vx + e.r0[1] * vy;
        // Art past the centre (none of the rock) is measured straight back, as a straight's is.
        if (d > 0) inward = e.intoSign * Math.atan2(e.r0[0] * vy - e.r0[1] * vx, d) * e.r0Len;
      }
      if (e.slope !== null) {
        // Its art's end and rock line brought onto the meeting point (the line only so far, see
        // STEP_MOST), spread back over the piece's half; then its offset from the meeting point there.
        const spread = ramp(1 - inward / cap);
        const x = w + e.step;
        // The bend zone at this offset (see `zone`), and how it ramps.
        const want = Math.max(least, BEND_PER_OFFSET * Math.abs(x) * tMax);
        const z = want <= cap ? want : cap;
        const f = (z - inward) / z;
        const bendAt = want <= cap ? smooth(f) : ramp(f);
        // Where the zone is held to the piece's half, art far off the rock line (its tile's clear
        // margin) moves no further than keeps it from folding.
        const most = (0.9 * z) / Math.max(Math.abs(e.slope), 1e-9);
        const xHeld = Math.max(-most, Math.min(most, x));
        const a = (xHeld * e.slope + overlap) * bendAt + e.along * spread;
        const b = e.step * spread;
        mx = mx + (e.out[0] * a + e.n[0] * b);
        my = my + (e.out[1] * a + e.n[1] * b);
      }
      if (e.taper && taperLen > 0) {
        const q = 1 - inward / taperLen;
        if (q > 0) {
          const c = (middleAt(e, s) - w) * (1 - taperWidth(q));
          mx = mx + e.n[0] * c;
          my = my + e.n[1] * c;
        }
      }
    }
    result[0] = mx;
    result[1] = my;
  };
  return { at, ends, cap, tMax, least, taperLen, rockHalf: bend.rockHalf };
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

/**
 * How far a cut of a bent piece's mesh may stray from its warp along one side, cells: across a
 * cell of the mesh a point of the art then lies within a hundredth of a cell of where the warp
 * puts it.
 */
const MESH_TOL = 0.003;
/** How far apart a bend's even cuts lie, cells at its size. */
const MESH_BEND_EVEN = 0.1;
/** How far either side of a step in the warp it is cut, cells at the piece's size. */
const MESH_STEP = 3e-4;
/** Cuts closer than this share of a side are one. */
const MESH_JOIN = 1e-4;

/**
 * Where a bent piece's mesh is cut, as shares of its texture's sides: only where its warp bends.
 * Along a bent end, its zone (to the end's furthest reach, see {@link zone}) is cut ever finer
 * toward the end, as the zone's ease is sharpest there (a smoothstep's curve over a zone `z` long
 * moving a point `x` off the line by `x·t`, with `z` at least 1.6·x·t: spans of √(2.13·tol·z)),
 * with a cut where its spread and its held zone have corners. Across it, only where the zone
 * grows with the offset: from where it passes the least zone out to the texture's edge, in
 * spans of √(1.33·tol·x / t), and everywhere close enough that the twist a cell's two
 * triangles cannot draw stays within the tolerance. A tapered end is cut evenly round its
 * quarter circle, finer where more art moves. A bend is cut evenly throughout as well. A
 * straight's middle, which nothing bends, is one cell.
 */
function meshCuts(warp: PieceWarp, curved: boolean, tl: Vec, ux: Vec, uy: Vec): { xs: number[]; ys: number[] } {
  const xs = [0, 1];
  const ys = [0, 1];
  const tol = MESH_TOL;
  const corners = [tl, add(tl, ux), add(tl, uy), add(add(tl, ux), uy)];
  const centre = add(tl, mul(add(ux, uy), 0.5));
  const unit = warp.least / BEND_LEAST;
  for (const e of warp.ends) {
    // The texture's side the end's run crosses, and how its inward and across read on each side.
    const alongX = Math.abs(dot(e.out, ux)) / Math.hypot(...ux) >= Math.abs(dot(e.out, uy)) / Math.hypot(...uy);
    const [along, across] = alongX ? [ux, uy] : [uy, ux];
    const [alongCuts, acrossCuts] = alongX ? [xs, ys] : [ys, xs];
    const base = sub(sub(centre, mul(along, 0.5)), e.o);
    // inward = artEnd − (base + f·along)·out; offset = (base' + f·across)·n + step.
    const s0 = dot(base, e.out);
    const dS = dot(along, e.out);
    const inwardAt = (i: number): void => {
      const f = (e.artEnd - i - s0) / dS;
      if (f > 0 && f < 1) alongCuts.push(f);
    };
    const baseAcross = sub(sub(centre, mul(across, 0.5)), e.o);
    const w0 = dot(baseAcross, e.n);
    const dW = dot(across, e.n);
    const offsetAt = (x: number): void => {
      const f = (x - e.step - w0) / dW;
      if (f > 0 && f < 1) acrossCuts.push(f);
    };
    const offsets = corners.map((p) => dot(sub(p, e.o), e.n) + e.step);
    const far = Math.max(...offsets.map(Math.abs));
    if (e.slope !== null) {
      const slope = Math.max(Math.abs(e.slope), 1e-9);
      const reach = Math.min(warp.cap, Math.max(warp.least, BEND_PER_OFFSET * far * warp.tMax));
      inwardAt(0);
      inwardAt(warp.cap);
      for (let i = 0; i < reach; ) {
        i += Math.sqrt(2.13 * tol * Math.max(i, warp.least));
        inwardAt(Math.min(i, reach));
      }
      // Across: the zone grows with the offset from where it passes the least to where it is held.
      const grows = warp.least / (BEND_PER_OFFSET * Math.max(warp.tMax, 1e-9));
      const held = warp.cap / (BEND_PER_OFFSET * Math.max(warp.tMax, 1e-9));
      const most = (0.9 * warp.cap) / slope;
      for (const sign of [-1, 1]) {
        for (const x of [grows, most]) offsetAt(sign * x);
        // Where the zone is held, its ease turns from a smoothstep to a straight ramp: the art steps
        // there, and a cut either side keeps the step to one thin row, as the warp has it.
        for (const x of [held - MESH_STEP * unit, held + MESH_STEP * unit]) offsetAt(sign * x);
        for (let x = grows; x < Math.min(far, held); ) {
          x += Math.sqrt((1.33 * tol * x) / slope);
          offsetAt(sign * Math.min(x, held));
        }
        // A cell's two triangles cannot draw a move that grows with the offset times the zone's
        // ease (x·t·r): across the whole of it, rows close enough that the twist between two of
        // them over one column's ease stays within the tolerance.
        for (let x = 0; x < far; ) {
          const z = Math.max(warp.least, Math.min(warp.cap, BEND_PER_OFFSET * x * warp.tMax));
          x += (1.83 * Math.sqrt(tol * z)) / slope;
          offsetAt(sign * x);
        }
      }
    }
    if (e.taper && warp.taperLen > 0) {
      // Round the quarter circle, as finely as the furthest art from the rock's middle asks: the
      // last span, at the tip, strays a quarter of its angle times that.
      const moved = far + (e.middle ? Math.max(...e.middle.map((m) => Math.abs(m[1]))) : warp.rockHalf);
      const steps = Math.max(4, Math.ceil(Math.PI / 2 / ((4 * tol) / Math.max(moved, 1e-9))));
      for (let k = 0; k <= steps; k++) inwardAt(warp.taperLen * (1 - Math.sin(((Math.PI / 2) * k) / steps)));
    }
  }
  // A bend's zones are read round its arc, so they cross the texture aslant: it is cut evenly
  // throughout as well.
  if (curved) {
    const step = MESH_BEND_EVEN * unit;
    for (const [cuts, side] of [
      [xs, ux],
      [ys, uy],
    ] as const) {
      const n = Math.ceil(Math.hypot(side[0], side[1]) / step);
      for (let k = 1; k < n; k++) cuts.push(k / n);
    }
  }
  const tidy = (cuts: number[]): number[] => {
    const out = [0];
    for (const c of cuts.filter((f) => f > MESH_JOIN && f < 1 - MESH_JOIN).sort((a, b) => a - b)) if (c - out[out.length - 1] > MESH_JOIN) out.push(c);
    out.push(1);
    return out;
  };
  return { xs: tidy(xs), ys: tidy(ys) };
}

/**
 * The mesh a bent piece is drawn as: its art's rectangle (its four corners from the top left
 * round, in world units) cut where its warp bends (see {@link meshCuts}), each point bent by
 * {@link bendWarp}, with the texture's own corners as uvs.
 */
export function bentMesh(pl: WalkPlacement, corners: [Vec, Vec, Vec, Vec]): { positions: Float32Array; uvs: Float32Array; indices: Uint32Array } {
  const warp = warpOf(pl);
  const [tl, tr, , bl] = corners;
  const ux = sub(tr, tl);
  const uy = sub(bl, tl);
  const pm: Vec = [0, 0];
  const at = (x: number, y: number, o: Vec): void => {
    const px = tl[0] + ux[0] * x + uy[0] * y;
    const py = tl[1] + ux[1] * x + uy[1] * y;
    if (warp) warp.at(px, py, o);
    else {
      o[0] = px;
      o[1] = py;
    }
  };
  const { xs, ys } = warp ? meshCuts(warp, pl.piece.turnDeg !== 0, tl, ux, uy) : { xs: [0, 1], ys: [0, 1] };
  const positions = new Float32Array(xs.length * ys.length * 2);
  const uvs = new Float32Array(xs.length * ys.length * 2);
  let i = 0;
  for (const y of ys) {
    for (const x of xs) {
      at(x, y, pm);
      positions[i] = pm[0];
      positions[i + 1] = pm[1];
      uvs[i] = x;
      uvs[i + 1] = y;
      i += 2;
    }
  }
  const cols = xs.length;
  const rows = ys.length - 1;
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
