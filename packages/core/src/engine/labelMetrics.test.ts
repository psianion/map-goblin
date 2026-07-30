import { describe, it, expect } from 'vitest';
import { measureLabel } from './labelMetrics';

describe('measureLabel', () => {
  it('grows with the longest line, not the total character count', () => {
    const oneLong = measureLabel('abcdefghij', 1);
    const twoShort = measureLabel('abcde\nabcde', 1);
    expect(twoShort.width).toBeLessThan(oneLong.width);
    expect(twoShort.height).toBeGreaterThan(oneLong.height);
  });

  it('scales linearly with font size', () => {
    const small = measureLabel('Crypt', 0.5);
    const large = measureLabel('Crypt', 1);
    expect(large.width).toBeCloseTo(small.width * 2, 9);
    expect(large.height).toBeCloseTo(small.height * 2, 9);
  });

  // An empty label still has to be clickable, or it can never be selected again
  // to be given any text.
  it('keeps a grabbable box for empty text', () => {
    const box = measureLabel('', 0.8);
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });

  it('counts every line for height', () => {
    expect(measureLabel('a\nb\nc', 1).height).toBeCloseTo(3 * 1.2, 9);
  });
});
