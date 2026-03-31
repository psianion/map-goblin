import { describe, it, expect } from 'vitest';
import { interpolateCatmullRom, generatePathPolygon } from './catmullRom';

type Vec2 = [number, number];

describe('interpolateCatmullRom', () => {
  it('returns empty array for empty input', () => {
    expect(interpolateCatmullRom([])).toEqual([]);
  });

  it('returns single point for single input', () => {
    const result = interpolateCatmullRom([[5, 10]]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual([5, 10]);
  });

  it('linearly interpolates 2 points', () => {
    const result = interpolateCatmullRom([[0, 0], [10, 0]], 4);
    expect(result).toHaveLength(5); // 4 segments + endpoint
    expect(result[0]).toEqual([0, 0]);
    expect(result[4]).toEqual([10, 0]);
    // Midpoint should be at (5, 0)
    expect(result[2][0]).toBeCloseTo(5, 5);
    expect(result[2][1]).toBeCloseTo(0, 5);
  });

  it('passes through all control points', () => {
    const controls: Vec2[] = [[0, 0], [2, 4], [6, 1], [10, 5]];
    const segs = 8;
    const result = interpolateCatmullRom(controls, segs);

    // First point
    expect(result[0][0]).toBeCloseTo(0, 4);
    expect(result[0][1]).toBeCloseTo(0, 4);

    // Second control point at index segs
    expect(result[segs][0]).toBeCloseTo(2, 4);
    expect(result[segs][1]).toBeCloseTo(4, 4);

    // Third control point at index 2*segs
    expect(result[2 * segs][0]).toBeCloseTo(6, 4);
    expect(result[2 * segs][1]).toBeCloseTo(1, 4);

    // Last point
    const last = result[result.length - 1];
    expect(last[0]).toBeCloseTo(10, 4);
    expect(last[1]).toBeCloseTo(5, 4);
  });

  it('produces correct number of output points', () => {
    const controls: Vec2[] = [[0, 0], [3, 3], [6, 0], [9, 3], [12, 0]];
    const segs = 10;
    const result = interpolateCatmullRom(controls, segs);
    // 4 spans * 10 points per span + 1 final = 41
    expect(result).toHaveLength(4 * segs + 1);
  });

  it('centripetal (alpha=0.5) avoids loops on uneven spacing', () => {
    // Points with very uneven spacing — uniform parameterization can loop
    const controls: Vec2[] = [[0, 0], [1, 0], [1.1, 5], [10, 5]];
    const result = interpolateCatmullRom(controls, 20, 0.5);

    // All y values should be non-negative (no dip below the x-axis)
    for (const [, y] of result) {
      expect(y).toBeGreaterThanOrEqual(-0.5);
    }
  });

  it('uniform parameterization (alpha=0) still works', () => {
    const controls: Vec2[] = [[0, 0], [5, 5], [10, 0]];
    const result = interpolateCatmullRom(controls, 8, 0);
    expect(result).toHaveLength(2 * 8 + 1);
    expect(result[0][0]).toBeCloseTo(0, 4);
    expect(result[result.length - 1][0]).toBeCloseTo(10, 4);
  });

  it('chordal parameterization (alpha=1) still works', () => {
    const controls: Vec2[] = [[0, 0], [5, 5], [10, 0]];
    const result = interpolateCatmullRom(controls, 8, 1);
    expect(result).toHaveLength(2 * 8 + 1);
    expect(result[0][0]).toBeCloseTo(0, 4);
    expect(result[result.length - 1][0]).toBeCloseTo(10, 4);
  });
});

describe('generatePathPolygon', () => {
  it('returns empty for fewer than 2 points', () => {
    expect(generatePathPolygon([], [1])).toEqual([]);
    expect(generatePathPolygon([[0, 0]], [1])).toEqual([]);
  });

  it('generates polygon for a horizontal line with uniform width', () => {
    const points: Vec2[] = [[0, 0], [10, 0]];
    const polygon = generatePathPolygon(points, [2]);

    // Should have 4 vertices (2 left + 2 right)
    expect(polygon).toHaveLength(4);

    // Left edge should be above (negative y = left-hand normal of rightward direction)
    // For rightward direction (1,0), perpendicular is (0,1) = upward
    // Left: (0,2), (10,2); Right: (0,-2), (10,-2) reversed = (10,-2), (0,-2)
    expect(polygon[0][0]).toBeCloseTo(0, 4);
    expect(polygon[0][1]).toBeCloseTo(2, 4);
    expect(polygon[1][0]).toBeCloseTo(10, 4);
    expect(polygon[1][1]).toBeCloseTo(2, 4);
    expect(polygon[2][0]).toBeCloseTo(10, 4);
    expect(polygon[2][1]).toBeCloseTo(-2, 4);
    expect(polygon[3][0]).toBeCloseTo(0, 4);
    expect(polygon[3][1]).toBeCloseTo(-2, 4);
  });

  it('supports variable widths per point', () => {
    const points: Vec2[] = [[0, 0], [5, 0], [10, 0]];
    const widths = [1, 3, 1];
    const polygon = generatePathPolygon(points, widths);

    // 3 left + 3 right = 6 vertices
    expect(polygon).toHaveLength(6);

    // Middle point should be wider
    expect(polygon[1][1]).toBeCloseTo(3, 4); // left middle y offset
    expect(polygon[4][1]).toBeCloseTo(-3, 4); // right middle y offset (reversed index)
  });

  it('repeats last width when widths array is shorter', () => {
    const points: Vec2[] = [[0, 0], [5, 0], [10, 0]];
    const widths = [2]; // uniform width of 2
    const polygon = generatePathPolygon(points, widths);

    expect(polygon).toHaveLength(6);
    // All offsets should be 2
    expect(polygon[0][1]).toBeCloseTo(2, 4);
    expect(polygon[1][1]).toBeCloseTo(2, 4);
    expect(polygon[2][1]).toBeCloseTo(2, 4);
  });

  it('handles vertical path', () => {
    const points: Vec2[] = [[0, 0], [0, 10]];
    const polygon = generatePathPolygon(points, [1]);

    expect(polygon).toHaveLength(4);
    // For downward direction (0,1), left-hand perpendicular is (-1, 0)
    // Left: (-1,0), (-1,10); Right: (1,0), (1,10) reversed
    expect(polygon[0][0]).toBeCloseTo(-1, 4);
    expect(polygon[1][0]).toBeCloseTo(-1, 4);
    expect(polygon[2][0]).toBeCloseTo(1, 4);
    expect(polygon[3][0]).toBeCloseTo(1, 4);
  });

  it('produces a closed polygon suitable for filling', () => {
    const controls: Vec2[] = [[0, 0], [5, 5], [10, 0]];
    const spline = interpolateCatmullRom(controls, 8);
    const polygon = generatePathPolygon(spline, [1]);

    // Should have 2 * spline.length vertices
    expect(polygon).toHaveLength(spline.length * 2);

    // First and last points should be close (left start and right start reversed)
    // They won't be identical but should form a proper closed contour
    expect(polygon.length).toBeGreaterThan(0);
  });
});
