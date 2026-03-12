import { describe, it, expect } from 'vitest'
import { SegmentQuadtree } from './SegmentQuadtree'
import type { Segment } from './raycaster'

describe('SegmentQuadtree', () => {
  it('empty tree returns empty array', () => {
    const qt = new SegmentQuadtree()
    qt.build([])
    expect(qt.query(-100, -100, 100, 100)).toEqual([])
  })

  it('single segment returned when query overlaps', () => {
    const qt = new SegmentQuadtree()
    const seg: Segment = { x1: 10, y1: 10, x2: 50, y2: 50 }
    qt.build([seg])
    const result = qt.query(0, 0, 60, 60)
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(seg)
  })

  it('single segment NOT returned when query is disjoint', () => {
    const qt = new SegmentQuadtree()
    const seg: Segment = { x1: 10, y1: 10, x2: 50, y2: 50 }
    qt.build([seg])
    const result = qt.query(200, 200, 300, 300)
    expect(result).toHaveLength(0)
  })

  it('returns only overlapping segments from many', () => {
    const qt = new SegmentQuadtree()
    const segs: Segment[] = [
      { x1: 0, y1: 0, x2: 10, y2: 0 },
      { x1: 5, y1: 5, x2: 15, y2: 5 },
      { x1: 500, y1: 500, x2: 510, y2: 500 },
    ]
    qt.build(segs)
    const result = qt.query(-5, -5, 20, 20)
    expect(result).toHaveLength(2)
    expect(result).toContain(segs[0])
    expect(result).toContain(segs[1])
  })

  it('deduplicates segments spanning multiple nodes', () => {
    const qt = new SegmentQuadtree()
    const seg: Segment = { x1: -1000, y1: 0, x2: 1000, y2: 0 }
    qt.build([seg])
    const result = qt.query(-500, -500, 500, 500)
    expect(result).toHaveLength(1)
  })

  it('rebuild resets the tree', () => {
    const qt = new SegmentQuadtree()
    qt.build([{ x1: 0, y1: 0, x2: 10, y2: 10 }])
    expect(qt.query(-5, -5, 15, 15)).toHaveLength(1)
    qt.build([])
    expect(qt.query(-5, -5, 15, 15)).toHaveLength(0)
  })
})
