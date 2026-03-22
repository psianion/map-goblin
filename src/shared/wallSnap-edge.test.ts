import { describe, it, expect } from 'vitest';
import { projectPointOntoLineSegment, snapToNearestWall } from './wallSnap';
import type { WallSegment } from './types';

const makeWall = (id: string, points: [number, number][]): WallSegment => ({
  id,
  points,
  wallType: 'normal',
  direction: 'both',
  color: '#000',
  width: 2,
  roughness: 0,
});

describe('snapToNearestWall — edge cases', () => {
  // 1. Empty walls array
  it('empty walls array returns null', () => {
    expect(snapToNearestWall([0, 0], [], 100)).toBeNull();
  });

  // 2. Zero-length wall (same start and end)
  it('zero-length wall: snap still returns a result without crash', () => {
    const wall = makeWall('w1', [[50, 50], [50, 50]]);
    // projectPointOntoLineSegment handles lenSq===0 by returning distance to the point itself
    const result = snapToNearestWall([50, 50], [wall], 100);
    // Point exactly ON the degenerate wall should snap to it (distance = 0)
    expect(result).not.toBeNull();
    expect(result!.distance).toBeCloseTo(0);
    expect(result!.wallId).toBe('w1');
  });

  // 3. Point at exactly maxDistance from wall — should NOT snap (uses strict <)
  it('point at exactly maxDistance is not snapped (strict less-than threshold)', () => {
    const wall = makeWall('w1', [[0, 0], [100, 0]]);
    // Point is exactly 20 units away; maxDistance is 20 → distance < 20 is false
    const result = snapToNearestWall([50, 20], [wall], 20);
    expect(result).toBeNull();
  });

  // 4. Point exactly on wall — distance should be 0
  it('point exactly on wall returns distance 0', () => {
    const wall = makeWall('w1', [[0, 0], [100, 0]]);
    const result = snapToNearestWall([50, 0], [wall], 1);
    expect(result).not.toBeNull();
    expect(result!.distance).toBeCloseTo(0);
    expect(result!.position).toEqual([50, 0]);
  });

  // 5. Diagonal wall — angle should be ~Math.PI/4 (45 degrees)
  it('diagonal 45-degree wall computes correct angle', () => {
    const wall = makeWall('w1', [[0, 0], [100, 100]]);
    const result = snapToNearestWall([50, 50], [wall], 1);
    expect(result).not.toBeNull();
    expect(result!.angle).toBeCloseTo(Math.PI / 4);
  });

  // 6. Very long wall — snap from midpoint
  it('very long wall (length 10000): snap from midpoint is accurate', () => {
    const wall = makeWall('w1', [[0, 0], [10000, 0]]);
    const result = snapToNearestWall([5000, 3], [wall], 10);
    expect(result).not.toBeNull();
    expect(result!.position[0]).toBeCloseTo(5000);
    expect(result!.position[1]).toBeCloseTo(0);
    expect(result!.t).toBeCloseTo(0.5);
  });

  // 7. Multiple walls equidistant — picks the first one encountered (implementation detail)
  it('two walls equidistant from point — returns one result (first wins due to strict <)', () => {
    const wall1 = makeWall('w1', [[0, 0], [100, 0]]);  // y=0, point is at y=5 → dist=5
    const wall2 = makeWall('w2', [[0, 10], [100, 10]]); // y=10, point is at y=5 → dist=5
    const result = snapToNearestWall([50, 5], [wall1, wall2], 20);
    expect(result).not.toBeNull();
    // Wall1 should win — it is processed first, wall2 has equal distance which fails strict <
    expect(result!.wallId).toBe('w1');
  });

  // 8. Negative coordinates — wall and point in negative space
  it('wall and point in negative coordinate space snap correctly', () => {
    const wall = makeWall('w1', [[-200, -100], [-100, -100]]);
    const result = snapToNearestWall([-150, -95], [wall], 20);
    expect(result).not.toBeNull();
    expect(result!.wallId).toBe('w1');
    expect(result!.position[0]).toBeCloseTo(-150);
    expect(result!.position[1]).toBeCloseTo(-100);
    expect(result!.distance).toBeCloseTo(5);
  });
});

describe('projectPointOntoLineSegment — edge cases', () => {
  // Zero-length segment handled gracefully
  it('zero-length segment: returns start point as closest, computes distance to it', () => {
    const result = projectPointOntoLineSegment([10, 10], [5, 5], [5, 5]);
    expect(result.t).toBe(0);
    expect(result.closest).toEqual([5, 5]);
    const expected = Math.sqrt(50);
    expect(result.distance).toBeCloseTo(expected);
  });

  // Point behind segment start
  it('point before segment start: t=0, closest is start', () => {
    const result = projectPointOntoLineSegment([-10, 0], [0, 0], [100, 0]);
    expect(result.t).toBe(0);
    expect(result.closest).toEqual([0, 0]);
    expect(result.distance).toBeCloseTo(10);
  });

  // Point past segment end
  it('point past segment end: t=1, closest is end', () => {
    const result = projectPointOntoLineSegment([110, 0], [0, 0], [100, 0]);
    expect(result.t).toBe(1);
    expect(result.closest).toEqual([100, 0]);
    expect(result.distance).toBeCloseTo(10);
  });

  // Negative coordinates
  it('negative coordinate space projection is correct', () => {
    const result = projectPointOntoLineSegment([-50, -5], [-100, 0], [0, 0]);
    expect(result.closest[0]).toBeCloseTo(-50);
    expect(result.closest[1]).toBeCloseTo(0);
    expect(result.distance).toBeCloseTo(5);
  });
});
