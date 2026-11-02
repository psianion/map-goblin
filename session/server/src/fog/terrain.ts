// The ground the tokens module stands tokens on (plan §7): a point's height off the scene's
// plateaus, and whether a player's move crosses a raised edge whose crossing kind refuses it,
// with the DM's live overrides from the crossings module. Pure reads of the parsed map; the
// geometry is core's (`shared/plateaus.ts`), the same the table's drag preview runs.

// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the plateau model is pure
import { crossingsAlongLayers, elevationAtLayers } from '@dnd/core/src/shared/plateaus'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design, as above
import { defaultCrossingKinds } from '@dnd/core/src/shared/crossingKinds'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the Lighting pass's level rules
import { firstLevelId, layersOnLevel } from '@dnd/core/src/shared/visionGate'
import { crossingRefusalMessage, sceneCrossings, type CrossingsState } from '@dnd/mechanics/crossings'
import type { TerrainOf } from '@dnd/mechanics/tokens'
import type { SceneMapOf } from './sceneMap'

export function createTerrain(
  sceneMapOf: SceneMapOf,
  crossingsOf: (campaignId: string) => CrossingsState | undefined,
): TerrainOf {
  return (sceneId) => {
    const map = sceneMapOf(sceneId)
    if (!map) return null
    const layersAt = (levelId?: string) => layersOnLevel(map.data, map.data.layers, levelId || firstLevelId(map.data))
    return {
      elevationAt: (x, y, levelId) => elevationAtLayers(layersAt(levelId), x, y),
      crossingRefusal: (from, to, levelId) => {
        const kinds = map.data.mapSettings.crossingKinds ?? defaultCrossingKinds()
        const live = sceneCrossings(crossingsOf(map.campaignId), sceneId)
        const blocked = crossingsAlongLayers(layersAt(levelId), [from.x, from.y], [to.x, to.y], kinds, live).find(
          (c) => c.blocks,
        )
        if (!blocked) return null
        return crossingRefusalMessage(blocked.kind ?? { id: blocked.kindId, name: blocked.kindId })
      },
    }
  }
}
