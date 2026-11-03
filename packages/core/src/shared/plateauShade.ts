// How a raised edge darkens the ground below it, as numbers and outlines: the drop shade that
// hugs every edge on its low side, the sun's shadow cast off it, and the graded shade down a
// slope. Pure, for the plateau renderer, the shadow pass and their tests; Pixi draws them.

import type { Polygon } from '../types/geometry';
import type { ShadowLook } from './shadows';

type Vec = [number, number];

// ─── The drop shade ────────────────────────────────────────

/** How dark the drop shade is at the edge: black at this opacity, fading to none at its width. */
export const DROP_SHADE_ALPHA = 0.45;
/** The drop shade's width, cells: this, plus DROP_SHADE_PER_CELL a cell of drop, up to DROP_SHADE_MAX. */
export const DROP_SHADE_BASE = 0.35;
export const DROP_SHADE_PER_CELL = 0.3;
export const DROP_SHADE_MAX = 1.5;
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

/** Where a slope's contour lines lie across it, as distances from its top: one a cell of drop, the last at the foot. */
export function contourOffsets(drop: number, width: number): number[] {
  const cells = Math.max(1, Math.round(Math.abs(drop)));
  return Array.from({ length: cells }, (_, k) => ((k + 1) * width) / cells);
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
