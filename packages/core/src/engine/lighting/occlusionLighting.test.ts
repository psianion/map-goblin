// The Lighting pass's occlusion rules: one-way walls, sight against light, windows, props that
// block light and sight, and the cone. Each agreed gap gets a row that fails on the old code.

import { describe, it, expect } from 'vitest'
import { blocksFrom, extractWallSegments, type Segment } from './raycaster'
import { clockwiseSweep } from './ClockwiseSweep'
import { LightManager } from './LightManager'
import { propEdges, propOccluderKey, propSegments } from '../../shared/propOcclusion'
import type { AssetChild, DungeonLayer, LightChild, WallSegment } from '../../store/types'

const wall = (over: Partial<WallSegment> = {}): WallSegment =>
  ({
    id: 'w1',
    points: [
      [0, 0],
      [10, 0],
    ],
    wallType: 'normal',
    direction: 'both',
    color: '#000',
    roughness: 0,
    ...over,
  }) as WallSegment

const layerWith = (walls: WallSegment[], children: unknown[] = []): DungeonLayer =>
  ({ type: 'dungeon', children, standaloneWalls: walls, mergedFloor: null }) as unknown as DungeonLayer

const prop = (over: Partial<AssetChild> = {}): AssetChild => ({
  id: 'crate',
  name: 'Crate',
  childType: 'asset',
  visible: true,
  objectType: 'asset',
  assetId: 'crate',
  position: { x: 5, y: 5 },
  rotation: 0,
  scale: 1,
  width: 2,
  height: 2,
  tint: '#ffffff',
  flipX: false,
  flipY: false,
  blocksLight: true,
  ...over,
})

const toPoints = (o: [number, number], r: number, segs: Segment[], cone?: { angle: number; direction: number }) =>
  clockwiseSweep(o, r, segs, cone).map((v) => v.point)

function inside(px: number, py: number, poly: [number, number][]): boolean {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

describe('one-way walls (agreed gap: wall direction was ignored)', () => {
  // A wall walked west → east along y = 0: its left (screen space, y down) is north, y < 0.
  const left: Segment = { x1: -10, y1: 0, x2: 10, y2: 0, direction: 'left' }
  const right: Segment = { ...left, direction: 'right' }

  it('a left wall blocks a light standing on its left, and lets one on its right through', () => {
    expect(blocksFrom(left, 0, -5)).toBe(true)
    expect(blocksFrom(left, 0, 5)).toBe(false)
    expect(inside(0, 5, toPoints([0, -5], 20, [left]))).toBe(false)
    expect(inside(0, -5, toPoints([0, 5], 20, [left]))).toBe(true)
  })

  it('a right wall is the mirror', () => {
    expect(blocksFrom(right, 0, 5)).toBe(true)
    expect(blocksFrom(right, 0, -5)).toBe(false)
    expect(inside(0, -5, toPoints([0, 5], 20, [right]))).toBe(false)
  })

  it('both directions block from either side, and a plain segment blocks', () => {
    expect(blocksFrom({ ...left, direction: 'both' }, 0, 5)).toBe(true)
    expect(blocksFrom({ x1: 0, y1: 0, x2: 1, y2: 0 }, 0, 5)).toBe(true)
  })

  it('the direction reaches the segments the lights sweep', () => {
    const segs = extractWallSegments([layerWith([wall({ direction: 'left' })])])
    expect(segs[0]?.direction).toBe('left')
  })
})

describe('sight has its own flag (agreed gap: sight read blocksLight)', () => {
  it('extracts by kind: a wall that blocks sight but not light is a sight segment only', async () => {
    const { WALL_TYPE_OCCLUSION } = await import('../../shared/occlusion')
    const saved = { ...WALL_TYPE_OCCLUSION.terrain }
    WALL_TYPE_OCCLUSION.terrain = { ...saved, blocksVision: true, blocksLight: false }
    try {
      const layer = layerWith([wall({ wallType: 'terrain' })])
      expect(extractWallSegments([layer], 'light')).toHaveLength(0)
      expect(extractWallSegments([layer], 'sight')).toHaveLength(1)
    } finally {
      WALL_TYPE_OCCLUSION.terrain = saved
    }
  })

  it('carries both flags on every segment', () => {
    const [seg] = extractWallSegments([layerWith([wall()])], 'sight')
    expect(seg).toMatchObject({ blocksLight: true, blocksSight: true })
  })

  it('a window passes sight and light alike', () => {
    const layer = layerWith([wall({ wallType: 'window' })])
    expect(extractWallSegments([layer], 'light')).toHaveLength(0)
    expect(extractWallSegments([layer], 'sight')).toHaveLength(0)
  })

  it('an ethereal wall blocks both', () => {
    const layer = layerWith([wall({ wallType: 'ethereal' })])
    expect(extractWallSegments([layer], 'light')).toHaveLength(1)
    expect(extractWallSegments([layer], 'sight')).toHaveLength(1)
  })
})

describe('props that block light and sight', () => {
  it('occlude as the four edges of their footprint', () => {
    const edges = propEdges(prop())
    expect(edges).toHaveLength(4)
    const xs = edges.flatMap((e) => [e.x1, e.x2])
    expect(Math.min(...xs)).toBeCloseTo(4)
    expect(Math.max(...xs)).toBeCloseTo(6)
  })

  it('turn with the prop', () => {
    const [e] = propEdges(prop({ rotation: Math.PI / 4 }))
    // A 2×2 box turned 45°: its corners sit √2 from the centre on the axes.
    expect(Math.hypot(e!.x1 - 5, e!.y1 - 5)).toBeCloseTo(Math.SQRT2)
  })

  it('only with the flag on and the prop visible', () => {
    expect(propSegments([prop({ blocksLight: false })])).toHaveLength(0)
    expect(propSegments([prop({ visible: false })])).toHaveLength(0)
    expect(propSegments([prop()])).toHaveLength(4)
  })

  it('join both kinds of segment and shadow a light behind them', () => {
    const layer = layerWith([], [prop()])
    expect(extractWallSegments([layer], 'light')).toHaveLength(4)
    expect(extractWallSegments([layer], 'sight')).toHaveLength(4)
    expect(extractWallSegments([layer], 'light', { props: false })).toHaveLength(0)
    const poly = toPoints([0, 5], 20, extractWallSegments([layer]))
    expect(inside(10, 5, poly)).toBe(false)
    expect(inside(2, 5, poly)).toBe(true)
  })

  it('move the occluder key when moved, turned or resized, and not otherwise', () => {
    const base = propOccluderKey([prop()])
    expect(propOccluderKey([prop()])).toBe(base)
    expect(propOccluderKey([prop({ position: { x: 6, y: 5 } })])).not.toBe(base)
    expect(propOccluderKey([prop({ rotation: 1 })])).not.toBe(base)
    expect(propOccluderKey([prop({ width: 3 })])).not.toBe(base)
    expect(propOccluderKey([prop({ blocksLight: false })])).toBe('')
  })
})

describe('the cone', () => {
  it('90° facing east lights east and not west', () => {
    const poly = toPoints([0, 0], 10, [], { angle: 90, direction: 0 })
    expect(inside(5, 0, poly)).toBe(true)
    expect(inside(-5, 0, poly)).toBe(false)
    expect(inside(0, 5, poly)).toBe(false)
  })

  it('180° facing south (clockwise on screen) lights the lower half', () => {
    const poly = toPoints([0, 0], 10, [], { angle: 180, direction: 90 })
    expect(inside(0, 5, poly)).toBe(true)
    expect(inside(0, -5, poly)).toBe(false)
  })

  it('350° leaves only a sliver dark behind it', () => {
    const poly = toPoints([0, 0], 10, [], { angle: 350, direction: 0 })
    expect(inside(0, 5, poly)).toBe(true)
    expect(inside(0, -5, poly)).toBe(true)
    expect(inside(-8, 0, poly)).toBe(false)
  })

  it('wraps across 0°/180° seams: a wedge facing west', () => {
    const poly = toPoints([0, 0], 10, [], { angle: 60, direction: 180 })
    expect(inside(-5, 0, poly)).toBe(true)
    expect(inside(-5, 1, poly)).toBe(true)
    expect(inside(-5, -1, poly)).toBe(true)
    expect(inside(5, 0, poly)).toBe(false)
  })

  it('starts at the apex: the origin is a vertex', () => {
    const verts = clockwiseSweep([3, 4], 10, [], { angle: 90, direction: 0 })
    expect(verts[0]!.point).toEqual([3, 4])
  })

  it('360° is no wedge, and walls still cut a wedge', () => {
    expect(clockwiseSweep([0, 0], 10, [], { angle: 360, direction: 0 })).toHaveLength(clockwiseSweep([0, 0], 10, []).length)
    const poly = toPoints([0, 0], 10, [{ x1: 4, y1: -10, x2: 4, y2: 10 }], { angle: 90, direction: 0 })
    expect(inside(3, 0, poly)).toBe(true)
    expect(inside(6, 0, poly)).toBe(false)
  })
})

describe('LightManager: cone and through-walls', () => {
  const light = (over: Partial<LightChild> = {}): LightChild => ({
    id: 'l',
    name: 'L',
    childType: 'light',
    visible: true,
    color: '#fff',
    radius: 10,
    featherRadius: 2,
    intensity: 1,
    falloff: 'quadratic',
    position: { x: 0, y: 0 },
    ...over,
  })

  it('a through-walls light ignores the walls, a plain one is cut', () => {
    const lm = new LightManager()
    lm.rebuildIfDirty([layerWith([wall({ points: [[3, -10], [3, 10]] })])])
    const cut = lm.getOrComputePolygon(light()).map((v) => v.point)
    const through = lm.getOrComputePolygon(light({ id: 't', throughWalls: true })).map((v) => v.point)
    expect(inside(6, 0, cut)).toBe(false)
    expect(inside(6, 0, through)).toBe(true)
  })

  it('re-sweeps when the cone or the through-walls flag changes', () => {
    const lm = new LightManager()
    lm.syncFromStore([light()])
    lm.getOrComputePolygon(light())
    const before = lm.staleStamp('l')
    lm.syncFromStore([light({ cone: { angle: 90, direction: 0 } })])
    expect(lm.staleStamp('l')).toBeGreaterThan(before)
    const mid = lm.staleStamp('l')
    lm.syncFromStore([light({ cone: { angle: 90, direction: 0 }, throughWalls: true })])
    expect(lm.staleStamp('l')).toBeGreaterThan(mid)
  })
})
