import { describe, expect, it } from 'vitest';
import { minDoorWidth, spanBetweenWalls } from './doorSpan';
import type { ResolvedWall } from './wallResolve';

const wall = (id: string, points: [number, number][], kind: ResolvedWall['kind'] = 'standalone', width = 0.5): ResolvedWall => ({
  id, points, wallType: 'normal', direction: 'both', color: '#000000', width, roughness: 0, kind,
});
const drawnWidth = (w: ResolvedWall) => w.width ?? 0.5;

describe('spanBetweenWalls', () => {
  it('spans a corridor between two drawn walls, face to face', () => {
    const walls = [wall('n', [[0, 0], [10, 0]]), wall('s', [[0, 3], [10, 3]])];
    const span = spanBetweenWalls([4, 1], walls, 'single', 3, drawnWidth)!;
    expect(span.wallA.id).toBe('n');
    // 3 between the lines, less a quarter cell at each face.
    expect(span.width).toBeCloseTo(2.5);
    expect(span.centre[0]).toBeCloseTo(4);
    expect(span.centre[1]).toBeCloseTo(1.5);
    expect(span.angle).toBeCloseTo(Math.PI / 2);
  });

  it('pulls in nothing at floor and material edges', () => {
    const walls = [wall('n', [[0, 0], [10, 0]], 'floor'), wall('s', [[0, 3], [10, 3]], 'material')];
    const span = spanBetweenWalls([4, 1], walls, 'single', 3, drawnWidth)!;
    expect(span.width).toBeCloseTo(3);
    expect(span.centre[1]).toBeCloseTo(1.5);
  });

  it('gives nothing in a room wider than the widest span', () => {
    const walls = [wall('n', [[0, 0], [10, 0]]), wall('s', [[0, 8], [10, 8]])];
    expect(spanBetweenWalls([4, 2], walls, 'single', 3, drawnWidth)).toBeNull();
    expect(spanBetweenWalls([4, 2], walls, 'single', 8, drawnWidth)?.width).toBeCloseTo(7.5);
  });

  it('never ends on the run the near point is on, but does on the same wall’s other runs', () => {
    // One wall bent into a U: the pointer between its arms spans arm to arm.
    const u = wall('u', [[0, 0], [10, 0], [10, 2], [0, 2]], 'floor');
    const span = spanBetweenWalls([5, 0.5], [u], 'single', 3, drawnWidth)!;
    expect(span.wallA.id).toBe('u');
    expect(span.width).toBeCloseTo(2);
    // A lone straight wall has nothing across from it.
    expect(spanBetweenWalls([5, 1], [wall('n', [[0, 0], [10, 0]])], 'single', 3, drawnWidth)).toBeNull();
  });

  it('gives nothing for a gap narrower than the style’s narrowest door', () => {
    const walls = [wall('n', [[0, 0], [10, 0]], 'floor'), wall('s', [[0, 1.5], [10, 1.5]], 'floor')];
    expect(minDoorWidth('double')).toBe(2);
    expect(spanBetweenWalls([4, 0.75], walls, 'double', 3, drawnWidth)).toBeNull();
    expect(spanBetweenWalls([4, 0.75], walls, 'single', 3, drawnWidth)?.width).toBeCloseTo(1.5);
  });

  it('gives nothing with the pointer on a wall', () => {
    expect(spanBetweenWalls([4, 0], [wall('n', [[0, 0], [10, 0]]), wall('s', [[0, 2], [10, 2]])], 'single', 3, drawnWidth)).toBeNull();
  });
});
