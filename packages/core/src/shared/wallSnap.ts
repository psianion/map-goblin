import type { WallSegment } from './types';

export interface WallSnapResult {
  wallId: string;
  position: [number, number];
  angle: number;
  t: number;
  distance: number;
}

export function projectPointOntoLineSegment(
  point: [number, number],
  lineStart: [number, number],
  lineEnd: [number, number],
): { closest: [number, number]; t: number; distance: number } {
  const dx = lineEnd[0] - lineStart[0];
  const dy = lineEnd[1] - lineStart[1];
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    const dist = Math.sqrt(
      (point[0] - lineStart[0]) ** 2 + (point[1] - lineStart[1]) ** 2,
    );
    return { closest: [...lineStart] as [number, number], t: 0, distance: dist };
  }

  let t = ((point[0] - lineStart[0]) * dx + (point[1] - lineStart[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const closest: [number, number] = [
    lineStart[0] + t * dx,
    lineStart[1] + t * dy,
  ];
  const distance = Math.sqrt(
    (point[0] - closest[0]) ** 2 + (point[1] - closest[1]) ** 2,
  );

  return { closest, t, distance };
}

/**
 * Nearest point on any wall, within `maxDistance`.
 *
 * Walks every segment of the polyline. This used to project onto a single line
 * from `points[0]` to the last point, which was equivalent while every wall was
 * two points — since the wall tool started producing chains it would have
 * snapped doors to a phantom line cutting the corners off the actual wall.
 *
 * `t` is parametric along the whole polyline by arc length, so it still means
 * "how far along this wall" and is unchanged for two-point walls.
 */
export function snapToNearestWall(
  worldPos: [number, number],
  walls: WallSegment[],
  maxDistance: number,
): WallSnapResult | null {
  let best: WallSnapResult | null = null;
  let bestDist = maxDistance;

  for (const wall of walls) {
    if (wall.points.length < 2) continue;

    const lengths: number[] = [];
    let total = 0;
    for (let i = 0; i < wall.points.length - 1; i++) {
      const len = Math.hypot(
        wall.points[i + 1][0] - wall.points[i][0],
        wall.points[i + 1][1] - wall.points[i][1],
      );
      lengths.push(len);
      total += len;
    }

    let travelled = 0;
    for (let i = 0; i < wall.points.length - 1; i++) {
      const start = wall.points[i];
      const end = wall.points[i + 1];
      const proj = projectPointOntoLineSegment(worldPos, start, end);

      if (proj.distance < bestDist) {
        bestDist = proj.distance;
        best = {
          wallId: wall.id,
          position: proj.closest,
          angle: Math.atan2(end[1] - start[1], end[0] - start[0]),
          t: total > 0 ? (travelled + proj.t * lengths[i]) / total : 0,
          distance: proj.distance,
        };
      }
      travelled += lengths[i];
    }
  }

  return best;
}
