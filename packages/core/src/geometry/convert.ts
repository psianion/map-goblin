import type { Point } from '../types/geometry';

export function tuplesToPoints(tuples: [number, number][]): Point[] {
  return tuples.map(([x, y]) => ({ x, y }));
}

export function pointsToTuples(points: Point[]): [number, number][] {
  return points.map(({ x, y }) => [x, y]);
}
