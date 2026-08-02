// Turning a stone drag on a floor-derived wall into a floor-outline edit.
//
// A ring's stones stand ON the merged floor outline, so the outline IS the
// wall's spine. Storing a stone drag as a cosmetic dx/dy therefore always lied:
// the stone left the boundary it was edging, and nothing downstream could put
// the two back together. Bending the drawn contour at render time to chase the
// stones was worse — on a curved run the bent contour self-intersected and the
// fill came out in black wedges.
//
// So a drag on a ring stone is planned here as a real edit of the outline: the
// stretch of boundary the dragged stones actually cover is found, given its own
// vertices, and moved. The floor recomputes, the ring is relaid, and the stones
// land back on the boundary because they were never taken off it.
//
// Pure geometry — no store, no Pixi — so the projection is unit-testable.

import type { Polygon } from '../types/geometry';

/** One dragged stone: where it sits, and how far it reaches along the spine. */
export interface DraggedStone {
  x: number;
  y: number;
  /** Half the stone's drawn length along the spine, world units. */
  halfLength: number;
}

export interface RingDragPlan {
  /** The outline with the anchor vertices this drag needs materialised. */
  outline: Polygon;
  /** Indices into `outline` that the drag displaces by its delta. */
  indices: number[];
}

/**
 * How far the ramp from untouched boundary up to the moved stretch runs, as a
 * multiple of the stone's half-length — so a drag tapers over about one stone
 * either side rather than all the way to the ring's next corner, which on a
 * long wall is metres away.
 */
const RAMP = 1;

/** Anchors closer together than this reuse one vertex instead of both. */
const ANCHOR_EPS = 1e-3;

/**
 * Plan the outline edit a stone drag amounts to.
 *
 * Every dragged stone claims the arc of boundary its own body covers. Vertices
 * inside a claimed arc move with the drag; vertices outside it do not, and an
 * anchor is materialised a stone's length beyond each claim so the boundary has
 * somewhere to ramp from. Claims that overlap simply share their vertices, so a
 * group drag on neighbouring stones comes out as one flat-topped bulge rather
 * than a row of spikes — no interval merging needed.
 *
 * Returns null when there is nothing to plan.
 */
export function planRingDrag(outline: Polygon, stones: DraggedStone[]): RingDragPlan | null {
  const n = outline.length;
  if (n < 3 || stones.length === 0) return null;

  const startAt: number[] = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    startAt.push(total);
    const [ax, ay] = outline[i];
    const [bx, by] = outline[(i + 1) % n];
    total += Math.hypot(bx - ax, by - ay);
  }
  if (total <= 0) return null;

  const wrap = (s: number): number => ((s % total) + total) % total;

  /** Arc position of the point on the ring closest to (x, y). */
  const project = (x: number, y: number): number => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const [ax, ay] = outline[i];
      const [bx, by] = outline[(i + 1) % n];
      const ex = bx - ax;
      const ey = by - ay;
      const len2 = ex * ex + ey * ey;
      if (len2 < 1e-12) continue;
      const s = Math.min(Math.max(((x - ax) * ex + (y - ay) * ey) / len2, 0), 1);
      const d = Math.hypot(x - (ax + ex * s), y - (ay + ey * s));
      if (d < bestD) {
        bestD = d;
        best = startAt[i] + s * Math.sqrt(len2);
      }
    }
    return wrap(best);
  };

  const claims = stones
    .filter((s) => s.halfLength > 0)
    .map((s) => ({ centre: project(s.x, s.y), half: s.halfLength }));
  if (claims.length === 0) return null;

  /** Is this arc position inside a stone's own footprint? */
  const claimed = (arc: number): boolean =>
    claims.some((c) => {
      // Cyclic distance, so a claim straddling the ring's seam still reads.
      const d = Math.abs(wrap(arc - c.centre + total / 2) - total / 2);
      return d <= c.half + 1e-9;
    });

  const anchors: number[] = [];
  for (const c of claims) {
    for (const d of [-c.half * (1 + RAMP), -c.half, c.half, c.half * (1 + RAMP)]) {
      anchors.push(wrap(c.centre + d));
    }
  }

  // Rebuild the ring in arc order, dropping in each anchor that no vertex
  // already stands on. Walking once keeps the inserts in ring order for free.
  const wanted = anchors
    .sort((a, b) => a - b)
    .filter((a, i, all) => i === 0 || a - all[i - 1] > ANCHOR_EPS);
  const point = (arc: number): [number, number] => {
    let i = n - 1;
    while (i > 0 && startAt[i] > arc) i--;
    const [ax, ay] = outline[i];
    const [bx, by] = outline[(i + 1) % n];
    const len = Math.hypot(bx - ax, by - ay);
    const u = len > 0 ? Math.min(Math.max(arc - startAt[i], 0), len) / len : 0;
    return [ax + (bx - ax) * u, ay + (by - ay) * u];
  };

  const next: Polygon = [];
  const arcs: number[] = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    while (k < wanted.length && wanted[k] < startAt[i] - ANCHOR_EPS) k++;
    // An anchor sitting on this vertex is this vertex; nothing to insert.
    while (k < wanted.length && Math.abs(wanted[k] - startAt[i]) <= ANCHOR_EPS) k++;
    next.push([outline[i][0], outline[i][1]]);
    arcs.push(startAt[i]);
    const edgeEnd = i + 1 < n ? startAt[i + 1] : total;
    while (k < wanted.length && wanted[k] < edgeEnd - ANCHOR_EPS) {
      next.push(point(wanted[k]));
      arcs.push(wanted[k]);
      k++;
    }
  }

  const indices = arcs.map((a, i) => (claimed(a) ? i : -1)).filter((i) => i >= 0);
  if (indices.length === 0) return null;
  return { outline: next, indices };
}
