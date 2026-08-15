// Triggers shapes (M4). `TriggerDef` is DM-authored and lives in the map's prep (§ prep.ts);
// everything here is the *runtime* half — what has fired, what a token has walked into, and
// the prompts/log a fire produces. Scoped by scene like fog and tokens, and byScene like
// them for the same reason: a campaign can hold more than one map.
//
// `ResolvedTrigger` is not this module's to build — the server resolves `roomId`/`shape`/
// `inert` from the authored zone once (containing room, radius, missing-reference checks)
// and hands the result in through `TriggerDeps.prepOf`; this module only ever reads it.

import type { Ability, AmbientLevel, TimeOfDay, TriggerDef, Weather } from '@dnd/core/src/shared/prep'
import {
  NOON,
  resolveWorldLight,
  type MapEnvironment,
  type NightSky,
  type TimeSpeed,
  type WorldLight,
} from '@dnd/core/src/shared/world'

// Consumers of the module (server wiring, table client) get the shared prep vocabulary from
// here rather than deep-importing @dnd/core themselves.
export type { Ability, AmbientLevel, TimeOfDay, TriggerDef, Weather }
// …and the world rules with it, so the referee and the table read the light off one import
// (`worldLightOf` below) the way they already read `needsLight`.
export { resolveWorldLight }
export type { MapEnvironment, NightSky, TimeSpeed, WorldLight }

export interface ResolvedTrigger {
  def: TriggerDef
  /** room-revealed only: the zone's containing room, resolved server-side. */
  roomId?: string
  /** enter-region / within-radius: the zone's shape in map units. */
  shape?:
    | { kind: 'circle'; x: number; y: number; radius: number }
    | { kind: 'rect'; x: number; y: number; width: number; height: number }
  /** Human-readable reason (missing zone / no containing room / missing light) — set ⇒ this
   *  trigger never fires, manual `fire` included. */
  inert?: string
  /** A `light` action's lightId → the light's own display name, resolved server-side —
   *  the pure module never imports the map to look one up itself. */
  lightNames?: Record<string, string>
}

export interface ResolvedPrep {
  triggers: ResolvedTrigger[]
}

export interface TriggerPrompt {
  id: string
  triggerId: string
  kind: 'trap' | 'ability-check'
  /** null ⇒ the entering token was unclaimed, so the DM answers. */
  targetIdentityId: string | null
  tokenId?: string
  text: string
  ability?: Ability
  dc?: number
  damage?: string
  at: number
}

export interface TriggerLogEntry {
  id: string
  at: number
  triggerId?: string
  kind: string
  text: string
  /** Players see only `toPlayers` entries… */
  toPlayers: boolean
  /** …plus entries addressed to them (their own roll outcomes). */
  forIdentityId?: string
  detail?: Record<string, unknown>
}

export interface SceneTriggers {
  /** triggerId → the `now()` it last fired. */
  fired: Record<string, number>
  /** within-radius / enter-region inside-latch per triggerId (rising-edge re-arm on leave). */
  armed: Record<string, boolean>
  /** Runtime overrides from `set-enabled` — `true` blocks a trigger regardless of `def.enabled`. */
  disabled: Record<string, boolean>
  lightOverrides: Record<string, boolean>
  /** `ambient` absent ⇒ `'daylight'` — a scene played before the dial existed keeps the
   *  purely geometric vision it was played with (S3 P3 §1). */
  env: { time?: TimeOfDay; weather?: Weather; ambient?: AmbientLevel }
  /** Open prompts, cap 20 (drop oldest). */
  prompts: TriggerPrompt[]
  /** Cap 200 (drop oldest). */
  log: TriggerLogEntry[]
}

/**
 * The campaign's live world — one clock and one sky for every scene in it, because a party
 * that walks from the courtyard into the cellar has not travelled through time.
 *
 * Beside `byScene` rather than inside it for exactly that reason, and absent on every campaign
 * that predates the clock: `worldOf` is the one reading, and its defaults are the state the
 * table has always played in (midday, nothing gated).
 */
export interface WorldState {
  /** Minutes 0-1439. */
  clock: number
  nightSky: NightSky
  /** Auto-advance rate. Stored and synced here; the ticking that reads it is P4. */
  timeSpeed: TimeSpeed
}

export interface TriggersState {
  byScene: Record<string, SceneTriggers>
  /** Absent until a DM touches the world — see `worldOf`. */
  world?: WorldState
}

/**
 * The scene's light level, as the vision rules read it (S3 P3 §1) — one reading of the
 * optional field, shared by the referee and the canvas so the two cannot disagree about
 * whether a normal eye needs a torch.
 */
export const ambientOf = (scene: SceneTriggers): AmbientLevel => scene.env.ambient ?? 'daylight'

/**
 * The one mechanical distinction the three levels draw: in `darkness` normal vision is
 * clipped to light-source coverage, and in `daylight`/`dusk` the whole sweep counts as lit.
 *
 * The scene's own dial only — a map that follows the sky asks `worldLightOf` instead, which
 * answers the same question with the clock in it.
 */
export const needsLight = (scene: SceneTriggers): boolean => ambientOf(scene) === 'darkness'

/** The world as it stands, defaulted: midday, a full moon over it, and not moving. */
export const WORLD_DEFAULT: WorldState = { clock: NOON, nightSky: 'full-moon', timeSpeed: 'paused' }

/** The one reading of the optional slice — a campaign that predates the clock reads midday. */
export const worldOf = (state: TriggersState): WorldState => ({ ...WORLD_DEFAULT, ...state.world })

/**
 * The scene's light, as the whole rule sees it: the map's authored environment, the campaign's
 * clock and sky, and the DM's own override on top.
 *
 * This is the seam `ambientOf`/`needsLight` used to be — one function the referee
 * (`fog/vision.ts`) and the canvas (`FogRenderer`) both call, so the mask and the redaction
 * cannot disagree about whether the party needs a torch.
 *
 * The migration is the `override` argument: a scene's stored `env.ambient` — every value a DM
 * has ever set — *is* the override, so a campaign upgraded into this feature plays exactly as
 * it did until someone clears the dial.
 */
export function worldLightOf(
  map: MapEnvironment,
  state: TriggersState,
  sceneId: string,
): WorldLight {
  const world = worldOf(state)
  return resolveWorldLight({
    ...map,
    clockMinutes: world.clock,
    nightSky: world.nightSky,
    override: sceneTriggersOf(state, sceneId).env.ambient ?? null,
  })
}

/** An untouched scene: nothing fired, nothing armed, no overrides. */
export function sceneTriggersOf(state: TriggersState, sceneId: string): SceneTriggers {
  return (
    state.byScene[sceneId] ?? {
      fired: {},
      armed: {},
      disabled: {},
      lightOverrides: {},
      env: {},
      prompts: [],
      log: [],
    }
  )
}
