import { describe, it, expect } from 'vitest';
import {
  flattenCubic,
  flattenRing,
  splitCubic,
  pointOnCubic,
  projectToCubic,
  ringHasCurves,
  type Vec2,
  type RingTangents,
} from './bezier';

const SQUARE: Vec2[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

describe('flattenRing', () => {
  it('returns the exact input ring when no vertex carries tangents', () => {
    expect(flattenRing(SQUARE, undefined)).toBe(SQUARE);
    expect(flattenRing(SQUARE, [null, null, null, null])).toBe(SQUARE);
    expect(ringHasCurves([null, { }])).toBe(false);
  });

  it('adds interior points only along the curved edge', () => {
    // Bow the top edge (vertex 0 -> 1) upward; the other three edges stay.
    const tangents: RingTangents = [
      { tout: [3, -4] },
      { tin: [7, -4] },
      null,
      null,
    ];
    const flat = flattenRing(SQUARE, tangents, 0.05);
    expect(flat.length).toBeGreaterThan(SQUARE.length);
    // Original vertices survive, in order.
    for (const v of SQUARE) {
      expect(flat).toContainEqual(v);
    }
    // The bow goes up: some interior point has negative y.
    expect(flat.some(([, y]) => y < -1)).toBe(true);
    // The straight edges gained nothing: every added point lies on the top run
    // (between x 0..10 with y < 0.05), never on the sides or bottom.
    const added = flat.filter(
      (p) => !SQUARE.some((v) => v[0] === p[0] && v[1] === p[1]),
    );
    for (const [, y] of added) {
      expect(y).toBeLessThan(0.05);
    }
  });

  it('flattens tighter with a smaller tolerance', () => {
    const tangents: RingTangents = [{ tout: [3, -6] }, { tin: [7, -6] }, null, null];
    const coarse = flattenRing(SQUARE, tangents, 0.5).length;
    const fine = flattenRing(SQUARE, tangents, 0.01).length;
    expect(fine).toBeGreaterThan(coarse);
  });
});

describe('flattenCubic', () => {
  it('stays within tolerance of the true curve', () => {
    const p0: Vec2 = [0, 0];
    const c1: Vec2 = [0, 5];
    const c2: Vec2 = [10, 5];
    const p1: Vec2 = [10, 0];
    const tol = 0.05;
    const pts = [p0, ...flattenCubic(p0, c1, c2, p1, tol), p1];
    // Every true-curve sample must lie near some flattened segment.
    for (let i = 0; i <= 50; i++) {
      const q = pointOnCubic(p0, c1, c2, p1, i / 50);
      let best = Infinity;
      for (let j = 0; j < pts.length - 1; j++) {
        const [ax, ay] = pts[j];
        const [bx, by] = pts[j + 1];
        const dx = bx - ax;
        const dy = by - ay;
        const lenSq = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((q[0] - ax) * dx + (q[1] - ay) * dy) / lenSq));
        best = Math.min(best, Math.hypot(q[0] - (ax + t * dx), q[1] - (ay + t * dy)));
      }
      expect(best).toBeLessThan(tol * 2);
    }
  });

  it('returns nothing for a degenerate straight cubic', () => {
    expect(flattenCubic([0, 0], [3, 0], [7, 0], [10, 0], 0.05)).toEqual([]);
  });
});

describe('splitCubic', () => {
  it('preserves the curve: both halves sample onto the original', () => {
    const p0: Vec2 = [0, 0];
    const c1: Vec2 = [2, 8];
    const c2: Vec2 = [8, -4];
    const p1: Vec2 = [10, 2];
    const { left, right } = splitCubic(p0, c1, c2, p1, 0.3);
    // left covers t in [0, 0.3]
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const a = pointOnCubic(left[0], left[1], left[2], left[3], t);
      const b = pointOnCubic(p0, c1, c2, p1, t * 0.3);
      expect(a[0]).toBeCloseTo(b[0], 9);
      expect(a[1]).toBeCloseTo(b[1], 9);
    }
    // right covers t in [0.3, 1]
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const a = pointOnCubic(right[0], right[1], right[2], right[3], t);
      const b = pointOnCubic(p0, c1, c2, p1, 0.3 + t * 0.7);
      expect(a[0]).toBeCloseTo(b[0], 9);
      expect(a[1]).toBeCloseTo(b[1], 9);
    }
  });
});

describe('projectToCubic', () => {
  it('finds the parameter nearest a point on the curve', () => {
    const p0: Vec2 = [0, 0];
    const c1: Vec2 = [0, 6];
    const c2: Vec2 = [10, 6];
    const p1: Vec2 = [10, 0];
    const target = pointOnCubic(p0, c1, c2, p1, 0.42);
    const t = projectToCubic(p0, c1, c2, p1, target);
    expect(t).toBeCloseTo(0.42, 2);
  });
});
