// Outlines kept lean. A brush stroke is a ring of many short steps (a dab is a 158-point
// circle), and a boolean over it hands back as many; stored as they come, each is a node
// handle. A ring is tidied before it is stored: thinned to the points that shape it and
// stripped of points stacked on their neighbour. Pure, no Clipper, so the load pass runs it.

import type { Polygon } from '../types/geometry';
import { simplifyPath } from '../geometry/simplify';

/** A point this near the one before it, in cells, is dropped. */
const MIN_GAP = 0.01;
/** A segment shorter than this, in cells, is a brush step. */
const SHORT_SEGMENT = 0.15;

/**
 * A closed ring thinned by Douglas-Peucker within `eps` cells (its seam point kept, so the
 * ring stays closed), then rid of any point closer than 0.01 cells to the one before it.
 * Empty when fewer than 3 points are left: the ring is gone. The ring itself when nothing was dropped.
 */
export function tidyRing(ring: Polygon, eps = 0.02): Polygon {
  if (ring.length < 3) return [];
  const thin =
    ring.length < 4 ? ring : simplifyPath([...ring, ring[0]].map(([x, y]) => ({ x, y })), eps).slice(0, -1).map((p): [number, number] => [p.x, p.y]);
  const out: Polygon = [];
  for (const p of thin) {
    const last = out[out.length - 1];
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < MIN_GAP) continue;
    out.push(p);
  }
  // The ring closes on itself: its last point is the one before the first.
  while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < MIN_GAP) out.pop();
  if (out.length < 3) return [];
  return out.length === ring.length ? ring : out;
}

/** Each ring tidied (`tidyRing`), the rings that are gone dropped. */
export function tidyRings(rings: readonly Polygon[]): Polygon[] {
  return rings.map((r) => tidyRing(r)).filter((r) => r.length >= 3);
}

/** Whether more than a third of a closed ring's segments are shorter than 0.15 cells: brush steps, not drawn corners. */
export function isDenseRing(ring: Polygon): boolean {
  if (ring.length < 3) return false;
  let short = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    if (Math.hypot(bx - ax, by - ay) < SHORT_SEGMENT) short++;
  }
  return short * 3 > ring.length;
}
