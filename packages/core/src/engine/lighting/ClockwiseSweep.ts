import type { Segment } from './raycaster'

export interface VisibilityVertex {
  point: [number, number]
  isRadiusClamped: boolean
}

function raySegmentIntersect(
  rx: number, ry: number, dx: number, dy: number, seg: Segment,
): number | null {
  const sx = seg.x2 - seg.x1
  const sy = seg.y2 - seg.y1
  const denom = dx * sy - dy * sx
  if (Math.abs(denom) < 1e-10) return null
  const t = ((seg.x1 - rx) * sy - (seg.y1 - ry) * sx) / denom
  const u = ((seg.x1 - rx) * dy - (seg.y1 - ry) * dx) / denom
  if (t >= 0 && u >= -1e-6 && u <= 1 + 1e-6) return t
  return null
}

function castRay(
  ox: number, oy: number, dx: number, dy: number,
  radius: number, segments: Segment[],
): { dist: number; hitWall: boolean } {
  let minT = radius
  let hitWall = false
  for (const seg of segments) {
    const t = raySegmentIntersect(ox, oy, dx, dy, seg)
    if (t !== null && t > 0 && t < minT) {
      minT = t
      hitWall = true
    }
  }
  return { dist: minT, hitWall }
}

function ccwCompare(
  ax: number, ay: number, bx: number, by: number,
): number {
  const aUpper = ay > 0 || (ay === 0 && ax > 0)
  const bUpper = by > 0 || (by === 0 && bx > 0)
  if (aUpper !== bUpper) return aUpper ? -1 : 1
  const cross = ax * by - ay * bx
  if (Math.abs(cross) > 1e-10) return cross > 0 ? -1 : 1
  return (ax * ax + ay * ay) - (bx * bx + by * by)
}

export function clockwiseSweep(
  origin: [number, number],
  radius: number,
  segments: Segment[],
): VisibilityVertex[] {
  const [ox, oy] = origin
  const r2 = radius * radius

  const nearSegments = segments.filter((s) => {
    const sMinX = Math.min(s.x1, s.x2)
    const sMaxX = Math.max(s.x1, s.x2)
    const sMinY = Math.min(s.y1, s.y2)
    const sMaxY = Math.max(s.y1, s.y2)
    const cx = Math.max(sMinX - ox, Math.min(0, sMaxX - ox))
    const cy = Math.max(sMinY - oy, Math.min(0, sMaxY - oy))
    return cx * cx + cy * cy <= r2
  })

  const SNAP = 0.001
  const snapKey = (x: number, y: number): string =>
    `${Math.round(x / SNAP) * SNAP},${Math.round(y / SNAP) * SNAP}`

  const endpointMap = new Map<string, [number, number]>()
  for (const seg of nearSegments) {
    const k1 = snapKey(seg.x1, seg.y1)
    if (!endpointMap.has(k1)) endpointMap.set(k1, [seg.x1, seg.y1])
    const k2 = snapKey(seg.x2, seg.y2)
    if (!endpointMap.has(k2)) endpointMap.set(k2, [seg.x2, seg.y2])
  }
  const endpoints = Array.from(endpointMap.values())

  endpoints.sort((a, b) => ccwCompare(a[0] - ox, a[1] - oy, b[0] - ox, b[1] - oy))

  const EPS = 0.00001
  const rayAngles: number[] = []

  for (const [ex, ey] of endpoints) {
    const angle = Math.atan2(ey - oy, ex - ox)
    rayAngles.push(angle - EPS, angle, angle + EPS)
  }

  const BOUNDARY_STEPS = 64
  for (let i = 0; i < BOUNDARY_STEPS; i++) {
    rayAngles.push((i / BOUNDARY_STEPS) * Math.PI * 2 - Math.PI)
  }

  rayAngles.sort((a, b) => a - b)

  const ANGLE_MERGE = 0.000005
  const finalAngles: number[] = []
  for (const a of rayAngles) {
    if (finalAngles.length === 0 || Math.abs(a - finalAngles[finalAngles.length - 1]) > ANGLE_MERGE) {
      finalAngles.push(a)
    }
  }

  const rawVerts: VisibilityVertex[] = []
  for (const angle of finalAngles) {
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)
    const { dist, hitWall } = castRay(ox, oy, dx, dy, radius, nearSegments)
    rawVerts.push({
      point: [ox + dx * dist, oy + dy * dist],
      isRadiusClamped: !hitWall,
    })
  }

  if (rawVerts.length < 3) return rawVerts

  return tessellateArcs(rawVerts, origin, radius)
}

function tessellateArcs(
  verts: VisibilityVertex[],
  origin: [number, number],
  radius: number,
): VisibilityVertex[] {
  const [ox, oy] = origin
  const result: VisibilityVertex[] = []
  const n = verts.length
  const ARC_STEP = (2 * Math.PI) / 64

  for (let i = 0; i < n; i++) {
    const curr = verts[i]
    const next = verts[(i + 1) % n]

    result.push(curr)

    if (curr.isRadiusClamped && next.isRadiusClamped) {
      const angle1 = Math.atan2(curr.point[1] - oy, curr.point[0] - ox)
      const angle2 = Math.atan2(next.point[1] - oy, next.point[0] - ox)

      let span = angle2 - angle1
      if (span < 0) span += 2 * Math.PI
      if (span < 1e-6) continue

      const steps = Math.max(1, Math.floor(span / ARC_STEP))
      if (steps <= 1) continue

      for (let s = 1; s < steps; s++) {
        const t = s / steps
        const a = angle1 + span * t
        result.push({
          point: [ox + Math.cos(a) * radius, oy + Math.sin(a) * radius],
          isRadiusClamped: true,
        })
      }
    }
  }

  return result
}
