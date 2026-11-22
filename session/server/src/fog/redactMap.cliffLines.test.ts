// A plateau cliff's own rock line at the table: a player gets it with the rooms it lies by, as a
// wall's line goes, and the DM's copy keeps every one.

import { describe, expect, it } from 'vitest'
import type { SceneFog } from '@dnd/mechanics/fog'
import type { Room } from '@dnd/core/src/shared/types'
import type { DungeonLayer, RockLine, SerializedMapData } from '@dnd/core/src/store/types'
import { openDb } from '../db/db'
import { createStores } from '../db/stores'
import { redactMapForViewer } from './redactMap'
import { createSceneMaps } from './sceneMap'

const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
]

const room = (id: string, x0: number, y0: number, x1: number, y1: number): Room => ({
  id,
  name: id,
  anchor: [(x0 + x1) / 2, (y0 + y1) / 2],
  boundary: rect(x0, y0, x1, y1),
  centroid: [(x0 + x1) / 2, (y0 + y1) / 2],
  area: (x1 - x0) * (y1 - y0),
  isPathway: false,
})

/** A plateau's cliff line inside the room from `x0` to `x0 + 10`. */
const cliff = (x0: number): RockLine => ({
  kind: 'cliff',
  edge: rect(x0 + 2, 2, x0 + 6, 6),
  closed: true,
  runs: [[[x0 + 2.4, 2], [x0 + 6, 2.2], [x0 + 6, 6], [x0 + 2, 6], [x0 + 2.4, 2]]],
})

const SCENE = 'scene-cliff'

function scene() {
  const layer = {
    id: 'layer-1',
    name: 'Caves',
    type: 'dungeon',
    levelId: 'level-1',
    visible: true,
    locked: false,
    opacity: 1,
    children: [],
    standaloneWalls: [],
    mergedFloor: [rect(0, 0, 10, 10), rect(30, 0, 40, 10)],
    style: {},
    sublayerVisibility: { floor: true, grid: true, walls: true },
    rooms: [room('hall', 0, 0, 10, 10), room('vault', 30, 0, 40, 10)],
    rockLines: [cliff(0), cliff(30)],
  } as unknown as DungeonLayer
  const data: SerializedMapData = {
    version: '3.1',
    mapSettings: { name: 'Caves' } as SerializedMapData['mapSettings'],
    grid: { visible: true, snapDivision: 1, style: 'clean' } as SerializedMapData['grid'],
    layers: [layer],
    customImages: {},
  }
  const stores = createStores(openDb(':memory:'))
  const campaign = stores.campaigns.create('Caves')
  stores.maps.insert(SCENE, campaign.id, 'Caves', JSON.stringify(data))
  stores.scenes.create(SCENE, campaign.id, SCENE, 'Caves')
  return createSceneMaps(stores).sceneMapOf(SCENE)!
}

const FOG: SceneFog = { rooms: { hall: { status: 'revealed', wasEverRevealed: true } }, concealBehindDoors: true }

describe('a cliff line on the player’s copy of the map', () => {
  it('keeps the cliff line by the revealed room and drops the far one', () => {
    const s = scene()
    const player = redactMapForViewer(s, FOG, {}).layers[0] as DungeonLayer
    expect(player.rockLines).toEqual([cliff(0)])
    expect((s.data.layers[0] as DungeonLayer).rockLines).toEqual([cliff(0), cliff(30)])
  })
})
