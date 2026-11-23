// src/testing/bandChecks.ts
//
// Test-only: what a measured kit's rock is held to on a real map, measured on one ring.
// The rock's line is each piece's own: its spine where it carries one, else its joint
// line bowed as a bend's arc and moved SEAT_IN to the floor side, both cut to where the
// art ends (half the kit's overlap in from each joint).

import { jointsOf, kitRockWidth } from '../assets/caveWallKit';
import { bandBends, SEAT_IN, seatLine } from '../engine/caveBandRenderer';
import { endTangents, unbend } from '../engine/bandBend';
import type { WalkPlacement } from '../engine/caveWalk';
import { ledgeRuns } from '../engine/plateauRenderer';
import type { DoorGap } from '../engine/wallNodeRenderer';
import type { Polygon } from '../types/geometry';

type V = [number, number];

/** The rules, by number, and what each allows. */
export const BAND_RULES = {
  /** 1: every point of the drawn edge outside an opening has rock within this. */
  bareReach: 0.5,
  /** 3: no rock further than this from the drawn edge. */
  strayReach: 0.8,
  /** 4: stretches of edge facing each other this close keep a clear disc this wide between their rock. */
  corridor: 2,
  corridorClear: 1,
  /** 5: the painted floor's edge and the rock's line within this of each other, and no turn of the floor's edge sharper than this, degrees. */
  floorReach: 0.2,
  spikeTurn: 120,
  /** How far past an opening's pad the floor's step from the drawn edge over to the rock is left alone. */
  padStep: 0.25,
  /** 6: every piece between these shares of its drawn size, at the size its stretch was laid at. */
  scale: [0.85, 1.25] as [number, number],
  /** 7: the rock line moved this share of the rock's width to the void side lies under rock everywhere. */
  rim: 0.4,
};

/** What one ring's rock measured. Lengths in cells at size 1. */
export interface BandCheck {
  /** 1: length of drawn edge with no rock within `bareReach`, and the worst point's distance. */
  bare: number;
  worstBare: number;
  worstBareAt: V | null;
  /** 2: rock line points inside an opening. */
  inOpening: number;
  inOpeningAt: V | null;
  /** 3: the furthest any rock lies from the drawn edge. */
  stray: number;
  strayAt: V | null;
  /** 4: the narrowest clear width between facing rock (Infinity where no stretches face). */
  corridor: number;
  corridorAt: V | null;
  /** 5: the furthest the floor's edge lies past the rock's line, or rock off the floor from its edge; and the spikes in the floor's edge. */
  floorOff: number;
  floorOffAt: V | null;
  spikes: number;
  spikeAt: V | null;
  /** 6: the smallest and largest piece, as a share of its drawn size. */
  scale: [number, number];
  /** 7: length of the rim (see BAND_RULES.rim) under no piece's body and no connector, and the first such point. */
  bareRim: number;
  bareRimAt: V | null;
}

/** Which rules a check breaks, by number. */
export function brokenRules(c: BandCheck): number[] {
  const out: number[] = [];
  if (c.bare > 1e-9) out.push(1);
  if (c.inOpening > 0) out.push(2);
  if (c.stray > BAND_RULES.strayReach) out.push(3);
  if (c.corridor < BAND_RULES.corridorClear) out.push(4);
  if (c.floorOff > BAND_RULES.floorReach || c.spikes > 0) out.push(5);
  if (c.scale[0] < BAND_RULES.scale[0] - 1e-6 || c.scale[1] > BAND_RULES.scale[1] + 1e-6) out.push(6);
  if (c.bareRim > 1e-9) out.push(7);
  return out;
}

const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]];
const mul = (a: V, s: number): V => [a[0] * s, a[1] * s];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1];
const cross = (a: V, b: V): number => a[0] * b[1] - a[1] * b[0];
const len = (a: V): number => Math.hypot(a[0], a[1]);

function segDist(p: V, a: V, b: V): number {
  const v = sub(b, a);
  const L2 = dot(v, v);
  const t = L2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), v) / L2)) : 0;
  return len(sub(p, add(a, mul(v, t))));
}

function lineDist(p: V, pts: V[], closed: boolean): number {
  let d = Infinity;
  for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) d = Math.min(d, segDist(p, pts[i], pts[(i + 1) % pts.length]));
  return d;
}

function inside([x, y]: V, rings: Polygon[]): boolean {
  let hit = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i];
      const [xj, yj] = r[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}

/** Points every `step` along a polyline. */
function sample(pts: V[], closed: boolean, step: number): V[] {
  const out: V[] = [];
  for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const L = len(sub(b, a));
    for (let s = 0; s < L; s += step) out.push(add(a, mul(sub(b, a), s / L)));
  }
  if (!closed && pts.length > 0) out.push(pts[pts.length - 1]);
  return out;
}

/** One piece's rock line, cut to its art (see the file header). */
export function pieceRockLine(pl: WalkPlacement, overlap: number): V[] {
  const half = (overlap / 2) * pl.at.scale;
  const c = Math.cos(pl.at.rotation);
  const s = Math.sin(pl.at.rotation);
  const [J0, J1] = jointsOf(pl.piece, pl.at) as [V, V];
  const v = sub(J1, J0);
  const L = len(v);
  if (L < 1e-9) return [];
  if (pl.piece.spine) {
    // A spine is drawn to the art's own ends already.
    return pl.piece.spine.map(([x, y]): V => [pl.at.position.x + (x * c - y * s) * pl.at.scale, pl.at.position.y + (x * s + y * c) * pl.at.scale]);
  }
  const right: V = [-v[1] / L, v[0] / L];
  const phi = (Math.abs(pl.piece.turnDeg) * Math.PI) / 360;
  const R = phi > 1e-4 ? L / (2 * Math.sin(phi)) : 0;
  const sgn = -Math.sign(pl.piece.turnDeg);
  const seat = SEAT_IN * pl.at.scale;
  const u0 = Math.min(0.5, half / L);
  const out: V[] = [];
  const steps = Math.max(2, Math.ceil(L / 0.1));
  for (let k = 0; k <= steps; k++) {
    const u = u0 + ((1 - 2 * u0) * k) / steps;
    const bow = R ? sgn * R * (Math.cos(phi * (2 * u - 1)) - Math.cos(phi)) : 0;
    out.push(add(add(J0, mul(v, u)), mul(right, bow + seat)));
  }
  return out;
}

/**
 * A piece's rock line (see {@link pieceRockLine}) carried on, at each end bent to meet its
 * neighbour, to exactly where its art ends: that end is drawn onto the line it meets the
 * neighbour on, so its rock reaches all the way there.
 */
function bentRockLine(pl: WalkPlacement, overlap: number): V[] {
  const line = pieceRockLine(pl, overlap);
  if (!pl.bend || line.length < 2) return line;
  const [J0, J1] = jointsOf(pl.piece, pl.at) as [V, V];
  const [t0, t1] = endTangents(pl);
  const half = (overlap / 2) * pl.at.scale;
  const out = [...line];
  if (pl.bend.a) {
    const short = dot(sub(out[0], add(J0, mul(t0, half))), t0);
    if (short > 1e-6) out.unshift(sub(out[0], mul(t0, short)));
  }
  if (pl.bend.b) {
    const last = out[out.length - 1];
    const short = dot(sub(sub(J1, mul(t1, half)), last), t1);
    if (short > 1e-6) out.push(add(last, mul(t1, short)));
  }
  return out;
}

export interface BandCheckInput {
  /** The drawn edge, wound void-left. */
  ring: Polygon;
  /** False for an open run (a cliff's stretch off the walls): the edge does not close. */
  closed?: boolean;
  placed: WalkPlacement[];
  /** The connectors laid over its joints (`bandConnectors`). */
  connectors?: WalkPlacement[];
  /** The ring's door and erased gaps. */
  gaps: DoorGap[];
  /** The layer's erased regions. */
  openings?: readonly Polygon[];
  /** The floor as painted, fitted to the rock; omitted to skip rule 5. */
  floor?: Polygon[];
  /** The size the rock was laid at; distances are judged in cells at size 1. */
  size: number;
  /** The kit's overlap at a joint. */
  overlap: number;
  /** How far past an opening's half-width the floor keeps to the drawn edge (rule 5 leaves that alone). */
  doorPad: number;
}

/** Distance from `p` to the line `pts` cut square at its two ends: Infinity past either end. */
function bodyDist(p: V, pts: V[]): number {
  let d = Infinity;
  const last = pts.length - 2;
  for (let i = 0; i <= last; i++) {
    const a = pts[i];
    const v = sub(pts[i + 1], a);
    const L2 = dot(v, v);
    if (L2 <= 0) continue;
    const t = dot(sub(p, a), v) / L2;
    if ((i === 0 && t < -1e-9) || (i === last && t > 1 + 1e-9)) continue;
    d = Math.min(d, len(sub(p, add(a, mul(v, Math.max(0, Math.min(1, t)))))));
  }
  return d;
}

/**
 * Rule 7 on one run of rock: its rock line moved `shift` to the void side (the left of
 * travel), round each bend of the line as well as along it, lies inside some piece's body
 * (`bodies`, each widened by `half`, square at its ends) or some connector (`discs`). An
 * open run's first and last `trim` are left alone (past its art's ends), and so is any
 * point `skip` says lies in an opening.
 */
function bareRimOf(
  line: V[],
  closed: boolean,
  shift: number,
  half: number,
  trim: number,
  bodies: { pl: WalkPlacement; line: V[]; joints: [V, V] }[],
  discs: { c: V; r: number }[],
  skip: (p: V) => boolean,
): { bare: number; at: V | null } {
  const step = 0.05;
  const under = (q: V, b: { pl: WalkPlacement; line: V[]; joints: [V, V] }): boolean => {
    // Only a piece whose joints lie within reach can cover the point.
    if (segDist(q, b.joints[0], b.joints[1]) > half + 1.5 * b.pl.at.scale) return false;
    return bodyDist(b.pl.bend ? (unbend(b.pl, q) as V) : q, b.line) <= half + 1e-6;
  };
  const covered = (q: V): boolean => discs.some((d) => len(sub(q, d.c)) <= d.r + 1e-6) || bodies.some((b) => under(q, b));
  const n = line.length;
  const segs = closed ? n : n - 1;
  const cum = [0];
  for (let i = 0; i < segs; i++) cum.push(cum[i] + len(sub(line[(i + 1) % n], line[i])));
  const total = cum[segs];
  let bare = 0;
  let at: V | null = null;
  const test = (p: V, q: V, s: number, w: number): void => {
    if (!closed && (s < trim || s > total - trim)) return;
    if (skip(p) || covered(q)) return;
    bare += w;
    at ??= q;
  };
  const leftOf = (i: number): V | null => {
    const v = sub(line[(i + 1) % n], line[i]);
    const L = len(v);
    return L < 1e-9 ? null : [v[1] / L, -v[0] / L];
  };
  for (let i = 0; i < segs; i++) {
    const a = line[i];
    const nl = leftOf(i);
    if (!nl) continue;
    const L = cum[i + 1] - cum[i];
    const t = mul(sub(line[(i + 1) % n], a), 1 / L);
    for (let s = 0; s < L; s += step) {
      const p = add(a, mul(t, s));
      test(p, add(p, mul(nl, shift)), cum[i] + s, step);
    }
    // Round the bend into the next segment: the wedge a joint opens lies there.
    const j = i + 1;
    if (j >= segs && !closed) continue;
    const next = leftOf(j % segs);
    if (!next) continue;
    const turn = Math.atan2(cross(nl, next), dot(nl, next));
    const k = Math.ceil(Math.abs(turn) / (step / shift));
    const p = line[j % n];
    for (let m = 1; m < k; m++) {
      const ang = (turn * m) / k;
      const dir: V = [nl[0] * Math.cos(ang) - nl[1] * Math.sin(ang), nl[0] * Math.sin(ang) + nl[1] * Math.cos(ang)];
      test(p, add(p, mul(dir, shift)), cum[j], (Math.abs(turn) * shift) / k);
    }
  }
  return { bare, at };
}

/** Measure one ring's rock against the seven rules. */
export function checkBand(input: BandCheckInput): BandCheck {
  const { placed, gaps, size } = input;
  const closedEdge = input.closed ?? true;
  const ring = input.ring.map(([x, y]): V => [x, y]);
  const openings = input.openings ?? [];
  const lines = placed.map((pl) => pieceRockLine(pl, input.overlap)).filter((l) => l.length > 1);
  const rockPts = lines.flatMap((l) => sample(l, false, 0.05));
  const rockDist = (p: V): number => Math.min(Infinity, ...lines.map((l) => lineDist(p, l, false)));
  // Each gap's direction along the edge it lies on.
  const gapDir = gaps.map((g) => {
    let best = { d: Infinity, t: [1, 0] as V };
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const d = segDist(g.position as V, a, b);
      if (d < best.d) best = { d, t: mul(sub(b, a), 1 / len(sub(b, a))) };
    }
    return best.t;
  });
  const nearGap = (p: V, pad: number): boolean =>
    gaps.some((g) => len(sub(p, g.position as V)) <= g.width / 2 + pad) || openings.some((o) => inside(p, [o]) || lineDist(p, o as V[], true) < pad);

  // 1: bare wall.
  const step = 0.05;
  let bare = 0;
  let worstBare = 0;
  let worstBareAt: V | null = null;
  const edgePts = sample(ring, closedEdge, step);
  for (const p of edgePts) {
    if (nearGap(p, 0.02)) continue;
    const d = rockDist(p) / size;
    if (d > BAND_RULES.bareReach) bare += step;
    if (d > worstBare) [worstBare, worstBareAt] = [d, p];
  }

  // 2: rock in an opening: a door's span, a cell either side of the edge, or an erased region.
  // A gap on an erased region's edge is that region's, and the region is what is open.
  const erased = gaps.map((g) => openings.some((o) => inside(g.position as V, [o]) || lineDist(g.position as V, o as V[], true) <= 0.06));
  let inOpening = 0;
  let inOpeningAt: V | null = null;
  for (const p of rockPts) {
    const inDoor = gaps.some((g, k) => {
      if (erased[k]) return false;
      const w = sub(p, g.position as V);
      return Math.abs(dot(w, gapDir[k])) < g.width / 2 - 0.02 && Math.abs(cross(gapDir[k], w)) <= 1;
    });
    const inErase = openings.some((o) => inside(p, [o]) && lineDist(p, o as V[], true) > 0.05);
    if (inDoor || inErase) {
      inOpening++;
      inOpeningAt ??= p;
    }
  }

  // 3: rock strays from the edge.
  let stray = 0;
  let strayAt: V | null = null;
  for (const p of rockPts) {
    const d = lineDist(p, ring, closedEdge) / size;
    if (d > stray) [stray, strayAt] = [d, p];
  }

  // 4: corridors. From each point of edge, straight across the floor to the edge facing it.
  let corridor = Infinity;
  let corridorAt: V | null = null;
  const edges = ring.length - (closedEdge ? 0 : 1);
  for (let i = 0; i < edges; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const L = len(sub(b, a));
    if (L < 1e-9) continue;
    const t = mul(sub(b, a), 1 / L);
    const n: V = [-t[1], t[0]];
    for (let s = step / 2; s < L; s += step) {
      const e = add(a, mul(t, s));
      if (nearGap(e, 0.02)) continue;
      // The nearest edge straight across, and whether it faces back (a corridor's far side).
      let hit = Infinity;
      let facing = false;
      for (let j = 0; j < edges; j++) {
        if (j === i) continue;
        const c = ring[j];
        const d = ring[(j + 1) % ring.length];
        const f = sub(d, c);
        const den = cross(n, f);
        if (Math.abs(den) < 1e-12) continue;
        const r = cross(sub(c, e), f) / den;
        const q = cross(sub(c, e), n) / den;
        if (r <= 1e-6 || q < 0 || q > 1) continue;
        const fn: V = [-f[1] / len(f), f[0] / len(f)];
        if (r < hit) [hit, facing] = [r, dot(fn, n) < -0.5];
      }
      if (!facing || hit > BAND_RULES.corridor * size) continue;
      const m = add(e, mul(n, hit / 2));
      const clear = (2 * rockDist(m)) / size;
      if (clear < corridor) [corridor, corridorAt] = [clear, m];
    }
  }

  // 5: the floor meets the rock, along the wall away from its openings.
  let floorOff = 0;
  let floorOffAt: V | null = null;
  let spikes = 0;
  let spikeAt: V | null = null;
  if (input.floor) {
    const boundary = input.floor.map((r) => r.map(([x, y]): V => [x, y]));
    // Beside an opening the floor keeps to the drawn edge, and steps over to the rock where that ends.
    const pad = (input.doorPad + BAND_RULES.padStep) * size;
    const floorDist = (p: V): number => Math.min(Infinity, ...boundary.map((r) => lineDist(p, r, true)));
    // The rock's seat: the line its pieces seat on, chained in walk order.
    const seat = seatLine(placed, true) as V[];
    // Ground between the floor and the rock: the seat away from the floor's edge.
    for (const p of sample(seat, true, step)) {
      if (nearGap(p, pad)) continue;
      const d = floorDist(p) / size;
      if (d > floorOff) [floorOff, floorOffAt] = [d, p];
    }
    // Floor past the rock: the floor's edge away from the seat.
    for (const r of boundary) {
      for (const p of sample(r, true, step)) {
        if (nearGap(p, pad) || lineDist(p, ring, true) > 1.5 * size) continue;
        const d = lineDist(p, seat, true) / size;
        if (d > floorOff) [floorOff, floorOffAt] = [d, p];
      }
    }
    // A spike at a joint: the seat the floor is fitted to turning back on itself, sharper than
    // any corner it follows, read across a tenth of a cell either side so a wrinkle smaller
    // than that is none.
    {
      const pts = sample(seat, true, step);
      const n = pts.length;
      let inSpike = false;
      for (let i = 0; i < n; i++) {
        const p = pts[i];
        const a = sub(p, pts[(i - 2 + n) % n]);
        const b = sub(pts[(i + 2) % n], p);
        const turn = len(a) < 1e-6 || len(b) < 1e-6 ? 0 : (Math.abs(Math.atan2(cross(a, b), dot(a, b))) * 180) / Math.PI;
        const sharp = turn > BAND_RULES.spikeTurn && !nearGap(p, pad) && lineDist(p, ring, true) <= 1.5 * size;
        if (sharp && !inSpike) {
          spikes++;
          spikeAt ??= p;
        }
        inSpike = sharp;
      }
    }
  }

  // 7: no wedge at a joint. The rock is the kit's rock width wide at its size, each piece's body
  // its rock line widened by half that, cut square where its art ends, and bent as it is drawn
  // where it meets a neighbour (bandBends): a point is under it where it lies under the piece
  // laid rigid once unbent.
  const set = placed.map((pl) => pl.piece);
  const width = kitRockWidth(set) * size;
  const discs = (input.connectors ?? []).map((pl) => ({ c: jointsOf(pl.piece, pl.at)[0] as V, r: (pl.piece.radius ?? 0) * pl.at.scale }));
  const bodies = bandBends(placed, set, size)
    .map((pl) => ({ pl, line: bentRockLine(pl, input.overlap), joints: jointsOf(pl.piece, pl.at) as [V, V] }))
    .filter((b) => b.line.length > 1);
  let bareRim = 0;
  let bareRimAt: V | null = null;
  for (const { run, open } of ledgeRuns(placed, closedEdge)) {
    const line = seatLine(run, !open) as V[];
    if (line.length < 2) continue;
    const trim = (input.overlap / 2) * size * BAND_RULES.scale[1];
    const r = bareRimOf(line, !open, BAND_RULES.rim * width, width / 2, trim, bodies, discs, (p) => nearGap(p, 0.02));
    bareRim += r.bare;
    bareRimAt ??= r.at;
  }

  // A piece of a narrow passage is held to the size its stretch was laid at.
  const scales = placed.map((pl) => pl.at.scale / (pl.size ?? size));
  return {
    bare,
    worstBare,
    worstBareAt,
    inOpening,
    inOpeningAt,
    stray,
    strayAt,
    corridor,
    corridorAt,
    floorOff,
    floorOffAt,
    spikes,
    spikeAt,
    scale: scales.length ? [Math.min(...scales), Math.max(...scales)] : [1, 1],
    bareRim,
    bareRimAt,
  };
}
