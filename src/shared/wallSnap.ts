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

export function snapToNearestWall(
  worldPos: [number, number],
  walls: WallSegment[],
  maxDistance: number,
): WallSnapResult | null {
  let best: WallSnapResult | null = null;
  let bestDist = maxDistance;

  for (const wall of walls) {
    const start = wall.points[0];
    const end = wall.points[wall.points.length - 1];
    const proj = projectPointOntoLineSegment(worldPos, start, end);

    if (proj.distance < bestDist) {
      bestDist = proj.distance;
      const dx = end[0] - start[0];
      const dy = end[1] - start[1];
      best = {
        wallId: wall.id,
        position: proj.closest,
        angle: Math.atan2(dy, dx),
        t: proj.t,
        distance: proj.distance,
      };
    }
  }

  return best;
}
