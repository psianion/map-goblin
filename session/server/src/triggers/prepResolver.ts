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
import {
  normalizePrep,
  type ResolvedNote,
  type ResolvedTrigger,
  type TriggerDeps,
  type TriggerToken,
} from '@dnd/mechanics/triggers'
import type { RoomNote, ScenePrep, ScenePrepV1, TriggerDef } from '@dnd/core/src/shared/prep'
import type { Stores } from '../db/stores'
import { exploredRooms } from '../fog/redactMap'
import type { SceneMap, SceneMapOf } from '../fog/sceneMap'

const NO_FOG: FogState = { byScene: {} }
const NO_TOKENS: TokensState = { library: {}, byScene: {} }

/** ponytail: same spirit as sceneMap's CACHE_MAX — a DM working two or three scenes at once
 *  is normal, a fourth resident entry is a leak. */
const PREP_CACHE_MAX = 3

/**
 * Wires `triggersModule`'s dependencies against the server's own stores. `registry` is
 * optional purely for the http-only callers (GET .../prep resolves, never fires); the live
 * server always passes it, and without it a fired encounter logs but materializes nothing.
 */
export function createTriggerDeps(
  stores: Stores,
  sceneMapOf: SceneMapOf,
  registry?: EncounterRegistry,
): Pick<TriggerDeps, 'prepOf' | 'tokensOf' | 'exploredOf' | 'applyEncounter'> {
  // N1 — a token drag re-evaluates every trigger at ~10Hz, and every step re-reads this same
  // scene's prep. `resolveTrigger` only ever changes when the stored prep JSON or the map it
  // resolves against changes, so keyed on both (string equality on the former, object
  // identity on the latter, since sceneMapOf itself already caches by revision) the resolved
  // result is safe to reuse across calls in between.
  const cache = new Map<
    string,
    { rawPrep: string; map: SceneMap | null; triggers: ResolvedTrigger[]; notes: ResolvedNote[] }
  >()

  return {
    prepOf(campaignId, sceneId) {
      const scene = stores.scenes.get(sceneId)
      if (!scene || scene.campaign_id !== campaignId || !scene.prep) return null
      const map = sceneMapOf(sceneId)

      const cached = cache.get(sceneId)
      if (cached && cached.rawPrep === scene.prep && cached.map === map) {
        return { triggers: cached.triggers, notes: cached.notes }
      }

      // Stored rows can still be v1 — normalize is the read-boundary shim (prep.ts).
      const prep = normalizePrep(JSON.parse(scene.prep) as ScenePrep | ScenePrepV1)
      const triggers = prep.triggers.map((def) => resolveTrigger(def, map))
      const notes = prep.notes.map((note) => resolveNote(note, map))
      if (!cache.has(sceneId) && cache.size >= PREP_CACHE_MAX) {
        cache.delete(cache.keys().next().value as string)
      }
      cache.set(sceneId, { rawPrep: scene.prep, map, triggers, notes })
      return { triggers, notes }
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

    // A fired encounter's spawn/seed lists, materialized through the registry's internal
    // door (`dispatchInternal` — the same one triggers.event uses; neither action is in its
    // module's `commands`, so a socket can never reach them). Refusals are warnings, never
    // throws: this runs inside the cascade a player's own token move kicked off.
    applyEncounter(effects, ctx) {
      if (!registry) return
      if (effects.spawn.length > 0) {
        const error = registry.dispatchInternal(
          'tokens',
          'spawn',
          { sceneId: effects.sceneId, tokens: effects.spawn },
          ctx,
        )
        if (error) console.warn(`[triggers] encounter '${effects.name}' spawn refused: ${error.message}`)
      }
      if (effects.seed.length > 0) {
        const error = registry.dispatchInternal(
          'initiative',
          'seed',
          { sceneId: effects.sceneId, entries: effects.seed },
          ctx,
        )
        if (error) console.warn(`[triggers] encounter '${effects.name}' seed refused: ${error.message}`)
      }
    },
  }
}

/** The one slice of ModuleRegistry this file needs — kept structural so importing the class
 *  (and its module-table world) stays unnecessary here. */
export interface EncounterRegistry {
  dispatchInternal(
    module: string,
    action: string,
    payload: unknown,
    ctx: unknown,
  ): { code: string; message: string } | null
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
  let hasEncounter = false
  for (const action of def.actions) {
    if (action.kind === 'light') {
      if (!map!.lightNames.has(action.lightId)) return { ...resolved, inert: 'light no longer exists' }
      lightNames[action.lightId] = map!.lightNames.get(action.lightId) ?? ''
    }
    if (action.kind === 'trap' && action.damage !== undefined && !isValidFormula(action.damage)) {
      return { ...resolved, inert: 'malformed damage formula' }
    }
    if (action.kind === 'encounter') {
      hasEncounter = true
      if (action.monsters.length === 0) return { ...resolved, inert: 'encounter has no monsters' }
      let total = 0
      for (const m of action.monsters) {
        if (!Number.isInteger(m.count) || m.count < 1) {
          return { ...resolved, inert: 'a monster count must be a whole number of at least 1' }
        }
        total += m.count
        if (m.hp !== undefined && !isValidFormula(m.hp)) {
          return { ...resolved, inert: 'malformed monster HP formula' }
        }
      }
      if (total > ENCOUNTER_ROSTER_MAX) {
        return { ...resolved, inert: `an encounter spawns at most ${ENCOUNTER_ROSTER_MAX} monsters` }
      }
    }
  }
  // Any-shape anchor: the point itself, a circle's centre, a rect's centre — where spawned
  // tokens fan out from (SPAWN_OFFSETS in the module).
  if (hasEncounter) return { ...resolved, lightNames, spawnAt: zoneAnchor(zone.shape) }
  return { ...resolved, lightNames }
}

const ENCOUNTER_ROSTER_MAX = 20

type ZoneShape = SceneMap['zones'][number]['shape']

function zoneAnchor(shape: ZoneShape): { x: number; y: number } {
  if (shape.kind === 'rect') return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 }
  return { x: shape.position.x, y: shape.position.y }
}

/**
 * A note resolves like a trigger, but browse never breaks: `inert` only says why the note
 * cannot *pop* (or why its pin badge should warn) — the table's Notes panel lists it
 * regardless. `roomId` is set only for a `showOnReveal` note whose anchor sits in a room.
 */
function resolveNote(note: RoomNote, map: SceneMap | null): ResolvedNote {
  const zone = map?.zones.find((z) => z.id === note.zoneId)
  if (!zone) return { note, inert: 'zone was deleted' }
  if (!note.showOnReveal) return { note }
  const at = zoneAnchor(zone.shape)
  const roomId = map!.roomAt(at.x, at.y)
  if (!roomId) return { note, inert: 'zone is not inside a room' }
  return { note, roomId }
}
