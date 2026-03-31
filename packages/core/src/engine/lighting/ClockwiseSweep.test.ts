import { describe, it, expect } from 'vitest'
import { clockwiseSweep } from './ClockwiseSweep'
import type { VisibilityVertex } from './ClockwiseSweep'
import type { Segment } from './raycaster'

function toPoints(verts: VisibilityVertex[]): [number, number][] {
  return verts.map((v) => v.point)
}

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

describe('clockwiseSweep', () => {
  it('no walls → full circle polygon (all vertices radius-clamped)', () => {
    const verts = clockwiseSweep([0, 0], 500, [])
    expect(verts.length).toBeGreaterThanOrEqual(16)
    for (const v of verts) {
      expect(v.isRadiusClamped).toBe(true)
      const dist = Math.sqrt(v.point[0] ** 2 + v.point[1] ** 2)
      expect(dist).toBeCloseTo(500, 0)
    }
  })

  it('single wall blocks rightward view', () => {
    const segs: Segment[] = [{ x1: 100, y1: -100, x2: 100, y2: 100 }]
    const poly = toPoints(clockwiseSweep([0, 0], 500, segs))
    expect(pointInPolygon(300, 0, poly)).toBe(false)
    expect(pointInPolygon(50, 0, poly)).toBe(true)
  })

  it('all vertices stay within radius + tolerance', () => {
    const segs: Segment[] = [
      { x1: 100, y1: -100, x2: 100, y2: 100 },
      { x1: -50, y1: 200, x2: 200, y2: 200 },
    ]
    const verts = clockwiseSweep([0, 0], 300, segs)
    for (const v of verts) {
      const dist = Math.sqrt(v.point[0] ** 2 + v.point[1] ** 2)
      expect(dist).toBeLessThanOrEqual(301)
    }
  })

  it('L-shaped concave corner — no shadow leak', () => {
    const segs: Segment[] = [
      { x1: 100, y1: 0, x2: 100, y2: 100 },
      { x1: 100, y1: 100, x2: 200, y2: 100 },
    ]
    const poly = toPoints(clockwiseSweep([50, 50], 500, segs))
    expect(pointInPolygon(150, 150, poly)).toBe(false)
    expect(pointInPolygon(50, 50, poly)).toBe(true)
  })

  it('box enclosure — light inside 4 walls cannot see outside', () => {
    const s = 200
    const segs: Segment[] = [
      { x1: -s, y1: -s, x2: s, y2: -s },
      { x1: s, y1: -s, x2: s, y2: s },
      { x1: s, y1: s, x2: -s, y2: s },
      { x1: -s, y1: s, x2: -s, y2: -s },
    ]
    const poly = toPoints(clockwiseSweep([0, 0], 500, segs))
    expect(pointInPolygon(300, 0, poly)).toBe(false)
    expect(pointInPolygon(0, 0, poly)).toBe(true)
  })

  it('light at wall endpoint does not throw', () => {
    const segs: Segment[] = [{ x1: 0, y1: 0, x2: 100, y2: 0 }]
    expect(() => clockwiseSweep([0, 0], 500, segs)).not.toThrow()
  })

  it('degenerate zero-length segment does not throw', () => {
    const segs: Segment[] = [{ x1: 50, y1: 50, x2: 50, y2: 50 }]
    expect(() => clockwiseSweep([0, 0], 500, segs)).not.toThrow()
  })

  it('arc tessellation produces smooth circle (no large chords)', () => {
    const radius = 500
    const verts = clockwiseSweep([0, 0], radius, [])
    const pts = toPoints(verts)
    const maxChord = radius * 2 * Math.PI / 32
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i]
      const [x2, y2] = pts[(i + 1) % pts.length]
      const dist = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
      expect(dist).toBeLessThan(maxChord)
    }
  })

  it('T-junction — endpoint on another wall surface', () => {
    const segs: Segment[] = [
      { x1: 0, y1: -100, x2: 0, y2: 100 },
      { x1: 0, y1: 0, x2: 100, y2: 0 },
    ]
    const poly = toPoints(clockwiseSweep([-50, 0], 500, segs))
    expect(pointInPolygon(-50, 0, poly)).toBe(true)
    expect(pointInPolygon(50, 50, poly)).toBe(false)
  })

  it('very small radius returns valid polygon', () => {
    const verts = clockwiseSweep([0, 0], 0.5, [])
    expect(verts.length).toBeGreaterThanOrEqual(3)
  })

  it('collinear walls — no duplicate vertices or artifacts', () => {
    const segs: Segment[] = [
      { x1: 100, y1: -50, x2: 100, y2: 0 },
      { x1: 100, y1: 0, x2: 100, y2: 50 },
    ]
    const poly = toPoints(clockwiseSweep([0, 0], 500, segs))
    expect(pointInPolygon(300, 0, poly)).toBe(false)
    expect(pointInPolygon(50, 0, poly)).toBe(true)
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i]
      const [x2, y2] = poly[(i + 1) % poly.length]
      const dist = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
      expect(dist).toBeGreaterThan(0.001)
    }
  })

  it('light inside rectangular room — polygon bounded by walls', () => {
    const s = 200
    const segs: Segment[] = [
      { x1: -s, y1: -s, x2: s, y2: -s },
      { x1: s, y1: -s, x2: s, y2: s },
      { x1: s, y1: s, x2: -s, y2: s },
      { x1: -s, y1: s, x2: -s, y2: -s },
    ]
    const verts = clockwiseSweep([0, 0], 500, segs)
    const wallHits = verts.filter((v) => !v.isRadiusClamped)
    expect(wallHits.length).toBeGreaterThan(0)
    for (const v of wallHits) {
      const [x, y] = v.point
      const nearWall = Math.abs(Math.abs(x) - s) < 2 || Math.abs(Math.abs(y) - s) < 2
      expect(nearWall).toBe(true)
    }
  })
})
