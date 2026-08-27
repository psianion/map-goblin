// Chord-walking a curve with the measured cave kit.
//
// One copy, shared by `scripts/gen-goblin-warren.mjs` (which lays the whole ring
// in one pass) and the band editor (which re-lays one stretch when a joint is
// dragged). Separate copies would drift, and an edited stretch would slowly stop
// matching the stretch beside it — the same reason the kit MEASUREMENTS moved to
// `../assets/caveWallKit.ts`.
//
// Pure geometry: no Pixi, no store, no pack. A piece is a measurement
// (`CaveKitPiece`) and the walk answers with placements (`KitPlacement`);
// turning a placement into an asset child is the caller's business, because the
// generator wants a `.mapbuilder` object and the editor wants a store command.
//
// The numbers in here were tuned against the shipped Goblin Warren. Changing one
// re-lays the whole cave, so treat them as measurements, not preferences.

import type { CaveKitPiece, KitPlacement } from '../assets/caveWallKit';

export type Vec = [number, number];
/** A densely and evenly sampled closed curve. Index arithmetic wraps modulo length. */
export type Curve = Vec[];

const add = (p: Vec, q: Vec): Vec => [p[0] + q[0], p[1] + q[1]];
const sub = (p: Vec, q: Vec): Vec => [p[0] - q[0], p[1] - q[1]];
const mul = (p: Vec, s: number): Vec => [p[0] * s, p[1] * s];
const len = (p: Vec): number => Math.hypot(p[0], p[1]);
const dist = (p: Vec, q: Vec): number => Math.hypot(p[0] - q[0], p[1] - q[1]);
const norm = (p: Vec): Vec => {
  const l = len(p) || 1;
  return [p[0] / l, p[1] / l];
};
const cross = (a: Vec, b: Vec): number => a[0] * b[1] - a[1] * b[0];
const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1];
const rot2 = (p: Vec, t: number): Vec => [
  p[0] * Math.cos(t) - p[1] * Math.sin(t),
  p[0] * Math.sin(t) + p[1] * Math.cos(t),
];
/** signed turn a→b in degrees; positive = clockwise in y-down screen space */
const turnDeg = (a: Vec, b: Vec): number => (Math.atan2(cross(a, b), dot(a, b)) * 180) / Math.PI;

/** How far the band is shoved toward the void, past the curve it rides. */
export const BAND_OUT = 0.18;
/** The designed overlap at a joint: each piece runs this far past its successor's start. */
export const BAND_OVERLAP = 0.3;
/** How far a piece may sit off the curve it spans, after the sideways nudge. */
export const BAND_FIT = 0.22;

/** Re-sample a closed polyline at an even spacing `h`. */
export function resampleClosed(pts: Curve, h: number): Curve {
  const out: Curve = [];
  let carry = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i],
      b = pts[(i + 1) % pts.length];
    const L = dist(a, b);
    if (L < 1e-9) continue;
    const d = norm(sub(b, a));
    for (let s = carry; s < L; s += h) out.push(add(a, mul(d, s)));
    carry = (((carry - L) % h) + h) % h;
  }
  return out;
}

/** Unit direction of travel at index `i`, measured across a four-sample window. */
export function tangentAt(curve: Curve, i: number): Vec {
  const n = curve.length;
  const a = curve[(Math.round(i) - 2 + n * 2) % n];
  const b = curve[(Math.round(i) + 2) % n];
  return norm(sub(b, a));
}

/**
 * Push a closed curve `d` cells toward the void (the left of travel). The band
 * rides this instead of the floor edge: the kit puts the floor edge at the
 * rock's inner lip, and offsetting the CURVE (rather than each piece) keeps
 * neighbours sharing a joint, so a convex turn does not open a white wedge.
 */
export function offsetCurve(curve: Curve, d: number): Curve {
  const step = dist(curve[0], curve[1]) || 0.1;
  const out = curve.map((p, i) => {
    const t = tangentAt(curve, i);
    return add(p, mul([t[1], -t[0]], d));
  });
  return resampleClosed(out, step);
}

/** Where a chord probe landed: the point, its fractional index, and the samples spanned. */
export interface ChordHit {
  p: Vec;
  i: number;
  span: number;
}

/** first point at chord distance `c` from curve[i0], walking forward */
export function chordPoint(curve: Curve, i0: number, c: number, maxSpan: number): ChordHit | null {
  const n = curve.length;
  const P = curve[Math.round(i0) % n];
  let prev = P;
  for (let k = 1; k <= maxSpan; k++) {
    const q = curve[(Math.round(i0) + k) % n];
    const d = dist(P, q);
    if (d >= c) {
      const dPrev = dist(P, prev);
      const u = d > dPrev ? (c - dPrev) / (d - dPrev) : 0;
      return { p: add(prev, mul(sub(q, prev), u)), i: Math.round(i0) + k - 1 + u, span: k };
    }
    prev = q;
  }
  return null;
}

/** How badly a piece misses the curve it would span, and the sideways nudge that minimises it. */
export interface ArcFit {
  miss: number;
  nudge: number;
}

/**
 * How well a piece's own arc can be made to lie on the curve between P and Q,
 * and by how much it has to be nudged sideways to get there.
 *
 * Comparing the two arcs' worst deviation is too strict: a straight laid across
 * a gentle curve is off by the full sagitta at the middle and by nothing at the
 * ends, but slide it half a sagitta toward the floor and the error halves and
 * splits either side. So take the residual's HALF-RANGE as the fit and its
 * midpoint as the nudge. That is what lets 4-cell pieces onto a lobe at all —
 * without it the whole ring comes out as a picket fence of 2-cell stones.
 */
export function fitArc(
  curve: Curve,
  i0: number,
  i1: number,
  P: Vec,
  Q: Vec,
  piece: CaveKitPiece,
): ArcFit {
  const n = curve.length;
  const v = sub(Q, P),
    L = len(v) || 1;
  const phi = (Math.abs(piece.turnDeg) * Math.PI) / 360;
  const R = phi > 1e-4 ? L / (2 * Math.sin(phi)) : 0;
  const sgn = -Math.sign(piece.turnDeg);
  let lo = Infinity,
    hi = -Infinity;
  for (let k = Math.ceil(i0); k <= Math.floor(i1); k++) {
    const w = sub(curve[k % n], P);
    const u = Math.max(0, Math.min(1, dot(w, v) / (L * L)));
    // the piece's own arc, sampled at the same point along the chord
    const own = R ? sgn * R * (Math.cos(phi * (2 * u - 1)) - Math.cos(phi)) : 0;
    const r = cross(v, w) / L - own;
    if (r < lo) lo = r;
    if (r > hi) hi = r;
  }
  if (lo === Infinity) return { miss: 0, nudge: 0 };
  return { miss: (hi - lo) / 2, nudge: (hi + lo) / 2 };
}

/**
 * Map a piece so its joint0 lands on P and joint1 on Q, then push it `out`
 * cells toward the void. The joints sit on the art's midline, but the kit's own
 * maps put the floor edge at the ROCK's inner edge with only the loose pebbles
 * spilling indoors — that split is ~0.2 cells off the midline.
 *
 * The unnudged, unshoved case is {@link placeOnChord} in caveWallKit.ts; this is
 * the same mapping with the band's two offsets applied.
 */
export function placePiece(
  piece: CaveKitPiece,
  P: Vec,
  Q: Vec,
  out = 0,
  overlap = 0,
  nudge = 0,
): KitPlacement {
  const [J0, J1] = piece.jointsCells;
  const natural = sub(J1, J0);
  const target = sub(Q, P);
  // Run each piece a hair past its joint. The art is cut flat at the tile edge,
  // so two neighbours meeting at an angle otherwise show that straight cut as a
  // seam across the rock — a sliver of overlap hides it without doubling ink.
  const s = (len(target) + overlap) / len(natural);
  const th = Math.atan2(target[1], target[0]) - Math.atan2(natural[1], natural[0]);
  // Both offsets are perpendicular to the chord, measured the way `fitArc` does:
  // positive is the right of travel, which is the floor side. `out` is the fixed
  // shove toward the void; `nudge` is what fitArc worked out this particular
  // piece needs sideways to sit centred on the curve it spans. Taking them off
  // the chord rather than the art's local axes keeps bends honest too.
  const dir = norm(target);
  const right: Vec = [-dir[1], dir[0]];
  const centre = add(sub(P, mul(rot2(J0, th), s)), mul(right, nudge - out));
  return {
    position: { x: centre[0], y: centre[1] },
    rotation: th,
    scale: s,
    flipY: piece.flipY ?? false,
  };
}

const idOf = (p: CaveKitPiece): string => p.key + (p.flipY ? '~' : '');
// Stable tiebreak: the walk is re-run while the closure factor is searched, so a
// live PRNG draw here would reshuffle the choice every pass and never converge.
const jitter = (i: number, piece: CaveKitPiece): number => {
  const key = piece.key + (piece.flipY ? 'm' : '');
  let h = (0x9e3779b9 ^ Math.round(i)) >>> 0;
  for (let c = 0; c < key.length; c++) h = Math.imul(h ^ key.charCodeAt(c), 0x01000193);
  return ((h >>> 0) / 4294967296) * 1.8;
};

/** One piece the walk laid, plus where it landed. */
export interface WalkPlacement {
  piece: CaveKitPiece;
  /** The chord the piece was mapped onto: joint0 on P, joint1 on Q. */
  P: Vec;
  Q: Vec;
  /** Fractional curve index the piece starts at. */
  i: number;
  /** The sideways offset fitArc asked for. */
  nudge: number;
  /** Which arm of the walk produced it — `walk`, `fallback`, or one of the closing moves. */
  branch: string;
  /** Closing pieces only: the uniform scale closure needed. */
  stretch?: number;
  /** Where the piece sits, with BAND_OUT and the nudge applied. */
  at: KitPlacement;
}

/** A joint the walk failed to cover: rock that was never laid. */
export interface BandHole {
  k: number;
  gap: string;
  at: string;
  from: string;
  to: string;
}

export interface WalkResult {
  placed: WalkPlacement[];
  holes: BandHole[];
  /** The closing piece's scale — 1 when the ring came out even on its own. */
  stretch: number;
}

/**
 * One pass along a stretch of curve, laying pieces from `set` end to end.
 *
 * `i0` and `i1` are curve indices and may run past the end of the array: every
 * index here wraps modulo the curve, so a span that crosses the seam of a closed
 * ring is simply a span whose `i1` is the larger number. {@link walkClosed} is
 * this walk with the whole ring as its span, and the band editor re-lays one
 * dragged stretch with the same call — that shared body is the point, because
 * two copies would let an edited stretch drift away from the one beside it.
 *
 * The curve is expected to be the band's own ride line — `offsetCurve(floor,
 * BAND_OUT)` — and the placements come back with BAND_OUT re-applied, so the
 * rock straddles the floor edge instead of sitting on it.
 */
export function walkSpan(
  curve: Curve,
  set: CaveKitPiece[],
  i0: number,
  i1: number,
  opts: { close?: boolean; ring?: boolean } = {},
): WalkResult {
  const n = curve.length;
  // A free end has nothing to close onto (an open band's tip simply moves), so
  // the walk stops once it has covered the span and the last piece lands where
  // its own chord takes it.
  const close = opts.close ?? true;
  const straights = set.filter((p) => p.turnDeg === 0);
  const spacing = dist(curve[0], curve[1]) || 0.1;
  const maxChord = Math.max(...set.map((p) => p.chordCells));
  const home = curve[Math.round(i1) % n];
  const laid: Omit<WalkPlacement, 'at'>[] = [];
  const used = new Map<string, number>();
  let lastId: string | null = null,
    runLen = 0;
  let i = i0,
    guard = 0;
  for (;;) {
    if (guard++ > 3000) throw new Error('band walk did not close');
    let P = curve[Math.round(i) % n];
    if (!close) {
      if (i >= i1) break;
      // Closing move: rather than rescaling the whole run to make it come out
      // even, spend the last stretch on ONE piece stretched onto the end point.
    } else if ((i1 - i) * spacing <= maxChord * 1.05) {
      let need = dist(P, home);
      if (need < 0.9 && laid.length) {
        const last = laid.pop()!;
        P = last.P;
        i = last.i;
        need = dist(P, home);
      }
      // Scale is uniform, so a stretched piece is also a THICKER piece — past
      // about ±12% it reads as a different wall from its neighbours. Split the
      // closing run in two before letting one piece stretch that far.
      const fit = (
        A: Vec,
        iA: number,
        B: Vec,
        iB: number,
      ): { piece: CaveKitPiece; sc: number; s: number; nudge: number } | null => {
        const d = dist(A, B);
        let bestC: { piece: CaveKitPiece; sc: number; s: number; nudge: number } | null = null;
        for (const piece of set) {
          const f = fitArc(curve, iA, iB, A, B, piece);
          // the closing piece answers to the same shape gate as every other one:
          // without it a 90° bend lands on a dead straight run and reads as a hinge
          if (f.miss > BAND_FIT) continue;
          const sc = Math.abs(Math.log(d / piece.chordCells)) * 9 + f.miss * 4;
          if (!bestC || sc < bestC.sc)
            bestC = { piece, sc, s: d / piece.chordCells, nudge: f.nudge };
        }
        return bestC;
      };
      const one = fit(P, i, home, i1);
      if (!one || one.s > 1.12 || one.s < 0.88) {
        const midI = (i + i1) / 2;
        const M = curve[Math.round(midI) % n];
        const a = fit(P, i, M, midI),
          b = fit(M, midI, home, i1);
        if (a) laid.push({ piece: a.piece, P, Q: M, i, stretch: a.s, nudge: a.nudge, branch: 'close-a' });
        if (b)
          laid.push({ piece: b.piece, P: M, Q: home, i: midI, stretch: b.s, nudge: b.nudge, branch: 'close-b' });
        if (!a && !b && one)
          laid.push({ piece: one.piece, P, Q: home, i, stretch: one.s, nudge: one.nudge, branch: 'close-one' });
      } else {
        laid.push({ piece: one.piece, P, Q: home, i, stretch: one.s, nudge: one.nudge, branch: 'close-single' });
      }
      break;
    }
    let best: {
      piece: CaveKitPiece;
      hit: ChordHit;
      score: number;
      nudge: number;
      branch?: string;
    } | null = null;
    for (const piece of set) {
      // three of the same stone in a row is where a wall stops reading as rock
      // and starts reading as fence posts
      if (runLen >= 3 && piece.key === lastId) continue;
      const hit = chordPoint(curve, i, piece.chordCells, Math.ceil((piece.chordCells * 2.4) / spacing));
      if (!hit) continue;
      // Shape fit alone is not enough to choose the family. The sideways nudge
      // will happily sit a 90° bend on a 50° curve at a respectable error, and
      // it reads as a hinge. A bend is for a real corner; a straight is for a
      // run that barely turns; the band in between belongs to neither.
      const turn = turnDeg(tangentAt(curve, i), tangentAt(curve, hit.i));
      if (
        piece.turnDeg === 0
          ? Math.abs(turn) > 35
          : Math.abs(turn) < 45 || Math.sign(turn) !== Math.sign(piece.turnDeg)
      )
        continue;
      const f = fitArc(curve, i, hit.i, P, hit.p, piece);
      if (f.miss > BAND_FIT) continue;
      // longest acceptable piece wins (a run of 2s where a 4 fits reads chopped);
      // the share term pushes back on whichever id is running away with the ring,
      // and the jitter breaks ties so mirrors and lengths alternate
      const share = (used.get(idOf(piece)) ?? 0) / Math.max(6, laid.length);
      const score = f.miss * 4 - 6 * piece.chordCells + share * 9 + jitter(i, piece);
      if (!best || score < best.score) best = { piece, hit, score, nudge: f.nudge };
    }
    if (!best) {
      // nothing fits the local bow — take the shortest straight and let the
      // next step recover rather than stalling the walk
      // the fallback answers to the repetition cap too, or a hard stretch of
      // curve quietly lays eight identical stones in a row
      const pool = runLen >= 3 ? straights.filter((x) => x.key !== lastId) : straights;
      const piece = (pool.length ? pool : straights).reduce((a, b) =>
        b.chordCells < a.chordCells ? b : a,
      );
      const hit = chordPoint(curve, i, piece.chordCells, Math.ceil((piece.chordCells * 3) / spacing));
      if (!hit) break;
      // `score` is never read past this point; the fallback has no contest to win.
      best = { piece, hit, score: 0, nudge: 0, branch: 'fallback' };
    }
    const id = best.piece.key;
    runLen = id === lastId ? runLen + 1 : 1;
    lastId = id;
    used.set(id, (used.get(id) ?? 0) + 1);
    // The piece spans its FULL native chord (so it renders at scale 1 — the
    // engine scales uniformly, and a stretched piece is a thicker piece), but
    // the cursor stops short of it. That shortfall is the overlap that hides
    // the straight cut where one tile's rock ends and the next begins.
    //
    // Measured back from where the piece actually ENDS, along the curve. It used
    // to be a second chord probe from P, which silently assumed chord distance
    // and arc distance stay close — true on a lobe, false on a hairpin, where a
    // 1.97-cell chord can span four cells of arc. There the cursor advanced a
    // third of the way the piece reached, the next piece started behind the
    // previous one's end joint, and the band tore open a two-cell hole with the
    // floor showing through to the void. Walking back from `hit.i` keeps the
    // overlap an overlap whatever the curve is doing.
    const backOff = Math.max(1, Math.round(BAND_OVERLAP / spacing));
    const step = { i: Math.max(i + 1, best.hit.i - backOff) };
    laid.push({ piece: best.piece, P, Q: best.hit.p, i, nudge: best.nudge, branch: best.branch ?? 'walk' });
    i = step.i;
  }
  const placed: WalkPlacement[] = laid.map((pl) => ({
    ...pl,
    at: placePiece(pl.piece, pl.P, pl.Q, BAND_OUT, 0, pl.nudge ?? 0),
  }));

  return {
    placed,
    holes: bandHoles(placed, opts.ring ?? false),
    stretch: placed[placed.length - 1]?.stretch ?? 1,
  };
}

/**
 * One pass all the way round a closed curve. The whole-ring case of
 * {@link walkSpan}, and what the generator lays a cave with.
 */
export function walkClosed(curve: Curve, set: CaveKitPiece[]): WalkResult {
  return walkSpan(curve, set, 0, curve.length, { ring: true });
}

/**
 * The closure gate, in one place — the band editor holds an edited stretch to
 * the same bar the generator holds a whole cave to.
 *
 * Each piece is meant to run PAST its successor's start by BAND_OVERLAP, so a
 * positive gap here is rock that was never laid: the band has a hole in it and
 * the floor shows through to the void. Reported rather than thrown so a bad walk
 * can still be looked at, but it is a defect. `ring` closes the last piece back
 * onto the first; a span's ends answer to whatever is beside them instead.
 */
export function bandHoles(placed: WalkPlacement[], ring: boolean): BandHole[] {
  const holes: BandHole[] = [];
  for (let k = 0; k < placed.length - (ring ? 0 : 1); k++) {
    const a = placed[k],
      b = placed[(k + 1) % placed.length];
    const gap = dist(a.Q, b.P);
    if (gap > 0.9)
      holes.push({
        k,
        gap: gap.toFixed(2),
        at: a.Q.map((v) => v.toFixed(2)).join(','),
        from: `${a.piece.key}/${a.branch}`,
        to: `${b.piece.key}/${b.branch}`,
      });
  }
  return holes;
}
