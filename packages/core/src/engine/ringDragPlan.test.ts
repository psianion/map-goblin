// The projection that turns a stone drag on a floor ring into an outline edit.
//
// Pure geometry, so it can be checked without a store, Clipper2 or Pixi — which
// is the point of keeping it out of the drag orchestration.

import { describe, it, expect } from 'vitest';
import { planRingDrag } from './ringDragPlan';
import type { Polygon } from '../types/geometry';

/** 12 x 8, walked anticlockwise in screen coords. Perimeter 40. */
const RING: Polygon = [[0, 0], [12, 0], [12, 8], [0, 8]];

/** Apply a plan the way the drag does, so a test can look at the result. */
function moved(outline: Polygon, indices: number[], dx: number, dy: number): Polygon {
  const set = new Set(indices);
  return outline.map(([x, y], i): [number, number] => (set.has(i) ? [x + dx, y + dy] : [x, y]));
}

describe('planRingDrag', () => {
  it('has nothing to plan without stones or without a ring', () => {
    expect(planRingDrag(RING, [])).toBeNull();
    expect(planRingDrag([[0, 0], [1, 1]], [{ x: 0, y: 0, halfLength: 1 }])).toBeNull();
    expect(planRingDrag(RING, [{ x: 6, y: 0, halfLength: 0 }])).toBeNull();
  });

  it('gives one stone a flat top of its own length, with a ramp either side', () => {
    const plan = planRingDrag(RING, [{ x: 6, y: 0, halfLength: 1 }])!;
    // Four anchors on the south edge: ramp foot, plateau, plateau, ramp foot.
    expect(plan.outline).toHaveLength(RING.length + 4);
    expect(plan.indices).toHaveLength(2);

    const out = moved(plan.outline, plan.indices, 0, -3);
    // The stone's own footprint moved, and only it.
    expect(out).toContainEqual([5, -3]);
    expect(out).toContainEqual([7, -3]);
    // The ramps start where the boundary is still where it was.
    expect(out).toContainEqual([4, 0]);
    expect(out).toContainEqual([8, 0]);
    // Nothing else on the ring shifted.
    for (const v of RING) expect(out).toContainEqual(v);
  });

  it('keeps the ring simple — no vertex is visited twice', () => {
    const plan = planRingDrag(RING, [{ x: 6, y: 0, halfLength: 1 }])!;
    const seen = plan.outline.map(([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('merges neighbouring stones into one plateau rather than a row of spikes', () => {
    const stones = [4, 6, 8].map((x) => ({ x, y: 0, halfLength: 1.2 }));
    const plan = planRingDrag(RING, stones)!;
    const out = moved(plan.outline, plan.indices, 0, -3);

    // Every vertex between the outermost claims moved together: one flat top.
    const south = out.filter(([, y]) => y < 0).map(([x]) => x).sort((a, b) => a - b);
    expect(south[0]).toBeCloseTo(2.8, 6);
    expect(south[south.length - 1]).toBeCloseTo(9.2, 6);
    // and nothing in between was left behind on the old boundary.
    const strandedInside = out.some(([x, y]) => y === 0 && x > 2.8 && x < 9.2);
    expect(strandedInside).toBe(false);
  });

  it('claims the stretch under the stone even when the ring bends beneath it', () => {
    // A densely sampled arc, the shape curve mode produces.
    const arc: Polygon = Array.from({ length: 40 }, (_, i): [number, number] => {
      const a = (i / 40) * Math.PI * 2;
      return [10 * Math.cos(a), 10 * Math.sin(a)];
    });
    const plan = planRingDrag(arc, [{ x: 0, y: 10, halfLength: 2 }])!;
    // More than one existing sample sits under a 4-unit stone, and all of them
    // move — the sawtooth that one-vertex-per-stone would leave.
    expect(plan.indices.length).toBeGreaterThan(2);
    const gaps = plan.indices.slice(1).map((v, i) => v - plan.indices[i]);
    expect(gaps.every((g) => g === 1)).toBe(true);
  });

  it('reuses a vertex already standing where an anchor would go', () => {
    // The stone's footprint lands exactly on the ring's corner at [12,0].
    const plan = planRingDrag(RING, [{ x: 12, y: 0, halfLength: 1 }])!;
    expect(plan.outline.filter(([x, y]) => x === 12 && y === 0)).toHaveLength(1);
  });

  it('wraps a claim across the ring seam', () => {
    // Centred on [0,0], which is both the ring's first and last vertex.
    const plan = planRingDrag(RING, [{ x: 0, y: 0, halfLength: 1 }])!;
    const out = moved(plan.outline, plan.indices, -3, -3);
    // Both arms of the corner moved, so the corner does not tear.
    expect(out).toContainEqual([-2, -3]);
    expect(out).toContainEqual([-3, -2]);
  });
});
