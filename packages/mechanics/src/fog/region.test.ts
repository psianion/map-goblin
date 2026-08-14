import { describe, expect, it } from 'vitest'

import {
  cellsCoveredByPolygon,
  clearCells,
  getCell,
  pointInPolygon,
  regionFor,
  regionOf,
  setCells,
  toBase64,
  toBytes,
  type Cell,
  type Frame,
} from './region'

const FRAME: Frame = { minX: 0, minY: 0, maxX: 10, maxY: 10 }
/** Off-origin on purpose: a mask that only works at (0, 0) is a mask that works by luck. */
const SHIFTED: Frame = { minX: -4, minY: -2, maxX: 6, maxY: 8 }

const set = (region = regionOf(FRAME), ...cells: Cell[]) => setCells(region, cells)
const on = (region: ReturnType<typeof regionOf>): Cell[] => {
  const cells: Cell[] = []
  for (let row = 0; row < region.rows; row++) {
    for (let col = 0; col < region.cols; col++) if (getCell(region, col, row)) cells.push([col, row])
  }
  return cells
}

describe('base64 round trip', () => {
  it('survives every byte value', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i)
    expect([...toBytes(toBase64(bytes))]).toEqual([...bytes])
  })

  it('round-trips an empty mask', () => {
    expect(toBase64(toBytes(''))).toBe('')
  })
})

describe('regionOf', () => {
  it('sizes to the frame and starts empty', () => {
    const region = regionOf(FRAME)
    expect(region).toMatchObject({ minX: 0, minY: 0, cols: 10, rows: 10 })
    // 100 bits = 13 bytes, all zero.
    expect(toBytes(region.bits)).toHaveLength(13)
    expect(on(region)).toEqual([])
  })

  it('keeps the frame origin, negative or not', () => {
    expect(regionOf(SHIFTED)).toMatchObject({ minX: -4, minY: -2, cols: 10, rows: 10 })
  })
})

describe('setCells / getCell / clearCells', () => {
  it('sets exactly the cells it is given', () => {
    expect(on(set(undefined, [0, 0], [9, 9], [3, 4]))).toEqual([
      [0, 0],
      [3, 4],
      [9, 9],
    ])
  })

  it('ORs — a second write never takes the first one back', () => {
    const once = set(undefined, [1, 1])
    expect(on(setCells(once, [[2, 2]]))).toEqual([
      [1, 1],
      [2, 2],
    ])
    // …and setting a cell that is already on changes nothing at all.
    expect(setCells(once, [[1, 1]]).bits).toBe(once.bits)
  })

  it('clears one cell and leaves its neighbours alone', () => {
    const both = set(undefined, [4, 4], [5, 4])
    expect(on(clearCells(both, [[4, 4]]))).toEqual([[5, 4]])
  })

  it('ignores cells outside the mask rather than corrupting a neighbour', () => {
    const region = regionOf(FRAME)
    // Row-major packing means an unclamped col=10 would land on (0, row+1).
    expect(setCells(region, [[10, 0], [-1, 0], [0, 10], [0, -1]]).bits).toBe(region.bits)
    expect(getCell(region, 10, 0)).toBe(false)
    expect(getCell(undefined, 0, 0)).toBe(false)
  })

  it('does not mutate the mask it was handed', () => {
    const region = regionOf(FRAME)
    setCells(region, [[1, 1]])
    expect(on(region)).toEqual([])
  })
})

describe('regionFor', () => {
  const frame: Frame = { minX: 0, minY: 0, maxX: 10, maxY: 10 }

  it('keeps a stored mask that still describes this frame, identity included', () => {
    const stored = set(undefined, [1, 1])
    expect(regionFor(stored, frame)).toBe(stored)
  })

  it('starts over when the map moved or resized under it', () => {
    const stored = set(undefined, [1, 1])
    expect(on(regionFor(stored, { minX: 0, minY: 0, maxX: 12, maxY: 10 }))).toEqual([])
    expect(on(regionFor(stored, { minX: 1, minY: 0, maxX: 11, maxY: 10 }))).toEqual([])
    expect(on(regionFor(undefined, frame))).toEqual([])
  })
})

describe('cellsCoveredByPolygon', () => {
  const square = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ]

  it('covers the cells whose centres are inside a known square', () => {
    // (2,2)–(6,6) holds the centres of cols 2..5 × rows 2..5 and no others.
    const cells = cellsCoveredByPolygon(square(2, 2, 6, 6), FRAME)
    expect(cells).toHaveLength(16)
    expect(cells).toContainEqual([2, 2])
    expect(cells).toContainEqual([5, 5])
    expect(cells).not.toContainEqual([6, 5])
    expect(cells).not.toContainEqual([1, 2])
  })

  it('counts cells from the frame origin, not from zero', () => {
    // The same world square, on a frame that starts at (-4, -2): (2,2) is col 6, row 4.
    const cells = cellsCoveredByPolygon(square(2, 2, 6, 6), SHIFTED)
    expect(cells).toHaveLength(16)
    expect(cells).toContainEqual([6, 4])
    expect(cells).toContainEqual([9, 7])
  })

  it('clips to the frame instead of running off the mask', () => {
    const cells = cellsCoveredByPolygon(square(-5, -5, 3, 3), FRAME)
    expect(cells).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
      [0, 2],
      [1, 2],
      [2, 2],
    ])
  })

  it('covers nothing for a degenerate polygon or one off the map', () => {
    expect(cellsCoveredByPolygon([[0, 0], [1, 1]], FRAME)).toEqual([])
    expect(cellsCoveredByPolygon(square(50, 50, 60, 60), FRAME)).toEqual([])
  })

  it('follows a concave shape rather than its bounding box', () => {
    // An L: the top-right quadrant of a 6×6 box is cut away.
    const ell: [number, number][] = [
      [0, 0],
      [3, 0],
      [3, 3],
      [6, 3],
      [6, 6],
      [0, 6],
    ]
    const cells = cellsCoveredByPolygon(ell, FRAME)
    expect(cells).toContainEqual([1, 1])
    expect(cells).toContainEqual([4, 4])
    expect(cells).not.toContainEqual([4, 1])
  })
})

describe('pointInPolygon', () => {
  const tri: [number, number][] = [
    [0, 0],
    [4, 0],
    [0, 4],
  ]
  it('answers inside and outside', () => {
    expect(pointInPolygon(tri, 1, 1)).toBe(true)
    expect(pointInPolygon(tri, 3, 3)).toBe(false)
    expect(pointInPolygon(tri, -1, 1)).toBe(false)
  })
})
