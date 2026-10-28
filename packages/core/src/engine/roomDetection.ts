import type { ThresholdSegment, WallSegment } from '../shared/types';
import type { Polygon } from '../geometry/GeometryEngine';
import { clipper2Engine } from '../geometry/Clipper2Engine';
import { signedArea } from '../shared/roomUtils';
import { wallWidthOf } from '../shared/wallLook';

/** Minimum half-thickness of a cutting rectangle, so hairline walls still cut. */
const MIN_HALF_WIDTH = 0.15;

/**
 * Half-width of a threshold's cut, in cells. A threshold blocks nothing and draws
 * nothing, so it only has to be wide enough that Clipper2 reliably opens a gap
 * between the two faces: 0.1 of a cell all told.
 */
export const THRESHOLD_HALF_WIDTH = 0.05;

/** One cutting rectangle per segment of a polyline, grown by `halfW` at both ends. */
function polylineToRects(points: readonly [number, number][], halfW: number): Polygon[] {
  const rects: Polygon[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
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
 * Expand a wall polyline into one cutting rectangle per segment. Each rect is
 * extended by its half-width at both ends so segments that merely touch at a
 * corner still seal — an unsealed corner leaks two rooms into one.
 */
export function wallToRects(wall: WallSegment, layerWallWidth: number): Polygon[] {
  const halfW = Math.max(wallWidthOf(wall, layerWallWidth) / 2, MIN_HALF_WIDTH);
  return polylineToRects(wall.points, halfW);
}

/** A threshold's cut: the same rectangles at a tenth of a cell wide. */
export function thresholdToRects(threshold: ThresholdSegment): Polygon[] {
  return polylineToRects(threshold.points, THRESHOLD_HALF_WIDTH);
}

/**
 * The faces rooms sit in: the merged floor with every wall and threshold
 * subtracted. Whatever the cutters fail to connect comes back as a separate
 * polygon, and each is a face. No cutters means the whole floor is one face.
 *
 * Faces carry no identity — a room is the anchor the DM placed, and its face is
 * whichever of these holds that anchor (`store/roomSync.ts`).
 *
 * Requires Clipper2 to be initialized (`setClipperModule`); without it the
 * engine returns the floor unchanged, i.e. one face per floor polygon.
 */
export function roomFaces(
  floorPolygons: Polygon[],
  walls: readonly WallSegment[],
  gridSize: number,
  /** The layer's `style.wallWidth`, which a wall without its own width takes. */
  layerWallWidth = 0,
  thresholds: readonly ThresholdSegment[] = [],
): Polygon[] {
  if (floorPolygons.length === 0) return [];

  // Unconditional difference: with no cutters this still normalizes winding and
  // merges overlapping floor polygons, so the sign test below stays meaningful.
  const parts = clipper2Engine.difference(floorPolygons, [
    ...walls.flatMap((w) => wallToRects(w, layerWallWidth)),
    ...thresholds.flatMap(thresholdToRects),
  ]);

  // Positive signed area = outer contour; negative = a hole, not a face.
  // ponytail: a face is a single ring, so one wrapped around a sealed inner
  // chamber reports its outline area. Give Room a contours[] if that bites.
  const minArea = gridSize * gridSize * 0.25;
  return parts.filter((p) => p.length >= 3 && signedArea(p) > minArea);
}
