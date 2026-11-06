// Plateaus in the sweep: a cliff hides its top from below and nothing from above. Light is
// stopped by any cliff a cell or more tall; for eyes the map threshold and each floor's
// override decide which cliffs count; and a one-way wall still blocks
// only from its own side.
import { describe, it, expect, beforeAll } from 'vitest'
import type { MainModule } from 'clipper2-wasm/dist/clipper2z'
import { setClipperModule } from '../../geometry/Clipper2Engine'
import { extractWallSegments, type Segment } from './raycaster'
import { cliffOccluders } from '../../shared/plateaus'
import { clockwiseSweep } from './ClockwiseSweep'
import { LightManager } from './LightManager'
import type { DungeonLayer, LightChild, ShapeChild, WallSegment } from '../../store/types'
import type { PlateauChild } from '../../shared/types'

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string)
  const { createRequire } = await import('node:module' as string)
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'))
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string)
  const clipper: MainModule = await mod.default({ wasmBinary })
  setClipperModule(clipper)
}, 30_000)

function rect(id: string, x0: number, y0: number, x1: number, y1: number, extra: Partial<ShapeChild> = {}): ShapeChild {
  return {
    id,
    name: id,
    childType: 'shape',
    visible: true,
    shapeType: 'rectangle',
    contours: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
    ...extra,
  }
}

function plat(id: string, x0: number, y0: number, x1: number, y1: number, extra: Partial<PlateauChild> = {}): PlateauChild {
  return {
    id,
    name: id,
    childType: 'plateau',
    visible: true,
    contours: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
    height: 1,
    edge: 'cliff',
    ...extra,
  };
}

const layerOf = (children: unknown[], walls: WallSegment[] = []): DungeonLayer =>
  ({ type: 'dungeon', children, standaloneWalls: walls, mergedFloor: null }) as unknown as DungeonLayer

function inside(px: number, py: number, poly: [number, number][]): boolean {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

const sees = (segs: Segment[], from: [number, number], to: [number, number]) =>
  inside(to[0], to[1], clockwiseSweep(from, 30, segs).map((v) => v.point))

const ground = rect('ground', 0, 0, 30, 30)
const plateau = (extra: Partial<PlateauChild> = {}) => plat('top', 10, 10, 14, 14, { height: 2, edge: 'cliff', ...extra })

describe('cliffs as one-way occluders', () => {
  it('a ray from the low side stops at the cliff; from the high side it passes', () => {
    for (const kind of ['sight', 'light'] as const) {
      const segs = extractWallSegments([layerOf([ground, plateau()])], kind)
      expect(segs).toHaveLength(4)
      expect(sees(segs, [5, 12], [12, 12])).toBe(false)
      expect(sees(segs, [12, 12], [20, 12])).toBe(true)
      expect(sees(segs, [12, 12], [5, 12])).toBe(true)
    }
  })

  it('a pit hides from its own floor, not from the rim above', () => {
    const pit = plat('pit', 10, 10, 14, 14, { height: -2, edge: 'cliff' })
    const segs = extractWallSegments([layerOf([ground, pit])], 'sight')
    expect(sees(segs, [12, 12], [20, 12])).toBe(false)
    expect(sees(segs, [20, 12], [12, 12])).toBe(true)
  })

  it('stops light at a one-cell cliff: a lamp below leaves the top dark, a lamp on top lights the ground', () => {
    const layers = [layerOf([ground, plateau({ height: 1 })])]
    const light = extractWallSegments(layers, 'light', { sightDropCells: 2 })
    expect(light).toHaveLength(4)
    expect(sees(light, [5, 12], [12, 12])).toBe(false)
    expect(sees(light, [12, 12], [5, 12])).toBe(true)
    expect(sees(light, [12, 12], [20, 12])).toBe(true)
    // The eye keeps the DM's threshold: at 2 a ground viewer still sees the +1 top.
    const sight = extractWallSegments(layers, 'sight', { sightDropCells: 2 })
    expect(sight).toHaveLength(0)
    expect(sees(sight, [5, 12], [12, 12])).toBe(true)
  })

  it('takes the drop it starts at from its caller', () => {
    const layer = layerOf([ground, plateau({ height: 1 })])
    expect(cliffOccluders(layer, 1)).toHaveLength(4)
    expect(cliffOccluders(layer, 2)).toHaveLength(0)
    expect(cliffOccluders(layer)).toHaveLength(0)
  })

  it('hides from the map threshold up', () => {
    const low = [layerOf([ground, plateau({ height: 1 })])]
    expect(extractWallSegments(low, 'sight')).toHaveLength(0)
    expect(extractWallSegments(low, 'sight', { sightDropCells: 1 })).toHaveLength(4)
    expect(extractWallSegments([layerOf([ground, plateau({ height: 3 })])], 'sight', { sightDropCells: 4 })).toHaveLength(0)
  })

  it('honours the floor override either way, and never hides with a slope on Auto', () => {
    expect(extractWallSegments([layerOf([ground, plateau({ height: 1, sightOverride: 'hide' })])], 'sight')).toHaveLength(4)
    expect(extractWallSegments([layerOf([ground, plateau({ height: 5, sightOverride: 'show' })])], 'sight')).toHaveLength(0)
    expect(extractWallSegments([layerOf([ground, plateau({ height: 5, edge: 'slope' })])], 'sight')).toHaveLength(0)
  })

  it('stays out of the wall-shadow pass, which casts cliffs by their drop', () => {
    expect(extractWallSegments([layerOf([ground, plateau()])], 'light', { props: false, cliffs: false })).toHaveLength(0)
  })

  it('still honours a wall’s direction beside them', () => {
    const wall = {
      id: 'w',
      points: [[0, 20], [30, 20]],
      wallType: 'normal',
      direction: 'left',
      color: '#000',
      roughness: 0,
    } as unknown as WallSegment
    const segs = extractWallSegments([layerOf([ground], [wall])], 'sight')
    // Walking +x, left is -y (screen space): blocked from above the line, open from below.
    expect(sees(segs, [5, 15], [5, 25])).toBe(false)
    expect(sees(segs, [5, 25], [5, 15])).toBe(true)
    const both = extractWallSegments([layerOf([ground], [{ ...wall, direction: 'both' }])], 'sight')
    expect(sees(both, [5, 25], [5, 15])).toBe(false)
  })
})

describe('scene lights cast from cliffs, as walls do', () => {
  const lamp = (x: number, y: number): LightChild => ({
    id: `lamp-${x}-${y}`,
    name: 'Lamp',
    childType: 'light',
    visible: true,
    color: '#fff',
    radius: 20,
    featherRadius: 2,
    intensity: 1,
    falloff: 'quadratic',
    position: { x, y },
  })
  /** The lighting pass's pool for `light` over `children`: what LightManager sweeps. */
  const pool = (children: unknown[], light: LightChild) => {
    const lm = new LightManager()
    lm.rebuildIfDirty([layerOf(children)])
    return lm.getOrComputePolygon(light).map((v) => v.point)
  }
  const wallAt = (points: [number, number][]) =>
    ({ id: 'w', points, wallType: 'normal', direction: 'both', color: '#000', roughness: 0 }) as unknown as WallSegment

  it('a lamp on the low side of a +1 cliff leaves its top and the ground beyond it in the dark', () => {
    const light = lamp(5, 12)
    const flat = pool([ground], light)
    const raised = pool([ground, plateau({ height: 1 })], light)
    // The top, and the ground past the far cliff in the lamp's direction.
    for (const p of [[12, 12], [16, 12], [18, 12.5]] as [number, number][]) {
      expect(inside(p[0], p[1], flat)).toBe(true)
      expect(inside(p[0], p[1], raised)).toBe(false)
    }
    // The near side, the lamp's own ground, stays lit up to the cliff.
    expect(inside(9.5, 12, raised)).toBe(true)
    // Exactly as a wall standing on the near cliff's edge throws it.
    const lm = new LightManager()
    lm.rebuildIfDirty([layerOf([ground], [wallAt([[10, 10], [10, 14]])])])
    const walled = lm.getOrComputePolygon(light).map((v) => v.point)
    for (const p of [[12, 12], [16, 12], [18, 12.5], [9.5, 12]] as [number, number][]) {
      expect(inside(p[0], p[1], raised)).toBe(inside(p[0], p[1], walled))
    }
  })

  it('a lamp on top lights the ground below as it would with no plateau', () => {
    const light = lamp(12, 12)
    const flat = pool([ground], light)
    const raised = pool([ground, plateau({ height: 1 })], light)
    for (const p of [[5, 12], [20, 12], [12, 4], [12, 22], [6, 6], [20, 20]] as [number, number][]) {
      expect(inside(p[0], p[1], flat)).toBe(true)
      expect(inside(p[0], p[1], raised)).toBe(true)
    }
  })
})
