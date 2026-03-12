import { describe, it, expect } from 'vitest'
import { computeVisibilityPolygon } from './raycaster'
import type { Segment } from './raycaster'

// Helper: winding number point-in-polygon test
function pointInPolygon(px: number, py: number, poly: [number, number][]): boolean {
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
  it('open area (no walls) returns at least 4 vertices', () => {
    const poly = computeVisibilityPolygon([0, 0], 500, [])
    expect(poly.length).toBeGreaterThanOrEqual(4)
  })

  it('all vertices in open area are approximately at radius distance (within 20%)', () => {
    const radius = 500
    const poly = computeVisibilityPolygon([0, 0], radius, [])
    for (const [x, y] of poly) {
      const dist = Math.sqrt(x * x + y * y)
      expect(Math.abs(dist - radius)).toBeLessThan(radius * 0.2)
    }
  })

  it('wall segment blocks the rightward view — point at [300, 0] not visible from [0, 0]', () => {
    const radius = 500
    const segments: Segment[] = [{ x1: 100, y1: -100, x2: 100, y2: 100 }]
    const poly = computeVisibilityPolygon([0, 0], radius, segments)
    expect(pointInPolygon(300, 0, poly)).toBe(false)
  })

  it('point at [50, 0] IS visible from [0, 0] (in front of the wall)', () => {
    const radius = 500
    const segments: Segment[] = [{ x1: 100, y1: -100, x2: 100, y2: 100 }]
    const poly = computeVisibilityPolygon([0, 0], radius, segments)
    expect(pointInPolygon(50, 0, poly)).toBe(true)
  })

  it('all polygon vertices stay within radius (+1 tolerance for floating point)', () => {
    const radius = 300
    const segments: Segment[] = [
      { x1: 100, y1: -100, x2: 100, y2: 100 },
      { x1: -50, y1: 200, x2: 200, y2: 200 },
    ]
    const poly = computeVisibilityPolygon([0, 0], radius, segments)
    for (const [x, y] of poly) {
      const dist = Math.sqrt(x * x + y * y)
      expect(dist).toBeLessThanOrEqual(radius + 1)
    }
  })

  it('degenerate zero-length segment does not throw', () => {
    const segments: Segment[] = [{ x1: 50, y1: 50, x2: 50, y2: 50 }]
    expect(() => computeVisibilityPolygon([0, 0], 500, segments)).not.toThrow()
  })

  it('light at wall endpoint does not throw', () => {
    const segments: Segment[] = [{ x1: 0, y1: 0, x2: 100, y2: 0 }]
    expect(() => computeVisibilityPolygon([0, 0], 500, segments)).not.toThrow()
  })

  it('box enclosure — light inside 4 walls cannot see outside', () => {
    const size = 200
    const segments: Segment[] = [
      { x1: -size, y1: -size, x2: size, y2: -size }, // top
      { x1: size, y1: -size, x2: size, y2: size }, // right
      { x1: size, y1: size, x2: -size, y2: size }, // bottom
      { x1: -size, y1: size, x2: -size, y2: -size }, // left
    ]
    const poly = computeVisibilityPolygon([0, 0], 500, segments)
    expect(pointInPolygon(300, 0, poly)).toBe(false)
    expect(pointInPolygon(0, 0, poly)).toBe(true)
  })
})
