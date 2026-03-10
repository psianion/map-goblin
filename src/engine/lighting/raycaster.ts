import type { DungeonLayer } from '@/store/types'

export interface Segment {
  x1: number
  y1: number
  x2: number
  y2: number
}

/**
 * Extract wall segments from dungeon layers for raycasting.
 * Uses standaloneWalls (blocksLight=true) and the merged floor boundary edges.
 */
export function extractWallSegments(dungeonLayers: DungeonLayer[]): Segment[] {
  const segments: Segment[] = []

  for (const layer of dungeonLayers) {
    // Standalone wall segments that block light
    for (const wall of layer.standaloneWalls) {
      if (!wall.blocksLight) continue
      const pts = wall.points
      for (let i = 0; i < pts.length - 1; i++) {
        segments.push({
          x1: pts[i][0],
          y1: pts[i][1],
          x2: pts[i + 1][0],
          y2: pts[i + 1][1],
        })
      }
    }

    // Floor boundary edges from mergedFloor polygons
    if (layer.mergedFloor) {
      for (const polygon of layer.mergedFloor) {
        const pts = polygon
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i]
          const b = pts[(i + 1) % pts.length]
          segments.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] })
        }
      }
    }
  }

  return segments
}

/**
 * Compute a 2D sweep-line visibility polygon for a point light.
 *
 * Algorithm:
 *  1. Collect all unique endpoints of wall segments within radius.
 *  2. Cast rays at each endpoint angle ± ε to find visibility boundary.
 *  3. Return the resulting polygon (world-space coords).
 *
 * Returns a flat array of [x, y] pairs forming a closed polygon.
 */
export function computeVisibilityPolygon(
  origin: [number, number],
  radius: number,
  segments: Segment[],
): [number, number][] {
  const [ox, oy] = origin
  const r2 = radius * radius

  // Filter segments to those within radius (bounding box pre-check)
  const nearSegments = segments.filter((s) => {
    const minX = Math.min(s.x1, s.x2) - ox
    const maxX = Math.max(s.x1, s.x2) - ox
    const minY = Math.min(s.y1, s.y2) - oy
    const maxY = Math.max(s.y1, s.y2) - oy
    // Quick AABB vs circle check
    const cx = Math.max(minX, Math.min(0, maxX))
    const cy = Math.max(minY, Math.min(0, maxY))
    return cx * cx + cy * cy <= r2
  })

  // Collect unique angles from endpoints
  const angles: number[] = []
  for (const seg of nearSegments) {
    angles.push(Math.atan2(seg.y1 - oy, seg.x1 - ox))
    angles.push(Math.atan2(seg.y2 - oy, seg.x2 - ox))
  }

  // Add boundary angles to form a full circle if no walls
  const STEPS = 32
  for (let i = 0; i < STEPS; i++) {
    angles.push((i / STEPS) * Math.PI * 2)
  }

  // Deduplicate and expand with ±ε
  const EPS = 0.0001
  const uniqueAngles: number[] = []
  for (const a of angles) {
    uniqueAngles.push(a - EPS, a, a + EPS)
  }
  uniqueAngles.sort((a, b) => a - b)

  // For each angle, cast ray and find closest intersection
  const points: [number, number][] = []
  for (const angle of uniqueAngles) {
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)

    let minT = radius
    for (const seg of nearSegments) {
      const t = raySegmentIntersect(ox, oy, dx, dy, seg)
      if (t !== null && t < minT) {
        minT = t
      }
    }

    points.push([ox + dx * minT, oy + dy * minT])
  }

  return points
}

/**
 * Ray-segment intersection. Returns t (distance along ray) or null.
 * Ray: P = origin + t*dir, t >= 0
 * Segment: Q = A + u*(B-A), 0 <= u <= 1
 */
function raySegmentIntersect(
  rx: number,
  ry: number,
  dx: number,
  dy: number,
  seg: Segment,
): number | null {
  const ax = seg.x1
  const ay = seg.y1
  const bx = seg.x2 - seg.x1
  const by = seg.y2 - seg.y1

  const denom = dx * by - dy * bx
  if (Math.abs(denom) < 1e-10) return null

  const t = ((ax - rx) * by - (ay - ry) * bx) / denom
  const u = ((ax - rx) * dy - (ay - ry) * dx) / denom

  if (t >= 0 && u >= 0 && u <= 1) {
    return t
  }
  return null
}
