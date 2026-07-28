import type { Room, WallSegment } from '../shared/types';
import type { Polygon } from '../geometry/GeometryEngine';
import { clipper2Engine } from '../geometry/Clipper2Engine';
import { buildRoom, signedArea } from '../shared/roomUtils';

/** Minimum half-thickness of a cutting rectangle, so hairline walls still cut. */
const MIN_HALF_WIDTH = 0.15;

/**
 * Expand a wall polyline into one cutting rectangle per segment. Each rect is
 * extended by its half-width at both ends so segments that merely touch at a
 * corner still seal — an unsealed corner leaks two rooms into one.
 */
function wallToRects(wall: WallSegment): Polygon[] {
  const halfW = Math.max(wall.width / 2, MIN_HALF_WIDTH);
  const rects: Polygon[] = [];
  for (let i = 0; i + 1 < wall.points.length; i++) {
    const [x0, y0] = wall.points[i];
    const [x1, y1] = wall.points[i + 1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const ux = (dx / len) * halfW;
    const uy = (dy / len) * halfW;
    const nx = (-dy / len) * halfW;
    const ny = (dx / len) * halfW;
    rects.push([
      [x0 - ux + nx, y0 - uy + ny],
      [x1 + ux + nx, y1 + uy + ny],
      [x1 + ux - nx, y1 + uy - ny],
      [x0 - ux - nx, y0 - uy - ny],
    ]);
  }
  return rects;
}

/**
 * Detect rooms by subtracting wall thickness from the merged floor: whatever
 * the walls fail to connect comes back as a separate polygon, and each of
 * those is a room. No walls means the whole floor is one room.
 *
 * Requires Clipper2 to be initialized (`setClipperModule`); without it the
 * engine returns the floor unchanged, i.e. one room per floor polygon.
 */
export function detectRooms(
  floorPolygons: Polygon[],
  walls: WallSegment[],
  gridSize: number,
  nameOverrides: Record<string, string> = {},
): Room[] {
  if (floorPolygons.length === 0) return [];

  // Unconditional difference: with no cutters this still normalizes winding and
  // merges overlapping floor polygons, so the sign test below stays meaningful.
  const parts = clipper2Engine.difference(floorPolygons, walls.flatMap(wallToRects));

  // Positive signed area = outer contour; negative = a hole, not a room.
  // ponytail: Room.boundary is a single ring, so a room wrapped around a sealed
  // inner chamber reports its outline area. Give Room a contours[] if that bites.
  const minArea = gridSize * gridSize * 0.25;
  return parts
    .filter((p) => p.length >= 3 && signedArea(p) > minArea)
    .map((p, i) => buildRoom(p, i, gridSize, nameOverrides));
}
