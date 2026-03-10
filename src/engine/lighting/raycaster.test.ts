import { describe, it, expect } from 'vitest'
import { computeVisibilityPolygon, type Segment } from './raycaster'

// Helper: check if a point is inside a polygon (winding number)
function pointInPolygon(px: number, py: number, poly: [number,number][]): boolean {
  let winding = 0
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]
    const [x2, y2] = poly[(i + 1) % poly.length]
    if (y1 <= py) {
      if (y2 > py && (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1) > 0) winding++
    } else {
      if (y2 <= py && (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1) < 0) winding--
    }
  }
  return winding !== 0
}

describe('computeVisibilityPolygon', () => {
  it('returns a polygon with at least 4 vertices for an open area', () => {
    const poly = computeVisibilityPolygon([0, 0], 500, [])
    expect(poly.length).toBeGreaterThanOrEqual(4)
  })

  it('open area polygon is roughly circular — radius check', () => {
    const origin: [number,number] = [0, 0]
    const radius = 300
    const poly = computeVisibilityPolygon(origin, radius, [])
    // All vertices should be at approximately the radius distance
    for (const [x, y] of poly) {
      const dist = Math.sqrt(x * x + y * y)
      expect(dist).toBeCloseTo(radius, -1) // within ~10 units
    }
  })

  it('a wall segment directly to the right blocks the rightward view', () => {
    const segments: Segment[] = [
      [[100, -100], [100, 100]],
    ]
    const poly = computeVisibilityPolygon([0, 0], 500, segments)
    // Point at [300, 0] should NOT be visible (behind the wall)
    expect(pointInPolygon(300, 0, poly)).toBe(false)
  })

  it('point directly in front of wall IS visible', () => {
    const segments: Segment[] = [
      [[100, -100], [100, 100]],
    ]
    const poly = computeVisibilityPolygon([0, 0], 500, segments)
    // Point at [50, 0] should be visible (in front of the wall)
    expect(pointInPolygon(50, 0, poly)).toBe(true)
  })

  it('visibility polygon stays within radius', () => {
    const segments: Segment[] = [
      [[100, -100], [100, 100]],
    ]
    const radius = 200
    const poly = computeVisibilityPolygon([0, 0], radius, segments)
    for (const [x, y] of poly) {
      const dist = Math.sqrt(x * x + y * y)
      expect(dist).toBeLessThanOrEqual(radius + 1) // +1 floating point tolerance
    }
  })

  it('handles zero-length wall segment without throwing', () => {
    const segments: Segment[] = [
      [[50, 50], [50, 50]], // degenerate
    ]
    expect(() => computeVisibilityPolygon([0, 0], 300, segments)).not.toThrow()
  })

  it('handles light exactly on wall endpoint without throwing', () => {
    const segments: Segment[] = [
      [[0, 0], [100, 0]], // light is at [0,0], an endpoint
    ]
    expect(() => computeVisibilityPolygon([0, 0], 300, segments)).not.toThrow()
  })

  it('box enclosure: light inside a square room sees only the interior', () => {
    // A square room with walls on all 4 sides
    const size = 200
    const segments: Segment[] = [
      [[-size, -size], [size, -size]], // top
      [[size, -size],  [size, size]],  // right
      [[size, size],   [-size, size]], // bottom
      [[-size, size],  [-size, -size]], // left
    ]
    const poly = computeVisibilityPolygon([0, 0], 500, segments)
    // Point outside the room should not be visible
    expect(pointInPolygon(300, 0, poly)).toBe(false)
    // Origin area should be visible
    expect(pointInPolygon(0, 0, poly)).toBe(true)
  })

  it('returns vertices sorted by angle', () => {
    const poly = computeVisibilityPolygon([0, 0], 300, [])
    const angles = poly.map(([x, y]) => Math.atan2(y, x))
    for (let i = 1; i < angles.length; i++) {
      expect(angles[i]).toBeGreaterThanOrEqual(angles[i - 1])
    }
  })
})
