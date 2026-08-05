// The server-side half of M4: turns a DM's authored `ScenePrep` (zone ids, light ids) into
// the `ResolvedPrep` the triggers module actually evaluates (room ids, shape geometry), and
// answers the module's other two questions — who is on the scene, and what has it explored
// — from the same stores fog/vision already read.
//
// Deliberately thin: every read here is fresh (`stores`/`sceneMapOf` are the sources of
// truth already used elsewhere), so this module caches nothing of its own.

import { sceneFogOf, type FogState } from '@dnd/mechanics/fog'
import type { TokensState } from '@dnd/mechanics/tokens'
import type { ResolvedTrigger, TriggerDeps, TriggerToken } from '@dnd/mechanics/triggers'
import type { ScenePrep, TriggerDef } from '@dnd/core/src/shared/prep'
import type { Stores } from '../db/stores'
import { exploredRooms } from '../fog/redactMap'
import type { SceneMap, SceneMapOf } from '../fog/sceneMap'

const NO_FOG: FogState = { byScene: {} }
const NO_TOKENS: TokensState = { library: {}, byScene: {} }

/** Wires `triggersModule`'s three dependencies against the server's own stores. */
export function createTriggerDeps(
  stores: Stores,
  sceneMapOf: SceneMapOf,
): Pick<TriggerDeps, 'prepOf' | 'tokensOf' | 'exploredOf'> {
  return {
    // Fresh every call, per TriggerDeps' contract: prep PUTs are quiet (http.ts), so there
    // is no revision to cache against.
    prepOf(campaignId, sceneId) {
      const scene = stores.scenes.get(sceneId)
      if (!scene || scene.campaign_id !== campaignId || !scene.prep) return null
      const prep = JSON.parse(scene.prep) as ScenePrep
      const map = sceneMapOf(sceneId)
      return { triggers: prep.triggers.map((def) => resolveTrigger(def, map)) }
    },

    tokensOf(campaignId, sceneId) {
      const byScene = (stores.moduleState.get(campaignId, 'tokens') as TokensState | undefined) ?? NO_TOKENS
      const tokens = byScene.byScene[sceneId] ?? {}
      const out: Record<string, TriggerToken> = {}
      for (const [id, t] of Object.entries(tokens)) {
        out[id] = { id: t.id, x: t.x, y: t.y, ownerId: t.ownerId, hidden: t.hidden }
      }
      return out
    },

    // The same computation vision.ts uses for the player-held map, on the module state
    // fog itself was last written with — not vision's cache, which is also keyed on
    // tokens/doors and would recompute more than this needs.
    exploredOf(campaignId, sceneId) {
      const fog = (stores.moduleState.get(campaignId, 'fog') as FogState | undefined) ?? NO_FOG
      return [...exploredRooms(sceneFogOf(fog, sceneId))]
    },
  }
}

/**
 * One authored trigger, resolved against the map doc its zone lives on. `inert` is set (and
 * `roomId`/`shape` left absent) the moment anything it names no longer checks out — a
 * deleted zone, a point zone with no containing room, an area condition anchored to a point
 * zone, or a `light` action whose light was removed from the map.
 */
function resolveTrigger(def: TriggerDef, map: SceneMap | null): ResolvedTrigger {
  const zone = map?.zones.find((z) => z.id === def.when.zoneId)
  if (!zone) return { def, inert: 'zone was deleted' }

  let resolved: ResolvedTrigger
  if (def.when.kind === 'room-revealed') {
    if (zone.shape.kind !== 'point') return { def, inert: 'zone is not a point — room-revealed needs one' }
    const roomId = map!.roomAt(zone.shape.position.x, zone.shape.position.y)
    if (!roomId) return { def, inert: 'zone is not inside a room' }
    resolved = { def, roomId }
  } else {
    // enter-region / within-radius
    if (zone.shape.kind === 'point') {
      return { def, inert: 'zone has no area to enter or measure a radius from' }
    }
    resolved = {
      def,
      shape:
        zone.shape.kind === 'circle'
          ? { kind: 'circle', x: zone.shape.position.x, y: zone.shape.position.y, radius: zone.shape.radius }
          : { kind: 'rect', x: zone.shape.x, y: zone.shape.y, width: zone.shape.width, height: zone.shape.height },
    }
  }

  for (const action of def.actions) {
    if (action.kind === 'light' && !map!.lightIds.has(action.lightId)) {
      return { ...resolved, inert: 'light no longer exists' }
    }
  }
  return resolved
}
