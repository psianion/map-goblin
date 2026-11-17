// Clipper's output rings sorted back into floors: each outer ring with the holes inside it.
// Shared by Carve out (engine/tools/eraseShapes.ts) and the painted cave floors (caveFloor.ts).

type Polygon = [number, number][];

export function signedArea(r: Polygon): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return a / 2;
}

/** A ring smaller than this, in square cells, is a sliver. */
const SLIVER_AREA = 0.05;
/** A ring thinner than this on average (twice its area over its length), in cells, is a sliver. */
const SLIVER_WIDTH = 0.1;

/**
 * Whether a ring is a sliver a brush or a union left behind: too small or too thin to be
 * floor or hole anyone drew. The floor union and a cave's edge both drop such rings, so no
 * rock, wall, walk blocker or sight line comes from one, on the canvas, the table or the
 * server alike. The map's own contours are left as they are.
 */
export function isSliverRing(r: Polygon): boolean {
  const area = Math.abs(signedArea(r));
  if (area < SLIVER_AREA) return true;
  let length = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) length += Math.hypot(r[i][0] - r[j][0], r[i][1] - r[j][1]);
  return (2 * area) / length < SLIVER_WIDTH;
}

function inside([x, y]: [number, number], ring: Polygon): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * Clipper's output as floors: each outer ring with the holes inside it. Outer rings wind
 * like the largest ring; a hole goes to the smallest outer ring around it.
 */
export function floorPieces(rings: Polygon[]): Polygon[][] {
  const sorted = rings.filter((r) => r.length >= 3).sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
  if (sorted.length === 0) return [];
  const sign = Math.sign(signedArea(sorted[0]));
  const outers = sorted.filter((r) => Math.sign(signedArea(r)) === sign);
  const pieces = outers.map((o) => [o]);
  for (const hole of sorted.filter((r) => Math.sign(signedArea(r)) !== sign)) {
    let owner = 0;
    for (let i = outers.length - 1; i >= 0; i--) {
      if (inside(hole[0], outers[i])) {
        owner = i;
        break;
      }
    }
    pieces[owner].push(hole);
  }
  return pieces;
}
