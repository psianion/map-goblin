// A door across a gap: from the wall nearest the pointer over to the nearest wall on the
// pointer's far side, so a door in a corridor or a cave entrance spans it rather than running
// along one side. Pure: the Door tool asks it where such a door would stand and how wide.

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

/** Below this a pointer is on its wall and there is no side to look across to. */
const ON_WALL = 1e-6;

/** cos and sin of 30°: the far side is the 120° wedge round n, bounded 60° either side of it. */
const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;

type Pt = [number, number];

/**
 * The point of run ab nearest `p` inside the wedge `(Q - p) . n >= 0.5 |Q - p|`, null when
 * the run lies wholly outside it. The wedge is two half-planes through p, their inward
 * normals n turned 30° either way, so the run clips to one stretch and the nearest point of
 * that stretch is the answer.
 */
function nearestInWedge(p: Pt, n: Pt, a: Pt, b: Pt): { at: Pt; distance: number } | null {
  let lo = 0;
  let hi = 1;
  const d: Pt = [b[0] - a[0], b[1] - a[1]];
  for (const s of [SIN30, -SIN30]) {
    const m: Pt = [n[0] * COS30 - n[1] * s, n[0] * s + n[1] * COS30];
    const f0 = (a[0] - p[0]) * m[0] + (a[1] - p[1]) * m[1];
    const df = d[0] * m[0] + d[1] * m[1];
    if (Math.abs(df) < 1e-12) {
      if (f0 < 0) return null;
      continue;
    }
    const t = -f0 / df;
    if (df > 0) lo = Math.max(lo, t);
    else hi = Math.min(hi, t);
  }
  if (lo > hi) return null;
  const len2 = d[0] * d[0] + d[1] * d[1];
  const raw = len2 > 0 ? ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / len2 : 0;
  const t = Math.min(hi, Math.max(lo, raw));
  const at: Pt = [a[0] + d[0] * t, a[1] + d[1] * t];
  const distance = Math.hypot(at[0] - p[0], at[1] - p[1]);
  return distance > ON_WALL ? { at, distance } : null;
}

/**
 * The door that spans the gap at `point`. A is the nearest point on any wall and n the unit
 * from A to the pointer; B is the nearest wall point on the pointer's far side, within 60°
 * of n, on any run but A's own. The door runs from A to B, at B − A's angle. A drawn
 * (standalone) wall's end is pulled in by half its drawn width (`widthOf`) so the door sits
 * between the faces; a floor edge has none. Where the faces leave less than the style's
 * narrowest door but the centres do not, it spans centre to centre. Null when there is no
 * far side, or the gap is narrower than the style allows or wider than `maxSpan`.
 */
export function spanBetweenWalls(
  point: Pt,
  walls: readonly ResolvedWall[],
  style: DoorStyle,
  maxSpan: number,
  widthOf: (wall: ResolvedWall) => number,
): DoorSpan | null {
  let near: { wall: ResolvedWall; run: number; at: Pt; distance: number } | null = null;
  for (const wall of walls) {
    for (let i = 0; i + 1 < wall.points.length; i++) {
      const p = projectPointOntoLineSegment(point, wall.points[i], wall.points[i + 1]);
      if (!near || p.distance < near.distance) near = { wall, run: i, at: p.closest, distance: p.distance };
    }
  }
  if (!near || near.distance < ON_WALL) return null;
  const n: Pt = [(point[0] - near.at[0]) / near.distance, (point[1] - near.at[1]) / near.distance];

  let far: { wall: ResolvedWall; at: Pt; distance: number } | null = null;
  for (const wall of walls) {
    for (let i = 0; i + 1 < wall.points.length; i++) {
      if (wall === near.wall && i === near.run) continue;
      const q = nearestInWedge(point, n, wall.points[i], wall.points[i + 1]);
      if (q && (!far || q.distance < far.distance)) far = { wall, ...q };
    }
  }
  if (!far) return null;

  const A = near.at;
  const gap = Math.hypot(far.at[0] - A[0], far.at[1] - A[1]);
  if (gap < ON_WALL) return null;
  const u: Pt = [(far.at[0] - A[0]) / gap, (far.at[1] - A[1]) / gap];
  const min = minDoorWidth(style);
  const face = (w: ResolvedWall) => (w.kind === 'standalone' ? widthOf(w) / 2 : 0);
  let pullA = face(near.wall);
  let pullB = face(far.wall);
  if (gap - pullA - pullB < min && gap >= min) pullA = pullB = 0;
  const width = gap - pullA - pullB;
  if (width < min || width > maxSpan) return null;
  // Along u from A: the near face at pullA, the far face at gap - pullB.
  const mid = (pullA + gap - pullB) / 2;
  return {
    centre: [A[0] + u[0] * mid, A[1] + u[1] * mid],
    angle: Math.atan2(u[1], u[0]),
    width,
    wallA: near.wall,
  };
}

