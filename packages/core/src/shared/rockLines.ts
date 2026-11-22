// A pack-measured kit's rock as saved on the layer (`DungeonLayer.rockLines`): which drawn
// outline each line was laid for. Pixi-free: the table server reads it with no catalog.

import type { RockLine } from '../store/types';

/** How near a point must lie to a rock line's edge to be on it, cells (its coordinates are rounded to 0.01). */
export const ROCK_EDGE_SLACK = 0.02;

type Pt = readonly [number, number];

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}

/** Whether `p` lies on the polyline `pts` (closed: with its closing edge) within ROCK_EDGE_SLACK. */
function onLine(p: Pt, pts: readonly Pt[], closed: boolean): boolean {
  const n = pts.length;
  if (n === 1) return segDist(p, pts[0], pts[0]) <= ROCK_EDGE_SLACK;
  for (let i = 0; i + 1 < n; i++) if (segDist(p, pts[i], pts[i + 1]) <= ROCK_EDGE_SLACK) return true;
  return closed && n > 2 && segDist(p, pts[n - 1], pts[0]) <= ROCK_EDGE_SLACK;
}

/** Whether `p` lies on the line's drawn edge. */
export function onRockEdge(p: Pt, line: RockLine): boolean {
  return onLine(p, line.edge, line.closed);
}

/** Whether `line` was laid for the closed ring `ring` as it stands: each lies along the other. */
export function laidFor(line: RockLine, ring: readonly Pt[]): boolean {
  return ring.length > 0 && ring.every((p) => onLine(p, line.edge, line.closed)) && line.edge.every((p) => onLine(p, ring, true));
}
