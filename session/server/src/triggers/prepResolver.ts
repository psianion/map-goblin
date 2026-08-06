// The server-side half of M4: turns a DM's authored `ScenePrep` (zone ids, light ids) into
// the `ResolvedPrep` the triggers module actually evaluates (room ids, shape geometry), and
// answers the module's other two questions — who is on the scene, and what has it explored
// — from the same stores fog/vision already read.
//
// Deliberately thin: `tokensOf`/`exploredOf` read fresh every call (`stores`/`sceneMapOf` are
// the sources of truth already used elsewhere). `prepOf` alone memoizes its own output (N1,
// below) — resolving is real work and a token drag calls it at ~10Hz.

import { isValidFormula } from '@dnd/mechanics/dice'
import { sceneFogOf, type FogState } from '@dnd/mechanics/fog'
import type { TokensState } from '@dnd/mechanics/tokens'
import type { ResolvedTrigger, TriggerDeps, TriggerToken } from '@dnd/mechanics/triggers'
import type { ScenePrep, TriggerDef } from '@dnd/core/src/shared/prep'
import type { Stores } from '../db/stores'
import { exploredRooms } from '../fog/redactMap'
import type { SceneMap, SceneMapOf } from '../fog/sceneMap'

const NO_FOG: FogState = { byScene: {} }
const NO_TOKENS: TokensState = { library: {}, byScene: {} }

/** ponytail: same spirit as sceneMap's CACHE_MAX — a DM working two or three scenes at once
 *  is normal, a fourth resident entry is a leak. */
const PREP_CACHE_MAX = 3

/** Wires `triggersModule`'s three dependencies against the server's own stores. */
export function createTriggerDeps(
  stores: Stores,
  sceneMapOf: SceneMapOf,
): Pick<TriggerDeps, 'prepOf' | 'tokensOf' | 'exploredOf'> {
  // N1 — a token drag re-evaluates every trigger at ~10Hz, and every step re-reads this same
  // scene's prep. `resolveTrigger` only ever changes when the stored prep JSON or the map it
  // resolves against changes, so keyed on both (string equality on the former, object
  // identity on the latter, since sceneMapOf itself already caches by revision) the resolved
  // result is safe to reuse across calls in between.
  const cache = new Map<string, { rawPrep: string; map: SceneMap | null; triggers: ResolvedTrigger[] }>()

  return {
    prepOf(campaignId, sceneId) {
      const scene = stores.scenes.get(sceneId)
      if (!scene || scene.campaign_id !== campaignId || !scene.prep) return null
      const map = sceneMapOf(sceneId)

      const cached = cache.get(sceneId)
      if (cached && cached.rawPrep === scene.prep && cached.map === map) {
        return { triggers: cached.triggers }
      }

      const prep = JSON.parse(scene.prep) as ScenePrep
      const triggers = prep.triggers.map((def) => resolveTrigger(def, map))
      if (!cache.has(sceneId) && cache.size >= PREP_CACHE_MAX) {
        cache.delete(cache.keys().next().value as string)
      }
      cache.set(sceneId, { rawPrep: scene.prep, map, triggers })
      return { triggers }
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

  const lightNames: Record<string, string> = {}
  for (const action of def.actions) {
    if (action.kind === 'light') {
      if (!map!.lightNames.has(action.lightId)) return { ...resolved, inert: 'light no longer exists' }
      lightNames[action.lightId] = map!.lightNames.get(action.lightId) ?? ''
    }
    if (action.kind === 'trap' && action.damage !== undefined && !isValidFormula(action.damage)) {
      return { ...resolved, inert: 'malformed damage formula' }
    }
  }
  return { ...resolved, lightNames }
}
