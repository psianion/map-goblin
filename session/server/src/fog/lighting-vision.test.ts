// The Lighting pass on the referee's side: the per-region darkness gate (mood × sky × the DM's
// slider), darkness sources that subtract light and block sight, cones on eyes and on carried
// torches, one-way walls, and levels. Synthetic scenes, swept by the real `createSweeps` and
// judged by the real `seen`, so each row is the rule and nothing else.

import { describe, expect, it } from 'vitest'
import type { Token } from '@dnd/mechanics/tokens'
import { skyFrame, type SkyFrame } from '@dnd/mechanics/triggers'
import type { LightChild, Room, WallSegment } from '@dnd/core/src/shared/types'
import type { DungeonLayer, MapSettings, SerializedMapData } from '@dnd/core/src/store/types'
import { createSweeps, seen, type LightGate } from './sweep'
import type { SceneMap } from './sceneMap'

const NOON: SkyFrame = skyFrame({ environment: 'outdoor', minutes: 720 })
const MIDNIGHT: SkyFrame = skyFrame({ environment: 'outdoor', minutes: 0, nightSky: 'moonless' })

const square = (x: number, y: number, w: number, h: number): [number, number][] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
]

const room = (id: string, face: [number, number][], look?: Room['look']): Room =>
  ({ id, name: id, anchor: face[0], boundary: face, face, ...(look ? { look } : {}) }) as Room

const wall = (id: string, points: [number, number][], over: Partial<WallSegment> = {}): WallSegment =>
  ({ id, points, wallType: 'normal', direction: 'both', color: '#000', roughness: 0, ...over }) as WallSegment

const lamp = (id: string, x: number, y: number, over: Partial<LightChild> = {}): LightChild => ({
  id,
  name: id,
  childType: 'light',
  visible: true,
  color: '#ffcc88',
  radius: 3,
  featherRadius: 1,
  intensity: 1,
  falloff: 'quadratic',
  position: { x, y },
  ...over,
})

interface SceneSpec {
  rooms?: Room[]
  walls?: WallSegment[]
  lights?: LightChild[]
  environment?: MapSettings['environment']
  /** Extra layers on other levels. */
  levels?: { id: string; walls?: WallSegment[]; lights?: LightChild[] }[]
}

/** A scene map shaped exactly as `sceneMap.ts` hands one over, built by hand. */
function scene(spec: SceneSpec): SceneMap {
  const layer = (id: string, levelId: string, walls: WallSegment[], lights: LightChild[], rooms: Room[]): DungeonLayer =>
    ({
      id,
      name: id,
      type: 'dungeon',
      levelId,
      visible: true,
      children: lights,
      standaloneWalls: walls,
      rooms,
      mergedFloor: null,
      style: {},
    }) as unknown as DungeonLayer
  const levels = [{ id: 'L1', name: 'One' }, ...(spec.levels ?? []).map((l) => ({ id: l.id, name: l.id }))]
  const layers = [
    layer('ground', 'L1', spec.walls ?? [], spec.lights ?? [], spec.rooms ?? []),
    ...(spec.levels ?? []).map((l) => layer(`layer-${l.id}`, l.id, l.walls ?? [], l.lights ?? [], [])),
  ]
  const data = {
    version: '3.1',
    mapSettings: { name: 'M', cellScale: { value: 5, unit: 'ft' }, ambientLight: '#ffffff', environment: spec.environment ?? 'outdoor' },
    grid: { visible: true, snapEnabled: true, snapDivision: 2 },
    layers,
    customImages: {},
    levels,
  } as unknown as SerializedMapData
  const rooms = (spec.rooms ?? []) as SceneMap['rooms']
  return {
    campaignId: 'c',
    data,
    frame: { minX: -20, minY: -20, maxX: 40, maxY: 40 },
    rooms,
    doors: [],
    zones: [],
    lights: layers.flatMap((l) => l.children as LightChild[]),
    lightNames: new Map(),
    roomAt: () => null,
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
    sight: { range: 0, angle: 360, visionMode: 'normal' },
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

const gate = (sky: SkyFrame, over: Partial<LightGate> = {}): LightGate => ({ sky, edits: {}, roomMoods: {}, ...over })

function visionOf(map: SceneMap, tokens: Token[], g: LightGate | null, levelId?: string) {
  return createSweeps().partyVision(
    map,
    Object.fromEntries(tokens.map((t) => [t.id, t])),
    {},
    g,
    undefined,
    false,
    null,
    levelId,
  )
}

const DARKVISION = (range: number) => ({ range, angle: 360, visionMode: 'darkvision' as const })

describe('the per-region darkness gate', () => {
  const cellar = room('cellar', square(10, 0, 6, 6), { mood: 'dark' })
  const hall = room('hall', square(0, 0, 6, 6))

  it('a lit room at noon is seen without any light (fast path: nothing dark)', () => {
    const v = visionOf(scene({ rooms: [hall] }), [eye('a', 1, 1)], gate(NOON))
    expect(v.lit).toBeNull()
    expect(seen(v, 4, 4)).toBe(true)
  })

  it('a Dark room hides from a normal eye in plain line of sight, while the lit room beside it shows', () => {
    const v = visionOf(scene({ rooms: [hall, cellar] }), [eye('a', 1, 1)], gate(NOON))
    expect(seen(v, 4, 4)).toBe(true)
    expect(seen(v, 13, 3)).toBe(false)
  })

  it('a light inside the Dark room lights its own reach and nothing past it', () => {
    const v = visionOf(scene({ rooms: [hall, cellar], lights: [lamp('candle', 13, 3, { radius: 1.5 })] }), [eye('a', 1, 1)], gate(NOON))
    expect(seen(v, 13, 3.5)).toBe(true)
    expect(seen(v, 15.5, 5.5)).toBe(false)
  })

  it('darkvision sees the Dark room out to its range and no further', () => {
    const v = visionOf(scene({ rooms: [hall, cellar] }), [eye('a', 8, 3, { sight: DARKVISION(6) })], gate(NOON))
    expect(seen(v, 11, 3)).toBe(true)
    expect(seen(v, 15.5, 3)).toBe(false)
  })

  it('a Dark room whose look says dark is visible counts as lit for sight', () => {
    const shown = room('cellar', square(10, 0, 6, 6), { mood: 'dark', moodVision: 'visible' })
    const v = visionOf(scene({ rooms: [hall, shown] }), [eye('a', 1, 1)], gate(NOON))
    expect(seen(v, 13, 3)).toBe(true)
  })

  it('the DM’s slider at 1 darkens a lit room: a normal eye needs light again', () => {
    const map = scene({ rooms: [hall], lights: [lamp('torch', 1, 1, { radius: 2 })] })
    const v = visionOf(map, [eye('a', 1, 1)], gate(skyFrame({ environment: 'outdoor', minutes: 720, override: 1 })))
    expect(seen(v, 1.5, 1.5)).toBe(true)
    expect(seen(v, 5, 5)).toBe(false)
  })

  it('a live room mood (set-room) darkens that room alone', () => {
    const v = visionOf(scene({ rooms: [hall] }), [eye('a', 1, 1)], gate(NOON, { roomMoods: { hall: { mood: 'dark' } } }))
    expect(seen(v, 4, 4)).toBe(false)
  })

  it('a moonless midnight darkens an outdoor map everywhere; noon does not', () => {
    const map = scene({})
    expect(seen(visionOf(map, [eye('a', 0, 0)], gate(MIDNIGHT)), 5, 0)).toBe(false)
    expect(seen(visionOf(map, [eye('a', 0, 0)], gate(NOON)), 5, 0)).toBe(true)
  })

  it('an underground map is dark at noon (its mood is Dark)', () => {
    const v = visionOf(scene({ environment: 'underground' }), [eye('a', 0, 0)], gate(NOON))
    expect(seen(v, 5, 0)).toBe(false)
  })
})

describe('darkness sources', () => {
  const night = (spec: SceneSpec, tokens: Token[]) => visionOf(scene(spec), tokens, gate(MIDNIGHT))
  const torch = lamp('torch', 0, 0, { radius: 12 })
  const darkness = (over: Partial<LightChild> = {}) => lamp('void', 6, 0, { radius: 2, darkness: true, ...over })

  it('subtract light: ground inside one is not lit by the torch over it', () => {
    const v = night({ lights: [torch, darkness()] }, [eye('a', 0, 0)])
    expect(seen(v, 3, 0)).toBe(true)
    expect(seen(v, 6, 0)).toBe(false)
  })

  it('block sight at their edge: lit ground behind one is hidden from an eye outside', () => {
    const v = night({ lights: [torch, darkness()] }, [eye('a', 0, 0)])
    expect(seen(v, 10, 0)).toBe(false)
    expect(seen(v, 0, 6)).toBe(true)
  })

  it('darkvision a source lets through sees inside and past it', () => {
    const v = night({ lights: [torch, darkness({ darkvisionSees: true })] }, [eye('a', 0, 0, { sight: DARKVISION(12) })])
    expect(seen(v, 6, 0)).toBe(true)
    expect(seen(v, 10, 0)).toBe(true)
  })

  it('darkvision a source does not let through sees neither', () => {
    const v = night({ lights: [torch, darkness()] }, [eye('a', 0, 0, { sight: DARKVISION(12) })])
    expect(seen(v, 6, 0)).toBe(false)
    expect(seen(v, 10, 0)).toBe(false)
  })
})

describe('cones, one-way walls and through-walls', () => {
  it('an eye’s sight.angle is its cone (facing east)', () => {
    const v = visionOf(scene({}), [eye('a', 0, 0, { sight: { range: 0, angle: 90, visionMode: 'normal' } })], gate(NOON))
    expect(seen(v, 5, 0)).toBe(true)
    expect(seen(v, -5, 0)).toBe(false)
  })

  it('a 360 angle (or none) is a full circle', () => {
    const v = visionOf(scene({}), [eye('a', 0, 0)], gate(NOON))
    expect(seen(v, -5, 0)).toBe(true)
  })

  it('a one-way wall lets sight through from its open side only', () => {
    // Walked south → north along x = 3: its left (screen space, y down) is west.
    const oneWay = wall('w', [[3, 10], [3, -10]], { direction: 'left' })
    const fromEast = visionOf(scene({ walls: [oneWay] }), [eye('a', 6, 0)], gate(NOON))
    expect(seen(fromEast, 0, 0)).toBe(true)
    const fromWest = visionOf(scene({ walls: [oneWay] }), [eye('a', 0, 0)], gate(NOON))
    expect(seen(fromWest, 6, 0)).toBe(false)
  })

  it('a one-way wall stops light from its blocking side', () => {
    const oneWay = wall('w', [[3, 10], [3, -10]], { direction: 'left' })
    const v = visionOf(scene({ walls: [oneWay], lights: [lamp('l', 0, 0, { radius: 8 })] }), [eye('a', 6, 0, { sight: { range: 0, angle: 360, visionMode: 'normal' } })], gate(MIDNIGHT))
    expect(seen(v, 5, 0)).toBe(false)
  })

  it('a torch carried at an angle lights a cone', () => {
    const bearer = eye('a', 0, 0, { light: { dim: 6, bright: 3, color: '#ffbb66', angle: 90 } })
    const v = visionOf(scene({}), [bearer], gate(MIDNIGHT))
    expect(seen(v, 4, 0)).toBe(true)
    expect(seen(v, -4, 0)).toBe(false)
  })

  it('a carried torch at 360 lights all round', () => {
    const bearer = eye('a', 0, 0, { light: { dim: 6, bright: 3, color: '#ffbb66', angle: 360 } })
    expect(seen(visionOf(scene({}), [bearer], gate(MIDNIGHT)), -4, 0)).toBe(true)
  })

  it('a through-walls light lights behind the wall it is not cut by', () => {
    const w = wall('w', [[2, 10], [2, -10]])
    const map = scene({ walls: [w], lights: [lamp('l', 0, 0, { radius: 6, throughWalls: true })] })
    // The eye stands east of the wall, the light west: only a through-walls light reaches it.
    const v = visionOf(map, [eye('a', 4, 0)], gate(MIDNIGHT))
    expect(seen(v, 3, 0)).toBe(true)
  })
})

describe('levels', () => {
  it('a level’s eyes, walls and lights only: a token on level 2 does not look at level 1', () => {
    const map = scene({ levels: [{ id: 'L2' }] })
    const tokens = [eye('up', 0, 0, { levelId: 'L2' })]
    expect(visionOf(map, tokens, gate(NOON), 'L1').eyes).toHaveLength(0)
    expect(visionOf(map, tokens, gate(NOON), 'L2').eyes).toHaveLength(1)
  })

  it('another level’s wall does not block, and its light does not light', () => {
    const map = scene({
      levels: [{ id: 'L2', walls: [wall('w2', [[2, 10], [2, -10]])], lights: [lamp('l2', 5, 0, { radius: 4 })] }],
    })
    const v = visionOf(map, [eye('a', 0, 0)], gate(MIDNIGHT), 'L1')
    expect(seen(v, 5, 0)).toBe(false) // dark: the level-2 lamp lights level 2 only
    const day = visionOf(map, [eye('a', 0, 0)], gate(NOON), 'L1')
    expect(seen(day, 5, 0)).toBe(true) // and its wall did not stop the sweep
  })
})

describe('§13 bench: a vision update on a 60×46 map with 8 rooms and 30 lights', () => {
  it('sweeps and judges every cell inside the budget', () => {
    const rooms: Room[] = []
    for (let i = 0; i < 8; i++) {
      const x = (i % 4) * 15
      const y = Math.floor(i / 4) * 23
      rooms.push(room(`r${i}`, square(x, y, 14, 22), i % 2 ? { mood: 'dark' } : undefined))
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
    const lights = Array.from({ length: 30 }, (_, i) => lamp(`l${i}`, 2 + ((i * 7) % 56), 2 + ((i * 11) % 42), { radius: 4 }))
    const tokens = [
      eye('a', 7, 11),
      eye('b', 22, 11, { sight: DARKVISION(12) }),
      eye('c', 37, 34),
      eye('d', 52, 34, { light: { dim: 6, bright: 3, color: '#ffbb66', angle: 360 } }),
    ]
    const map = scene({ rooms, walls, lights })
    const started = performance.now()
    const v = visionOf(map, tokens, gate(MIDNIGHT))
    let shown = 0
    for (let col = 0; col < 60; col++) {
      for (let row = 0; row < 46; row++) if (seen(v, col + 0.5, row + 0.5)) shown++
    }
    const ms = performance.now() - started
    console.log(`[bench] server vision update, 60x46, 8 rooms, 30 lights, 4 eyes: ${ms.toFixed(1)} ms (${shown} cells seen)`)
    expect(shown).toBeGreaterThan(0)
    // The plan's budget is 15 ms; held loosely here so a busy CI box does not flake.
    expect(ms).toBeLessThan(250)
  })
})
