// Stairs on a plateau edge that runs along a cave wall's rock: the wall's rock stands in for the
// cliff there, so the stairs open that rock across their span exactly as a Door-tool Opening
// does (its ends tapered, the floor running out through it, light, sight and walking through).
// Each such span is handed to the walls' consumers as an Opening of its own, never stored.

import type { DungeonLayer } from '../store/types';
import type { DoorChild } from './types';
import { stairFlights } from './plateaus';
import type { ResolvedDoor, ResolvedWall } from './wallResolve';

/** How near a floor or cave wall a span's middle must lie, and how parallel to it, to run along it. */
const ALONG = 0.05;
const PARALLEL_SIN = 0.05;

/**
 * Every flight of stairs whose span runs along a floor ring's or a painted cave's wall, as a bare
 * Opening resolved onto that wall, the span's width. None on a layer with no stairs.
 */
export function stairOpenings(layer: DungeonLayer, walls: readonly ResolvedWall[]): ResolvedDoor[] {
  const flights = stairFlights(layer);
  if (flights.length === 0) return [];
  const out: ResolvedDoor[] = [];
  for (const f of flights) {
    const [a, b] = f.top;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const u: [number, number] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const host = hostOf(walls, mid, u);
    if (!host) continue;
    const angle = Math.atan2(u[1], u[0]);
    const door: DoorChild = {
      id: `stairs:${f.plateau.id}:${f.span.id}`,
      name: '',
      childType: 'door',
      visible: true,
      wallId: host.wall.id,
      position: mid,
      angle,
      width: len,
      style: 'archway',
      state: 'open',
      isSecret: false,
      bare: true,
    };
    out.push({ door, wall: host.wall, t: host.t, position: mid, angle, detached: false });
  }
  return out;
}

/** The floor or cave wall `p` lies on running along `u`, and where along it by length (0..1). */
function hostOf(walls: readonly ResolvedWall[], p: [number, number], u: [number, number]): { wall: ResolvedWall; t: number } | null {
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
      if (along >= 0 && along <= L && off <= ALONG && Math.abs(u[0] * dy - u[1] * dx) / L <= PARALLEL_SIN) {
        return { wall, t: total > 0 ? (s + along) / total : 0 };
      }
      s += L;
    }
  }
  return null;
}
