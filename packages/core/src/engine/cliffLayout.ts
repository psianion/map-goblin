// Where a cliff's ledge rock goes, as numbers. A cliff edge is mostly straight: a rectangle,
// a polygon drawn by clicks. The cave walk rounds every corner to suit the 2x4 rock band and
// chases chords around it, which on a ledge kit (1x2/1x4/1x6 straights, one small bend) made a
// 4x4 square into a pear and a small pit into a curl. So straight edges are tiled here
// instead: whole ledge pieces end to end along each edge, stretched along their length only to
// fit it exactly, carried a little past each corner so neighbours overlap there. Only a run
// that really curves (a circle, a freehand outline) is left to the walk.
//
// Pure: the renderer turns these into sprites, the tests read them directly.

import type { CaveKitPiece } from '../assets/caveWallKit';

type Vec = [number, number];

/** A vertex turning more than this is a corner: the edges either side are tiled separately. */
export const CORNER_TURN_DEG = 25;
/** How far an edge's rock carries on past a corner, cells: enough to close its outside, no knob. */
export const CORNER_REACH = 0.22;
/** The ledge art is drawn this much of its own width: a band, not a wall of boulders (board 1). */
export const LEDGE_WIDTH = 0.75;
/** The ledge's joint line sits this far off the edge, toward the low side, cells. */
export const LEDGE_OUT = 0.1;
/** A run whose points stray no further than this from its chord is straight. */
const STRAIGHT_TOL = 0.08;
/** Shorter stretches between gaps are left bare. */
const MIN_SPAN = 0.4;

/** One ledge piece laid along a straight edge. */
export interface LedgePlacement {
  key: string;
  /** Sprite centre, world cells. */
  centre: Vec;
  /** Sprite rotation: the piece's own -y (its joint axis) along the edge. */
  rotation: number;
  /** Stretch along the piece's length (its width is never scaled). */
  stretch: number;
  /** Mirrored along its length, for variety: the void side stays where it is. */
  flip: boolean;
  /** Unit normal toward the low side (the left of travel). */
  normal: Vec;
}

/** A stretch of the ring between corners: a straight edge to tile, or a curve for the walk. */
export interface CliffRun {
  points: Vec[];
  straight: boolean;
  /** The ring closes on itself with no corner anywhere (a circle): walk it whole. */
  closed: boolean;
}

const turnAt = (a: Vec, b: Vec, c: Vec): number => {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const vx = c[0] - b[0];
  const vy = c[1] - b[1];
  return (Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy) * 180) / Math.PI;
};

function isStraight(pts: Vec[]): boolean {
  const a = pts[0];
  const b = pts[pts.length - 1];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < 1e-9) return false;
  for (const p of pts) {
    const d = Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / L;
    if (d > STRAIGHT_TOL) return false;
  }
  return true;
}

/** Drop repeated points, which have no direction to turn by. */
function dedupe(points: readonly Vec[], closed: boolean): Vec[] {
  const out: Vec[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) out.push([p[0], p[1]]);
  }
  if (closed && out.length > 1) {
    const [f, l] = [out[0], out[out.length - 1]];
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) <= 1e-6) out.pop();
  }
  return out;
}

/**
 * Cut a cliff's points (wound with the low side on the left) at its corners. A closed ring
 * with no corner comes back whole as one closed curved run.
 */
export function splitAtCorners(points: readonly Vec[], closed: boolean): CliffRun[] {
  const pts = dedupe(points, closed);
  const n = pts.length;
  if (n < 2) return [];
  const corner = pts.map((p, i) => {
    if (!closed && (i === 0 || i === n - 1)) return true;
    const a = pts[(i - 1 + n) % n];
    const c = pts[(i + 1) % n];
    return Math.abs(turnAt(a, p, c)) > CORNER_TURN_DEG;
  });
  const corners = corner.flatMap((c, i) => (c ? [i] : []));
  if (closed && corners.length === 0) return [{ points: pts, straight: false, closed: true }];
  const runs: CliffRun[] = [];
  const count = closed ? corners.length : corners.length - 1;
  for (let k = 0; k < count; k++) {
    const from = corners[k];
    let to = corners[(k + 1) % corners.length];
    if (to <= from) to += n;
    const run: Vec[] = [];
    for (let i = from; i <= to; i++) run.push(pts[i % n]);
    runs.push({ points: run, straight: isStraight(run), closed: false });
  }
  return runs;
}

/** The parts of [lo, hi] along a→b that no gap covers. */
function openIntervals(a: Vec, d: Vec, lo: number, hi: number, gaps: readonly { position: Vec; width: number }[]): [number, number][] {
  let keep: [number, number][] = [[lo, hi]];
  for (const g of gaps) {
    const gx = g.position[0] - a[0];
    const gy = g.position[1] - a[1];
    const along = gx * d[0] + gy * d[1];
    const across = Math.abs(gx * d[1] - gy * d[0]);
    if (across > 0.5) continue;
    const c0 = along - g.width / 2;
    const c1 = along + g.width / 2;
    keep = keep.flatMap(([k0, k1]): [number, number][] => {
      if (c1 <= k0 || c0 >= k1) return [[k0, k1]];
      const out: [number, number][] = [];
      if (c0 > k0) out.push([k0, c0]);
      if (c1 < k1) out.push([c1, k1]);
      return out;
    });
  }
  return keep.filter(([p, q]) => q - p >= MIN_SPAN);
}

/**
 * Whole pieces whose chords add up to about `length`: one per two cells, the longest first,
 * so a long edge is a few long stones rather than a row of short ones.
 */
function compose(length: number, straights: readonly CaveKitPiece[]): CaveKitPiece[] {
  const byUnits = [...straights].sort((p, q) => q.chordCells - p.chordCells);
  let units = Math.max(1, Math.round(length / 2));
  const out: CaveKitPiece[] = [];
  while (units > 0) {
    const piece = byUnits.find((p) => Math.round(p.chordCells / 2) <= units) ?? byUnits[byUnits.length - 1];
    out.push(piece);
    units -= Math.max(1, Math.round(piece.chordCells / 2));
  }
  return out;
}

/**
 * Tile one straight edge a→b (low side on the left of travel) with ledge straights, skipping
 * the gaps on it and carrying past each end that is a corner.
 */
export function tileStraight(
  a: Vec,
  b: Vec,
  straights: readonly CaveKitPiece[],
  gaps: readonly { position: Vec; width: number }[] = [],
  reach: [number, number] = [CORNER_REACH, CORNER_REACH],
): LedgePlacement[] {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < 1e-9 || straights.length === 0) return [];
  const d: Vec = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const left: Vec = [d[1], -d[0]];
  const rotation = Math.atan2(d[0], -d[1]);
  const out: LedgePlacement[] = [];
  for (const [s0, s1] of openIntervals(a, d, -reach[0], L + reach[1], gaps)) {
    const pieces = compose(s1 - s0, straights);
    const total = pieces.reduce((sum, p) => sum + p.chordCells, 0);
    const stretch = (s1 - s0) / total;
    let at = s0;
    pieces.forEach((piece, i) => {
      const span = piece.chordCells * stretch;
      const mid = at + span / 2;
      // The joints sit at the piece's own x (left of its centre when negative): put them on the
      // joint line, LEDGE_OUT toward the low side.
      const off = LEDGE_OUT + piece.jointsCells[0][0] * LEDGE_WIDTH;
      out.push({
        key: piece.key,
        centre: [a[0] + d[0] * mid + left[0] * off, a[1] + d[1] * mid + left[1] * off],
        rotation,
        stretch,
        flip: i % 2 === 1,
        normal: left,
      });
      at += span;
    });
  }
  return out;
}
