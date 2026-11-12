// How a raised edge darkens the ground below it, as numbers and outlines: the drop shade that
// hugs every edge on its low side, the sun's shadow cast off it, and the graded shade down a
// slope. Pure, for the plateau renderer, the shadow pass and their tests; Pixi draws them.

import type { Polygon } from '../types/geometry';
import type { ShadowLook } from './shadows';

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
/** How many nested bands the drop shade is laid in before the blur smooths them. */
export const DROP_SHADE_STEPS = 8;

/** How wide the drop shade below an edge `drop` cells high is, cells. */
export function dropShadeWidth(drop: number): number {
  return Math.min(DROP_SHADE_MAX, DROP_SHADE_BASE + DROP_SHADE_PER_CELL * Math.abs(drop));
}

/**
 * A shade laid as `steps` nested bands, the k-th reaching k/steps of the way out: each band's
 * opacity, so that where they stack the black over the ground falls in even steps from
 * `peak` at the edge to peak/steps in the outermost band.
 */
export function nestedAlphas(peak: number, steps: number): number[] {
  // Band j (1-based) is covered by bands j..steps; its stacked opacity is to be
  // peak × (1 - (j - 1)/steps), so what lets light through there is T_j = 1 - that.
  const through = (j: number) => (j > steps ? 1 : 1 - peak * (1 - (j - 1) / steps));
  return Array.from({ length: steps }, (_, i) => 1 - through(i + 1) / through(i + 2));
}

/** The opacity black bands of `alphas` stack to where the first `from` of them no longer reach. */
export function stackedAlpha(alphas: readonly number[], from: number): number {
  let through = 1;
  for (let k = from; k < alphas.length; k++) through *= 1 - alphas[k];
  return 1 - through;
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
 */
export function leeSweeps(
  points: Polygon,
  closed: boolean,
  lowLeft: boolean,
  look: Pick<ShadowLook, 'dx' | 'dy'>,
  length: number,
  back = SUN_SHADOW_BACK,
): Polygon[] {
  const out: Polygon[] = [];
  const n = points.length;
  const vx = look.dx * length;
  const vy = look.dy * length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
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

// ─── The slope ─────────────────────────────────────────────

/** How wide a slope is, cells: the card's slope width (1 when unset), whatever the drop, at most this. */
export const SLOPE_MAX_WIDTH = 3;

/** The band a slope lays outside its outline, cells wide. */
export function slopeWidthOf(slopeWidth: number | undefined): number {
  return Math.max(0, Math.min(SLOPE_MAX_WIDTH, slopeWidth ?? 1));
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
/** The densest a wobbled ring's points lie, cells apart: close enough that the wander reads as a curve. */
const WOBBLE_STEP = 0.15;

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

/** The point of `line` (a polyline) nearest `p`, and how far it is. */
function nearestOnLine(p: Vec, line: Polygon): { q: Vec; d: number } {
  let best: Vec = [line[0][0], line[0][1]];
  let bestD = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i];
    const [bx, by] = line[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2)) : 0;
    const q: Vec = [ax + dx * t, ay + dy * t];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return { q: best, d: bestD };
}

/**
 * `rings` (a band grown `reach` round `line`) with their far edge made ragged: each point is
 * moved straight away from or towards `line`, by up to `amp` as `noise` says at the nearest
 * point of the line, and by less the nearer it lies to the line, so the band keeps its crisp
 * edge on the line itself and only its inner edge wanders. Taken along the line, the same noise
 * moves every one of a soft edge's nested steps alike, so they stay nested.
 */
export function wobbleRings(rings: Polygon[], line: Polygon, reach: number, amp: number, noise: (x: number, y: number) => number): Polygon[] {
  if (amp <= 0 || reach <= 0 || line.length < 2) return rings;
  return rings.map((ring) => {
    const out: Polygon = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / WOBBLE_STEP));
      for (let k = 0; k < n; k++) {
        const p: Vec = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
        const { q, d } = nearestOnLine(p, line);
        if (d < 1e-9) {
          out.push(p);
          continue;
        }
        const t = Math.min(1, d / reach);
        const shift = amp * noise(q[0], q[1]) * t * t * (3 - 2 * t);
        out.push([p[0] + ((p[0] - q[0]) / d) * shift, p[1] + ((p[1] - q[1]) / d) * shift]);
      }
    }
    return out;
  });
}

/** How dark a slope is at its foot: black at this opacity, from none at its top. */
export const SLOPE_FOOT_SHADE = 0.4;
/** How much lighter a slope face turned square to the sun is than one turned from it. */
export const SLOPE_SUN_LIGHTER = 0.4;
/** How many bands across a slope its shade is laid in. */
export const SLOPE_STEPS = 16;
/** The slope's contour lines: ink, 1.5 px wide at 1x (20 px a cell), at this opacity. */
export const SLOPE_CONTOUR_WIDTH = 1.5 / 20;
export const SLOPE_CONTOUR_ALPHA = 0.6;

/** How dark the k-th of SLOPE_STEPS bands down a slope is, from its top (k = 0). */
export function slopeBandAlpha(k: number, steps = SLOPE_STEPS): number {
  return (SLOPE_FOOT_SHADE * (k + 0.5)) / steps;
}

/**
 * How much of its shade a slope face turned to `normal` (pointing down the slope) keeps under
 * `look`: all of it turned from the light or with none, 1 - SLOPE_SUN_LIGHTER square to it.
 */
export function slopeSunFactor(normal: Vec, look: Pick<ShadowLook, 'dx' | 'dy'> | null): number {
  if (!look) return 1;
  // The shadow runs along (dx, dy), away from the light: a face turned to the light points the other way.
  const facing = Math.max(0, Math.min(1, -(normal[0] * look.dx + normal[1] * look.dy)));
  return 1 - SLOPE_SUN_LIGHTER * facing;
}

/** Where a slope's contour lines lie across it, as distances from its outline: one a cell of drop, evenly spaced inside the band. */
export function contourOffsets(drop: number, width: number): number[] {
  const cells = Math.max(1, Math.round(Math.abs(drop)));
  return Array.from({ length: cells }, (_, k) => ((k + 1) * width) / (cells + 1));
}

/** One face of a slope's band: which way it faces down the slope, and its bands from the outline out. */
export interface RampFace {
  normal: Vec;
  bands: Polygon[];
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
 * A slope's band, `width` cells out on the low side of a run (`lowLeft`: a plateau's ring;
 * else a pit's), in faces: one per straight stretch, mitred at concave corners, and a fan of
 * rounded faces at each convex one. Each face's `steps` bands run from the outline out.
 */
export function slopeRamp(points: Polygon, closed: boolean, lowLeft: boolean, width: number, steps = SLOPE_STEPS): RampFace[] {
  const { segs, start, end, arcs } = offsetFrame(points, closed, lowLeft);
  const faces: RampFace[] = [];
  const ts = Array.from({ length: steps + 1 }, (_, k) => (width * k) / steps);
  segs.forEach((g, i) => {
    faces.push({
      normal: g.n,
      bands: ts.slice(0, -1).map((t0, k) => {
        const t1 = ts[k + 1];
        return [along(g.a, start[i], t0), along(g.b, end[i], t0), along(g.b, end[i], t1), along(g.a, start[i], t1)];
      }),
    });
    const arc = arcs[i];
    if (!arc) return;
    const slices = Math.max(1, Math.ceil((Math.abs(arc.sweep) * 180) / Math.PI / ARC_STEP));
    for (let j = 0; j < slices; j++) {
      const a0 = arc.from + (arc.sweep * j) / slices;
      const a1 = arc.from + (arc.sweep * (j + 1)) / slices;
      const mid = (a0 + a1) / 2;
      faces.push({
        normal: [Math.cos(mid), Math.sin(mid)],
        bands: ts.slice(0, -1).map((t0, k) => {
          const t1 = ts[k + 1];
          return t0 === 0
            ? [arc.at, onArc(arc.at, a0, t1), onArc(arc.at, mid, t1), onArc(arc.at, a1, t1)]
            : [onArc(arc.at, a0, t0), onArc(arc.at, a0, t1), onArc(arc.at, mid, t1), onArc(arc.at, a1, t1), onArc(arc.at, a1, t0), onArc(arc.at, mid, t0)];
        }),
      });
    }
  });
  return faces;
}

/** The run's line pushed `d` cells to its low side: mitred at concave corners, rounded at convex ones. */
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
