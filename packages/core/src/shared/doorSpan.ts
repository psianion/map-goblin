// A door across a gap: from the wall nearest the pointer, straight over to the first wall
// on the far side, so a door in a corridor spans it rather than running along one side.
// Pure: the Door tool asks it where such a door would stand and how wide it would be.

import type { DoorStyle } from './types';
import type { ResolvedWall } from './wallResolve';
import { projectPointOntoLineSegment } from './wallSnap';

/**
 * Styles that are drawn as a two-cell opening. A double door has two leaves, a
 * portcullis a row of bars, an archway a stone jamb either side — squeeze any of
 * them into one cell and the art is a smear with no readable detail. Single-leaf
 * styles (and portals, which carry their own art) fit a cell.
 */
const WIDE_STYLES = new Set<DoorStyle>(['double', 'portcullis', 'archway']);

/**
 * Narrowest a door of this style may be, in world units — grid cells, the same
 * units `door.width` and the door tool's snap reach are in.
 */
export function minDoorWidth(style: DoorStyle): number {
  return WIDE_STYLES.has(style) ? 2 : 1;
}

export interface DoorSpan {
  /** The middle of the gap, between the two walls' faces. */
  centre: [number, number];
  /** Radians, from the near wall towards the far one. */
  angle: number;
  /** The gap between the faces, cells: the door's width. */
  width: number;
  /** The wall nearest the pointer, whose look the door takes. */
  wallA: ResolvedWall;
}

/** Below this a pointer is on its wall and there is no direction to cast in. */
const ON_WALL = 1e-6;

/** Where the ray from `o` along `d` crosses segment ab, as the distance along the ray; null when it misses. */
function rayHit(o: [number, number], d: [number, number], a: [number, number], b: [number, number]): number | null {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const den = d[0] * ey - d[1] * ex;
  if (Math.abs(den) < 1e-12) return null;
  const ax = a[0] - o[0];
  const ay = a[1] - o[1];
  const t = (ax * ey - ay * ex) / den;
  const u = (ax * d[1] - ay * d[0]) / den;
  return t > ON_WALL && u >= 0 && u <= 1 ? t : null;
}

/**
 * The door that spans the gap at `point`: A is the nearest point on any wall, the cast
 * runs from the pointer away from A, and B is the first wall run it hits other than the
 * one A is on. A drawn (standalone) wall's end is pulled in by half its drawn width
 * (`widthOf`) so the door sits between the faces; floor and material edges have none.
 * Null when nothing is hit, or the gap is narrower than the style allows or wider than
 * `maxSpan`.
 */
export function spanBetweenWalls(
  point: [number, number],
  walls: readonly ResolvedWall[],
  style: DoorStyle,
  maxSpan: number,
  widthOf: (wall: ResolvedWall) => number,
): DoorSpan | null {
  let near: { wall: ResolvedWall; run: number; at: [number, number]; distance: number } | null = null;
  for (const wall of walls) {
    for (let i = 0; i + 1 < wall.points.length; i++) {
      const p = projectPointOntoLineSegment(point, wall.points[i], wall.points[i + 1]);
      if (!near || p.distance < near.distance) near = { wall, run: i, at: p.closest, distance: p.distance };
    }
  }
  if (!near || near.distance < ON_WALL) return null;
  const n: [number, number] = [(point[0] - near.at[0]) / near.distance, (point[1] - near.at[1]) / near.distance];

  let far: { wall: ResolvedWall; t: number } | null = null;
  for (const wall of walls) {
    for (let i = 0; i + 1 < wall.points.length; i++) {
      if (wall === near.wall && i === near.run) continue;
      const t = rayHit(point, n, wall.points[i], wall.points[i + 1]);
      if (t !== null && (!far || t < far.t)) far = { wall, t };
    }
  }
  if (!far) return null;

  const face = (w: ResolvedWall) => (w.kind === 'standalone' ? widthOf(w) / 2 : 0);
  const pullA = face(near.wall);
  const pullB = face(far.wall);
  const gap = near.distance + far.t;
  const width = gap - pullA - pullB;
  if (width < minDoorWidth(style) || width > maxSpan) return null;
  // Along n from A: the near face at pullA, the far face at gap - pullB.
  const mid = (pullA + gap - pullB) / 2;
  return {
    centre: [near.at[0] + n[0] * mid, near.at[1] + n[1] * mid],
    angle: Math.atan2(n[1], n[0]),
    width,
    wallA: near.wall,
  };
}
