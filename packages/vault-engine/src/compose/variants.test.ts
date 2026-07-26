import { describe, it, expect } from 'vitest';
import { generateVariantSeed, shuffleWithSeed } from './variants.js';

describe('generateVariantSeed', () => {
  it('returns a number', () => {
    const seed = generateVariantSeed('stone-cobble', 'wall-straight', 'A');
    expect(seed).toBeTypeOf('number');
  });

  it('is deterministic', () => {
    const a = generateVariantSeed('stone', 'straight', 'B');
    const b = generateVariantSeed('stone', 'straight', 'B');
    expect(a).toBe(b);
  });

  it('produces different seeds for different variants', () => {
    const a = generateVariantSeed('stone', 'straight', 'A');
    const b = generateVariantSeed('stone', 'straight', 'B');
    expect(a).not.toBe(b);
  });
});

describe('shuffleWithSeed', () => {
  it('returns same-length array', () => {
    const input = [1, 2, 3, 4, 5];
    const result = shuffleWithSeed(input, 42);
    expect(result).toHaveLength(5);
  });

  it('is deterministic for same seed', () => {
    const input = [1, 2, 3, 4, 5];
    expect(shuffleWithSeed(input, 42)).toEqual(shuffleWithSeed(input, 42));
  });

  it('produces different order for different seeds', () => {
    const input = [1, 2, 3, 4, 5];
    const a = shuffleWithSeed(input, 1);
    const b = shuffleWithSeed(input, 999);
    expect(a).not.toEqual(b);
  });

  it('returns empty array for empty input', () => {
    const result = shuffleWithSeed([], 42);
    expect(result).toEqual([]);
  });

  it('returns single-element array unchanged', () => {
    const result = shuffleWithSeed(['only'], 42);
    expect(result).toEqual(['only']);
  });

  it('does not mutate the original array', () => {
    const input = [1, 2, 3, 4, 5];
    const copy = [...input];
    shuffleWithSeed(input, 42);
    expect(input).toEqual(copy);
  });

  it('contains all original elements (no duplicates or loss)', () => {
    const input = [10, 20, 30, 40, 50];
    const result = shuffleWithSeed(input, 123);
    expect(result.sort((a, b) => a - b)).toEqual([10, 20, 30, 40, 50]);
  });
});

describe('generateVariantSeed edge cases', () => {
  it('handles single-character inputs', () => {
    const seed = generateVariantSeed('a', 'b', 'C');
    expect(seed).toBeTypeOf('number');
    expect(Number.isFinite(seed)).toBe(true);
  });

  it('produces consistent results for same inputs across calls', () => {
    const results = Array.from({ length: 10 }, () =>
      generateVariantSeed('stone', 'wall', 'A'),
    );
    expect(new Set(results).size).toBe(1);
  });
});
