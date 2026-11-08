// A Path: a line of nodes drawn as the pack's path units laid one after another along it,
// each piece at its own length and never stretched (decided 2 November). Width scales the
// units; Curve runs the line through its nodes as a spline and Smoothness rounds what is
// left of its corners; the transitions at each end fade the first and last few units in or
// out (Fade) or taper them from or to nothing across the path (Grow, Shrink).
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
