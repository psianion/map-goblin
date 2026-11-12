// A Path: a line of nodes drawn as the pack's path units laid one after another along it,
// each piece at its own length and never stretched (decided 2 November). Width scales the
// units; Curve runs the line through its nodes as a spline and Smoothness rounds what is
// left of its corners; the transitions at each end fade the first and last few units in or
// out (Fade) or taper them from or to nothing across the path (Grow, Shrink).
//
// A piece tagged `soft` is drawn instead as one band following the line (`softPathStrip`),
// its art repeating along it, so a bend runs on unbroken.
//
// The child type is 'pathway': 'path' children are the retired Path tool's, which every
// load still drops (store/migration.ts).

import type { PathwayChild } from './types';
import { interpolateCatmullRom } from '../geometry/catmullRom';
import { effectiveContours } from '../engine/tools/childTransform';

export type TransitionIn = PathwayChild['transitionIn'];
export type TransitionOut = PathwayChild['transitionOut'];

/** How many units at each end a transition ramps over. */
export const TRANSITION_UNITS = 3;
/** Corner-cutting passes at full Smoothness. */
const SMOOTH_PASSES = 4;

type Pt = [number, number];

/** One pass of Chaikin's corner cutting over an open line, cutting `q` of each edge; the ends stay. */
function cutCorners(line: Pt[], q: number): Pt[] {
  if (line.length < 3) return line;
  const out: Pt[] = [line[0]];
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i];
    const [bx, by] = line[i + 1];
    if (i > 0) out.push([ax + (bx - ax) * q, ay + (by - ay) * q]);
    if (i < line.length - 2) out.push([bx + (ax - bx) * q, by + (ay - by) * q]);
  }
  out.push(line[line.length - 1]);
  return out;
}

/**
 * The line a path's units are laid along, in world cells: its nodes (its transform folded
 * in), through a spline when Curve is on, then rounded by Smoothness (0 sharp, 1 round).
 */
export function pathwayLine(p: Pick<PathwayChild, 'contours' | 'transform' | 'curve' | 'smoothness'>): Pt[] {
  let line = (effectiveContours(p)[0] ?? []).map(([x, y]): Pt => [x, y]);
  if (line.length < 2) return line;
  if (p.curve && line.length > 2) line = interpolateCatmullRom(line, 12) as Pt[];
  const s = Math.min(1, Math.max(0, p.smoothness));
  if (s > 0) for (let k = 0; k < SMOOTH_PASSES; k++) line = cutCorners(line, 0.25 * s);
  return line;
}

/** A unit as laid: its centre, its turn, its scale along and across the path, its alpha. */
export interface PathUnit {
  x: number;
  y: number;
  rotation: number;
  /** Along the path: the width's scale, the same for every unit. */
  scaleAlong: number;
  /** Across the path: the width's scale, times the taper of a Grow or Shrink end. */
  scaleAcross: number;
  alpha: number;
}

/** A unit's own size, in cells at scale 1: its length along the path and its width across it. */
export interface UnitSize {
  length: number;
  width: number;
}

/** The ramp at unit `i` of `n` for one end's transition: 1 off the ramp, rising toward 1 over it. */
function ramp(k: number, n: number): number {
  const over = Math.min(TRANSITION_UNITS, Math.floor(n / 2));
  return k < over ? (k + 1) / (over + 1) : 1;
}

/**
 * The units a path of `line` lays, end to end from its start: each `unit.length` long at
 * the scale `width / unit.width` gives, centred on its stretch of the line and turned along
 * the chord across it. The line is covered with as many whole units as fit, rounded up, so
 * no gap opens at the end; the units then share the length evenly, overlapping by the small
 * remainder, and none is ever stretched.
 */
export function layPathUnits(
  line: readonly Pt[],
  unit: UnitSize,
  width: number,
  transitionIn: TransitionIn,
  transitionOut: TransitionOut,
): PathUnit[] {
  if (line.length < 2 || unit.length <= 0 || unit.width <= 0 || width <= 0) return [];
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const total = cum[cum.length - 1];
  if (total <= 1e-6) return [];
  const scale = width / unit.width;
  const length = unit.length * scale;
  const n = Math.max(1, Math.ceil(total / length - 1e-6));
  const step = total / n;
  const at = (s: number): Pt => {
    let k = 1;
    while (k < cum.length - 1 && cum[k] < s) k++;
    const t = (s - cum[k - 1]) / (cum[k] - cum[k - 1] || 1);
    return [line[k - 1][0] + (line[k][0] - line[k - 1][0]) * t, line[k - 1][1] + (line[k][1] - line[k - 1][1]) * t];
  };
  const out: PathUnit[] = [];
  for (let i = 0; i < n; i++) {
    const a = at(i * step);
    const b = at((i + 1) * step);
    const [x, y] = at((i + 0.5) * step);
    const rIn = ramp(i, n);
    const rOut = ramp(n - 1 - i, n);
    let alpha = 1;
    let across = 1;
    if (transitionIn === 'fade') alpha *= rIn;
    if (transitionIn === 'grow') across *= rIn;
    if (transitionOut === 'fade') alpha *= rOut;
    if (transitionOut === 'shrink') across *= rOut;
    out.push({ x, y, rotation: Math.atan2(b[1] - a[1], b[0] - a[0]), scaleAlong: scale, scaleAcross: scale * across, alpha });
  }
  return out;
}

// ─── A soft piece: one band along the line ─────────────────

/** A soft piece's band as a triangle strip: two vertices a station (left of travel, then right). */
export interface SoftPathStrip {
  /** x, y per vertex, world cells. */
  positions: number[];
  /** u along one repeat of the art (0 to 1), v across it (0 on the left of travel, 1 on the right), per vertex. */
  uvs: number[];
  /** Opacity per vertex: 1 but where a Fade end ramps it. */
  alphas: number[];
  /** Three vertex indices a triangle. */
  indices: number[];
}

/** The densest a soft band's stations lie, cells apart, and the most a station spans of the width. */
const SOFT_STEP = 0.25;
const SOFT_STEP_OF_WIDTH = 1 / 3;

const smoothstep = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/**
 * A soft piece's band along `line`: `width` across, the art repeating every `repeat` cells
 * along it (its own aspect at that width), as one continuous strip of stations. At each
 * station the band runs square to the line's direction taken over a chord as long as the
 * band is wide, so a sharp bend turns smoothly; a vertex on the inside of a bend that would
 * step back against the direction of travel is held where the last one was, so the strip
 * never folds over itself there. Where the art repeats, a station is laid twice (u 1, then
 * u 0), so each repeat maps the whole of it. Grow and Shrink taper the width over the first
 * and last TRANSITION_UNITS repeats (at most half the line each); Fade ramps the opacity
 * over the same stretch; both ease smoothly to nothing at the very end.
 */
export function softPathStrip(
  line: readonly Pt[],
  repeat: number,
  width: number,
  transitionIn: TransitionIn,
  transitionOut: TransitionOut,
): SoftPathStrip {
  const out: SoftPathStrip = { positions: [], uvs: [], alphas: [], indices: [] };
  if (line.length < 2 || repeat <= 0 || width <= 0) return out;
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const total = cum[cum.length - 1];
  if (total <= 1e-6) return out;
  const at = (s: number): Pt => {
    const c = Math.min(total, Math.max(0, s));
    let k = 1;
    while (k < cum.length - 1 && cum[k] < c) k++;
    const t = (c - cum[k - 1]) / (cum[k] - cum[k - 1] || 1);
    return [line[k - 1][0] + (line[k][0] - line[k - 1][0]) * t, line[k - 1][1] + (line[k][1] - line[k - 1][1]) * t];
  };

  // Stations: an even step, every repeat boundary, and each end.
  const step = Math.min(SOFT_STEP, width * SOFT_STEP_OF_WIDTH);
  const boundaries = new Set<number>();
  for (let k = 1; k * repeat < total - 1e-6; k++) boundaries.add(k * repeat);
  const nearBoundary = (s: number): boolean => [...boundaries].some((b) => Math.abs(b - s) < 1e-6);
  const marks: number[] = [0, total, ...boundaries];
  for (let k = 1; k * step < total - 1e-6; k++) if (!nearBoundary(k * step)) marks.push(k * step);
  const stations = marks.sort((a, b) => a - b).filter((s, i, all) => i === 0 || s - all[i - 1] > 1e-6);

  const ramp = Math.min(TRANSITION_UNITS * repeat, total / 2);
  const half = width / 2;
  const chord = half;
  let lastL: Pt | null = null;
  let lastR: Pt | null = null;
  const push = (p: Pt, u: number, v: number, alpha: number): void => {
    out.positions.push(p[0], p[1]);
    out.uvs.push(u, v);
    out.alphas.push(alpha);
  };
  for (const s of stations) {
    const p = at(s);
    const a = at(s - chord);
    const b = at(s + chord);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const tx = (b[0] - a[0]) / len;
    const ty = (b[1] - a[1]) / len;
    let h = half;
    let alpha = 1;
    if (transitionIn === 'grow') h *= smoothstep(s / ramp);
    if (transitionOut === 'shrink') h *= smoothstep((total - s) / ramp);
    if (transitionIn === 'fade') alpha *= smoothstep(s / ramp);
    if (transitionOut === 'fade') alpha *= smoothstep((total - s) / ramp);
    // Left of travel on screen (y down) is (ty, -tx).
    let left: Pt = [p[0] + ty * h, p[1] - tx * h];
    let right: Pt = [p[0] - ty * h, p[1] + tx * h];
    // The fold guard: never step back against the direction of travel.
    if (lastL && (left[0] - lastL[0]) * tx + (left[1] - lastL[1]) * ty < 0) left = lastL;
    if (lastR && (right[0] - lastR[0]) * tx + (right[1] - lastR[1]) * ty < 0) right = lastR;
    const boundary = boundaries.has(s);
    let u = Math.max(0, s / repeat - Math.floor(s / repeat + 1e-9));
    // A line ending exactly on a repeat ends that repeat, not the next one's start.
    if (s >= total - 1e-9 && u < 1e-9) u = 1;
    if (boundary) {
      // The end of one repeat and the start of the next, at the same place.
      push(left, 1, 0, alpha);
      push(right, 1, 1, alpha);
      u = 0;
    }
    push(left, u, 0, alpha);
    push(right, u, 1, alpha);
    lastL = left;
    lastR = right;
  }
  const pairs = out.alphas.length / 2;
  for (let k = 0; k < pairs - 1; k++) {
    const l0 = 2 * k;
    const r0 = l0 + 1;
    const l1 = l0 + 2;
    const r1 = l0 + 3;
    out.indices.push(l0, r0, l1, l1, r0, r1);
  }
  return out;
}

/** Distance from `p` to the line, in cells. */
export function distanceToLine(line: readonly Pt[], p: { x: number; y: number }): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i];
    const [bx, by] = line[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / l2));
    best = Math.min(best, Math.hypot(p.x - (ax + dx * t), p.y - (ay + dy * t)));
  }
  return line.length === 1 ? Math.hypot(p.x - line[0][0], p.y - line[0][1]) : best;
}

/** The path's bounds with its width, in cells. */
export function pathwayBounds(p: PathwayChild): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const line = pathwayLine(p);
  if (line.length === 0) return null;
  const h = p.width / 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of line) {
    minX = Math.min(minX, x - h);
    minY = Math.min(minY, y - h);
    maxX = Math.max(maxX, x + h);
    maxY = Math.max(maxY, y + h);
  }
  return { minX, minY, maxX, maxY };
}
