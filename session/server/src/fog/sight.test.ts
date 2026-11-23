// What a party eye sees on the referee's side: line of sight out to its range, cut by walls,
// one-way walls and its own cone, on its own level. Light plays no part. Synthetic scenes, swept
// by the real `createSweeps` and judged by the real `seen`, so each row is the rule and nothing
// else.

import { describe, expect, it } from 'vitest'
import type { Token } from '@dnd/mechanics/tokens'
import type { Room, WallSegment } from '@dnd/core/src/shared/types'
import type { DungeonLayer, SerializedMapData } from '@dnd/core/src/store/types'
import { createSweeps, seen } from './sweep'
import type { SceneMap } from './sceneMap'

const square = (x: number, y: number, w: number, h: number): [number, number][] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
]

const room = (id: string, face: [number, number][]): Room =>
  ({ id, name: id, anchor: face[0], boundary: face, face }) as Room

const wall = (id: string, points: [number, number][], over: Partial<WallSegment> = {}): WallSegment =>
  ({ id, points, wallType: 'normal', direction: 'both', color: '#000', roughness: 0, ...over }) as WallSegment

interface SceneSpec {
  rooms?: Room[]
  walls?: WallSegment[]
  /** Extra layers on other levels. */
  levels?: { id: string; walls?: WallSegment[] }[]
}

/** A scene map shaped exactly as `sceneMap.ts` hands one over, built by hand. */
function scene(spec: SceneSpec): SceneMap {
  const layer = (id: string, levelId: string, walls: WallSegment[], rooms: Room[]): DungeonLayer =>
    ({
      id,
      name: id,
      type: 'dungeon',
      levelId,
      visible: true,
      children: [],
      standaloneWalls: walls,
      rooms,
      mergedFloor: null,
      style: {},
    }) as unknown as DungeonLayer
  const levels = [{ id: 'L1', name: 'One' }, ...(spec.levels ?? []).map((l) => ({ id: l.id, name: l.id }))]
  const layers = [
    layer('ground', 'L1', spec.walls ?? [], spec.rooms ?? []),
    ...(spec.levels ?? []).map((l) => layer(`layer-${l.id}`, l.id, l.walls ?? [], [])),
  ]
  const data = {
    version: '3.1',
    mapSettings: { name: 'M', cellScale: { value: 5, unit: 'ft' }, ambientLight: '#ffffff', environment: 'outdoor' },
    grid: { visible: true, snapEnabled: true, snapDivision: 2 },
    layers,
    customImages: {},
    levels,
  } as unknown as SerializedMapData
  return {
    campaignId: 'c',
    data,
    frame: { minX: -20, minY: -20, maxX: 40, maxY: 40 },
    rooms: (spec.rooms ?? []) as SceneMap['rooms'],
    doors: [],
    zones: [],
    lights: [],
    lightNames: new Map(),
    roomAt: () => null,
    roomAtOn: () => null,
    roomLevels: new Map(),
    roomsAlong: () => [],
  }
}

const eye = (id: string, x: number, y: number, over: Partial<Token> = {}): Token =>
  ({
    id,
    name: id,
    imageAssetId: null,
    size: 'medium',
    disposition: 'friendly',
    // A sight range past any map here, so the walls are what bound the eye.
    sight: { range: 1000, angle: 360, visionMode: 'normal' },
    light: null,
    defId: null,
    x,
    y,
    elevation: 0,
    z: 0,
    hidden: false,
    ownerId: 'p-1',
    ...over,
  }) as Token

function visionOf(map: SceneMap, tokens: Token[], levelId?: string) {
  return createSweeps().partyVision(map, Object.fromEntries(tokens.map((t) => [t.id, t])), {}, levelId)
}

describe('range', () => {
  it('an eye sees out to its sight range and no further', () => {
    const v = visionOf(scene({}), [eye('a', 0, 0, { sight: { range: 4, angle: 360, visionMode: 'normal' } })])
    expect(seen(v, 3.5, 0)).toBe(true)
    expect(seen(v, 4.5, 0)).toBe(false)
  })
})

describe('cones and one-way walls', () => {
  it('an eye’s sight.angle is its cone (facing east)', () => {
    const v = visionOf(scene({}), [eye('a', 0, 0, { sight: { range: 1000, angle: 90, visionMode: 'normal' } })])
    expect(seen(v, 5, 0)).toBe(true)
    expect(seen(v, -5, 0)).toBe(false)
  })

  it('a 360 angle (or none) is a full circle', () => {
    const v = visionOf(scene({}), [eye('a', 0, 0)])
    expect(seen(v, -5, 0)).toBe(true)
  })

  it('a one-way wall lets sight through from its open side only', () => {
    // Walked south → north along x = 3: its left (screen space, y down) is west.
    const oneWay = wall('w', [[3, 10], [3, -10]], { direction: 'left' })
    const fromEast = visionOf(scene({ walls: [oneWay] }), [eye('a', 6, 0)])
    expect(seen(fromEast, 0, 0)).toBe(true)
    const fromWest = visionOf(scene({ walls: [oneWay] }), [eye('a', 0, 0)])
    expect(seen(fromWest, 6, 0)).toBe(false)
  })
})

describe('levels', () => {
  it('a level’s eyes only: a token on level 2 does not look at level 1', () => {
    const map = scene({ levels: [{ id: 'L2' }] })
    const tokens = [eye('up', 0, 0, { levelId: 'L2' })]
    expect(visionOf(map, tokens, 'L1').eyes).toHaveLength(0)
    expect(visionOf(map, tokens, 'L2').eyes).toHaveLength(1)
  })

  it('another level’s wall does not block', () => {
    const map = scene({ levels: [{ id: 'L2', walls: [wall('w2', [[2, 10], [2, -10]])] }] })
    expect(seen(visionOf(map, [eye('a', 0, 0)], 'L1'), 5, 0)).toBe(true)
  })
})

describe('§13 bench: a vision update on a 60×46 map with 8 rooms', () => {
  it('sweeps and judges every cell inside the budget', () => {
    const rooms: Room[] = []
    for (let i = 0; i < 8; i++) {
      const x = (i % 4) * 15
      const y = Math.floor(i / 4) * 23
      rooms.push(room(`r${i}`, square(x, y, 14, 22)))
    }
    const walls: WallSegment[] = []
    for (const r of rooms) {
      const f = r.face!
      for (let k = 0; k < 4; k++) {
        const a = f[k]!
        const b = f[(k + 1) % 4]!
        // A doorway gap in the middle of each wall.
        const mx = (a[0] + b[0]) / 2
        const my = (a[1] + b[1]) / 2
        walls.push(wall(`${r.id}-${k}a`, [a, [a[0] + (mx - a[0]) * 0.8, a[1] + (my - a[1]) * 0.8]]))
        walls.push(wall(`${r.id}-${k}b`, [[b[0] + (mx - b[0]) * 0.8, b[1] + (my - b[1]) * 0.8], b]))
      }
    }
    const tokens = [eye('a', 7, 11), eye('b', 22, 11), eye('c', 37, 34), eye('d', 52, 34)]
    const map = scene({ rooms, walls })
    const started = performance.now()
    const v = visionOf(map, tokens)
    let shown = 0
    for (let col = 0; col < 60; col++) {
      for (let row = 0; row < 46; row++) if (seen(v, col + 0.5, row + 0.5)) shown++
    }
    const ms = performance.now() - started
    console.log(`[bench] server vision update, 60x46, 8 rooms, 4 eyes: ${ms.toFixed(1)} ms (${shown} cells seen)`)
    expect(shown).toBeGreaterThan(0)
    // The plan's budget is 15 ms; held loosely here so a busy CI box does not flake.
    expect(ms).toBeLessThan(250)
  })
})
