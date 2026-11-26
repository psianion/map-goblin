// Stairs on a plateau edge that runs along a cave wall's rock: the wall's rock stands in for the
// cliff there, so the stairs open that rock across their span exactly as a Door-tool Opening
// does (its ends tapered, the floor running out through it, light, sight and walking through).
// A cliff entrance's mouth with a walled floor behind it opens that floor's wall the same way,
// across the mouth, wherever the wall runs along it within reach. Each such span is handed to the
// walls' consumers as an Opening of its own, never stored.

import type { DungeonLayer } from '../store/types';
import type { DoorChild } from './types';
import { ENTRANCE_BEHIND, layerPlateaus, stairFlights } from './plateaus';
import type { ResolvedDoor, ResolvedWall } from './wallResolve';

/** How near a floor or cave wall a span's middle must lie, and how parallel to it, to run along it. */
const ALONG = 0.05;
const PARALLEL_SIN = 0.05;
/** How far from an entrance's edge the wall of the floor behind it may run and still be opened, cells. */
const MOUTH_REACH = ENTRANCE_BEHIND + ALONG;
/** The narrowest a mouth opens its floor's wall, cells: a rock wall laid round a narrower gap closes over it. */
const MOUTH_WALL_LEAST = 1;

type Vec = [number, number];

/**
 * Every flight of stairs whose span runs along a floor ring's or a painted cave's wall, and every
 * cliff entrance with a walled floor behind it whose wall runs along it, as a bare Opening resolved
 * onto that wall: the span's width, or across the whole cells the mouth frees to walk
 * (`EntranceInfo.walk`), never under MOUTH_WALL_LEAST, so a token stepping through lands in the room.
 * None on a layer with neither.
 */
export function stairOpenings(layer: DungeonLayer, walls: readonly ResolvedWall[]): ResolvedDoor[] {
  const out: ResolvedDoor[] = [];
  // Stairs sit on their wall (within ALONG): the Opening stands at their middle. A mouth may lie off
  // its wall: the Opening stands where the mouth's middle meets the wall.
  const open = (id: string, a: Vec, b: Vec, reach: number): void => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) return;
    const u: Vec = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const mid: Vec = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const host = hostOf(walls, mid, u, reach);
    if (!host) return;
    const angle = Math.atan2(u[1], u[0]);
    const door: DoorChild = {
      id,
      name: '',
      childType: 'door',
      visible: true,
      wallId: host.wall.id,
      position: reach > ALONG ? host.at : mid,
      angle,
      width: reach > ALONG ? Math.max(len, MOUTH_WALL_LEAST) : len,
      style: 'archway',
      state: 'open',
      isSecret: false,
      bare: true,
    };
    out.push({ door, wall: host.wall, t: host.t, position: door.position, angle, detached: false });
  };
  for (const f of stairFlights(layer)) open(`stairs:${f.plateau.id}:${f.span.id}`, f.top[0], f.top[1], ALONG);
  if (layer.children.some((c) => c.childType === 'plateau' && (c.entrances?.length ?? 0) > 0)) {
    for (const e of layerPlateaus(layer).entrances) {
      if (!e.behind) continue;
      const [p, q] = [e.walk[0], e.walk[e.walk.length - 1]];
      open(`entrance:${e.plateau.id}:${e.span.id}`, [p[0], p[1]], [q[0], q[1]], MOUTH_REACH);
    }
  }
  return out;
}

/**
 * The floor or cave wall running along `u` nearest `p` within `reach`, where on it `p` lies (`at`)
 * and how far along it by length (0..1).
 */
function hostOf(walls: readonly ResolvedWall[], p: Vec, u: Vec, reach: number): { wall: ResolvedWall; t: number; at: Vec } | null {
  let best: { wall: ResolvedWall; t: number; at: Vec; off: number } | null = null;
  for (const wall of walls) {
    if (wall.kind === 'standalone') continue;
    const pts = wall.points;
    let total = 0;
    for (let k = 0; k + 1 < pts.length; k++) total += Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
    let s = 0;
    for (let k = 0; k + 1 < pts.length; k++) {
      const [q, r] = [pts[k], pts[k + 1]];
      const dx = r[0] - q[0];
      const dy = r[1] - q[1];
      const L = Math.hypot(dx, dy);
      if (L < 1e-9) continue;
      const along = ((p[0] - q[0]) * dx + (p[1] - q[1]) * dy) / L;
      const off = Math.abs((p[0] - q[0]) * dy - (p[1] - q[1]) * dx) / L;
      if (along >= 0 && along <= L && off <= reach && Math.abs(u[0] * dy - u[1] * dx) / L <= PARALLEL_SIN && (!best || off < best.off)) {
        best = { wall, t: total > 0 ? (s + along) / total : 0, at: [q[0] + (dx * along) / L, q[1] + (dy * along) / L], off };
      }
      s += L;
    }
  }
  return best && { wall: best.wall, t: best.t, at: best.at };
}
