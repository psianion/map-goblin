// The one piece of the band x-ray that is arithmetic rather than drawing: which
// run of the floor ring an edit actually displaced. It walks the ring rather
// than slicing it, because a stretch near the seam wraps index 0 — and a wrap
// bug there would dash a line right across the cave.

import { describe, it, expect } from 'vitest';
import { movedStretch } from './bandGhostPreview';
import type { Vec } from './caveBand';

/** A square-ish ring of `n` points, so an index means something visual. */
const ring = (n: number): Vec[] => Array.from({ length: n }, (_, i): Vec => [i, 0]);

const bump = (base: Vec[], at: number[]): Vec[] =>
  base.map((p, i): Vec => (at.includes(i) ? [p[0], p[1] + 1] : [p[0], p[1]]));

describe('movedStretch', () => {
  it('takes the moved run plus one untouched point at each end', () => {
    const before = ring(10);
    expect(movedStretch(before, bump(before, [4, 5]))).toEqual([
      [3, 0],
      [4, 1],
      [5, 1],
      [6, 0],
    ]);
  });

  it('walks round the seam rather than slicing at index 0', () => {
    const before = ring(10);
    // The stretch straddles the join: 8, 9, 0, 1.
    expect(movedStretch(before, bump(before, [8, 9, 0, 1]))).toEqual([
      [7, 0],
      [8, 1],
      [9, 1],
      [0, 1],
      [1, 1],
      [2, 0],
    ]);
  });

  it('draws nothing when nothing moved, or when everything did', () => {
    const before = ring(10);
    expect(movedStretch(before, ring(10))).toEqual([]);
    expect(movedStretch(before, bump(before, [...before.keys()]))).toEqual([]);
    // A ring that changed length is a different outline, not a moved one.
    expect(movedStretch(before, ring(12))).toEqual([]);
  });
});
