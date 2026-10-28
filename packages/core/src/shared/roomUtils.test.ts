import { describe, it, expect } from 'vitest';
import {
  roomBadgePoints,
  computeArea,
  computeCentroid,
  computeStableRoomId,
  faceMetrics,
  interiorPoint,
  isPathway,
  nextRoomNumber,
  pointInRing,
  readingOrder,
  roomFace,
  signedArea,
} from './roomUtils';

const SQUARE: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];

describe('signedArea / computeArea', () => {
  it('is positive for counter-clockwise winding', () => {
    expect(signedArea(SQUARE)).toBeCloseTo(100);
  });

  it('is negative for clockwise winding (a hole)', () => {
    expect(signedArea([...SQUARE].reverse())).toBeCloseTo(-100);
  });

  it('computeArea ignores winding', () => {
    expect(computeArea(SQUARE)).toBeCloseTo(100);
    expect(computeArea([...SQUARE].reverse())).toBeCloseTo(100);
  });
});

describe('computeCentroid', () => {
  it('returns the center of a square', () => {
    expect(computeCentroid(SQUARE)).toEqual([5, 5]);
  });

  it('is unaffected by extra collinear vertices (unlike a vertex average)', () => {
    const withMidpoint: [number, number][] = [[0, 0], [5, 0], [10, 0], [10, 10], [0, 10]];
    const [cx, cy] = computeCentroid(withMidpoint);
    expect(cx).toBeCloseTo(5);
    expect(cy).toBeCloseTo(5); // vertex average would give 4
  });

  it('falls back to the vertex average for degenerate input', () => {
    expect(computeCentroid([[0, 0], [4, 0], [8, 0]])).toEqual([4, 0]);
  });
});

describe('computeStableRoomId', () => {
  it('is stable for the same centroid', () => {
    expect(computeStableRoomId([5, 5], 1)).toBe(computeStableRoomId([5, 5], 1));
  });

  it('differs for centroids in different grid cells', () => {
    expect(computeStableRoomId([5, 5], 1)).not.toBe(computeStableRoomId([10, 10], 1));
  });

  it('absorbs sub-grid-cell jitter', () => {
    expect(computeStableRoomId([5.02, 4.97], 1)).toBe(computeStableRoomId([5, 5], 1));
  });

  it('quantizes relative to grid size', () => {
    // At gridSize 5 these collapse into the same cell; at gridSize 1 they do not.
    expect(computeStableRoomId([5, 5], 5)).toBe(computeStableRoomId([6, 6], 5));
    expect(computeStableRoomId([5, 5], 1)).not.toBe(computeStableRoomId([6, 6], 1));
  });

  it('produces a room- prefixed id', () => {
    expect(computeStableRoomId([5, 5], 1)).toMatch(/^room-[0-9a-z]+$/);
  });
});

describe('isPathway', () => {
  it('flags a narrow corridor', () => {
    expect(isPathway([[0, 0], [10, 0], [10, 2], [0, 2]], 1)).toBe(true);
  });

  it('rejects a square room', () => {
    expect(isPathway(SQUARE, 1)).toBe(false);
  });

  it('rejects a long-but-wide hall (aspect 2.5)', () => {
    expect(isPathway([[0, 0], [10, 0], [10, 4], [0, 4]], 1)).toBe(false);
  });

  it('rejects a long room that is wider than two grid cells', () => {
    // Aspect 5 but 3 cells wide at gridSize 1 — a hall, not a corridor.
    expect(isPathway([[0, 0], [15, 0], [15, 3], [0, 3]], 1)).toBe(false);
  });

  it('rejects degenerate input', () => {
    expect(isPathway([[0, 0], [10, 0]], 1)).toBe(false);
  });
});

describe('roomFace', () => {
  it('is the derived face, else the hand-traced boundary, else nothing', () => {
    expect(roomFace({ face: SQUARE, boundary: [[0, 0], [1, 0], [1, 1]] })).toBe(SQUARE);
    expect(roomFace({ boundary: SQUARE })).toBe(SQUARE);
    expect(roomFace({})).toEqual([]);
  });
});

describe('interiorPoint', () => {
  it('is the centroid when that is inside', () => {
    expect(interiorPoint(SQUARE)).toEqual([5, 5]);
  });

  it('finds a point inside a ring its centroid falls outside of', () => {
    // A U: the centroid sits in the notch between the arms.
    const u: [number, number][] = [[0, 0], [10, 0], [10, 10], [7, 10], [7, 3], [3, 3], [3, 10], [0, 10]];
    const [cx, cy] = computeCentroid(u);
    expect(pointInRing(cx, cy, u)).toBe(false);
    const [x, y] = interiorPoint(u);
    expect(pointInRing(x, y, u)).toBe(true);
  });
});

describe('readingOrder / nextRoomNumber', () => {
  it('reads top to bottom, then left to right', () => {
    const rooms = [
      { id: 'c', anchor: [1, 9] as [number, number] },
      { id: 'b', anchor: [8, 1.4] as [number, number] },
      { id: 'a', anchor: [2, 1.2] as [number, number] },
    ];
    expect(readingOrder(rooms).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('prefers the face centroid over the anchor when one is known', () => {
    const rooms = [
      { id: 'late', anchor: [0, 0] as [number, number], centroid: [0, 20] as [number, number] },
      { id: 'early', anchor: [0, 10] as [number, number] },
    ];
    expect(readingOrder(rooms).map((r) => r.id)).toEqual(['early', 'late']);
  });

  it('numbers past the highest in use', () => {
    expect(nextRoomNumber(undefined)).toBe(1);
    expect(nextRoomNumber([{ number: 2 }, {}, { number: 7 }])).toBe(8);
  });
});

describe('faceMetrics', () => {
  it('fills centroid, area and isPathway', () => {
    const m = faceMetrics(SQUARE, 1);
    expect(m.centroid).toEqual([5, 5]);
    expect(m.area).toBeCloseTo(100);
    expect(m.isPathway).toBe(false);
  });
});

describe('roomBadgePoints', () => {
  const sq = (x0: number, x1: number): [number, number][] => [
    [x0, 0],
    [x1, 0],
    [x1, 10],
    [x0, 10],
  ];

  it('puts a badge inside its own face, wherever the anchor sits in it', () => {
    const rooms = [
      { id: 'w', name: 'West', anchor: [9.9, 5] as [number, number], face: sq(0, 10) },
      { id: 'e', name: 'East', anchor: [10.1, 5] as [number, number], face: sq(10, 20) },
    ];
    const at = roomBadgePoints(rooms);
    expect(at.get('w')).toEqual([5, 5]);
    expect(at.get('e')).toEqual([15, 5]);
    // Memoised on the rooms array: the same answer object, no recompute.
    expect(roomBadgePoints(rooms)).toBe(at);
  });

  it('keeps the anchor for an orphan, a room with no face, and two rooms on one face', () => {
    const face = sq(0, 10);
    const rooms = [
      { id: 'o', name: 'Orphan', anchor: [30, 5] as [number, number], face: sq(20, 30), orphaned: true },
      { id: 'n', name: 'No face', anchor: [40, 5] as [number, number] },
      { id: 'a', name: 'A', anchor: [2, 2] as [number, number], face },
      { id: 'b', name: 'B', anchor: [8, 8] as [number, number], face },
    ];
    const at = roomBadgePoints(rooms);
    expect([at.get('o'), at.get('n'), at.get('a'), at.get('b')]).toEqual([[30, 5], [40, 5], [2, 2], [8, 8]]);
  });
});
