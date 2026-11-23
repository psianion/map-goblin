// How a raised edge darkens the ground below it, as numbers and outlines: the drop shade that
// hugs every edge on its low side, the sun's shadow cast off it, and a slope's side face with
// its ledge bands and lines. Pure, for the plateau renderer, the shadow pass and their tests;
// Pixi draws them.

import type { Polygon } from '../types/geometry';
import type { ShadowLook } from './shadows';
import type { PlateauChild } from './types';
import { clipper2Engine } from '../geometry/Clipper2Engine';

type Vec = [number, number];

// ─── The drop shade ────────────────────────────────────────

/**
 * How dark the drop shade is at the edge: black at this opacity, fading to none at its width.
 * A faint contact shade only: the sun's shadow (one side) is what reads as the drop, so the
 * lit sides stay clean.
 */
export const DROP_SHADE_ALPHA = 0.11;
/** The drop shade's width, cells: this, plus DROP_SHADE_PER_CELL a cell of drop, up to DROP_SHADE_MAX. */
export const DROP_SHADE_BASE = 0.15;
export const DROP_SHADE_PER_CELL = 0.06;
export const DROP_SHADE_MAX = 1 / 3;

/** How wide the drop shade below an edge `drop` cells high is, cells. */
export function dropShadeWidth(drop: number): number {
  return Math.min(DROP_SHADE_MAX, DROP_SHADE_BASE + DROP_SHADE_PER_CELL * Math.abs(drop));
}

// ─── The sun's shadow ──────────────────────────────────────

/** How dark a raised edge's sun shadow is: black at this opacity (times the caster's strength). */
export const SUN_SHADOW_ALPHA = 0.35;
/** A raised edge's sun shadow is this long, plus SUN_SHADOW_PER_CELL a cell of drop, cells. */
export const SUN_SHADOW_BASE = 0.8;
export const SUN_SHADOW_PER_CELL = 0.6;
/**
 * How far behind the edge, onto its high side, the shadow's fill reaches before it is cut back
 * to the edge: past the blur's reach, so the blur has shadow on both sides of the edge and the
 * shadow is as dark at the edge as anywhere.
 */
export const SUN_SHADOW_BACK = 0.5;

/** How long the sun shadow off an edge `drop` cells high is, cells. */
export function sunShadowLength(drop: number): number {
  return SUN_SHADOW_BASE + SUN_SHADOW_PER_CELL * Math.abs(drop);
}

/**
 * The sun shadow's fill off one run of edge: per stretch of it turned away from the light (its
 * low side facing along the shadow), the stretch swept `length` along the shadow and pushed
 * `back` behind itself. `lowLeft` says the low side is on the left of travel (a plateau's ring)
 * rather than the right (a pit's). Stretches facing the light cast nothing: their sweep runs
 * up over their own top, and the stretches the light leaves on the far side cast the shadow.
 * `length` is one for the run, or one per segment (each stretch by its own drop).
 */
export function leeSweeps(
  points: Polygon,
  closed: boolean,
  lowLeft: boolean,
  look: Pick<ShadowLook, 'dx' | 'dy'>,
  length: number | readonly number[],
  back = SUN_SHADOW_BACK,
): Polygon[] {
  const out: Polygon[] = [];
  const n = points.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    const reach = typeof length === 'number' ? length : length[i];
    const vx = look.dx * reach;
    const vy = look.dy * reach;
    // Left of travel on screen (y down) is (dy, -dx).
    const side = lowLeft ? 1 : -1;
    const nx = (side * (b[1] - a[1])) / len;
    const ny = (side * -(b[0] - a[0])) / len;
    if (nx * look.dx + ny * look.dy <= 1e-6) continue;
    const bx = -nx * back;
    const by = -ny * back;
    out.push([
      [a[0] + bx, a[1] + by],
      [b[0] + bx, b[1] + by],
      [b[0] + vx, b[1] + vy],
      [a[0] + vx, a[1] + vy],
    ]);
  }
  return out;
}

/** A painted border's width, cells: the card's (this when unset), kept to BORDER_MIN_WIDTH..BORDER_MAX_WIDTH. */
export const BORDER_DEFAULT_WIDTH = 0.75;
export const BORDER_MIN_WIDTH = 0.25;
export const BORDER_MAX_WIDTH = 3;
/** How much of a painted border's width its inner edge fades over. */
export const BORDER_FADE = 1 / 3;

/** The band a painted border lays on its high side, cells wide. */
export function borderWidthOf(borderWidth: number | undefined): number {
  return Math.max(BORDER_MIN_WIDTH, Math.min(BORDER_MAX_WIDTH, borderWidth ?? BORDER_DEFAULT_WIDTH));
}

// ─── A painted band's ragged inner edge ────────────────────

/** How far a painted band's inner edge wanders either way, as a share of the band's width. */
export const BORDER_WOBBLE = 1 / 3;
/**
 * Where two textured plateau tops of one height meet, how wide the soft seam between them is,
 * cells: the later top fades in over it, onto the earlier one grown this far under it.
 */
export const TOP_SEAM = 0.75;
/** A seed for `wobbleNoise` from an id, so one plateau or floor always wanders the same way. */
export function wobbleSeed(id: string | undefined): number {
  let h = 2166136261;
  for (const ch of id ?? '') h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/**
 * Smooth noise over the plane in [-1, 1]: three swells a few cells long, each at a direction
 * and phase drawn from `seed`. Low frequency, so an edge moved by it wanders, never zigzags.
 */
export function wobbleNoise(seed: number): (x: number, y: number) => number {
  let h = seed || 1;
  const next = (): number => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    h >>>= 0;
    return h / 4294967296;
  };
  const waves = [
    { length: 3.1, weight: 1 },
    { length: 1.9, weight: 0.6 },
    { length: 1.3, weight: 0.3 },
  ].map(({ length, weight }) => {
    const a = next() * Math.PI * 2;
    const k = (Math.PI * 2) / length;
    return { kx: Math.cos(a) * k, ky: Math.sin(a) * k, phase: next() * Math.PI * 2, weight };
  });
  const total = waves.reduce((n, w) => n + w.weight, 0);
  return (x, y) => waves.reduce((n, w) => n + w.weight * Math.sin(w.kx * x + w.ky * y + w.phase), 0) / total;
}

// ─── The slope's face ──────────────────────────────────────
//
// A slope shows a side face on one side of its outline only: the side pointing the way the DM
// set (the plateau's own direction, else the map's), never the sun's. Face directions are
// degrees on screen: 0 points right (+x), 90 down (+y), so they turn clockwise as seen.

/** The map's face direction when it sets none: lower right, a little more down than right. */
export const DEFAULT_FACE_DIRECTION = 60;
/** The step the editor turns a face direction by, degrees. */
export const FACE_DIRECTION_STEP = 15;

/** A face direction kept to 0..360, whole degrees. */
export function wrapDirection(deg: number): number {
  return ((Math.round(deg) % 360) + 360) % 360;
}

/** The unit vector a face direction points along, on screen (y down). */
export function faceVector(deg: number): Vec {
  const a = (deg * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a)];
}

/** The direction a plateau's faces point: its own, else the map's, else DEFAULT_FACE_DIRECTION. */
export function faceDirectionOf(owner: Pick<PlateauChild, 'faceDir'> | null | undefined, mapDirection: number | undefined): number {
  return owner?.faceDir ?? mapDirection ?? DEFAULT_FACE_DIRECTION;
}

/** How thick one ledge of a face is, cells: every ledge the same, whatever the drop. */
export const FACE_LEDGE = 0.18;
/** The most ledges a face is laid in. */
export const FACE_LEDGES_MAX = 5;
/** The deepest a face reaches out from its edge, cells, before it wanders. */
export const FACE_DEPTH_MAX = FACE_LEDGE * FACE_LEDGES_MAX;

/** How many ledges a face is laid in for a drop of `drop` cells: one more than the drop, 2 at 1 up to 5 from 4. */
export function faceBandCount(drop: number): number {
  return Math.min(FACE_LEDGES_MAX, Math.max(2, Math.round(Math.abs(drop)) + 1));
}

/**
 * How far a face reaches out from its edge, cells, for a drop of `drop` cells: its ledges, each
 * FACE_LEDGE thick, so a taller drop shows more ledges (0.36, 0.54, 0.72 and 0.90 at 1 to 4).
 */
export function faceDepth(drop: number): number {
  return faceBandCount(drop) * FACE_LEDGE;
}

/**
 * How far a face's depth wanders either way along its edge, as a share of it, so its foot is
 * no copy of the outline. The noise it scales seldom reaches its ends: about 18 % in practice.
 */
export const FACE_DEPTH_WANDER = 0.3;
/** How slowly the depth wanders: the noise's swells, cells long, are its own (1.3 to 3.1) times this. */
export const FACE_DEPTH_WANDER_SCALE = 0.7;
/** The furthest a face can reach from its edge for a drop of `drop`, wander and all: what bounds and shadows pad by. */
export function faceReach(drop: number): number {
  return faceDepth(drop) * (1 + FACE_DEPTH_WANDER);
}

/**
 * How far a boundary between two ledges steps either way along the edge, and how far each sits
 * off its place by plateau, both in ledges: together well inside half a ledge, so the
 * boundaries never cross.
 */
export const FACE_LEDGE_STEP = 0.25;
export const FACE_LEDGE_JITTER = 0.05;
/** How long a boundary holds one level along the edge before it steps, cells (its runs vary round this). */
export const FACE_LEDGE_RUN = 0.32;
/** How closely a face's edge is sampled for its wander and its steps, cells. */
export const FACE_SAMPLE = 0.08;
/** Where the drop changes along a facing stretch (a lower plateau against part of it), the ledges ease from one count to the other over this many cells. */
export const FACE_JOIN = 0.5;
/** At the end of a facing stretch the face eases into the rim over this many times its full depth there, along the edge. */
export const FACE_END = 1.6;
/** A turned-away stretch shorter than this, cells, between two facing ones does not end the face: a jagged edge does not scallop. */
export const FACE_GAP = 0.4;

/** What a ledge band leaves of the colour beneath it over plain ground: this at the rim… */
export const FACE_KEEP_RIM = 0.8;
/** …down to this at the foot, in even steps (a face of two ledges keeps FACE_KEEP_TWO at its foot). */
export const FACE_KEEP_FOOT = 0.54;
export const FACE_KEEP_TWO = 0.56;
/** The colour the ground bands darken towards: a deep umber, so grass and stone go dark, not grey. */
export const FACE_SHADE_COLOR = 0x1c1610;
/**
 * Over a face tile the bands are the tile's own light: the top ledge lifted by a pale warm wash
 * added over it (about a third of a face tile's mean tone), the last ledge darkened to
 * FACE_TILE_KEEP, with four or five ledges the one above it darkened half as far, the rest the
 * tile as it is.
 */
export const FACE_LIFT_COLOR = 0xfff0d8;
export const FACE_LIFT_ALPHA = 0.14;
export const FACE_TILE_KEEP = 0.74;

/** How one ledge band is shaded: a wash added over it (`add`), or darkened towards `color`; `alpha` its strength. */
export interface FaceBandShade {
  color: number;
  alpha: number;
  add: boolean;
}

/** How each of `count` ledge bands (2 to 5) is shaded, rim to foot, over a face tile (`tile`) or over plain ground; null leaves it as it is. */
export function faceBandShades(count: number, tile: boolean): (FaceBandShade | null)[] {
  const n = Math.max(2, Math.min(FACE_LEDGES_MAX, Math.round(count)));
  const dark = (keep: number): FaceBandShade => ({ color: FACE_SHADE_COLOR, alpha: 1 - keep, add: false });
  if (!tile) {
    // Darkening only, rim to foot in even steps.
    if (n === 2) return [dark(FACE_KEEP_RIM), dark(FACE_KEEP_TWO)];
    return Array.from({ length: n }, (_, k) => dark(FACE_KEEP_RIM + ((FACE_KEEP_FOOT - FACE_KEEP_RIM) * k) / (n - 1)));
  }
  const out: (FaceBandShade | null)[] = Array.from({ length: n }, () => null);
  out[0] = { color: FACE_LIFT_COLOR, alpha: FACE_LIFT_ALPHA, add: true };
  out[n - 1] = dark(FACE_TILE_KEEP);
  if (n >= 4) out[n - 2] = dark(1 - (1 - FACE_TILE_KEEP) / 2);
  return out;
}

/** How many cells a face tile spans, laid finer than a floor so its fall-line streaks read on a face a cell deep. */
export const FACE_TILE_CELLS = 2;

/** The face's lines: fine ink at partial opacity, so they take the hue of what is under them. */
export const FACE_INK = 0x2b2420;
/** The line along the face's foot, cells wide. */
export const FACE_FOOT_WIDTH = 0.022;
export const FACE_FOOT_ALPHA = 0.6;
/** The finer line between two ledge bands (the card's Ledge lines). */
export const FACE_LEDGE_WIDTH = 0.014;
export const FACE_LEDGE_ALPHA = 0.35;
/** The rim line along the outline where the edge squarely faces the face direction… */
export const FACE_RIM_WIDTH = 0.022;
export const FACE_RIM_ALPHA = 0.7;
/** …and on the far side, finer and lighter. */
export const FACE_RIM_FAR_WIDTH = 0.014;
export const FACE_RIM_FAR_ALPHA = 0.45;
/** How many steps the rim goes from its far weight to its face weight in. */
export const FACE_RIM_STEPS = 4;
/** The pale highlight just inside the rim on the far side: its colour, opacity, width and gap from the rim, cells. */
export const FACE_HIGHLIGHT_COLOR = 0xfff6e2;
export const FACE_HIGHLIGHT_ALPHA = 0.4;
export const FACE_HIGHLIGHT_WIDTH = 0.04;
export const FACE_HIGHLIGHT_INSET = 0.035;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * How much of the rim's face weight a stretch of edge takes, 0 to 1, from how squarely its
 * low-side normal faces the face direction (`facing`, their dot): none turned away, all from
 * a little past side-on.
 */
export function rimWeight(facing: number): number {
  return smoothstep(-0.25, 0.45, facing);
}

/** How strongly a stretch of edge turned away from the face direction (`facing` its dot) carries the highlight. */
export function highlightWeight(facing: number): number {
  return smoothstep(0.1, 0.55, -facing);
}

/** The segments of a run with their unit normals to the low side (`lowLeft`: a plateau's ring; else a pit's). */
export function lowSegments(points: Polygon, closed: boolean, lowLeft: boolean): { a: Vec; b: Vec; n: Vec }[] {
  const out: { a: Vec; b: Vec; n: Vec }[] = [];
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i] as Vec;
    const b = points[(i + 1) % points.length] as Vec;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    // Left of travel on screen (y down) is (dy, -dx).
    const side = lowLeft ? 1 : -1;
    out.push({ a, b, n: [(side * (b[1] - a[1])) / len, (side * -(b[0] - a[0])) / len] });
  }
  return out;
}

/**
 * How deep a face reaches at a point of its edge: a fixed depth, or one that varies along the
 * edge, read at the point and at how far along the run it lies (cells from its start).
 */
export type FaceDepthAt = number | ((p: Vec, along: number) => number);

/**
 * The sweep of a run's face: every segment whose low side faces along `v` (a unit vector),
 * swept `depth` along it, the quads joined. Not yet cut to the low side. A depth that varies
 * is read every FACE_SAMPLE along the edge, so the foot follows it.
 */
export function faceSweep(points: Polygon, closed: boolean, lowLeft: boolean, v: Vec, depth: FaceDepthAt): Polygon[] {
  if (typeof depth === 'number' && depth <= 0) return [];
  const quads: Polygon[] = [];
  const push = (a: Vec, b: Vec, da: number, db: number) => {
    if (da <= 0 && db <= 0) return;
    const quad: Polygon = [a, b, [b[0] + v[0] * db, b[1] + v[1] * db], [a[0] + v[0] * da, a[1] + v[1] * da]];
    // Wound positive, so the quads join under the non-zero rule whichever way the run turns.
    quads.push(ringArea(quad) < 0 ? quad.reverse() : quad);
  };
  let along = 0;
  for (const { a, b, n } of lowSegments(points, closed, lowLeft)) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const start = along;
    along += len;
    if (n[0] * v[0] + n[1] * v[1] <= 1e-6) continue;
    if (typeof depth === 'number') {
      push(a, b, depth, depth);
      continue;
    }
    const steps = Math.max(1, Math.ceil(len / FACE_SAMPLE));
    let p = a;
    let dp = depth(a, start);
    for (let k = 1; k <= steps; k++) {
      const q: Vec = k === steps ? b : [a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps];
      const dq = depth(q, start + (len * k) / steps);
      push(p, q, dp, dq);
      p = q;
      dp = dq;
    }
  }
  return quads.length === 0 ? [] : clipper2Engine.union(quads, []);
}

/** A small hash of a seed and a whole number, in [-1, 1]. */
function hashUnit(seed: number, i: number): number {
  let h = Math.imul(seed ^ Math.imul(i, 0x27d4eb2d), 0x165667b1) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  return ((h >>> 0) / 4294967296) * 2 - 1;
}

/**
 * A stepped noise along a line, in [-1, 1]: flat runs about `run` cells long, their lengths
 * varied, with a short ramp between one level and the next. What makes a ledge boundary read as
 * stepped rock rather than a ruled line.
 */
export function steppedNoise(seed: number, run: number): (along: number) => number {
  const smooth = (u: number): number => {
    const i = Math.floor(u);
    const f = u - i;
    return hashUnit(seed + 7, i) + (hashUnit(seed + 7, i + 1) - hashUnit(seed + 7, i)) * smoothstep(0, 1, f);
  };
  return (along) => {
    const w = along / run + 0.6 * smooth(along / (run * 2.3));
    const i = Math.floor(w);
    const a = hashUnit(seed, i);
    return a + (hashUnit(seed, i + 1) - a) * smoothstep(0.8, 1, w - i);
  };
}

/**
 * How far each boundary between `count` ledges sits off its place along a face, in ledges, at
 * `along` cells down the run: set off a little by plateau (FACE_LEDGE_JITTER) and stepped along
 * the edge (FACE_LEDGE_STEP). Never as much as half a ledge, so the boundaries keep their order.
 */
export function ledgeSteps(seed: number, count: number): ((along: number) => number)[] {
  const out: ((along: number) => number)[] = [];
  for (let k = 1; k < count; k++) {
    const base = FACE_LEDGE_JITTER * hashUnit(seed + 101, k);
    const step = steppedNoise((seed + 977 * k) >>> 0, FACE_LEDGE_RUN);
    out.push((along) => base + FACE_LEDGE_STEP * step(along));
  }
  return out;
}

/**
 * Which ends of a run its face eases into the rim at (true), and which it runs on at to be
 * clipped (false): where the ring goes on under a higher plateau, or on into a slope of the same
 * height whose face shows there too.
 */
export interface FaceEnds {
  start: boolean;
  end: boolean;
}

/** One stretch of a run's line, with where it lies along the run and how many ledges its own drop asks. */
interface FaceSeg {
  a: Vec;
  b: Vec;
  s0: number;
  s1: number;
  facing: boolean;
  ledges: number;
}

/** A chain of facing stretches: where it starts and ends along the run, and whether each end eases. */
interface FaceChain {
  first: number;
  last: number;
  s0: number;
  s1: number;
  easeStart: boolean;
  easeEnd: boolean;
}

/**
 * A run as an open line: a closed one opened at the start of its longest stretch turned away
 * from `v`, so no face is cut by the seam. Its drops go with it, one per segment.
 */
function openRun(points: Polygon, closed: boolean, lowLeft: boolean, v: Vec, drops: readonly number[]): { pts: Polygon; drops: number[] } {
  if (!closed) return { pts: points, drops: [...drops] };
  const n = points.length;
  const facing = points.map((a, i) => {
    const b = points[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const side = lowLeft ? 1 : -1;
    return ((side * (b[1] - a[1])) / len) * v[0] + ((side * -(b[0] - a[0])) / len) * v[1] > 1e-6;
  });
  let best = 0;
  let bestLen = -1;
  for (let i = 0; i < n; i++) {
    if (facing[i] || !facing[(i - 1 + n) % n]) continue;
    let len = 0;
    for (let k = i; !facing[k % n] && k < i + n; k++) {
      const a = points[k % n];
      const b = points[(k + 1) % n];
      len += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    if (len > bestLen) {
      bestLen = len;
      best = i;
    }
  }
  const pts: Polygon = [];
  const out: number[] = [];
  for (let k = 0; k <= n; k++) pts.push(points[(best + k) % n]);
  for (let k = 0; k < n; k++) out.push(drops[(best + k) % n]);
  return { pts, drops: out };
}

/**
 * How many ledges a face shows at each point of its run, `along` cells from its start: the
 * ledge count of the drop there, eased over FACE_JOIN where the drop changes, falling to 0 at
 * an eased end of a facing chain over FACE_END times the full depth there.
 */
function ledgeCount(segs: readonly FaceSeg[], chains: readonly FaceChain[]): (along: number) => number {
  return (s) => {
    const chain = chains.find((c) => s >= c.s0 - 1e-9 && s <= c.s1 + 1e-9);
    if (!chain) return 0;
    // The segment under s, and the nearest change of the count within the chain.
    let at = chain.first;
    while (at < chain.last && segs[at].s1 < s) at++;
    let target = segs[at].ledges;
    let best = Infinity;
    for (let i = chain.first; i < chain.last; i++) {
      if (segs[i].ledges === segs[i + 1].ledges) continue;
      const c = segs[i].s1;
      if (Math.abs(s - c) < Math.min(best, FACE_JOIN / 2)) {
        best = Math.abs(s - c);
        target = segs[i].ledges + (segs[i + 1].ledges - segs[i].ledges) * smoothstep(c - FACE_JOIN / 2, c + FACE_JOIN / 2, s);
      }
    }
    const reach = (ledges: number) => FACE_END * FACE_LEDGE * ledges;
    const fromStart = chain.easeStart ? smoothstep(0, reach(segs[chain.first].ledges), s - chain.s0) : 1;
    const fromEnd = chain.easeEnd ? smoothstep(0, reach(segs[chain.last].ledges), chain.s1 - s) : 1;
    return target * Math.min(fromStart, fromEnd);
  };
}

/**
 * The face of one run of edge with the face direction `deg`: its facing segments swept along
 * it, cut to the run's low side (`lowLeft`: outside `rings`, the band's; else inside them). A
 * raised ring's face hangs off the edges that point along the direction; a pit's is its far
 * wall, inside the rim on the side the direction comes from.
 *
 * The face is laid in ledges FACE_LEDGE thick, counted from the rim: at each point as many as
 * the drop there asks (`drop`, one for the run or one per segment, `faceBandCount`), so where a
 * lower plateau lies against part of the edge its lowest ledges pinch out and the upper ones run
 * on unbroken. At each end of a facing chain (`ends` says which run ends count) the ledges ease
 * to none, so the foot curves in to meet the rim. Band k of n lies between boundaries k and k + 1.
 *
 * With a `seed` (the plateau's, `wobbleSeed`) the face is rock, not a ruled strip: its depth
 * wanders slowly along the edge (FACE_DEPTH_WANDER) and the ledge boundaries step unevenly
 * (`ledgeSteps`), the same way on every redraw. Without one it is exact, for the tests.
 */
export function slopeFace(
  points: Polygon,
  closed: boolean,
  lowLeft: boolean,
  rings: Polygon[],
  deg: number,
  drop: number | readonly number[],
  seed?: number,
  ends: FaceEnds = { start: true, end: true },
): SlopeFace {
  const v = faceVector(deg);
  const count = closed ? points.length : points.length - 1;
  const perSeg = typeof drop === 'number' ? Array.from({ length: count }, () => drop) : drop;
  const most = perSeg.reduce((m, d) => Math.max(m, Math.abs(d)), 0);
  const depth = faceDepth(most);
  const n = faceBandCount(most);
  const open = openRun(points, closed, lowLeft, v, perSeg);
  const eased: FaceEnds = closed ? { start: true, end: true } : ends;

  const segs: FaceSeg[] = [];
  let along = 0;
  for (let i = 0; i < open.pts.length - 1; i++) {
    const a = open.pts[i] as Vec;
    const b = open.pts[i + 1] as Vec;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    const side = lowLeft ? 1 : -1;
    const facing = ((side * (b[1] - a[1])) / len) * v[0] + ((side * -(b[0] - a[0])) / len) * v[1] > 1e-6;
    segs.push({ a, b, s0: along, s1: along + len, facing, ledges: faceBandCount(open.drops[i] ?? most) });
    along += len;
  }
  const total = along;
  const chains: FaceChain[] = [];
  segs.forEach((g, i) => {
    if (!g.facing) return;
    const last = chains[chains.length - 1];
    if (last && g.s0 - last.s1 < FACE_GAP) {
      last.last = i;
      last.s1 = g.s1;
    } else {
      chains.push({ first: i, last: i, s0: g.s0, s1: g.s1, easeStart: true, easeEnd: true });
    }
  });
  for (const c of chains) {
    if (c.s0 <= 1e-9) c.easeStart = eased.start;
    if (c.s1 >= total - 1e-9) c.easeEnd = eased.end;
  }
  const u = ledgeCount(segs, chains);

  const cut = (sweep: Polygon[]): Polygon[] =>
    sweep.length === 0 ? [] : lowLeft ? clipper2Engine.difference(sweep, rings) : clipper2Engine.intersection(sweep, rings);
  const wander = seed === undefined ? null : wobbleNoise(seed);
  const w = (p: Vec) => (wander ? 1 + FACE_DEPTH_WANDER * wander(p[0] / FACE_DEPTH_WANDER_SCALE, p[1] / FACE_DEPTH_WANDER_SCALE) : 1);
  const offsets = seed === undefined ? null : ledgeSteps(seed, n);
  // Boundary k (1 to n - 1) lies k ledges from the rim, stepped, never past the foot; boundary n is the foot.
  const depthTo = (k: number): FaceDepthAt => (p, s) => {
    const ledges = u(s);
    const at = k >= n ? ledges : Math.min(ledges, k + (offsets ? offsets[k - 1](s) : 0));
    return FACE_LEDGE * w(p) * at;
  };
  const steps = Array.from({ length: n }, (_, k) => cut(faceSweep(open.pts, false, lowLeft, v, depthTo(k + 1))));
  const bands = steps.map((s, k) => (k === 0 || s.length === 0 ? s : clipper2Engine.difference(s, steps[k - 1])));
  return { depth, region: steps[n - 1], bands, steps };
}

/** A run's face: its region and ledge bands, and the sweep to each band's lower boundary. */
export interface SlopeFace {
  /** How far it reaches along the face direction, cells. */
  depth: number;
  /** The whole face. */
  region: Polygon[];
  /** The ledge bands, rim to foot; together they make `region`. */
  bands: Polygon[][];
  /** The face as far as each band's lower boundary, rim to foot: the last is `region`. */
  steps: Polygon[][];
}

/** How near a ring edge's middle lies to a line it is taken as running along, cells: past Clipper's snap. */
const ON_LINE = 0.02;

/**
 * The stretches of `rings`' outlines that do not run along any of `along` (closed rings), as
 * open polylines: a face's foot and sides, once the rim it hangs from is taken out.
 */
export function linesOff(rings: Polygon[], along: Polygon[]): Polygon[] {
  const on = (p: Vec): boolean => along.some((r) => r.length >= 2 && distanceToRing(p, r) < ON_LINE);
  const out: Polygon[] = [];
  for (const ring of rings) {
    const n = ring.length;
    if (n < 2) continue;
    const off = ring.map((a, i) => {
      const b = ring[(i + 1) % n];
      return !on([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    });
    if (off.every(Boolean)) {
      out.push([...ring, ring[0]]);
      continue;
    }
    // Start just after an edge on the line, so no stretch straddles the seam.
    const start = off.findIndex((o, i) => o && !off[(i - 1 + n) % n]);
    if (start < 0) continue;
    let line: Polygon | null = null;
    for (let k = start; k < start + n; k++) {
      const i = k % n;
      if (off[i]) {
        if (!line) line = [ring[i]];
        line.push(ring[(i + 1) % n]);
      } else if (line) {
        out.push(line);
        line = null;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function distanceToRing(p: Vec, ring: Polygon): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - (ax + dx * t), p[1] - (ay + dy * t)));
  }
  return best;
}

function ringArea(r: Polygon): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) a += r[i][0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * r[i][1];
  return a / 2;
}

/** The widest a mitre at a concave corner may reach, as a multiple of the offset. */
const MITRE_LIMIT = 4;
/** A rounded corner is cut into faces of at most this turn, degrees. */
const ARC_STEP = 15;

interface Seg {
  a: Vec;
  b: Vec;
  /** Unit normal to the low side. */
  n: Vec;
}

/** Where each corner's offset goes: per segment, the directions its two ends move along, and the arcs at convex corners. */
function offsetFrame(points: Polygon, closed: boolean, lowLeft: boolean) {
  const pts: Vec[] = [];
  for (const p of points) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-9) pts.push([p[0], p[1]]);
  }
  if (closed && pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-9) pts.pop();
  const segs: Seg[] = [];
  const count = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < count; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // Left of travel on screen (y down) is (dy, -dx).
    const side = lowLeft ? 1 : -1;
    segs.push({ a, b, n: [(side * (b[1] - a[1])) / len, (side * -(b[0] - a[0])) / len] });
  }
  // Per segment end: the direction that end's offset moves (its normal, or a mitre at a concave corner).
  const start: Vec[] = segs.map((g) => g.n);
  const end: Vec[] = segs.map((g) => g.n);
  // Per corner after segment i: the arc from its normal round to the next one's, when convex.
  const arcs: ({ at: Vec; from: number; sweep: number } | null)[] = segs.map(() => null);
  for (let i = 0; i < segs.length; i++) {
    if (!closed && i === segs.length - 1) break;
    const g0 = segs[i];
    const g1 = segs[(i + 1) % segs.length];
    const u0: Vec = [g0.b[0] - g0.a[0], g0.b[1] - g0.a[1]];
    const convex = u0[0] * g1.n[0] + u0[1] * g1.n[1] > 1e-12;
    if (convex) {
      const from = Math.atan2(g0.n[1], g0.n[0]);
      let sweep = Math.atan2(g1.n[1], g1.n[0]) - from;
      while (sweep > Math.PI) sweep -= 2 * Math.PI;
      while (sweep < -Math.PI) sweep += 2 * Math.PI;
      arcs[i] = { at: g0.b, from, sweep };
    } else {
      const k = 1 + g0.n[0] * g1.n[0] + g0.n[1] * g1.n[1];
      const m: Vec = [(g0.n[0] + g1.n[0]) / k, (g0.n[1] + g1.n[1]) / k];
      if (k > 1e-6 && Math.hypot(m[0], m[1]) <= MITRE_LIMIT) {
        end[i] = m;
        start[(i + 1) % segs.length] = m;
      }
    }
  }
  return { segs, start, end, arcs };
}

const along = (p: Vec, d: Vec, t: number): Vec => [p[0] + d[0] * t, p[1] + d[1] * t];
const onArc = (c: Vec, angle: number, r: number): Vec => [c[0] + Math.cos(angle) * r, c[1] + Math.sin(angle) * r];

/**
 * The run's line pushed `d` cells to its low side (`lowLeft`; pass the other side to push it
 * up onto the top): mitred at concave corners, rounded at convex ones.
 */
export function offsetPath(points: Polygon, closed: boolean, lowLeft: boolean, d: number): Polygon {
  const { segs, start, end, arcs } = offsetFrame(points, closed, lowLeft);
  const out: Polygon = [];
  segs.forEach((g, i) => {
    out.push(along(g.a, start[i], d), along(g.b, end[i], d));
    const arc = arcs[i];
    if (!arc) return;
    const slices = Math.max(1, Math.ceil((Math.abs(arc.sweep) * 180) / Math.PI / ARC_STEP));
    for (let j = 1; j < slices; j++) out.push(onArc(arc.at, arc.from + (arc.sweep * j) / slices, d));
  });
  if (closed && out.length > 0) out.push(out[0]);
  return out;
}

// ─── The blur ──────────────────────────────────────────────

/** The 5-tap kernel's weights, centre out, as Pixi's BlurFilter ships them (const GAUSSIAN_VALUES[5]). */
export const BLUR_WEIGHTS_5 = [0.250301, 0.221461, 0.153388];
/** That kernel's spread, in taps: the standard deviation its weights make. */
const KERNEL_SIGMA = Math.sqrt(2 * (BLUR_WEIGHTS_5[1] * 1 + BLUR_WEIGHTS_5[2] * 4));
/** A Gaussian edge falls from 90 % to 10 % over this many standard deviations. */
const FADE_PER_SIGMA = 2.5631;

/**
 * The BlurFilter strength (5 taps) that fades an edge from 90 % to 10 % over `fade` cells at
 * `pxPerCell` screen pixels a cell. Pixi spreads its taps `strength` pixels apart (the passes
 * add up to that by variance), so the edge's spread is KERNEL_SIGMA × strength pixels.
 */
export function blurStrengthFor(fade: number, pxPerCell: number): number {
  return (fade / FADE_PER_SIGMA / KERNEL_SIGMA) * pxPerCell;
}

/** The BlurFilter strength whose edge spreads `sigma` pixels (one standard deviation). */
export function blurStrengthForSigma(sigma: number): number {
  return sigma / KERNEL_SIGMA;
}

/**
 * How many passes a BlurFilter of `strength` pixels needs to come out a gradient rather than a
 * staircase. Pixi spaces its first pass's taps `strength / sqrt(Σ 4^-i)` apart and halves that
 * each pass; a hard edge through it steps at the last pass's spacing, so passes are added until
 * that spacing is a pixel or less. Fewer passes left a light's shadow edge in visible treads.
 */
export function blurPasses(strength: number): number {
  let sum = 1;
  for (let passes = 1; passes < 8; passes++) {
    if (strength / Math.sqrt(sum) / 2 ** (passes - 1) <= 1) return passes;
    sum += 4 ** -passes;
  }
  return 8;
}
