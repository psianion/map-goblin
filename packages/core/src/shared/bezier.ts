// Cubic bezier math for curved shape/water edges.
//
// Curves live only in authoring: a vertex may carry optional in/out tangent
// points, and one flatten pass turns the curved ring into the plain point ring
// every downstream consumer already understands (Clipper2, wall layout, fog,
// hit tests, renderers). This module is shared so the editor and the table
// flatten identically — geometry must not depend on which app computed it.

export type Vec2 = [number, number];

/**
 * Optional tangents for one ring vertex. `tin` bends the edge arriving at the
 * vertex, `tout` the edge leaving it. Both are ABSOLUTE world points, not
 * offsets — they drag like handles because they are handles. Absent (or null
 * entry) means the vertex is a corner and its edges are straight.
 */
export interface VertexTangents {
  tin?: Vec2;
  tout?: Vec2;
}

/** Per-ring tangent list, indexed like the ring's points. */
export type RingTangents = (VertexTangents | null)[];

/**
 * Flatten tolerance in world units (grid squares). The calibration knob for
 * "smooth enough at max zoom without drowning Clipper2 in points" — tune it
 * at a gate walk, not in review.
 */
export const FLATTEN_TOLERANCE = 0.05;

function sub(a: Vec2, b: Vec2): Vec2 {
  return [a[0] - b[0], a[1] - b[1]];
}

/** Squared distance from `p` to the infinite line through a-b. */
function distSqToLine(p: Vec2, a: Vec2, b: Vec2): number {
  const [dx, dy] = sub(b, a);
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const [ex, ey] = sub(p, a);
    return ex * ex + ey * ey;
  }
  const cross = (p[0] - a[0]) * dy - (p[1] - a[1]) * dx;
  return (cross * cross) / lenSq;
}

/** De Casteljau split of a cubic at `t`, exact. */
export function splitCubic(
  p0: Vec2,
  c1: Vec2,
  c2: Vec2,
  p1: Vec2,
  t: number,
): { left: [Vec2, Vec2, Vec2, Vec2]; right: [Vec2, Vec2, Vec2, Vec2] } {
  const lerp = (a: Vec2, b: Vec2): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const q0 = lerp(p0, c1);
  const q1 = lerp(c1, c2);
  const q2 = lerp(c2, p1);
  const r0 = lerp(q0, q1);
  const r1 = lerp(q1, q2);
  const s = lerp(r0, r1);
  return { left: [p0, q0, r0, s], right: [s, r1, q2, p1] };
}

/** Point on a cubic at `t`. */
export function pointOnCubic(p0: Vec2, c1: Vec2, c2: Vec2, p1: Vec2, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0],
    a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1],
  ];
}

/**
 * Adaptive flatten: recursive de Casteljau subdivision until both control
 * points sit within `tolerance` of the chord. Returns interior points only —
 * the caller owns the endpoints, so segments concatenate without doubles.
 */
export function flattenCubic(
  p0: Vec2,
  c1: Vec2,
  c2: Vec2,
  p1: Vec2,
  tolerance: number = FLATTEN_TOLERANCE,
  depth = 0,
): Vec2[] {
  const tolSq = tolerance * tolerance;
  if (
    depth >= 16 ||
    (distSqToLine(c1, p0, p1) <= tolSq && distSqToLine(c2, p0, p1) <= tolSq)
  ) {
    return [];
  }
  const { left, right } = splitCubic(p0, c1, c2, p1, 0.5);
  return [
    ...flattenCubic(left[0], left[1], left[2], left[3], tolerance, depth + 1),
    left[3],
    ...flattenCubic(right[0], right[1], right[2], right[3], tolerance, depth + 1),
  ];
}

/** True when any vertex actually bends an edge. */
export function ringHasCurves(tangents: RingTangents | undefined): boolean {
  return !!tangents?.some((t) => t && (t.tin || t.tout));
}

/** True when the edge leaving vertex a (toward b) is bent by either end. */
export function edgeIsCurved(
  ta: VertexTangents | null | undefined,
  tb: VertexTangents | null | undefined,
): boolean {
  return !!(ta?.tout || tb?.tin);
}

/**
 * The cubic's control points for the edge a→b. A missing tangent collapses
 * onto its endpoint — the same degenerate cubic `flattenRing` uses, so a curve
 * picked here lands exactly where it renders.
 */
export function edgeControls(
  a: Vec2,
  b: Vec2,
  ta: VertexTangents | null | undefined,
  tb: VertexTangents | null | undefined,
): [Vec2, Vec2] {
  return [ta?.tout ?? a, tb?.tin ?? b];
}

/**
 * The straight ring a curved ring flattens to. Edges with no tangents on
 * either end pass through untouched, so a ring with no curves round-trips to
 * exactly its input points.
 */
export function flattenRing(
  ring: Vec2[],
  tangents: RingTangents | undefined,
  tolerance: number = FLATTEN_TOLERANCE,
): Vec2[] {
  if (!ringHasCurves(tangents)) return ring;
  const out: Vec2[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    out.push(a);
    const tout = tangents?.[i]?.tout;
    const tin = tangents?.[(i + 1) % ring.length]?.tin;
    if (!tout && !tin) continue;
    // A one-sided curve still needs both controls; the missing one collapses
    // onto its endpoint, which is the standard degenerate cubic.
    out.push(...flattenCubic(a, tout ?? a, tin ?? b, b, tolerance));
  }
  return out;
}

/**
 * A child's whole tangent set translated by (dx, dy) — for duplicate, paste
 * and every other path that slides rings without reshaping them. Handles are
 * absolute points, so a moved ring must move them too.
 */
export function translateTangents(
  tangents: RingTangents[] | undefined,
  dx: number,
  dy: number,
): RingTangents[] | undefined {
  if (!tangents) return undefined;
  return tangents.map((ring) =>
    (ring ?? []).map((vt) =>
      vt
        ? {
            ...(vt.tin ? { tin: [vt.tin[0] + dx, vt.tin[1] + dy] as Vec2 } : {}),
            ...(vt.tout ? { tout: [vt.tout[0] + dx, vt.tout[1] + dy] as Vec2 } : {}),
          }
        : vt,
    ),
  );
}

/**
 * Nearest `t` on a cubic to `p`: coarse sampling then a few rounds of local
 * refinement. Plenty for insert-on-curve picking — the pick radius is far
 * larger than the refinement error.
 */
export function projectToCubic(p0: Vec2, c1: Vec2, c2: Vec2, p1: Vec2, p: Vec2): number {
  const distSqAt = (t: number): number => {
    const q = pointOnCubic(p0, c1, c2, p1, t);
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    return dx * dx + dy * dy;
  };
  let best = 0;
  let bestD = distSqAt(0);
  for (let i = 1; i <= 24; i++) {
    const t = i / 24;
    const d = distSqAt(t);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  let span = 1 / 24;
  for (let round = 0; round < 6; round++) {
    for (const t of [best - span / 2, best + span / 2]) {
      if (t < 0 || t > 1) continue;
      const d = distSqAt(t);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    span /= 2;
  }
  return best;
}
