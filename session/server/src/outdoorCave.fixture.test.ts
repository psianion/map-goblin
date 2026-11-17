// The table fix pass's acceptance map: a current-format (3.11) file with base ground, one walled
// room, one door from that room to the outside, a cave whose rock has one mouth, and a party
// start. Every rule test and the browser acceptance spec stand on it, so its shape is pinned here.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { openDb } from './db/db'
import { createStores } from './db/stores'
import { ensureClipperReady } from './fog/clipperBoot'
import { createSceneMaps } from './fog/sceneMap'
import { parseMapFile } from './mapImport'

beforeAll(async () => {
  expect(await ensureClipperReady()).toBe(true)
}, 30_000)

const OUTDOOR_CAVE = readFileSync(join(import.meta.dirname, '../../testdata/outdoor-cave.ggvtt'), 'utf8')

describe('outdoor-cave.ggvtt', () => {
  it('loads unmigrated at 3.11 and keeps its party start', () => {
    const parsed = parseMapFile(OUTDOOR_CAVE)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.migrated).toBe(false)
    expect(parsed.data.version).toBe('3.11')
    expect(parsed.data.mapSettings.partyStart).toEqual({ x: 15.5, y: 7.5, levelId: 'lvl-1' })
    expect(parsed.data.mapSettings.ground?.textureId).toBeTruthy()
  })

  it('has one room, one outside door and one cave mouth', () => {
    const stores = createStores(openDb(':memory:'))
    const campaign = stores.campaigns.create('Fixture')
    stores.maps.insert('scene-cave', campaign.id, 'Outdoor Cave', OUTDOOR_CAVE)
    stores.scenes.create('scene-cave', campaign.id, 'scene-cave', 'Outdoor Cave')
    const map = createSceneMaps(stores).sceneMapOf('scene-cave')!
    expect(map.rooms.map((r) => r.id)).toEqual(['room-hall'])
    expect(map.roomAt(8, 7)).toBe('room-hall')
    expect(map.roomAt(15.5, 7.5)).toBeNull()
    expect(map.doors.map((d) => [d.id, d.roomA, d.roomB])).toEqual([['door-hall', 'room-hall', null]])
    const layer = map.data.layers.find((l) => l.type === 'dungeon')
    expect(layer && 'caveOpenings' in layer ? layer.caveOpenings : []).toHaveLength(1)
    expect(map.frame).toEqual({ minX: 0, minY: 0, maxX: 30, maxY: 20 })
  })
})
