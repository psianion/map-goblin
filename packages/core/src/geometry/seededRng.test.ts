// src/geometry/seededRng.test.ts
import { describe, it, expect } from 'vitest';
import { mulberry32, hashPosition } from './seededRng';

describe('mulberry32', () => {
  it('returns values in [0, 1)', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is deterministic for the same seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 50; i++) {
      expect(a()).toBe(b());
    }
  });

  it('produces different sequences for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const aVals = Array.from({ length: 10 }, () => a());
    const bVals = Array.from({ length: 10 }, () => b());
    expect(aVals).not.toEqual(bVals);
  });
});

describe('hashPosition', () => {
  it('returns a consistent integer for the same position', () => {
    expect(hashPosition(10, 20)).toBe(hashPosition(10, 20));
  });

  it('returns different values for different positions', () => {
    expect(hashPosition(10, 20)).not.toBe(hashPosition(20, 10));
    expect(hashPosition(0, 0)).not.toBe(hashPosition(1, 0));
  });
});
