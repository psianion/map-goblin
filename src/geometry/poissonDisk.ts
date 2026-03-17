import type { Point } from '@/types/geometry';

/**
 * Poisson-disk sampling within a circular region.
 * Uses Bridson's algorithm with grid-accelerated spatial lookup.
 *
 * @param center  Center of the sampling circle (world coords)
 * @param radius  Radius of the sampling region
 * @param minDist Minimum distance between any two samples
 * @param maxCount Maximum number of points to return
 * @returns Array of sampled points within the circle
 */
export function poissonDiskSample(
  center: Point,
  radius: number,
  minDist: number,
  maxCount: number,
): Point[] {
  if (radius <= 0 || minDist <= 0 || maxCount <= 0) return [];

  const cellSize = minDist / Math.SQRT2;
  const gridWidth = Math.ceil((radius * 2) / cellSize);
  const gridOffset = center.x - radius; // grid origin x
  const gridOffsetY = center.y - radius; // grid origin y

  // Spatial grid: -1 = empty, otherwise index into points[]
  const grid = new Int32Array(gridWidth * gridWidth).fill(-1);

  const points: Point[] = [];
  const active: number[] = [];
  const k = 30; // rejection attempts per active point

  // Start with center point
  addPoint(center);

  while (active.length > 0 && points.length < maxCount) {
    const activeIdx = Math.floor(Math.random() * active.length);
    const activePointIdx = active[activeIdx];
    const pt = points[activePointIdx];
    let found = false;

    for (let attempt = 0; attempt < k; attempt++) {
      // Random point at distance [minDist, 2*minDist] from active point
      const angle = Math.random() * Math.PI * 2;
      const dist = minDist + Math.random() * minDist;
      const candidate: Point = {
        x: pt.x + Math.cos(angle) * dist,
        y: pt.y + Math.sin(angle) * dist,
      };

      // Check within sampling circle
      const dx = candidate.x - center.x;
      const dy = candidate.y - center.y;
      if (dx * dx + dy * dy > radius * radius) continue;

      // Check grid neighbors for minimum distance
      const gx = Math.floor((candidate.x - gridOffset) / cellSize);
      const gy = Math.floor((candidate.y - gridOffsetY) / cellSize);

      if (gx < 0 || gx >= gridWidth || gy < 0 || gy >= gridWidth) continue;

      if (!hasNeighborTooClose(candidate, gx, gy)) {
        addPoint(candidate);
        found = true;
        if (points.length >= maxCount) break;
      }
    }

    if (!found) {
      // Remove from active list (swap with last)
      active[activeIdx] = active[active.length - 1];
      active.pop();
    }
  }

  return points;

  function addPoint(p: Point): void {
    const idx = points.length;
    points.push(p);
    active.push(idx);
    const gx = Math.floor((p.x - gridOffset) / cellSize);
    const gy = Math.floor((p.y - gridOffsetY) / cellSize);
    if (gx >= 0 && gx < gridWidth && gy >= 0 && gy < gridWidth) {
      grid[gy * gridWidth + gx] = idx;
    }
  }

  function hasNeighborTooClose(candidate: Point, gx: number, gy: number): boolean {
    const minDistSq = minDist * minDist;
    const searchRadius = 2; // check 5x5 neighborhood
    for (let dy = -searchRadius; dy <= searchRadius; dy++) {
      for (let dx = -searchRadius; dx <= searchRadius; dx++) {
        const nx = gx + dx;
        const ny = gy + dy;
        if (nx < 0 || nx >= gridWidth || ny < 0 || ny >= gridWidth) continue;
        const neighborIdx = grid[ny * gridWidth + nx];
        if (neighborIdx === -1) continue;
        const neighbor = points[neighborIdx];
        const ddx = candidate.x - neighbor.x;
        const ddy = candidate.y - neighbor.y;
        if (ddx * ddx + ddy * ddy < minDistSq) return true;
      }
    }
    return false;
  }
}
