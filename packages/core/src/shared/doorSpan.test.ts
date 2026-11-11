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
    const span = spanBetweenWalls([4, 1], walls, 'single', 4, drawnWidth)!;
    expect(span.wallA.id).toBe('n');
    // 3 between the lines, less a quarter cell at each face.
    expect(span.width).toBeCloseTo(2.5);
    expect(span.centre[0]).toBeCloseTo(4);
    expect(span.centre[1]).toBeCloseTo(1.5);
    expect(span.angle).toBeCloseTo(Math.PI / 2);
  });

  it('spans a one-cell corridor from off its centre, centre to centre once the faces leave too little', () => {
    const walls = [wall('n', [[0, 0], [10, 0]]), wall('s', [[0, 1], [10, 1]])];
    const span = spanBetweenWalls([4, 0.3], walls, 'single', 4, drawnWidth)!;
    expect(span.width).toBeCloseTo(1);
    expect(span.centre[1]).toBeCloseTo(0.5);
  });

  it('pulls in nothing at floor edges', () => {
    const walls = [wall('n', [[0, 0], [10, 0]], 'floor'), wall('s', [[0, 3], [10, 3]], 'floor')];
    const span = spanBetweenWalls([4, 1], walls, 'single', 4, drawnWidth)!;
    expect(span.width).toBeCloseTo(3);
    expect(span.centre[1]).toBeCloseTo(1.5);
  });

  it('spans between angled walls, at the angle from the near point to the far one', () => {
    // Two walls opening out like a funnel: no straight cast from the near wall meets the other square on.
    const walls = [wall('a', [[0, 0], [10, 1]], 'floor'), wall('b', [[0, 3], [10, 5]], 'floor')];
    const span = spanBetweenWalls([5, 2], walls, 'single', 4, drawnWidth)!;
    expect(span).not.toBeNull();
    expect(span.wallA.id).toBe('a');
    expect(span.width).toBeGreaterThan(2);
    expect(span.width).toBeLessThan(4);
    expect(Math.sin(span.angle)).toBeGreaterThan(0.9);
  });

  it('spans from a wall’s end to the wall facing it', () => {
    // A stub ending at x = 4 and a long wall across from it; the pointer is past the stub's end.
    const walls = [wall('stub', [[0, 0], [4, 0]], 'floor'), wall('far', [[0, 3], [10, 3]], 'floor')];
    const span = spanBetweenWalls([4.6, 0.8], walls, 'single', 4, drawnWidth)!;
    expect(span.wallA.id).toBe('stub');
    expect(span.width).toBeLessThanOrEqual(4);
    expect(span.width).toBeGreaterThan(2.9);
  });

  it('spans a 4-cell gap at Width 1 and not a 4.5-cell one', () => {
    const gap = (d: number) => [wall('n', [[0, 0], [10, 0]], 'floor'), wall('s', [[0, d], [10, d]], 'floor')];
    expect(spanBetweenWalls([4, 1], gap(4), 'single', Math.max(4, 1), drawnWidth)?.width).toBeCloseTo(4);
    expect(spanBetweenWalls([4, 1], gap(4.5), 'single', Math.max(4, 1), drawnWidth)).toBeNull();
  });

  it('never ends on the run the near point is on, but does on the same wall’s other runs', () => {
    // One wall bent into a U: the pointer between its arms spans arm to arm.
    const u = wall('u', [[0, 0], [10, 0], [10, 2], [0, 2]], 'floor');
    const span = spanBetweenWalls([5, 0.5], [u], 'single', 4, drawnWidth)!;
    expect(span.wallA.id).toBe('u');
    expect(span.width).toBeCloseTo(2);
    // A lone straight wall has nothing across from it.
    expect(spanBetweenWalls([5, 1], [wall('n', [[0, 0], [10, 0]])], 'single', 4, drawnWidth)).toBeNull();
  });

  it('gives nothing for a gap narrower than the style’s narrowest door', () => {
    const walls = [wall('n', [[0, 0], [10, 0]], 'floor'), wall('s', [[0, 1.5], [10, 1.5]], 'floor')];
    expect(minDoorWidth('double')).toBe(2);
    expect(spanBetweenWalls([4, 0.75], walls, 'double', 4, drawnWidth)).toBeNull();
    expect(spanBetweenWalls([4, 0.75], walls, 'single', 4, drawnWidth)?.width).toBeCloseTo(1.5);
  });

  it('gives nothing with the pointer on a wall', () => {
    expect(spanBetweenWalls([4, 0], [wall('n', [[0, 0], [10, 0]]), wall('s', [[0, 2], [10, 2]])], 'single', 4, drawnWidth)).toBeNull();
  });
});
