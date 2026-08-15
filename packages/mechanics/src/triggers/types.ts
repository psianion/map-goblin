// Triggers shapes (M4). `TriggerDef` is DM-authored and lives in the map's prep (§ prep.ts);
// everything here is the *runtime* half — what has fired, what a token has walked into, and
// the prompts/log a fire produces. Scoped by scene like fog and tokens, and byScene like
// them for the same reason: a campaign can hold more than one map.
//
// `ResolvedTrigger` is not this module's to build — the server resolves `roomId`/`shape`/
// `inert` from the authored zone once (containing room, radius, missing-reference checks)
// and hands the result in through `TriggerDeps.prepOf`; this module only ever reads it.

import type { Ability, AmbientLevel, TimeOfDay, TriggerDef, Weather } from '@dnd/core/src/shared/prep'

// Consumers of the module (server wiring, table client) get the shared prep vocabulary from
// here rather than deep-importing @dnd/core themselves.
export type { Ability, AmbientLevel, TimeOfDay, TriggerDef, Weather }

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

export interface TriggersState {
  byScene: Record<string, SceneTriggers>
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
 */
export const needsLight = (scene: SceneTriggers): boolean => ambientOf(scene) === 'darkness'

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
