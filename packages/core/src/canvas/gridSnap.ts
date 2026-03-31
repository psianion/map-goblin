import type { Point } from '../types/geometry';
import { useStore } from '../store/store';

/**
 * Grid snap middleware — snaps world-space points to grid subdivisions.
 * interval = 1 / snapDivision (in world units)
 */
export function gridSnap(point: Point): Point {
  const { snapEnabled, snapDivision } = useStore.getState().grid;
  if (!snapEnabled) return point;
  const interval = 1 / snapDivision;
  return {
    x: Math.round(point.x / interval) * interval,
    y: Math.round(point.y / interval) * interval,
  };
}
