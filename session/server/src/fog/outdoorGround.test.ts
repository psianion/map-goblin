// R2 (rca-live.md): outdoor ground is outside every zoned walled floor and cave outline, so the gap
// between a cave's rooms and its rock is never Outdoors, while a floor nobody zoned still is.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { SerializedMapData } from '@dnd/core/src/store/types'
import { openDb } from '../db/db'
import { createStores } from '../db/stores'
import { ensureClipperReady } from './clipperBoot'
import { enclosedOn, enclosureRings } from './outdoorGround'
import { createSceneMaps, isDungeon, type SceneMap } from './sceneMap'

beforeAll(async () => {
  expect(await ensureClipperReady()).toBe(true)
}, 30_000)

const read = (name: string): string => readFileSync(join(import.meta.dirname, '../../../testdata', name), 'utf8')

function sceneOf(map: string): SceneMap {
  const stores = createStores(openDb(':memory:'))
  const campaign = stores.campaigns.create('Ground')
  stores.maps.insert('s', campaign.id, 'Ground', map)
  stores.scenes.create('s', campaign.id, 's', 'Ground')
  return createSceneMaps(stores).sceneMapOf('s')!
}

const LEVEL = '2993b681-e620-42dd-a2bf-845a8bd99eea'

describe('enclosedOn', () => {
  it('takes the gap between a cave’s rooms and its rock out of Outdoors', () => {
    const scene = sceneOf(read('testing-cave.ggvtt'))
    const enclosed = enclosedOn(scene, LEVEL)
    // Cell centres in no room but inside the cave's outline: the rock gap rooms are inset by.
    let gaps = 0
    for (let y = 0.25; y < 30; y += 0.5) {
      for (let x = 0.25; x < 30; x += 0.5) if (scene.roomAt(x, y) === null && enclosed(x, y)) gaps++
    }
    expect(enclosureRings(scene, LEVEL)).toHaveLength(1)
    expect(gaps).toBeGreaterThan(0)
    // Outside the cave is open ground, and so is the mouth's apron.
    expect(enclosed(15.5, 25.5)).toBe(false)
    expect(enclosed(2, 2)).toBe(false)
  })

  it('leaves a cave nobody zoned in Outdoors, and takes it out once a room is anchored in it', () => {
    expect(enclosedOn(sceneOf(read('outdoor-cave.ggvtt')), 'lvl-1')(22, 9)).toBe(false)
    const map = JSON.parse(read('outdoor-cave.ggvtt')) as SerializedMapData
    map.layers.find(isDungeon)!.rooms!.push({ id: 'room-cave', name: 'Cave', anchor: [22, 9] })
    const zoned = enclosedOn(sceneOf(JSON.stringify(map)), 'lvl-1')
    expect(zoned(22, 9)).toBe(true)
    expect(zoned(8, 7)).toBe(true)
    expect(zoned(15.5, 9.5)).toBe(false)
  })

  it('falls back to the floor shapes when the layer has no union', () => {
    const map = JSON.parse(read('outdoor-cave.ggvtt')) as SerializedMapData
    const scene = sceneOf(JSON.stringify(map))
    const layer = scene.data.layers.find(isDungeon)!
    const healed = layer.mergedFloor
    layer.mergedFloor = null
    try {
      const fresh = { ...scene }
      expect(enclosedOn(fresh, 'lvl-1')(8, 7)).toBe(true)
      expect(enclosedOn(fresh, 'lvl-1')(15.5, 9.5)).toBe(false)
    } finally {
      layer.mergedFloor = healed
    }
  })
})
