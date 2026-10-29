// Props at the table: the keys a prop carries beyond its art (opacity, overhead, lock and the
// behaviour fields) are map information like the art itself. The player's copy filters props
// by where they stand and never rebuilds one, so whatever the DM authored reaches the table
// as authored. These pin that, for a zoned layer and for an unzoned one.

import { describe, expect, it } from 'vitest'
import type { SceneFog } from '@dnd/mechanics/fog'
import type { AnyChild, Room } from '@dnd/core/src/shared/types'
import type { DungeonLayer, SerializedMapData } from '@dnd/core/src/store/types'
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

/** Every key a prop can carry, the new ones set away from their defaults. */
const prop = (id: string, x: number, y: number): AnyChild =>
  ({
    id,
    name: id,
    childType: 'asset',
    visible: true,
    objectType: 'asset',
    assetId: 'gg-demo:spider_web_3x2_object_A',
    position: { x, y },
    rotation: 0.25,
    scale: 1,
    width: 4,
    height: 3,
    tint: '#c04040',
    flipX: true,
    flipY: false,
    opacity: 0.8,
    overhead: true,
    locked: true,
    castsShadow: false,
    blocksLight: true,
    blocksMovement: true,
    glows: true,
  }) as AnyChild

const SCENE = 'scene-props'

function mapFile(zoned: boolean): SerializedMapData {
  const layer = {
    id: 'layer-1',
    name: 'Crypt',
    type: 'dungeon',
    levelId: 'level-1',
    visible: true,
    locked: false,
    opacity: 1,
    children: [prop('prop-hall', 5, 5), prop('prop-vault', 35, 5)],
    standaloneWalls: [],
    mergedFloor: [rect(0, 0, 40, 10)],
    style: {},
    sublayerVisibility: { floor: true, grid: true, walls: true },
    rooms: zoned ? [room('hall', 0, 0, 10, 10), room('vault', 30, 0, 40, 10)] : [],
  } as unknown as DungeonLayer
  return {
    version: '3.1',
    mapSettings: { name: 'Crypt' } as SerializedMapData['mapSettings'],
    grid: { visible: true, snapDivision: 1, style: 'clean' } as SerializedMapData['grid'],
    layers: [layer],
    customImages: {},
  }
}

/** The hall seen, the vault never. */
const FOG: SceneFog = { rooms: { hall: { status: 'revealed', wasEverRevealed: true } }, concealBehindDoors: true }

function playerCopy(zoned: boolean): AnyChild[] {
  const stores = createStores(openDb(':memory:'))
  const campaign = stores.campaigns.create('Crypt')
  stores.maps.insert(SCENE, campaign.id, 'Crypt', JSON.stringify(mapFile(zoned)))
  stores.scenes.create(SCENE, campaign.id, SCENE, 'Crypt')
  const scene = createSceneMaps(stores).sceneMapOf(SCENE)!
  return (redactMapForViewer(scene, FOG, {}).layers[0] as DungeonLayer).children
}

describe('a prop on the player’s copy of the map', () => {
  it('reaches an explored room with every key as authored, and stays out of an unexplored one', () => {
    const children = playerCopy(true)
    expect(children.find((c) => c.id === 'prop-hall')).toEqual(prop('prop-hall', 5, 5))
    expect(children.map((c) => c.id)).not.toContain('prop-vault')
  })

  it('goes over whole on a layer nobody zoned', () => {
    const children = playerCopy(false)
    expect(children).toEqual([prop('prop-hall', 5, 5), prop('prop-vault', 35, 5)])
  })
})
