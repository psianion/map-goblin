import type { Room } from './types';

/**
 * Signed area (shoelace). Positive = counter-clockwise winding.
 * Clipper2 emits outer contours positive and holes negative, so the sign
 * is what distinguishes a room from a hole punched in one.
 */
export function signedArea(boundary: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < boundary.length; i++) {
    const [x1, y1] = boundary[i];
    const [x2, y2] = boundary[(i + 1) % boundary.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/** Absolute polygon area. */
export function computeArea(boundary: [number, number][]): number {
  return Math.abs(signedArea(boundary));
}

/**
 * Area centroid of a polygon (not the vertex average) — stable when Clipper2
 * inserts extra collinear vertices, which the vertex average is not.
 * Falls back to the vertex average for degenerate (zero-area) input.
 */
export function computeCentroid(boundary: [number, number][]): [number, number] {
  if (boundary.length === 0) return [0, 0];
  const a = signedArea(boundary);
  if (Math.abs(a) > 1e-9) {
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < boundary.length; i++) {
      const [x1, y1] = boundary[i];
      const [x2, y2] = boundary[(i + 1) % boundary.length];
      const cross = x1 * y2 - x2 * y1;
      cx += (x1 + x2) * cross;
      cy += (y1 + y2) * cross;
    }
    return [cx / (6 * a), cy / (6 * a)];
  }
  let sx = 0;
  let sy = 0;
  for (const [x, y] of boundary) {
    sx += x;
    sy += y;
  }
  return [sx / boundary.length, sy / boundary.length];
}

/**
 * Stable room ID: FNV-1a over the centroid quantized to grid cells.
 * Editing walls elsewhere on the map leaves a room's ID untouched, which is
 * what lets user-assigned names survive re-detection.
 *
 * ponytail: two rooms whose centroids land in the same grid cell collide.
 * Mix the rounded area into the key if that ever shows up in practice.
 */
export function computeStableRoomId(centroid: [number, number], gridSize: number): string {
  const g = gridSize > 0 ? gridSize : 1;
  const key = `${Math.round(centroid[0] / g)},${Math.round(centroid[1] / g)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `room-${(h >>> 0).toString(36)}`;
}

/**
 * Narrow-corridor heuristic: long axis more than 3x the short axis, and the
 * short axis no wider than two grid cells.
 *
 * ponytail: axis-aligned bounding box, so a diagonal corridor reads as a room.
 * Swap in a rotating-calipers oriented box if diagonal maps matter.
 */
export function isPathway(boundary: [number, number][], gridSize: number): boolean {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of boundary) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  if (short < 0.01) return false;
  return long / short > 3 && short <= 2 * gridSize;
}

/** Build a Room from a boundary polygon, applying any user name override. */
export function buildRoom(
  boundary: [number, number][],
  index: number,
  gridSize: number,
  nameOverrides: Record<string, string> = {},
): Room {
  const centroid = computeCentroid(boundary);
  const id = computeStableRoomId(centroid, gridSize);
  const pathway = isPathway(boundary, gridSize);
  return {
    id,
    name: nameOverrides[id] ?? (pathway ? `Corridor ${index + 1}` : `Room ${index + 1}`),
    boundary,
    centroid,
    area: computeArea(boundary),
    isPathway: pathway,
  };
}
