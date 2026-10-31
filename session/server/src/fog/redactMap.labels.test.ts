// Labels at the table: a label is the DM's unless it is marked visible to players. A player
// seat's copy keeps only the marked ones (and those still by the room they stand in); the DM
// seat reads the document whole.

import { describe, expect, it } from 'vitest'
import type { SceneFog } from '@dnd/mechanics/fog'
import type { AnyChild, Room } from '@dnd/core/src/shared/types'
import type { DungeonLayer, SerializedMapData } from '@dnd/core/src/store/types'
import { openDb } from '../db/db'
import { createStores } from '../db/stores'
import { keptChildIds, redactMapForViewer } from './redactMap'
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

const label = (id: string, x: number, players?: true): AnyChild =>
  ({
    id,
    name: id,
    childType: 'text',
    visible: true,
    text: id,
    position: { x, y: 5 },
    rotation: 0,
    scale: 1,
    fontSize: 0.8,
    color: '#1b1b1b',
    width: 3,
    height: 1,
    ...(players ? { players } : {}),
  }) as AnyChild

const SCENE = 'scene-labels'

function mapFile(zoned: boolean): SerializedMapData {
  const layer = {
    id: 'layer-1',
    name: 'Crypt',
    type: 'dungeon',
    levelId: 'level-1',
    visible: true,
    locked: false,
    opacity: 1,
    children: [label('gm-note', 4), label('hall-name', 6, true), label('vault-name', 35, true)],
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

function scene(zoned: boolean) {
  const stores = createStores(openDb(':memory:'))
  const campaign = stores.campaigns.create('Crypt')
  stores.maps.insert(SCENE, campaign.id, 'Crypt', JSON.stringify(mapFile(zoned)))
  stores.scenes.create(SCENE, campaign.id, SCENE, 'Crypt')
  return createSceneMaps(stores).sceneMapOf(SCENE)!
}

const ids = (children: AnyChild[]) => children.filter((c) => c.childType === 'text').map((c) => c.id)

describe('labels on the player’s copy of the map', () => {
  it('drops a DM-only label even in a room the party has explored, on the fetch and the delta lane', () => {
    const s = scene(true)
    const children = (redactMapForViewer(s, FOG, {}).layers[0] as DungeonLayer).children
    expect(ids(children)).not.toContain('gm-note')
    expect(keptChildIds(s, FOG, {}).has('gm-note')).toBe(false)
  })

  it('keeps a label marked for players in an explored room, and still not one in an unexplored room', () => {
    const children = (redactMapForViewer(scene(true), FOG, {}).layers[0] as DungeonLayer).children
    expect(ids(children)).toEqual(['hall-name'])
    // On a layer nobody zoned, the marked ones go over whole and the DM-only one stays home.
    const unzoned = (redactMapForViewer(scene(false), FOG, {}).layers[0] as DungeonLayer).children
    expect(ids(unzoned)).toEqual(['hall-name', 'vault-name'])
  })

  it('leaves the DM seat’s document whole', () => {
    // The DM is served the document as stored (http.ts); the scene map reads that same file.
    const children = (scene(true).data.layers[0] as DungeonLayer).children
    expect(ids(children)).toEqual(['gm-note', 'hall-name', 'vault-name'])
  })
})
