import type { Point } from '../types/geometry';
import { interpolateCatmullRom } from './catmullRom';
import { simplifyPath } from './simplify';

/**
 * Precision assists shared by the drawing tools: Shift-constrained angles
 * while placing anchors, and curve-mode smoothing of a finished click-chain.
 */

/** Shift-drawing constrains segments to multiples of this angle. */
export const ANGLE_SNAP_DEG = 15;

/**
 * Project `point` onto the nearest `stepDeg`-multiple ray out of `anchor`.
 * The projected distance along the ray is preserved, so the segment keeps
 * its length and only rotates to the constrained angle.
 */
export function snapToAngle(anchor: Point, point: Point, stepDeg: number = ANGLE_SNAP_DEG): Point {
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-9) return point;
  const step = (stepDeg * Math.PI) / 180;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: anchor.x + Math.cos(angle) * dist, y: anchor.y + Math.sin(angle) * dist };
}

/** Interpolated points per control-point span when smoothing a chain. */
const SMOOTH_SEGMENTS_PER_SPAN = 8;
/** Simplification tolerance (world units) — strips near-collinear samples. */
const SMOOTH_EPSILON = 0.02;

/**
 * Smooth an open click-chain through centripetal Catmull-Rom, then strip the
 * near-collinear samples so straight runs stay 2 points. The chain still
 * passes through every clicked anchor, endpoints exactly.
 * Chains of fewer than 3 points come back unchanged — nothing to smooth.
 */
export function smoothChain(points: Point[]): Point[] {
  if (points.length < 3) return points;
  const curve = interpolateCatmullRom(
    points.map((p): [number, number] => [p.x, p.y]),
    SMOOTH_SEGMENTS_PER_SPAN,
  );
  return simplifyPath(curve.map(([x, y]) => ({ x, y })), SMOOTH_EPSILON);
}
