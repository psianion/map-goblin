// 2D visibility polygon from a point, swept against wall segments — the
// same shadow-casting shape as the product's ClockwiseSweep, miniaturized:
// cast a ray at every segment endpoint (plus a hair either side, so a wall's
// far corner doesn't get shadowed by its own near corner), keep the nearest
// hit per ray, sort by angle. Real geometry each call, not a baked path.
import type { Vec2 } from './mapData';

export interface Segment {
  a: Vec2;
  b: Vec2;
}

const EPS = 1e-3;

// Ray (origin + t*dir, t>=0) vs segment (a + u*(b-a), u in [0,1]).
function raySegmentT(origin: Vec2, dx: number, dz: number, seg: Segment): number | null {
  const sx = seg.b.x - seg.a.x;
  const sz = seg.b.z - seg.a.z;
  const denom = dx * sz - dz * sx;
  if (Math.abs(denom) < 1e-9) return null;
  const ox = seg.a.x - origin.x;
  const oz = seg.a.z - origin.z;
  const t = (ox * sz - oz * sx) / denom;
  const u = (ox * dz - oz * dx) / denom;
  if (t < 0 || u < 0 || u > 1) return null;
  return t;
}

export interface Rect {
  min: Vec2;
  max: Vec2;
}

// ponytail: Sutherland-Hodgman only requires the CLIP window (here, always
// an axis-aligned rect) to be convex — the subject polygon can be concave,
// which is why this is safe for computeVisibilityPolygon's star-shaped
// output in general. Its real ceiling is a subject that dips in and out of
// the same clip edge more than once: S-H always emits a single connected
// loop, so what should logically be several disjoint clipped regions comes
// back bridged together by a degenerate zero-area edge along the clip
// boundary. focalAccents.tsx's PlayerFog is the one caller, and its origin
// sits outside FOG_RECT (west of it, in the corridor) with a sight cone
// dipping into and out of the rect's near edge as it fans past nearby
// walls — exactly that shape. Upgrade to Greiner-Hormann (handles
// multi-contour output) if that ever visibly bites; tried bounding the
// sweep by construction instead (passing the rect's own edges into
// computeVisibilityPolygon's own segment list, avoiding this clip step
// entirely) but that's wrong here specifically: with the origin outside the
// rect, the near edge becomes the *closest* blocker on every ray, so it
// stops the sweep at the rect's threshold and reveals nothing past it —
// verified with a throwaway node script (zero lit area in Room B vs. the
// correct ~50%). Clipping after the fact, as below, doesn't have that
// problem: the sweep runs against real walls only, and this just trims the
// result to the rect's own extent.
/** Clips a polygon (e.g. computeVisibilityPolygon's own output) to an
 * axis-aligned rect — Sutherland-Hodgman against the rect's four
 * half-planes. A sight sweep is real geometry, not bounded to whatever
 * footprint a caller wants fogged (it happily reaches into a corridor, the
 * next room over, ...); THREE's ShapeGeometry earcut triangulator assumes a
 * hole sits entirely inside its outer path, so a hole cut from an unclipped
 * sweep that reaches past the fog quad's own rect can triangulate wrong. */
export function clipPolygonToRect(polygon: Vec2[], rect: Rect): Vec2[] {
  const clipEdge = (points: Vec2[], inside: (p: Vec2) => boolean, intersect: (a: Vec2, b: Vec2) => Vec2): Vec2[] => {
    const out: Vec2[] = [];
    for (let i = 0; i < points.length; i++) {
      const curr = points[i];
      const prev = points[(i - 1 + points.length) % points.length];
      const currIn = inside(curr);
      if (currIn !== inside(prev)) out.push(intersect(prev, curr));
      if (currIn) out.push(curr);
    }
    return out;
  };
  let pts = polygon;
  pts = clipEdge(pts, (p) => p.x >= rect.min.x, (a, b) => ({ x: rect.min.x, z: a.z + ((rect.min.x - a.x) / (b.x - a.x)) * (b.z - a.z) }));
  pts = clipEdge(pts, (p) => p.x <= rect.max.x, (a, b) => ({ x: rect.max.x, z: a.z + ((rect.max.x - a.x) / (b.x - a.x)) * (b.z - a.z) }));
  pts = clipEdge(pts, (p) => p.z >= rect.min.z, (a, b) => ({ z: rect.min.z, x: a.x + ((rect.min.z - a.z) / (b.z - a.z)) * (b.x - a.x) }));
  pts = clipEdge(pts, (p) => p.z <= rect.max.z, (a, b) => ({ z: rect.max.z, x: a.x + ((rect.max.z - a.z) / (b.z - a.z)) * (b.x - a.x) }));
  return pts;
}

/** Visibility polygon (world-space points, angle-sorted) from `origin` against `segments`, capped at `maxRadius`. */
export function computeVisibilityPolygon(origin: Vec2, segments: Segment[], maxRadius: number): Vec2[] {
  const angles = new Set<number>();
  for (const seg of segments) {
    for (const p of [seg.a, seg.b]) {
      const angle = Math.atan2(p.z - origin.z, p.x - origin.x);
      angles.add(angle - EPS);
      angles.add(angle);
      angles.add(angle + EPS);
    }
  }

  const hits: { angle: number; point: Vec2 }[] = [];
  for (const angle of angles) {
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    let closest = maxRadius;
    for (const seg of segments) {
      const t = raySegmentT(origin, dx, dz, seg);
      if (t !== null && t < closest) closest = t;
    }
    hits.push({ angle, point: { x: origin.x + dx * closest, z: origin.z + dz * closest } });
  }
  hits.sort((a, b) => a.angle - b.angle);
  return hits.map((h) => h.point);
}
