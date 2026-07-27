import { describe, it, expect } from 'vitest';
import { hashCombine, sha256File, contentHash } from './hash.js';

describe('hashCombine', () => {
  it('returns a 32-bit unsigned integer', () => {
    const result = hashCombine(42, 7);
    expect(result).toBeTypeOf('number');
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(0xFFFFFFFF);
  });

  it('is deterministic', () => {
    expect(hashCombine(100, 200)).toBe(hashCombine(100, 200));
  });

  it('produces different outputs for different inputs', () => {
    expect(hashCombine(1, 2)).not.toBe(hashCombine(2, 1));
  });
});

describe('sha256File', () => {
  it('returns a hex string for a buffer', () => {
    const buf = Buffer.from('hello world');
    const result = sha256File(buf);
    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic', () => {
    const buf = Buffer.from('test data');
    expect(sha256File(buf)).toBe(sha256File(buf));
  });
});

describe('contentHash', () => {
  it('returns truncated 8-char hex hash', () => {
    const buf = Buffer.from('atlas content');
    const result = contentHash(buf);
    expect(result).toMatch(/^[a-f0-9]{8}$/);
  });
});
