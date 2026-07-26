import { describe, it, expect } from 'vitest';
import {
  buildRoom,
  computeArea,
  computeCentroid,
  computeStableRoomId,
  isPathway,
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

describe('buildRoom', () => {
  it('names plain rooms and corridors differently', () => {
    expect(buildRoom(SQUARE, 0, 1).name).toBe('Room 1');
    expect(buildRoom([[0, 0], [10, 0], [10, 1], [0, 1]], 2, 1).name).toBe('Corridor 3');
  });

  it('applies a name override keyed by stable id', () => {
    const id = buildRoom(SQUARE, 0, 1).id;
    expect(buildRoom(SQUARE, 0, 1, { [id]: "Klarg's Cave" }).name).toBe("Klarg's Cave");
  });

  it('fills centroid, area and isPathway', () => {
    const room = buildRoom(SQUARE, 0, 1);
    expect(room.centroid).toEqual([5, 5]);
    expect(room.area).toBeCloseTo(100);
    expect(room.isPathway).toBe(false);
    expect(room.boundary).toBe(SQUARE);
  });
});
