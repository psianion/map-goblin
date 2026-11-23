// The fog rework's two-level map: a cellar and a loft whose rooms overlap on the grid. The cell
// record is kept per level because of maps like this one, so its shape is pinned here.
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

const TWO_LEVELS = readFileSync(join(import.meta.dirname, '../../testdata/two-levels.ggvtt'), 'utf8')

describe('two-levels.ggvtt', () => {
  it('loads unmigrated at 3.11 with two levels', () => {
    const parsed = parseMapFile(TWO_LEVELS)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.migrated).toBe(false)
    expect(parsed.data.levels?.map((l) => l.id)).toEqual(['lvl-low', 'lvl-high'])
  })

  it('has one room per level, and the two overlap', () => {
    const stores = createStores(openDb(':memory:'))
    const campaign = stores.campaigns.create('Fixture')
    stores.maps.insert('scene-two', campaign.id, 'Two Levels', TWO_LEVELS)
    stores.scenes.create('scene-two', campaign.id, 'scene-two', 'Two Levels')
    const map = createSceneMaps(stores).sceneMapOf('scene-two')!
    expect(map.rooms.map((r) => r.id)).toEqual(['room-cellar', 'room-loft'])
    expect(map.roomAt(4, 6)).toBe('room-cellar')
    expect(map.roomAt(14, 6)).toBe('room-loft')
    // Both rooms cover the middle; a lookup that takes no level can only name one of them.
    expect(['room-cellar', 'room-loft']).toContain(map.roomAt(9, 6))
    expect(map.frame).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 14 })
  })
})
