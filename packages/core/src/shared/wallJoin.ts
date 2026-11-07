// Joining drawn walls end to end: the Wall tool's auto-join and Select's Merge. Pure, so
// what joins, how the points run and where the hand edits land are unit-tested here; the
// command in store/commands.ts only applies the answer.

import type { DungeonStyle } from '../store/types';
import type { WallDirection, WallEdits, WallSegment } from './types';
import { standaloneWallLook } from './wallLook';

type Pt = [number, number];

/** Two endpoints closer than this are the same point (the endpoint snap lands exactly on one). */
export const JOIN_TOLERANCE = 1e-3;

const same = (a: Pt, b: Pt): boolean => Math.hypot(a[0] - b[0], a[1] - b[1]) <= JOIN_TOLERANCE;

function isLoop(points: readonly Pt[]): boolean {
  return points.length >= 4 && same(points[0], points[points.length - 1]);
}

function length(points: readonly Pt[]): number {
  let n = 0;
  for (let i = 1; i < points.length; i++) n += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return n;
}

const flip = (d: WallDirection): WallDirection => (d === 'left' ? 'right' : d === 'right' ? 'left' : d);

/** How `b` meets `a`: which end of each touches, or null when no endpoint is shared. */
export function sharedEnd(a: readonly Pt[], b: readonly Pt[]): { aEnd: 'start' | 'end'; bEnd: 'start' | 'end' } | null {
  if (a.length < 2 || b.length < 2 || isLoop(a) || isLoop(b)) return null;
  const ends = [
    ['end', 'start'],
    ['end', 'end'],
    ['start', 'end'],
    ['start', 'start'],
  ] as const;
  for (const [aEnd, bEnd] of ends) {
    const p = aEnd === 'start' ? a[0] : a[a.length - 1];
    const q = bEnd === 'start' ? b[0] : b[b.length - 1];
    if (same(p, q)) return { aEnd, bEnd };
  }
  return null;
}

interface Joined {
  points: Pt[];
  /** Whether `b` runs backwards in the joined line. */
  bReversed: boolean;
  /** Where each wall's stretch starts along the joined line, and how long it is. */
  a: { from: number; len: number };
  b: { from: number; len: number };
  total: number;
}

/**
 * `a` and `b` as one line, keeping `a`'s direction. Where both ends of `a` meet `b`'s, the
 * line closes into a loop whose last point is exactly its first. Null when they share no end.
 */
export function joinPoints(a: readonly Pt[], b: readonly Pt[]): Joined | null {
  const end = sharedEnd(a, b);
  if (!end) return null;
  const aLen = length(a);
  const bLen = length(b);
  // a then b: a's end meets b. b then a: a's start meets b.
  const aFirst = end.aEnd === 'end';
  const bReversed = aFirst ? end.bEnd === 'end' : end.bEnd === 'start';
  const bPts = bReversed ? [...b].reverse() : [...b];
  const points: Pt[] = (aFirst ? [...a, ...bPts.slice(1)] : [...bPts, ...a.slice(1)]).map(([x, y]) => [x, y]);
  if (points.length >= 4 && same(points[0], points[points.length - 1])) points[points.length - 1] = [points[0][0], points[0][1]];
  return {
    points,
    bReversed,
    a: { from: aFirst ? 0 : bLen, len: aLen },
    b: { from: aFirst ? aLen : 0, len: bLen },
    total: aLen + bLen,
  };
}

/** A wall's hand edits moved onto its stretch of the joined line (`t` is along the whole spine). */
function remapEdits(edits: WallEdits, span: { from: number; len: number }, total: number, reversed: boolean): WallEdits {
  const t = (v: number) => (total > 0 ? (span.from + (reversed ? 1 - v : v) * span.len) / total : v);
  return {
    nodeEdits: edits.nodeEdits?.map((e) => ({ ...e, t: t(e.t) })),
    spanEdits: edits.spanEdits?.map((e) => ({ ...e, t: t(e.t) })),
    nodeInserts: edits.nodeInserts?.map((e) => ({ ...e, t: t(e.t) })),
  };
}

const joinLists = <T>(x: T[] | undefined, y: T[] | undefined): T[] | undefined => (x || y ? [...(x ?? []), ...(y ?? [])] : undefined);

/** Why `a` and `b` cannot be one wall, said for the status line; null when they can. */
export function joinRefusal(a: WallSegment, b: WallSegment, style: DungeonStyle): string | null {
  if (a.id === b.id) return 'the same wall';
  if (a.locked || b.locked) return 'one is locked';
  const end = sharedEnd(a.points, b.points);
  if (!end) return 'not touching at an end';
  if (a.wallType !== b.wallType) return 'different types';
  if (standaloneWallLook(a, style).setId !== standaloneWallLook(b, style).setId) return 'different sets';
  const bReversed = end.aEnd === 'end' ? end.bEnd === 'end' : end.bEnd === 'start';
  if ((bReversed ? flip(b.direction) : b.direction) !== a.direction) return 'facing different ways';
  return null;
}

/**
 * `b` joined into `a` as one wall: `a`'s id and fields, the joined points, both walls' hand
 * edits on their own stretch. Null when they cannot join (see `joinRefusal`).
 */
export function mergeWalls(a: WallSegment, b: WallSegment, style: DungeonStyle): WallSegment | null {
  if (joinRefusal(a, b, style)) return null;
  const j = joinPoints(a.points, b.points);
  if (!j) return null;
  const ea = remapEdits(a, j.a, j.total, false);
  const eb = remapEdits(b, j.b, j.total, j.bReversed);
  const merged: WallSegment = { ...structuredClone(a), points: j.points };
  const nodeEdits = joinLists(ea.nodeEdits, eb.nodeEdits);
  const spanEdits = joinLists(ea.spanEdits, eb.spanEdits);
  const nodeInserts = joinLists(ea.nodeInserts, eb.nodeInserts);
  if (nodeEdits) merged.nodeEdits = nodeEdits;
  if (spanEdits) merged.spanEdits = spanEdits;
  if (nodeInserts) merged.nodeInserts = nodeInserts;
  return merged;
}

/**
 * What auto-join does with a wall about to be drawn: the walls on the layer whose free end
 * it starts or finishes on, of the same set and type, joined into the first of them.
 * Null when it touches none, and the new wall is drawn on its own.
 */
export function autoJoin(
  drawn: WallSegment,
  walls: readonly WallSegment[],
  style: DungeonStyle,
): { merged: WallSegment; removed: string[] } | null {
  const touching = (end: Pt) =>
    walls.find((w) => w.visible !== false && !isLoop(w.points) && (same(w.points[0], end) || same(w.points[w.points.length - 1], end)) && !joinRefusal(w, drawn, style));
  const atStart = touching(drawn.points[0]);
  const atEnd = touching(drawn.points[drawn.points.length - 1]);
  const host = atStart ?? atEnd;
  if (!host) return null;
  let merged = mergeWalls(host, drawn, style);
  if (!merged) return null;
  const removed: string[] = [];
  // Drawn from one end of a wall to its other end, the joined line has closed into a loop
  // already; between two walls, the second joins too.
  const other = atStart && atEnd && atEnd.id !== atStart.id ? atEnd : null;
  const both = other ? mergeWalls(merged, other, style) : null;
  if (both && other) {
    merged = both;
    removed.push(other.id);
  }
  return { merged, removed };
}
