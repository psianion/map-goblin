// Re-laying a stretch of cave band.
//
// A cave wall is not a spine with stones fitted along it: it is a run of placed
// rock whose chords the kit can actually build — fourteen lengths and turns of
// 0/±90, nothing in between. So a joint cannot simply be offset the way a wall
// stone's can. The drag edits the FLOOR OUTLINE and the band is re-walked over
// the edited outline, which is the generator's own behaviour applied locally and
// what "the polygon auto-adjusts to incorporate the asset" has to mean.
//
// Everything here is pure: no Pixi, no store, no commands. The answer is an
// outline and a list of placements; turning those into child updates is the
// caller's business (see the step-5 composite in the band editor).
//
// The walk itself is `caveWalk.ts` — the same code the generator lays a whole
// cave with. Two copies would let an edited stretch drift away from the stretch
// beside it, which is the entire reason the walk moved into the engine.

import { jointsOf, type CaveKitPiece, type KitPlacement } from '../assets/caveWallKit';
import type { CaveBand } from './caveBand';
import {
  BAND_OUT,
  BAND_OVERLAP,
  offsetCurve,
  resampleClosed,
  tangentAt,
  walkClosed,
  walkSpan,
  type Curve,
  type Vec,
  type WalkResult,
} from './caveWalk';

/**
 * The spacing the cave outline is sampled at before the band walks it.
 *
 * The generator smooths its traced ring to this (`smoothRing` in
 * scripts/gen-goblin-warren.mjs) and saves the simplified curve as the floor
 * shape. Re-walking has to resample back to the same spacing, or the chord
 * probes land on a coarse polyline and every fit changes.
 */
const CURVE_STEP = 0.1;

/** Gate 1: past this a seam is a hole, with the floor showing through to the void. */
const MAX_SEAM = 0.9;

/**
 * Gate 2: how far a closing piece may be scaled. Scale is uniform, so a
 * stretched piece is also a THICKER piece — past about ±12% it reads as a
 * different wall from its neighbours.
 */
const MAX_STRETCH = 0.12;

/**
 * Anchor half-width, in joints either side of the edit.
 *
 * A real trade-off: too narrow and closure needs unacceptable scale, too wide
 * and a small drag rewrites wall far from the cursor, which reads as the map
 * fighting you. Start at ±2 and widen only on failure.
 */
const K_MIN = 2;
const K_MAX = 6;

const add = (p: Vec, q: Vec): Vec => [p[0] + q[0], p[1] + q[1]];
const sub = (p: Vec, q: Vec): Vec => [p[0] - q[0], p[1] - q[1]];
const mul = (p: Vec, s: number): Vec => [p[0] * s, p[1] * s];
const mid = (p: Vec, q: Vec): Vec => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
const dot = (p: Vec, q: Vec): number => p[0] * q[0] + p[1] * q[1];
const dist = (p: Vec, q: Vec): number => Math.hypot(p[0] - q[0], p[1] - q[1]);

/** One piece the solver would lay, ready to become an asset child. */
export interface BandSpanPiece {
  piece: CaveKitPiece;
  at: KitPlacement;
}

export interface BandSolution {
  ok: true;
  /** The floor ring with the edit applied. Only the deformed stretch differs. */
  contour: Vec[];
  /**
   * The stretch of band these replace: `band.pieces[from]` onward for `count`,
   * wrapping. The caller reuses those children's ids in order and only
   * adds/removes for the difference in count.
   */
  from: number;
  count: number;
  /** The replacements, in walk order. `pieces[m].piece.key` names the stone. */
  pieces: BandSpanPiece[];
  /**
   * How far the kit pulled the handle away from the pointer, in cells — the
   * number that tells a DM whether the constraint is helping or fighting.
   * Measured to the nearest seam the walk actually laid.
   */
  kitPull: number;
  /** The anchor half-width that closed: `K_MIN` unless closure needed more room. */
  k: number;
}

export interface BandRefusal {
  ok: false;
  reason: string;
}

/** Either a stretch the kit can build, or a refusal that leaves the band alone. */
export type BandSolveResult = BandSolution | BandRefusal;

const refuse = (reason: string): BandRefusal => ({ ok: false, reason });

/** Index of the curve sample nearest `p`. */
function nearestIndex(curve: Curve, p: Vec): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < curve.length; i++) {
    const d = (curve[i][0] - p[0]) ** 2 + (curve[i][1] - p[1]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** `band.joints[m]`, with `m` wrapped — a closed band's anchors run off both ends. */
const jointAt = (band: CaveBand, m: number): Vec => {
  const n = band.joints.length;
  return band.joints[((m % n) + n) % n];
};

/**
 * Where a joint index lands on the map, whole or fractional.
 *
 * A whole index is the joint itself, to the bit. A fraction is a point along the
 * span between the joints either side of it: the transient handle an insert
 * gesture drops mid-wall, which is not a joint at all — it only becomes one if
 * the re-walk happens to land a seam there. Shared with the overlay that draws
 * that handle, so what is drawn and what the deformation peaks on cannot drift.
 */
export function bandJointPoint(band: CaveBand, joint: number): Vec {
  const lo = Math.floor(joint);
  const f = joint - lo;
  const a = jointAt(band, lo);
  return f === 0 ? [a[0], a[1]] : add(mul(a, 1 - f), mul(jointAt(band, lo + 1), f));
}

/**
 * Does the band walk the way its outline is stored, or against it?
 *
 * The generator traces rings floor-on-the-right, so walking forward puts the
 * void on the left and `offsetCurve` shoves the band the right way. Nothing
 * forces a hand-drawn floor shape to be wound that way, and a band walked round
 * a ring stored backwards would be re-laid inside out. The band is the ground
 * truth — it is what is on the map — so the outline is turned to match it.
 * Summed over every piece rather than sampled at one: a bend's chord sits 45°
 * off the tangent, which one sample could read either way.
 */
function runsWithContour(contour: Curve, band: CaveBand): boolean {
  let agree = 0;
  for (const p of band.pieces) {
    const t = tangentAt(contour, nearestIndex(contour, mid(p.joints[0], p.joints[1])));
    agree += dot(t, sub(p.joints[1], p.joints[0]));
  }
  return agree >= 0;
}

/** The stretch of band an edit re-lays, and the joints holding its ends still. */
interface Span {
  /** Anchor joints. `null` is a free end of an open run, which simply moves. */
  a: number | null;
  b: number | null;
  from: number;
  count: number;
}

/**
 * The pieces between two joint indices, which may run past either end.
 *
 * A closed band wraps; an open one clamps, and a clamped end is a free end with
 * no closure constraint rather than an anchor.
 */
function spanBetween(band: CaveBand, aRaw: number, bRaw: number): Span | null {
  const joints = band.joints.length;
  const pieces = band.pieces.length;
  // Any wider and the two anchors meet round the back: the "stretch outside
  // [a, b] that does not move" would be empty.
  if (bRaw - aRaw >= joints) return null;
  if (band.closed) {
    const wrap = (m: number): number => ((m % joints) + joints) % joints;
    return { a: wrap(aRaw), b: wrap(bRaw), from: wrap(aRaw + 1) % pieces, count: bRaw - aRaw };
  }
  // An open run's first and last joints ARE its free ends: no piece ends at
  // joint 0 and none starts at the last one. A k-window that reaches either has
  // nothing there to anchor to, so it is clamped and that side is deliberately
  // free. Reading them as anchors indexed `pieces[-1]` / `pieces[length]`, which
  // threw, which solveEdit's catch reported as a kit that cannot follow the
  // outline, which widened k until the anchor really had run off the end and the
  // tip translated rigidly — two joints in from either end of an open run.
  const a = aRaw <= 0 ? null : aRaw;
  const b = bRaw >= joints - 1 ? null : bRaw;
  const from = a ?? 0;
  const last = (b ?? joints - 1) - 1;
  if (last < from) return null;
  return { a, b, from, count: last - from + 1 };
}

/**
 * The piece ending at joint `m` and the piece starting there.
 *
 * A closed band's joint `m` sits between pieces `m` and `m + 1`; an open run
 * counts its free ends as joints too, which shifts everything by one.
 */
const endsAt = (band: CaveBand, m: number): number => (band.closed ? m : m - 1);
const startsAt = (band: CaveBand, m: number): number =>
  band.closed ? (m + 1) % band.pieces.length : m;

/** Outline indices from `at` toward `stop`, with the arc walked to reach each. */
function reachOut(
  contour: Curve,
  at: number,
  stop: number,
  dir: 1 | -1,
): { idx: number[]; arc: number[] } {
  const n = contour.length;
  const idx: number[] = [];
  const arc: number[] = [];
  let s = 0;
  for (let j = at; idx.length <= n; j = (j + dir + n) % n) {
    if (idx.length) s += dist(contour[j], contour[(j - dir + n) % n]);
    idx.push(j);
    arc.push(s);
    if (j === stop) break;
  }
  return { idx, arc };
}

/** One end of a deformed stretch: where it stops, and whether that end is pinned. */
interface Side {
  stop: number;
  anchored: boolean;
}

/** The far end of one half of a deformed stretch: an anchor, or a free end. */
const sideOf = (base: Curve, band: CaveBand, anchor: number | null, free: number): Side => ({
  stop: nearestIndex(base, jointAt(band, anchor ?? free)),
  anchored: anchor !== null,
});

/**
 * The outline run an edit is allowed to touch, walked forward from one end to
 * the other.
 *
 * Bounded on purpose. The stretch is found by nearest outline point to each
 * joint, and that mapping is not guaranteed monotone — the saved ring is
 * Douglas–Peucker simplified, so a couple of joints can share a point on a long
 * straight. Walking each half outward from the peak until it happens to meet its
 * anchor would then set off round the ring and displace the whole cave. Taking
 * the run first and placing the peak INSIDE it cannot do that; a run that has
 * come out backwards is longer than half the ring, and that is a refusal.
 */
function stretchRun(contour: Curve, back: Side, fwd: Side): { idx: number[]; arc: number[] } | null {
  const run = reachOut(contour, back.stop, fwd.stop, 1);
  return run.idx.length > contour.length / 2 ? null : run;
}

/**
 * Displace the outline by `d`, peaking nearest `peak` and fading to nothing at
 * each anchor.
 *
 * Cosine, not linear: a linear falloff meets the untouched outline at an angle,
 * and the floor edge reads as a crease exactly where the eye is looking.
 */
function deformPeak(contour: Curve, back: Side, fwd: Side, peak: Vec, d: Vec): Vec[] | null {
  const run = stretchRun(contour, back, fwd);
  if (!run) return null;
  const { idx, arc } = run;
  let at = 0;
  for (let m = 1; m < idx.length; m++)
    if (dist(contour[idx[m]], peak) < dist(contour[idx[at]], peak)) at = m;
  // The peak has landed ON an anchor: this stretch of ring is too coarsely
  // simplified to carry a bulge at all, and pushing the anchor is the one thing
  // the anchor is there to prevent. Widening finds more outline to work with.
  if ((back.anchored && at === 0) || (fwd.anchored && at === idx.length - 1)) return null;
  const out = contour.map((p): Vec => [p[0], p[1]]);
  for (let m = 0; m < idx.length; m++) {
    // The same cosine either side, anchor or free end. A free end used to carry
    // the whole displacement past the peak — "a free end simply moves" — but
    // that only reads right when the free end IS what is being dragged, and then
    // the peak sits on it and the cosine hands it the full delta anyway. With
    // the peak further along the run it translated the tip rigidly and left a
    // step in the outline; fading over the remaining distance to the tip is the
    // same answer the anchored side gives. Nothing pins the tip either way — the
    // walk still runs to it with no closure to answer to.
    const total = Math.abs((m <= at ? arc[0] : arc[idx.length - 1]) - arc[at]) || 1;
    const w = 0.5 * (1 + Math.cos((Math.PI * Math.abs(arc[m] - arc[at])) / total));
    out[idx[m]] = add(contour[idx[m]], mul(d, w));
  }
  return out;
}

/** Replace the outline between two anchors with the straight chord between them. */
function deformChord(contour: Curve, back: Side, fwd: Side): Vec[] | null {
  const run = stretchRun(contour, back, fwd);
  if (!run) return null;
  const { idx, arc } = run;
  const out = contour.map((p): Vec => [p[0], p[1]]);
  const A = contour[idx[0]];
  const v = sub(contour[idx[idx.length - 1]], A);
  const total = arc[arc.length - 1] || 1;
  for (let m = 0; m < idx.length; m++) out[idx[m]] = add(A, mul(v, arc[m] / total));
  return out;
}

/** What one walk of the edited stretch produced. */
interface Attempt {
  pieces: BandSpanPiece[];
  /** The seams it landed on, in walk order, free ends included. */
  joints: Vec[];
}

/**
 * Walk one stretch of the edited outline and hold the result to the gates.
 *
 * Answers with the reason rather than a bad band: the caller widens the anchors
 * and tries again, and if nothing closes that reason is what the DM is told.
 */
function walkAttempt(
  base: Curve,
  deformed: Vec[],
  band: CaveBand,
  set: CaveKitPiece[],
  span: Span,
): Attempt | string {
  const ride = offsetCurve(resampleClosed(deformed, CURVE_STEP), BAND_OUT);
  const n = ride.length;
  const spacing = dist(ride[0], ride[1]) || CURVE_STEP;
  // A free end goes wherever the outline under it went — the whole drag when the
  // DM has the tip itself, a fading share of it when the peak is further along
  // the run. Read off the deformation rather than handed the raw delta, so what
  // the rock does and what the floor does cannot disagree.
  const carried = (j: Vec): Vec => {
    const i = nearestIndex(base, j);
    return add(j, sub(deformed[i], base[i]));
  };
  // Where the untouched band leaves off. An anchored end continues from the kept
  // piece's own joint, with the cursor measured BACK by the overlap exactly the
  // way the walk advances it — so the first new piece meets the kept one the way
  // any two pieces meet, rather than butting against it.
  const head =
    span.a === null ? carried(band.joints[0]) : band.pieces[endsAt(band, span.a)].joints[1];
  const tail =
    span.b === null
      ? carried(band.joints[band.joints.length - 1])
      : band.pieces[startsAt(band, span.b)].joints[0];
  const backOff = Math.max(1, Math.round(BAND_OVERLAP / spacing));
  let i0 = nearestIndex(ride, head) - (span.a === null ? 0 : backOff);
  let i1 = nearestIndex(ride, tail);
  if (i0 < 0) i0 += n;
  while (i1 <= i0) i1 += n;

  const walk = walkSpan(ride, set, i0, i1, { close: span.b !== null });
  if (!walk.placed.length || walk.holes.length) return 'the wall would have a hole in it';
  if (walk.placed.some((p) => Math.abs(p.at.scale - 1) > MAX_STRETCH))
    return 'closing that stretch would stretch a stone out of shape';

  const pieces = walk.placed.map((p) => ({ piece: p.piece, at: p.at }));
  const ends = pieces.map((p) => jointsOf(p.piece, p.at));
  // Gate 1 over the whole edited stretch, including the two seams with the band
  // that is not moving. Those two are the ones the walk cannot see for itself,
  // and they are exactly where a torn band would show.
  const seams: [Vec, Vec][] = [];
  if (span.a !== null) seams.push([head, ends[0][0]]);
  for (let m = 0; m + 1 < ends.length; m++) seams.push([ends[m][1], ends[m + 1][0]]);
  if (span.b !== null) seams.push([ends[ends.length - 1][1], tail]);
  if (seams.some(([p, q]) => dist(p, q) > MAX_SEAM)) return 'the wall would have a hole in it';

  const joints = seams.map(([p, q]) => mid(p, q));
  // A free end is a joint in its own right — it is the handle a DM drags.
  if (span.a === null) joints.unshift(ends[0][0]);
  if (span.b === null) joints.push(ends[ends.length - 1][1]);
  return { pieces, joints };
}

/** Do two closed segments cross, endpoints not counted? */
function crosses(a: Vec, b: Vec, c: Vec, e: Vec): boolean {
  const side = (p: Vec, q: Vec, r: Vec): number => {
    const s = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    return Math.abs(s) < 1e-12 ? 0 : Math.sign(s);
  };
  return side(a, b, c) * side(a, b, e) < 0 && side(c, e, a) * side(c, e, b) < 0;
}

/**
 * Has the edit folded the floor outline through itself?
 *
 * Drag a joint far enough and the wall goes straight through the room and out
 * the far side. The band that comes back can still close — the kit will happily
 * lay rock down one side of a spike and up the other — but the polygon is
 * broken, and everything downstream of it (the fill, room detection, the LOS
 * edges `resolveWalls` derives) reads a bowtie. That is not a wall the DM asked
 * for, so it is a refusal.
 *
 * ponytail: brute force over the edited edges against the whole ring. That is a
 * few thousand segment tests on the Warren, which is nothing next to the walk
 * this is guarding, and a sweep line would be a page of code to save it.
 */
function foldsOverItself(before: Vec[], after: Vec[]): boolean {
  const n = after.length;
  const edited: number[] = [];
  for (let i = 0; i < n; i++)
    if (i >= before.length || dist(before[i], after[i]) > 1e-9) edited.push(i);
  if (!edited.length) return false;
  // The edited points move two edges each — the one arriving and the one leaving.
  const suspect = new Set<number>();
  for (const i of edited) {
    suspect.add((i - 1 + n) % n);
    suspect.add(i);
  }
  for (const i of suspect)
    for (let j = 0; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      if (crosses(after[i], after[(i + 1) % n], after[j], after[(j + 1) % n])) return true;
    }
  return false;
}

/** What an edit does to the outline, and which stretch it re-lays. */
interface EditPlan {
  /** The narrowest anchor half-width worth trying. */
  kFrom: number;
  span: (k: number) => Span | null;
  /** Null when the stretch the anchors describe is not a stretch at all. */
  deform: (base: Curve, span: Span) => Vec[] | null;
  /** Where the gesture asked the wall to go; `kitPull` is measured from here. */
  probe: Vec;
}

function solveEdit(
  input: { contour: readonly Vec[]; band: CaveBand; set: CaveKitPiece[] },
  plan: EditPlan,
): BandSolveResult {
  const { band } = input;
  if (band.pieces.length < 2) return refuse('that wall is too short to re-lay');
  if (input.contour.length < 4) return refuse('that floor outline is not a polygon');
  const src: Vec[] = input.contour.map((p): Vec => [p[0], p[1]]);
  const flip = !runsWithContour(src, band);
  const base = flip ? src.reverse() : src;

  let why = 'the kit cannot close that stretch';
  for (let k = plan.kFrom; k <= K_MAX; k++) {
    const span = plan.span(k);
    if (!span) continue;
    let got: Attempt | string = 'the kit cannot close that stretch';
    let deformed: Vec[] | null = null;
    try {
      deformed = plan.deform(base, span);
      if (!deformed) continue;
      got = foldsOverItself(base, deformed)
        ? 'that would fold the floor outline through itself'
        : walkAttempt(base, deformed, band, input.set, span);
    } catch (err) {
      // Whatever the pointer is doing, this runs on every pointermove: a curve
      // the walk cannot get round is a refusal, not a crash. Said out loud in
      // dev all the same — an index bug in here reads exactly like a kit that
      // cannot follow the outline, and one hid behind this catch for a whole
      // phase, quietly widening the anchors on every open-band edit.
      if (import.meta.env.DEV) console.warn('[bandSolver] the edit walk threw', err);
      got = 'the kit cannot follow that outline';
    }
    if (typeof got === 'string' || !deformed) {
      why = typeof got === 'string' ? got : why;
      continue;
    }
    return {
      ok: true,
      contour: flip ? deformed.reverse() : deformed,
      from: span.from,
      count: span.count,
      pieces: got.pieces,
      kitPull: Math.min(...got.joints.map((j) => dist(plan.probe, j))),
      k,
    };
  }
  return refuse(why);
}

export interface BandDragInput {
  /** The floor shape child's ring, in cells. Never mutated. */
  contour: readonly Vec[];
  band: CaveBand;
  /**
   * Index into `band.joints`, whole or fractional.
   *
   * A fraction peaks the deformation BETWEEN two joints — the transient handle
   * an insert gesture drops mid-span. Nothing else about the solve changes: the
   * walk still decides where the seams go, so an inserted joint survives only
   * where one really landed.
   */
  joint: number;
  /** Where the pointer asked that joint to go. */
  to: Vec;
  /** The kit, from `caveBandPieces()`. */
  set: CaveKitPiece[];
}

/**
 * Drag one joint of a band to `to`.
 *
 * The outline between the anchors is bowed toward the cursor and the stretch is
 * re-walked over it. The kit decides what the wall can actually be: the handle
 * lands where the walk put a seam, which is what `kitPull` reports.
 */
export function solveBandDrag(input: BandDragInput): BandSolveResult {
  const { band, joint, to } = input;
  const n = band.joints.length;
  // NaN lands here too. A closed band wraps, so a fraction past its last joint
  // is a real span; an open run has nothing past its free end to peak in.
  if (!(joint >= 0) || joint >= n || (!band.closed && joint > n - 1)) {
    return refuse('no such joint');
  }
  const peak = bandJointPoint(band, joint);
  const d = sub(to, peak);
  return solveEdit(input, {
    kFrom: K_MIN,
    // The anchors are the usual k joints beyond the ones the peak sits between.
    // On a whole index floor and ceil are the same joint, and this is the ±k it
    // has always been; a fraction holds one more piece still.
    span: (k) => spanBetween(band, Math.floor(joint) - k, Math.ceil(joint) + k),
    deform: (base, span) =>
      deformPeak(
        base,
        sideOf(base, band, span.a, 0),
        sideOf(base, band, span.b, band.joints.length - 1),
        peak,
        d,
      ),
    probe: to,
  });
}

export interface BandStraightenInput {
  contour: readonly Vec[];
  band: CaveBand;
  /** Contiguous indices into `band.joints` — the joints being deleted. */
  joints: number[];
  set: CaveKitPiece[];
}

/**
 * Delete joints: the outline between the two surviving neighbours becomes a
 * straight chord and that stretch is re-walked.
 *
 * How many pieces the stretch ends up with falls out of the walk rather than
 * being asked for, which keeps the outline the single source of truth — the
 * whole point of doing it this way rather than deleting children.
 */
export function solveBandStraighten(input: BandStraightenInput): BandSolveResult {
  const { band } = input;
  const M = band.joints.length;
  const sel = [...new Set(input.joints)].sort((a, b) => a - b);
  if (!sel.length || sel.some((m) => m < 0 || m >= M)) return refuse('no such joint');
  if (sel[sel.length - 1] - sel[0] !== sel.length - 1)
    return refuse('those joints are not next to each other');
  if (sel.length > M - 3) return refuse('that is the whole wall');
  if (!band.closed && (sel[0] === 0 || sel[sel.length - 1] === M - 1))
    return refuse('a free end has nothing to straighten between');
  const lo = sel[0] - 1;
  const hi = sel[sel.length - 1] + 1;
  return solveEdit(input, {
    // The chord is fixed between the immediate neighbours; widening gives the
    // WALK more room to close without straightening any more wall than asked.
    kFrom: 1,
    span: (k) => spanBetween(band, sel[0] - k, sel[sel.length - 1] + k),
    deform: (base) => deformChord(base, sideOf(base, band, lo, lo), sideOf(base, band, hi, hi)),
    probe: mid(jointAt(band, lo), jointAt(band, hi)),
  });
}

export interface BandRewalkInput {
  contour: readonly Vec[];
  band: CaveBand;
  set: CaveKitPiece[];
}

/**
 * Re-lay the whole wall over the outline as it stands now.
 *
 * The recovery tool for a band that has desynced from a floor shape moved by
 * other means. The outline is not touched — it is already what the DM wants; the
 * rock is what is wrong.
 */
export function rewalkBand(input: BandRewalkInput): BandSolveResult {
  const { band } = input;
  if (input.contour.length < 4) return refuse('that floor outline is not a polygon');
  const src: Vec[] = input.contour.map((p): Vec => [p[0], p[1]]);
  const base = runsWithContour(src, band) ? src : [...src].reverse();
  let walk: WalkResult;
  try {
    walk = walkClosed(offsetCurve(resampleClosed(base, CURVE_STEP), BAND_OUT), input.set);
  } catch {
    return refuse('the kit cannot walk that outline');
  }
  if (!walk.placed.length || walk.holes.length) return refuse('the kit cannot close that outline');
  if (walk.placed.some((p) => Math.abs(p.at.scale - 1) > MAX_STRETCH))
    return refuse('closing that outline would stretch a stone out of shape');
  return {
    ok: true,
    contour: input.contour.map((p): Vec => [p[0], p[1]]),
    from: 0,
    count: band.pieces.length,
    pieces: walk.placed.map((p) => ({ piece: p.piece, at: p.at })),
    // No cursor and no anchors: the whole wall is the stretch.
    kitPull: 0,
    k: 0,
  };
}
