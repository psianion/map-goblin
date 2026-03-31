import { describe, it, expect } from 'vitest';
import { poissonDiskSample } from './poissonDisk';
import { mulberry32 } from './seededRng';

describe('poissonDiskSample', () => {
  it('returns points within the specified radius', () => {
    const center = { x: 100, y: 100 };
    const radius = 50;
    const points = poissonDiskSample(center, radius, 10, 20);
    for (const p of points) {
      const dx = p.x - center.x;
      const dy = p.y - center.y;
      expect(Math.sqrt(dx * dx + dy * dy)).toBeLessThanOrEqual(radius + 0.01);
    }
  });

  it('respects maxCount limit', () => {
    const points = poissonDiskSample({ x: 0, y: 0 }, 100, 5, 10);
    expect(points.length).toBeLessThanOrEqual(10);
  });

  it('is deterministic with a seeded rng', () => {
    const center = { x: 50, y: 50 };
    const a = poissonDiskSample(center, 30, 8, 15, mulberry32(42));
    const b = poissonDiskSample(center, 30, 8, 15, mulberry32(42));
    expect(a).toEqual(b);
  });

  it('produces different results with different seeds', () => {
    const center = { x: 50, y: 50 };
    const a = poissonDiskSample(center, 30, 8, 15, mulberry32(1));
    const b = poissonDiskSample(center, 30, 8, 15, mulberry32(2));
    // At least one point should differ (extremely unlikely to be identical)
    const aStr = JSON.stringify(a);
    const bStr = JSON.stringify(b);
    expect(aStr).not.toBe(bStr);
  });

  it('still works without rng parameter (uses Math.random)', () => {
    const points = poissonDiskSample({ x: 0, y: 0 }, 50, 10, 20);
    expect(points.length).toBeGreaterThan(0);
  });
});
