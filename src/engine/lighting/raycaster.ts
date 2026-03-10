export type Segment = [[number, number], [number, number]]

/**
 * Compute a 2D visibility polygon from `origin` against `segments`.
 *
 * Algorithm (Amit Patel sweep-line, adapted):
 * 1. Collect all wall segment endpoints as candidate ray targets
 * 2. Add cardinal + octagonal boundary points (ensures open areas produce a circle-like polygon)
 * 3. For each candidate point, cast 3 rays: angle-ε, angle, angle+ε
 *    (triple-ray technique prevents gaps at wall endpoints)
 * 4. For each ray, find the nearest intersection point with all segments
 * 5. Collect all intersection points, sort by angle
 * 6. Clip to radius
 * 7. Return as world-space polygon
 *
 * Returns polygon vertices in world space, sorted by angle from origin.
 */
export function computeVisibilityPolygon(
  origin: [number, number],
  radius: number,
  segments: Segment[],
): [number, number][] {
  const [ox, oy] = origin
  const EPSILON = 0.0001

  // Filter degenerate segments
  const validSegments = segments.filter(([[ax, ay], [bx, by]]) => {
    const dx = bx - ax
    const dy = by - ay
    return dx * dx + dy * dy > EPSILON
  })

  // Collect angles to endpoints, plus cardinal + octagonal directions
  const angles: number[] = []

  for (const [[ax, ay], [bx, by]] of validSegments) {
    const a1 = Math.atan2(ay - oy, ax - ox)
    const a2 = Math.atan2(by - oy, bx - ox)
    angles.push(a1 - EPSILON, a1, a1 + EPSILON)
    angles.push(a2 - EPSILON, a2, a2 + EPSILON)
  }

  // Add 8 directions to cover open areas with no walls
  for (let i = 0; i < 8; i++) {
    angles.push((2 * Math.PI * i) / 8 - Math.PI)
  }

  // For each angle, cast ray and find nearest intersection
  const hits: [number, number][] = []

  for (const angle of angles) {
    const rdx = Math.cos(angle)
    const rdy = Math.sin(angle)

    let minT = radius
    let hitX = ox + rdx * radius
    let hitY = oy + rdy * radius

    for (const [[ax, ay], [bx, by]] of validSegments) {
      // Parametric ray-segment intersection
      // Ray: P = origin + t * dir, t >= 0
      // Segment: Q = A + s * (B - A), s in [0, 1]
      const sdx = bx - ax
      const sdy = by - ay
      const denom = rdx * sdy - rdy * sdx
      if (Math.abs(denom) < EPSILON) continue // Parallel

      const tx = ax - ox
      const ty = ay - oy
      const t = (tx * sdy - ty * sdx) / denom
      const s = (tx * rdy - ty * rdx) / denom

      if (t >= -EPSILON && t < minT && s >= -EPSILON && s <= 1 + EPSILON) {
        minT = t
        hitX = ox + rdx * t
        hitY = oy + rdy * t
      }
    }

    hits.push([hitX, hitY])
  }

  // Sort by angle from origin
  hits.sort(([ax, ay], [bx, by]) => {
    const angleA = Math.atan2(ay - oy, ax - ox)
    const angleB = Math.atan2(by - oy, bx - ox)
    return angleA - angleB
  })

  // Deduplicate near-identical points
  const result: [number, number][] = []
  for (const [hx, hy] of hits) {
    if (result.length === 0) {
      result.push([hx, hy])
      continue
    }
    const [px, py] = result[result.length - 1]
    const dx = hx - px
    const dy = hy - py
    if (dx * dx + dy * dy > EPSILON) {
      result.push([hx, hy])
    }
  }

  return result
}

/**
 * Extract wall segments from all dungeon layers for raycasting.
 * Returns segments from standalone walls (blocksLight === true)
 * plus boundary edges from mergedFloor polygons.
 */
export function extractWallSegments(
  layers: import('@/store/types').DungeonLayer[],
): Segment[] {
  const segments: Segment[] = []

  for (const layer of layers) {
    if (!layer.visible) continue

    // Standalone walls with blocksLight flag
    for (const wall of layer.standaloneWalls) {
      if (!wall.blocksLight) continue
      const pts = wall.points
      for (let i = 0; i < pts.length - 1; i++) {
        segments.push([
          [pts[i][0], pts[i][1]],
          [pts[i + 1][0], pts[i + 1][1]],
        ])
      }
    }

    // Floor boundary edges from mergedFloor polygons
    if (layer.mergedFloor) {
      for (const poly of layer.mergedFloor) {
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i]
          const b = poly[(i + 1) % poly.length]
          segments.push([[a[0], a[1]], [b[0], b[1]]])
        }
      }
    }
  }

  return segments
}
