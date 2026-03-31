import { describe, it, expect } from 'vitest';
import { projectPointOntoLineSegment, snapToNearestWall } from './wallSnap';
import type { WallSegment } from './types';

describe('projectPointOntoLineSegment', () => {
  it('projects to midpoint of horizontal segment', () => {
    const result = projectPointOntoLineSegment([50, 10], [0, 0], [100, 0]);
    expect(result.closest[0]).toBeCloseTo(50);
    expect(result.closest[1]).toBeCloseTo(0);
    expect(result.t).toBeCloseTo(0.5);
    expect(result.distance).toBeCloseTo(10);
  });

  it('clamps to start when point is before segment', () => {
    const result = projectPointOntoLineSegment([-50, 0], [0, 0], [100, 0]);
    expect(result.t).toBe(0);
    expect(result.closest).toEqual([0, 0]);
  });

  it('clamps to end when point is past segment', () => {
    const result = projectPointOntoLineSegment([150, 0], [0, 0], [100, 0]);
    expect(result.t).toBe(1);
    expect(result.closest).toEqual([100, 0]);
  });

  it('handles vertical segments', () => {
    const result = projectPointOntoLineSegment([10, 50], [0, 0], [0, 100]);
    expect(result.closest[0]).toBeCloseTo(0);
    expect(result.closest[1]).toBeCloseTo(50);
    expect(result.t).toBeCloseTo(0.5);
  });

  it('computes correct projection for diagonal segment', () => {
    const result = projectPointOntoLineSegment([50, 50], [0, 0], [100, 100]);
    expect(result.closest[0]).toBeCloseTo(50);
    expect(result.closest[1]).toBeCloseTo(50);
  });
});

describe('snapToNearestWall', () => {
  const wall1: WallSegment = {
    id: 'w1', points: [[0, 0], [100, 0]],
    wallType: 'normal', direction: 'both',
    color: '#000', width: 2, roughness: 0,
  };
  const wall2: WallSegment = {
    id: 'w2', points: [[0, 50], [100, 50]],
    wallType: 'normal', direction: 'both',
    color: '#000', width: 2, roughness: 0,
  };

  it('snaps to nearest wall within threshold', () => {
    const result = snapToNearestWall([50, 5], [wall1, wall2], 20);
    expect(result).not.toBeNull();
    expect(result!.wallId).toBe('w1');
    expect(result!.distance).toBeCloseTo(5);
  });

  it('returns null when beyond threshold', () => {
    const result = snapToNearestWall([50, 100], [wall1, wall2], 20);
    expect(result).toBeNull();
  });

  it('selects closer wall when multiple are within range', () => {
    const result = snapToNearestWall([50, 45], [wall1, wall2], 20);
    expect(result!.wallId).toBe('w2');
  });

  it('computes wall angle', () => {
    const result = snapToNearestWall([50, 5], [wall1], 20);
    expect(result!.angle).toBeCloseTo(0);
  });
});
