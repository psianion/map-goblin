// Plateaus at the table are relief, like terrain: they ship to a player with their layer
// whatever the fog, so the player's copy reads the same heights and edges as the DM's.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SceneFog } from '@dnd/mechanics/fog'
import type { DungeonLayer, SerializedMapData } from '@dnd/core/src/store/types'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the plateau model is pure, as fog/terrain.ts reads it
import { crossingsAlongLayers, elevationAtLayers, hiddenTops } from '@dnd/core/src/shared/plateaus'
import { openDb } from '../db/db'
import { createStores } from '../db/stores'
import { redactMapForViewer } from './redactMap'
import { createSceneMaps } from './sceneMap'

const SCENE = 'scene-plateaus'

function scene(file: string) {
  const data = readFileSync(join(import.meta.dirname, '../../../testdata', `${file}.mapbuilder`), 'utf8')
  const stores = createStores(openDb(':memory:'))
  const campaign = stores.campaigns.create('Plateaus')
  stores.maps.insert(SCENE, campaign.id, file, data)
  stores.scenes.create(SCENE, campaign.id, SCENE, file)
  return createSceneMaps(stores).sceneMapOf(SCENE)!
}

const dungeons = (data: SerializedMapData) => data.layers.filter((l): l is DungeonLayer => l.type === 'dungeon')
const plateauIds = (data: SerializedMapData) =>
  dungeons(data).flatMap((l) => l.children.filter((c) => c.childType === 'plateau' || c.childType === 'opening').map((c) => c.id))

/** Nothing seen: the player's copy is as bare as fog makes it. */
const DARK: SceneFog = { rooms: {}, concealBehindDoors: true }

describe('plateaus on the player’s copy of the map', () => {
  for (const file of ['plateau-test', 'plateau-table', 'tower-test']) {
    it(`ships every plateau and opening of ${file}, and the player reads the DM’s heights and edges`, () => {
      const s = scene(file)
      const dm = s.data
      const player = redactMapForViewer(s, DARK, {})
      expect(plateauIds(player)).toEqual(plateauIds(dm))
      expect(plateauIds(dm).length).toBeGreaterThan(0)
      const kinds = dm.mapSettings.crossingKinds ?? []
      const dmLayers = dungeons(dm)
      const playerLayers = dungeons(player)
      let probed = 0
      for (let y = -0.5; y <= 40; y += 0.75) {
        for (let x = -0.5; x <= 40; x += 0.75) {
          for (const levelId of new Set(dmLayers.map((l) => l.levelId))) {
            const on = (ls: DungeonLayer[]) => ls.filter((l) => l.levelId === levelId)
            expect(elevationAtLayers(on(playerLayers), x, y), `${file} (${x}, ${y})`).toBe(elevationAtLayers(on(dmLayers), x, y))
            probed++
          }
        }
      }
      expect(probed).toBeGreaterThan(2000)
      // Moves across the map cross the same edges for both.
      const strip = (ls: DungeonLayer[]) =>
        [
          ...crossingsAlongLayers(ls, [0.5, 7.5], [39.5, 7.5], kinds),
          ...crossingsAlongLayers(ls, [22, 0.5], [22, 39.5], kinds),
        ].map((c) => `${c.targetId}:${c.kindId}:${c.down}`)
      expect(strip(playerLayers)).toEqual(strip(dmLayers))
      expect(playerLayers.flatMap((l) => hiddenTops(l, dm.mapSettings.sightDropCells)).length).toBe(
        dmLayers.flatMap((l) => hiddenTops(l, dm.mapSettings.sightDropCells)).length,
      )
    })
  }
})
