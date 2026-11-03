// Chord-walking a curve with the measured cave kit.
//
// The live band renderer (caveBandRenderer.ts) walks every cave ring and drawn
// cave wall through here, the same way the kit MEASUREMENTS live in one place
// (`../assets/caveWallKit.ts`).
//
// Pure geometry: no Pixi, no store, no pack. A piece is a measurement
// (`CaveKitPiece`) and the walk answers with placements (`KitPlacement`);
// turning a placement into a sprite is the caller's business.
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

/** A turn this sharp inside a closing stretch is offered as the place to split it. */
const SPLIT_CORNER_DEG = 50;
/** How much a split on that corner is preferred over an even split of the same cost. */
const CORNER_SPLIT_BONUS = 4;
/** A joint lapping less than this along travel is a seam: the straight cut shows. */
export const MIN_LAP = BAND_OVERLAP / 3;
/**
 * The overlap at a joint of a thin ink line kit (the ledge and contour pieces). Their joints
 * are a flat zone of 0.2 cell plus a ramp, so a lap past that doubles the ink.
 */
export const LINE_OVERLAP = 0.15;

/**
 * True for a kit of thin ink lines (ledge, contour): no rock band, no side to it. It is laid
 * on the curve itself (no shove toward the void) and laps LINE_OVERLAP.
 */
export function isLineKit(set: readonly CaveKitPiece[]): boolean {
  return set.length > 0 && set.every((p) => p.key.startsWith('ledge_') || p.key.startsWith('contour_'));
}

/** The overlap at a joint of the foot rubble kit: loose stones, so a short lap is enough. */
export const RUBBLE_OVERLAP = 0.1;

/**
 * True for the foot rubble kit (`rubble_*` band pieces): laid on the ring it is given, which
 * already sits where the rubble belongs, so no shove either.
 */
export function isRubbleKit(set: readonly CaveKitPiece[]): boolean {
  return set.length > 0 && set.every((p) => p.key.startsWith('rubble_'));
}

/** The overlap a kit's joints are walked with. */
export const kitOverlap = (set: readonly CaveKitPiece[]): number =>
  isLineKit(set) ? LINE_OVERLAP : isRubbleKit(set) ? RUBBLE_OVERLAP : BAND_OVERLAP;
/** How far a kit is shoved toward the void past the curve it rides (twice: ride and placement). */
export const kitOut = (set: readonly CaveKitPiece[]): number => (isLineKit(set) || isRubbleKit(set) ? 0 : BAND_OUT);

/**
 * Which turns a straight may span and which a bend may: a straight up to `straight` degrees,
 * a bend from `bend`. Scaled to the kit's smallest bend: 35 and 45 for the rock band, whose
 * smallest bend is 90, so a 15 degree ledge bend gets its own 6 and 7.5.
 */
export function bendGate(set: readonly CaveKitPiece[]): { straight: number; bend: number } {
  const turns = set.filter((p) => p.turnDeg !== 0).map((p) => Math.abs(p.turnDeg));
  const smallest = turns.length > 0 ? Math.min(...turns) : 90;
  return { straight: (35 * smallest) / 90, bend: (45 * smallest) / 90 };
}

/** True when `piece` is the wrong family for a stretch turning `turn` degrees under `gate`. */
const wrongFamilyFor = (piece: CaveKitPiece, turn: number, gate: { straight: number; bend: number }): boolean =>
  piece.turnDeg === 0
    ? Math.abs(turn) > gate.straight
    : Math.abs(turn) < gate.bend || Math.sign(turn) !== Math.sign(piece.turnDeg);

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
 * this walk with the whole ring as its span, and an open run or a door-cut span
 * is laid with the same call, so every stretch of a band is walked alike.
 *
 * The curve is expected to be the band's own ride line — `offsetCurve(floor,
 * BAND_OUT)` — and the placements come back with BAND_OUT re-applied, so the
 * rock straddles the floor edge instead of sitting on it.
 */
export interface WalkOptions {
  /** Close the last piece onto the span's end (default). False leaves a free end. */
  close?: boolean;
  /** The span is a whole ring: the last piece meets the first. */
  ring?: boolean;
  /**
   * Run the closing piece BAND_OVERLAP past the first piece's start (a ring), and a
   * two-piece close's halves past each other by the same, the overlap every other
   * joint already has. Without it the closer butts its neighbours end to end and a
   * turn there opens a sliver of floor.
   */
  lap?: boolean;
  /**
   * Where a two-piece close may split the last stretch: at the midpoint only (1,
   * the default) or at the best of this many evenly spaced points. A midpoint
   * that lands on a corner leaves one half a bend laid across a straight.
   */
  splits?: number;
  /**
   * When neither half of a split close passes the shape gate, lay the closest
   * fit anyway instead of leaving the stretch bare. A misfit stone reads as
   * rough rock; a missing one shows floor straight through to the void.
   */
  fill?: boolean;
}

export function walkSpan(
  curve: Curve,
  set: CaveKitPiece[],
  i0: number,
  i1: number,
  opts: WalkOptions = {},
): WalkResult {
  const n = curve.length;
  // A free end has nothing to close onto (an open band's tip simply moves), so
  // the walk stops once it has covered the span and the last piece lands where
  // its own chord takes it.
  const close = opts.close ?? true;
  const straights = set.filter((p) => p.turnDeg === 0);
  const spacing = dist(curve[0], curve[1]) || 0.1;
  const maxChord = Math.max(...set.map((p) => p.chordCells));
  const overlap = kitOverlap(set);
  const out = kitOut(set);
  const gate = bendGate(set);
  // A lapped ring closes onto a point a little way INTO its first piece.
  const lapBy = opts.lap && opts.ring ? Math.max(1, Math.round(overlap / spacing)) : 0;
  const iHome = i1 + lapBy;
  const home = curve[Math.round(iHome) % n];
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
        loose = false,
      ): { piece: CaveKitPiece; sc: number; s: number; nudge: number } | null => {
        const d = dist(A, B);
        // An open run filled live also holds its closer to the walk's family
        // rule (a bend for a real corner, a straight for a run that barely
        // turns), softly, as a cost: a short drawn run otherwise closed on two
        // bends laid along a straight line. Not on a ring, where a cramped
        // closer needs every piece it can get; not without fill, which is how
        // the solver's fixture expects the shape gate alone to decide.
        const family = !!opts.fill && !opts.ring;
        const turn = family ? turnDeg(tangentAt(curve, iA), tangentAt(curve, iB)) : 0;
        const wrongFamily = (p: CaveKitPiece): boolean => wrongFamilyFor(p, turn, gate);
        let bestC: { piece: CaveKitPiece; sc: number; s: number; nudge: number } | null = null;
        for (const piece of set) {
          const f = fitArc(curve, iA, iB, A, B, piece);
          // the closing piece answers to the same shape gate as every other one:
          // without it a 90° bend lands on a dead straight run and reads as a hinge
          if (f.miss > BAND_FIT && !loose) continue;
          const sc =
            Math.abs(Math.log(d / piece.chordCells)) * 9 +
            f.miss * 4 +
            (family && wrongFamily(piece) ? 6 : 0);
          if (!bestC || sc < bestC.sc)
            bestC = { piece, sc, s: d / piece.chordCells, nudge: f.nudge };
        }
        return bestC;
      };
      const one = fit(P, i, home, iHome);
      if (!one || one.s > 1.12 || one.s < 0.88) {
        // The second half starts BAND_OVERLAP back inside the first, as every walked
        // joint does: two halves meeting end to end open a seam once each is shoved
        // off its own chord, worst where the split lands on a turn.
        // Each half gives up half the overlap: the first runs on past the split, the
        // second starts short of it.
        // The plain walk keeps its halves end to end, as the solver fixture expects.
        const halfLap = opts.lap ? Math.max(1, Math.round(overlap / spacing / 2)) : 0;
        const halves = (at: number) => {
          const mI = Math.min(iHome - 1, at + halfLap);
          const mP = curve[Math.round(mI) % n];
          const bI = Math.max(i + 1, at - halfLap);
          const bP = curve[Math.round(bI) % n];
          return { mI, mP, bI, bP, a: fit(P, i, mP, mI), b: fit(bP, bI, home, iHome) };
        };
        let split = halves((i + iHome) / 2);
        // A sharp corner in the stretch is a split point of its own: each half then
        // keeps to one side of it instead of one piece being laid across it.
        let cornerI = -1;
        let cornerTurn = 0;
        const reach = Math.max(2, Math.round(0.5 / spacing));
        for (let k = Math.ceil(i) + reach; k <= Math.floor(iHome) - reach; k++) {
          const t = Math.abs(turnDeg(tangentAt(curve, k - reach), tangentAt(curve, k + reach)));
          if (t > cornerTurn) {
            cornerTurn = t;
            cornerI = k;
          }
        }
        const splits = opts.splits ?? 1;
        const candidates: number[] = [];
        if (splits > 1) {
          for (let k = 1; k < splits; k++) candidates.push(i + ((iHome - i) * k) / splits);
          // And where each piece of the kit would end laid from P at its own size, so
          // the first half can be a whole stone and the second takes what is left.
          for (const c of new Set(set.map((p) => p.chordCells))) {
            const hit = chordPoint(curve, i, c, Math.ceil((iHome - i) * 1.5));
            if (hit && hit.i - halfLap > i + 1 && hit.i - halfLap < iHome - 1) candidates.push(hit.i - halfLap);
          }
        }
        if (cornerI >= 0 && cornerTurn >= SPLIT_CORNER_DEG) candidates.push(cornerI);
        if (candidates.length > 0) {
          // A missing half costs more than any fit, then the shape and stretch of
          // the two halves decide.
          const cost = (h: ReturnType<typeof fit>): number => (h ? h.sc + Math.abs(Math.log(h.s)) * 30 : 99);
          let bestCost = cost(split.a) + cost(split.b);
          for (const mI of candidates) {
            const k = halves(mI);
            const c = cost(k.a) + cost(k.b) - (mI === cornerI ? CORNER_SPLIT_BONUS : 0);
            if (c < bestCost) {
              bestCost = c;
              split = k;
            }
          }
        }
        let { a, b } = split;
        if (opts.fill && (a || b || !one)) {
          a ??= fit(P, i, split.mP, split.mI, true);
          b ??= fit(split.bP, split.bI, home, iHome, true);
        }
        if (a) laid.push({ piece: a.piece, P, Q: split.mP, i, stretch: a.s, nudge: a.nudge, branch: 'close-a' });
        if (b)
          laid.push({ piece: b.piece, P: split.bP, Q: home, i: split.bI, stretch: b.s, nudge: b.nudge, branch: 'close-b' });
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
      if (wrongFamilyFor(piece, turn, gate)) continue;
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
    const backOff = Math.max(1, Math.round(overlap / spacing));
    const step = { i: Math.max(i + 1, best.hit.i - backOff) };
    laid.push({ piece: best.piece, P, Q: best.hit.p, i, nudge: best.nudge, branch: best.branch ?? 'walk' });
    i = step.i;
  }
  const placed: WalkPlacement[] = laid.map((pl) => ({
    ...pl,
    at: placePiece(pl.piece, pl.P, pl.Q, out, 0, pl.nudge ?? 0),
  }));

  return {
    placed,
    holes: bandHoles(placed, opts.ring ?? false),
    stretch: placed[placed.length - 1]?.stretch ?? 1,
  };
}

/** How many starting points a ring is walked from before the best closure is kept. */
const RING_STARTS = 12;
/** A closing piece within this of scale 1 is even enough to stop looking. */
const RING_EVEN = Math.log(1.04);

/**
 * One pass all the way round a closed curve. The whole-ring case of
 * {@link walkSpan}, and what the live band renderer lays a cave with.
 *
 * Where the walk starts decides which chords it meets on the way round, and
 * so what is left for the closing piece: from one start a ring comes out even,
 * from another the last stone has to stretch a quarter past its size. The
 * forge kit has no short inside bend, which made the shipped Warren close at
 * 1.24 from index 0 where gg-demo's kit closed at 1.04 — luck, not geometry.
 * So the ring is walked from a few evenly spaced starts and the one that
 * closes best is kept: no holes first, then the smallest stretch anywhere in
 * the run. Deterministic for a given curve, since each start is.
 */
export function walkClosed(
  curve: Curve,
  set: CaveKitPiece[],
  opts: Pick<WalkOptions, 'lap' | 'splits' | 'fill'> = {},
): WalkResult {
  const n = curve.length;
  // The start is judged on open joints and stretch only: a plain close butts the first
  // piece end to end (a seam on every start alike); the lap below is what closes it.
  const cost = (r: WalkResult): number =>
    jointHoles(r.placed, true, false).length * 100 + Math.max(0, ...r.placed.map((p) => Math.abs(Math.log(p.at.scale))));
  let best: WalkResult | null = null;
  let bestStart = 0;
  let bestCost = Infinity;
  // The start is chosen on the plain walk whatever the options: they only
  // change the closing move, so every piece the walk lays before it (every
  // straight run and ordinary bend) comes out exactly as it always has.
  for (let k = 0; k < RING_STARTS; k++) {
    const i0 = Math.round((k * n) / RING_STARTS);
    let r: WalkResult;
    try {
      r = walkSpan(curve, set, i0, i0 + n, { ring: true });
    } catch {
      continue;
    }
    const c = cost(r);
    if (c < bestCost) {
      best = r;
      bestStart = i0;
      bestCost = c;
    }
    if (c <= RING_EVEN) break;
  }
  if (!best) throw new Error('band walk did not close');
  if (!opts.lap && !opts.splits && !opts.fill) return best;
  // Then that start's close is laid again with the options. Kept only when it
  // lays the same number of pieces (a plain ring keeps its count and look, the
  // close just overlaps its neighbours) or the plain close tore a hole.
  try {
    const closed = walkSpan(curve, set, bestStart, bestStart + n, { ...opts, ring: true });
    if (closed.holes.length > best.holes.length) return best;
    return closed.placed.length === best.placed.length || best.holes.length > 0 ? closed : best;
  } catch {
    return best;
  }
}

/**
 * The closure gate, in one place, so every walk is held to the same bar.
 *
 * Each piece is meant to run PAST its successor's start by BAND_OVERLAP, so a
 * positive gap here is rock that was never laid: the band has a hole in it and
 * the floor shows through to the void. Reported rather than thrown so a bad walk
 * can still be looked at, but it is a defect. `ring` closes the last piece back
 * onto the first; a span's ends answer to whatever is beside them instead.
 *
 * A joint that laps less than MIN_LAP along travel is one too: two pieces butted
 * end to end (a closer meeting its neighbour on the same point) each get shoved
 * off their own chord, and on any turn that opens a wedge of floor between them.
 * Along travel a long lap is fine; across it, the 0.9 gate still holds.
 */
export function bandHoles(placed: WalkPlacement[], ring: boolean): BandHole[] {
  return jointHoles(placed, ring, true);
}

/** The joints open by more than the gate, and with `seams` the ones lapping too little. */
function jointHoles(placed: WalkPlacement[], ring: boolean, seams: boolean): BandHole[] {
  const holes: BandHole[] = [];
  // A third of the kit's own overlap: MIN_LAP for the rock band.
  const minLap = kitOverlap(placed.map((pl) => pl.piece)) / 3;
  for (let k = 0; k < placed.length - (ring ? 0 : 1); k++) {
    const a = placed[k],
      b = placed[(k + 1) % placed.length];
    const gap = dist(a.Q, b.P);
    const travel = norm(add(norm(sub(a.Q, a.P)), norm(sub(b.Q, b.P))));
    const lap = dot(sub(a.Q, b.P), travel);
    // Judged by seams, a joint lapping long (a short side's straight over the bends either
    // end) is no hole: only one that falls short along travel or misses sideways is.
    const open = seams ? lap < minLap || Math.abs(cross(sub(a.Q, b.P), travel)) > 0.9 : gap > 0.9;
    if (open)
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

/** A corner of a ring with straight sides: its ride index and signed turn, degrees. */
export interface RingCorner {
  at: number;
  turn: number;
}

/** A small ring laid corner first: the placements, and each side's straight stretch. */
export interface CornerLayout {
  placed: WalkPlacement[];
  /**
   * Per side (corner k to corner k + 1), the free arc between the two bend groups, in
   * cells: what the straights there cover, before they lap the bends either end.
   */
  sides: number[];
}

/**
 * The bends a corner is turned with: the group (one bend, or the same bend repeated) that
 * turns within CORNER_GROUP_TOL of the corner on the shortest chord, its sign the corner's.
 * The smallest pair the kit has is what a small ring wants: a long bend there eats the
 * whole side. Null when the kit has no bend that way.
 */
function cornerBends(turn: number, set: CaveKitPiece[]): CaveKitPiece[] | null {
  let best: { piece: CaveKitPiece; count: number; cost: number } | null = null;
  for (const piece of set) {
    if (piece.turnDeg === 0 || Math.sign(piece.turnDeg) !== Math.sign(turn) || piece.flipY) continue;
    const count = Math.max(1, Math.round(Math.abs(turn) / Math.abs(piece.turnDeg)));
    const miss = Math.abs(count * Math.abs(piece.turnDeg) - Math.abs(turn));
    const cost = (miss > CORNER_GROUP_TOL ? 1000 + miss : 0) + count * piece.chordCells;
    if (!best || cost < best.cost) best = { piece, count, cost };
  }
  return best ? Array.from({ length: best.count }, () => best.piece) : null;
}

/** How far a bend group may turn from its corner, degrees. */
const CORNER_GROUP_TOL = 20;

/**
 * Lay a ring with straight sides corner first: each corner gets its bend group centred
 * on it, then each side is covered between the groups by straights at their own size,
 * overlapping the bends either end by BAND_OVERLAP, and more where the side is shorter
 * than the shortest straight. No piece is stretched and no corner is cut across.
 *
 * Null when the kit has no straight, or no bend for some corner.
 */
export function layCorners(curve: Curve, corners: RingCorner[], set: CaveKitPiece[]): CornerLayout | null {
  const n = curve.length;
  const spacing = dist(curve[0], curve[1]) || 0.1;
  const overlap = kitOverlap(set);
  const backOff = Math.max(1, Math.round(overlap / spacing));
  const straights = set.filter((p) => p.turnDeg === 0).sort((a, b) => b.chordCells - a.chordCells);
  if (straights.length === 0 || corners.length < 3) return null;
  const at = (i: number): Vec => curve[((Math.round(i) % n) + n) % n];

  /** Lay `pieces` one after another from index `from`, each lapping the last. */
  const layRun = (pieces: CaveKitPiece[], from: number, branch: string): Omit<WalkPlacement, 'at'>[] | null => {
    const out: Omit<WalkPlacement, 'at'>[] = [];
    let i = from;
    for (const piece of pieces) {
      const P = at(i);
      const hit = chordPoint(curve, ((i % n) + n) % n, piece.chordCells, Math.ceil((piece.chordCells * 3) / spacing));
      if (!hit) return null;
      const end = i + (hit.i - (((i % n) + n) % n));
      const f = fitArc(curve, ((i % n) + n) % n, hit.i, P, hit.p, piece);
      out.push({ piece, P, Q: hit.p, i, nudge: f.nudge, branch });
      i = end - backOff;
    }
    return out;
  };
  /** Where a run laid from `from` ends, as a curve index. */
  const endOf = (run: Omit<WalkPlacement, 'at'>[]): number => {
    const last = run[run.length - 1];
    const hit = chordPoint(curve, ((last.i % n) + n) % n, last.piece.chordCells, Math.ceil((last.piece.chordCells * 3) / spacing))!;
    return last.i + (hit.i - (((last.i % n) + n) % n));
  };

  // Each corner's group, centred on it: laid once from the corner to learn its reach.
  const groups: { run: Omit<WalkPlacement, 'at'>[]; from: number; to: number }[] = [];
  for (const c of corners) {
    const bends = cornerBends(c.turn, set);
    if (!bends) return null;
    // The arc a chord takes depends on where it starts on the rounded corner, so the
    // start is settled over a few passes until the group's ends sit either side alike.
    let from = c.at;
    let run: Omit<WalkPlacement, 'at'>[] | null = null;
    for (let pass = 0; pass < 4; pass++) {
      run = layRun(bends, from, 'corner');
      if (!run) return null;
      from = c.at - (endOf(run) - from) / 2;
    }
    run = layRun(bends, from, 'corner');
    if (!run) return null;
    groups.push({ run, from, to: endOf(run) });
  }

  const laid: Omit<WalkPlacement, 'at'>[] = [];
  const sides: number[] = [];
  let mirror = 0;
  groups.forEach((g, k) => {
    laid.push(...g.run);
    const next = groups[(k + 1) % groups.length];
    let nextFrom = next.from;
    while (nextFrom < g.to - n / 2) nextFrom += n;
    // From a lap inside this group's last bend to a lap inside the next group's first.
    const s0 = g.to - backOff;
    const s1 = nextFrom + backOff;
    const arc = (s1 - s0) * spacing;
    sides.push((nextFrom - g.to) * spacing);
    if (g.to - nextFrom >= backOff) return;
    // Longest straights that fit, then centred: a stretch under the shortest one takes
    // that one alone and laps the bends either side by more.
    const pieces: CaveKitPiece[] = [];
    // Short by up to half an overlap is fine: centred, each end still laps by more than
    // MIN_LAP, where one more piece would lap the bends by most of its own length.
    let left = arc;
    for (;;) {
      const piece = straights.find((p) => p.chordCells <= left + overlap / 2) ?? straights[straights.length - 1];
      const same = set.filter((p) => p.turnDeg === 0 && p.key === piece.key);
      pieces.push(same[mirror++ % same.length]);
      left -= piece.chordCells;
      if (left <= overlap / 2) break;
      // The next piece starts back inside this one.
      left += overlap;
    }
    const total = pieces.reduce((sum, p) => sum + p.chordCells, 0) - (pieces.length - 1) * overlap;
    const run = layRun(pieces, s0 + ((arc - total) / 2) / spacing, 'side');
    if (run) laid.push(...run);
  });

  const out = kitOut(set);
  const placed: WalkPlacement[] = laid.map((pl) => ({ ...pl, at: placePiece(pl.piece, pl.P, pl.Q, out, 0, pl.nudge) }));
  return { placed, sides };
}
