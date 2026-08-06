// Keeping floor-wall stone edits attached to their ring across a recompute.
//
// `floorWallEdits` is keyed by index into `mergedFloor`, and Clipper2 owns
// that array's order: adding a room, punching a hole or merging two outlines
// can reorder every ring, at which point index-keyed edits silently retarget —
// the hand-tuned stones of the great hall jump onto the corridor (GitHub #37's
// known fragility). On every recompute the old rings are matched to the new
// ones by centroid and area, and the keys move with their ring. An edit whose
// ring genuinely vanished (erased, merged away) is dropped: stones for a wall
// that no longer exists have nothing to stand on.

import type { Polygon } from '../types/geometry';
import type { WallEdits } from '../shared/types';

function signedArea(poly: Polygon): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
  }
  return a / 2;
}

function centroid(poly: Polygon): [number, number] {
  let x = 0;
  let y = 0;
  for (const [px, py] of poly) {
    x += px;
    y += py;
  }
  return [x / poly.length, y / poly.length];
}

/**
 * `edits` re-keyed from `oldRings` indices to `newRings` indices.
 *
 * Matching is greedy nearest-centroid among rings of the same winding, each
 * new ring claimable once. A match must be closer than the ring's own scale
 * (√area) — one edit moves a wall, it does not teleport the room — so a
 * deleted room's edits fall out instead of grabbing whatever ring happens to
 * sit nearest. Returns undefined when nothing survives.
 */
export function remapFloorWallEdits(
  oldRings: Polygon[],
  newRings: Polygon[],
  edits: Record<string, WallEdits>,
): Record<string, WallEdits> | undefined {
  const candidates: { oldKey: string; newIndex: number; d: number }[] = [];
  for (const oldKey of Object.keys(edits)) {
    const oldRing = oldRings[Number(oldKey)];
    if (!oldRing || oldRing.length < 3) continue;
    const oldArea = signedArea(oldRing);
    const [ox, oy] = centroid(oldRing);
    const reach = Math.sqrt(Math.abs(oldArea)) + 0.5;
    for (let i = 0; i < newRings.length; i++) {
      const ring = newRings[i];
      if (ring.length < 3) continue;
      if (Math.sign(signedArea(ring)) !== Math.sign(oldArea)) continue;
      const [nx, ny] = centroid(ring);
      const d = Math.hypot(nx - ox, ny - oy);
      if (d <= reach) candidates.push({ oldKey, newIndex: i, d });
    }
  }

  candidates.sort((a, b) => a.d - b.d);
  const takenOld = new Set<string>();
  const takenNew = new Set<number>();
  const out: Record<string, WallEdits> = {};
  for (const c of candidates) {
    if (takenOld.has(c.oldKey) || takenNew.has(c.newIndex)) continue;
    takenOld.add(c.oldKey);
    takenNew.add(c.newIndex);
    out[String(c.newIndex)] = edits[c.oldKey];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
