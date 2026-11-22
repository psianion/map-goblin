// Table fix pass §2.3, tests 6.1 rows 1 to 6: solid things decide where a player's token may
// stand and walk, on the outdoor-cave fixture (base ground, one walled room with a door to the
// outside, a cave whose rock has one mouth).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { rebaseRegion, setCells, type FogState, type SceneFog } from '@dnd/mechanics/fog'
import { CROSSING_BLOCKED } from '@dnd/mechanics/crossings'
import type { DoorsState } from '@dnd/mechanics/doors'
import { MOVE_BLOCKED, SOLID_GROUND, OUTSIDE_MAP, ROOM_UNEXPLORED, type Token, type TokensState } from '@dnd/mechanics/tokens'
import { openDb } from '../db/db'
import { createStores } from '../db/stores'
import { ensureClipperReady } from './clipperBoot'
import type { SceneMap } from './sceneMap'
import { createVision } from './vision'

beforeAll(async () => {
  expect(await ensureClipperReady()).toBe(true)
}, 30_000)

const MAP = readFileSync(join(import.meta.dirname, '../../../testdata/outdoor-cave.ggvtt'), 'utf8')
const SCENE = 'scene-cave'
const PLAYER = { role: 'player' as const, identityId: 'p-1' }
/** A table with fog off (the walk grid alone decides), or the fog `fog` makes of the map. */
function table(map = MAP, fog?: (scene: SceneMap) => SceneFog, doors?: DoorsState) {
  const stores = createStores(openDb(':memory:'))
  const campaign = stores.campaigns.create('Cave')
  stores.maps.insert(SCENE, campaign.id, 'Outdoor Cave', map)
  stores.scenes.create(SCENE, campaign.id, SCENE, 'Outdoor Cave')
  if (doors) stores.moduleState.put(campaign.id, 'doors', doors)
  const pc = { id: 'pc', name: 'Bram', size: 'medium', x: 15.5, y: 7.5, ownerId: 'p-1', hidden: false } as Token
  stores.moduleState.put(campaign.id, 'tokens', { library: {}, byScene: { [SCENE]: { pc } } } satisfies TokensState)
  const vision = createVision(stores)
  if (fog) stores.moduleState.put(campaign.id, 'fog', { byScene: { [SCENE]: fog(vision.sceneMapOf(SCENE)!) } } satisfies FogState)
  const walk = (from: { x: number; y: number }, to: { x: number; y: number }) =>
    vision.visionOf(SCENE, PLAYER)!.walkRefusal!({ ...pc, ...from }, to, from)
  return { walk }
}

/** The fixture with one more ring on its layer: a plateau of the given outline. */
function withPlateau(contour: [number, number][]): string {
  const map = JSON.parse(MAP)
  const layer = map.layers.find((l: { type: string }) => l.type === 'dungeon')
  layer.children.push({
    id: 'ridge',
    name: 'Ridge',
    childType: 'plateau',
    visible: true,
    contours: [contour],
    height: 3,
    edge: 'cliff',
    crossingId: 'impassable',
  })
  return JSON.stringify(map)
}

describe('stand and move (§2.3)', () => {
  it('1: stands on base ground outside every room', () => {
    const { walk } = table()
    expect(walk({ x: 15.5, y: 7.5 }, { x: 15.5, y: 12.5 })).toBeNull()
    expect(walk({ x: 15.5, y: 7.5 }, { x: 2.5, y: 17.5 })).toBeNull()
  })

  it('with fog on, walks over cleared ground only, and refuses the frame’s outside (row 11)', () => {
    // Three cells cleared under and below the token, nothing else.
    const strip = (scene: SceneMap): SceneFog => {
      const frame = scene.frame!
      const at = (x: number, y: number): [number, number] => [Math.floor(x - frame.minX), Math.floor(y - frame.minY)]
      const cleared = setCells(rebaseRegion(undefined, frame)!, [at(15.5, 7.5), at(15.5, 8.5), at(15.5, 9.5)])
      return { rooms: {}, concealBehindDoors: true, on: true, cleared: { 'lvl-1': cleared } }
    }
    const { walk } = table(MAP, strip)
    expect(walk({ x: 15.5, y: 7.5 }, { x: 15.5, y: 9.5 })).toBeNull()
    expect(walk({ x: 15.5, y: 7.5 }, { x: 15.5, y: 12.5 })).toMatch(new RegExp(`^${ROOM_UNEXPLORED}`))
    expect(walk({ x: 15.5, y: 7.5 }, { x: 31.5, y: 7.5 })).toMatch(new RegExp(`^${OUTSIDE_MAP}`))
  })

  it('2: refuses rock, by cell — the cave’s rock fills the cell outside its edge, not the one in', () => {
    const { walk } = table()
    expect(walk({ x: 15.5, y: 7.5 }, { x: 17.5, y: 5.5 })).toMatch(new RegExp(`^${SOLID_GROUND}`))
    expect(walk({ x: 15.5, y: 7.5 }, { x: 16.5, y: 5.5 })).toBeNull()
  })

  it('S4: refuses the floor-side cell the rock is drawn over, wider than a stone wall would reach', () => {
    // The cave's rock is 1.2 wide: drawn 0.6 into the floor, so the cell centre 0.5 in is rock.
    const { walk } = table()
    expect(walk({ x: 22.5, y: 6.5 }, { x: 18.5, y: 5.5 })).toMatch(new RegExp(`^${SOLID_GROUND}`))
    expect(walk({ x: 22.5, y: 6.5 }, { x: 19.5, y: 5.5 })).toBeNull()
  })

  it('walks into the cave through its mouth, with no door', () => {
    const { walk } = table()
    expect(walk({ x: 15.5, y: 9.5 }, { x: 22.5, y: 6.5 })).toBeNull()
  })

  it('3: refuses a move through a wall into a known room, naming the shut door', () => {
    const { walk } = table()
    expect(walk({ x: 13.5, y: 5.5 }, { x: 11.5, y: 5.5 })).toBe('door-closed door-hall: that space cannot be occupied')
  })

  it('4: allows the same move round through the door once it is open', () => {
    const { walk } = table(MAP, undefined, { byScene: { [SCENE]: { 'door-hall': { open: true, locked: false, revealed: true } } } })
    expect(walk({ x: 13.5, y: 5.5 }, { x: 11.5, y: 5.5 })).toBeNull()
  })

  it('5: names a shut door several steps away, and says locked when it is', () => {
    const { walk } = table(MAP, undefined, { byScene: { [SCENE]: { 'door-hall': { open: false, locked: true, revealed: true } } } })
    expect(walk({ x: 22.5, y: 6.5 }, { x: 6.5, y: 8.5 })).toBe('door-locked door-hall: that space cannot be occupied')
  })

  it('6: a refusing cliff refuses when there is no way round, and allows a path round it', () => {
    const wall = table(withPlateau([[14, 0], [15, 0], [15, 20], [14, 20]]))
    expect(wall.walk({ x: 13.5, y: 15.5 }, { x: 15.5, y: 15.5 })).toMatch(new RegExp(`^${CROSSING_BLOCKED} impassable`))
    const short = table(withPlateau([[14, 12], [15, 12], [15, 19], [14, 19]]))
    expect(short.walk({ x: 13.5, y: 15.5 }, { x: 15.5, y: 15.5 })).toBeNull()
  })

  it('says blocked, naming nothing, when the only way in is a secret door nobody found', () => {
    const map = JSON.parse(MAP)
    const layer = map.layers.find((l: { type: string }) => l.type === 'dungeon')
    layer.children.find((c: { id: string }) => c.id === 'door-hall').isSecret = true
    const { walk } = table(JSON.stringify(map))
    expect(walk({ x: 13.5, y: 5.5 }, { x: 11.5, y: 5.5 })).toMatch(new RegExp(`^${MOVE_BLOCKED}:`))
  })
})
