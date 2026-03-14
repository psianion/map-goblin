import { describe, it, expect } from 'vitest';
import {
  computeBoundingBox,
  applyTransformToPoints,
  constrainProportions,
  rotatePoint,
  snapValueToGrid,
  snapAngle,
} from './transformMath';

describe('computeBoundingBox', () => {
  it('returns correct bounds for a rectangle', () => {
    const points: [number, number][] = [[0, 0], [100, 0], [100, 50], [0, 50]];
    const bb = computeBoundingBox(points);
    expect(bb).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  });

  it('enforces minimum size of 1', () => {
    const points: [number, number][] = [[5, 5], [5, 5]];
    const bb = computeBoundingBox(points);
    expect(bb.width).toBeGreaterThanOrEqual(1);
    expect(bb.height).toBeGreaterThanOrEqual(1);
  });
});

describe('applyTransformToPoints', () => {
  it('applies translate', () => {
    const points: [number, number][] = [[0, 0], [10, 10]];
    const result = applyTransformToPoints(points, { translate: [5, 5], rotate: 0, scale: [1, 1] });
    expect(result).toEqual([[5, 5], [15, 15]]);
  });

  it('applies scale from origin', () => {
    const points: [number, number][] = [[10, 10]];
    const result = applyTransformToPoints(points, { translate: [0, 0], rotate: 0, scale: [2, 2] });
    expect(result).toEqual([[20, 20]]);
  });

  it('applies rotation', () => {
    const points: [number, number][] = [[10, 0]];
    const result = applyTransformToPoints(points, { translate: [0, 0], rotate: Math.PI / 2, scale: [1, 1] });
    expect(result[0][0]).toBeCloseTo(0, 5);
    expect(result[0][1]).toBeCloseTo(10, 5);
  });
});

describe('constrainProportions', () => {
  it('constrains to original aspect ratio', () => {
    const result = constrainProportions(200, 50, 100, 50);
    expect(result.width / result.height).toBeCloseTo(100 / 50);
  });
});

describe('rotatePoint', () => {
  it('rotates 90 degrees around origin', () => {
    const [x, y] = rotatePoint(10, 0, 0, 0, Math.PI / 2);
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(10, 5);
  });

  it('rotates around custom pivot', () => {
    const [x, y] = rotatePoint(20, 10, 10, 10, Math.PI);
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(10, 5);
  });
});

describe('snapValueToGrid', () => {
  it('snaps to nearest grid line', () => {
    expect(snapValueToGrid(47, 10)).toBe(50);
    expect(snapValueToGrid(3, 10)).toBe(0);
  });
});

describe('snapAngle', () => {
  it('snaps to nearest 15 degree increment', () => {
    const snapped = snapAngle(0.27); // ~15.5 degrees
    expect(snapped).toBeCloseTo(Math.PI / 12, 5); // 15 degrees
  });
});
