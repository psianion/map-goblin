import { describe, it, expect } from 'vitest';
import { isDoubleClick } from './DrawingTool';

const at = (x: number, y: number, time: number) => ({ point: { x, y }, time });

describe('isDoubleClick', () => {
  it('is a double-click only when close in both time and space', () => {
    expect(isDoubleClick(at(0, 0, 1000), { x: 0, y: 0 }, 1100)).toBe(true);
  });

  // The bug this exists for: clicking anchors along a chain faster than 300ms
  // used to commit the chain early, because only time was checked.
  it('is not a double-click for a fast click somewhere else', () => {
    expect(isDoubleClick(at(0, 0, 1000), { x: 14, y: 0 }, 1010)).toBe(false);
  });

  it('is not a double-click for a slow click in the same place', () => {
    expect(isDoubleClick(at(0, 0, 1000), { x: 0, y: 0 }, 1400)).toBe(false);
  });

  it('tolerates the small jitter of a real double-click', () => {
    expect(isDoubleClick(at(3, 3, 1000), { x: 3.1, y: 3.1 }, 1050)).toBe(true);
  });

  it('has no previous click to match on the first click', () => {
    expect(isDoubleClick(null, { x: 0, y: 0 }, 1000)).toBe(false);
  });
});
