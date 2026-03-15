import { describe, it, expect } from 'vitest';
import { poissonDiskSample } from './poissonDisk';

describe('poissonDiskSample', () => {
  const center = { x: 10, y: 10 };

  it('returns points within the sampling radius', () => {
    const points = poissonDiskSample(center, 5, 1, 100);
    for (const p of points) {
      const dx = p.x - center.x;
      const dy = p.y - center.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      expect(dist).toBeLessThanOrEqual(5 + 0.001); // tiny epsilon for float
    }
  });

  it('maintains minimum spacing between all points', () => {
    const minDist = 1.5;
    const points = poissonDiskSample(center, 5, minDist, 100);
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const dx = points[i].x - points[j].x;
        const dy = points[i].y - points[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        expect(dist).toBeGreaterThanOrEqual(minDist - 0.001);
      }
    }
  });

  it('respects the max count cap', () => {
    const points = poissonDiskSample(center, 10, 0.5, 20);
    expect(points.length).toBeLessThanOrEqual(20);
  });

  it('returns at least one point for valid inputs', () => {
    const points = poissonDiskSample(center, 5, 1, 100);
    expect(points.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty array for zero radius', () => {
    const points = poissonDiskSample(center, 0, 1, 100);
    expect(points).toEqual([]);
  });

  it('returns empty array for zero maxCount', () => {
    const points = poissonDiskSample(center, 5, 1, 0);
    expect(points).toEqual([]);
  });

  it('returns empty array for negative radius', () => {
    const points = poissonDiskSample(center, -5, 1, 100);
    expect(points).toEqual([]);
  });

  it('returns empty array for zero minDist', () => {
    const points = poissonDiskSample(center, 5, 0, 100);
    expect(points).toEqual([]);
  });

  it('returns single point when maxCount is 1', () => {
    const points = poissonDiskSample(center, 5, 1, 1);
    expect(points.length).toBe(1);
  });

  it('produces reasonable density for large area', () => {
    const points = poissonDiskSample(center, 10, 2, 500);
    // Area = pi*10^2 ≈ 314, each point occupies ~pi*(minDist/2)^2 ≈ 3.14
    // Theoretical max ≈ 100. Should get at least 20+.
    expect(points.length).toBeGreaterThan(15);
  });
});
