// Triggers shapes (M4). `TriggerDef` is DM-authored and lives in the map's prep (§ prep.ts);
// everything here is the *runtime* half — what has fired, what a token has walked into, and
// the prompts/log a fire produces. Scoped by scene like fog and tokens, and byScene like
// them for the same reason: a campaign can hold more than one map.
//
// `ResolvedTrigger` is not this module's to build — the server resolves `roomId`/`shape`/
// `inert` from the authored zone once (containing room, radius, missing-reference checks)
// and hands the result in through `TriggerDeps.prepOf`; this module only ever reads it.

import type {
  Ability,
  AmbientLevel,
  RoomNote,
  TimeOfDay,
  TriggerDef,
  Weather,
} from '@dnd/core/src/shared/prep'
import {
  NOON,
  resolveWorldLight,
  type MapEnvironment,
  type NightSky,
  type TimeSpeed,
  type WorldLight,
} from '@dnd/core/src/shared/world'

// Consumers of the module (server wiring, table client) get the shared prep vocabulary from
// here rather than deep-importing @dnd/core themselves. `normalizePrep` rides along as a
// value for the same reason `resolveWorldLight` does: D3 bars the server from runtime-
// importing @dnd/core directly, and this leaf is pure.
export { normalizePrep } from '@dnd/core/src/shared/prep'
export type { Ability, AmbientLevel, RoomNote, TimeOfDay, TriggerDef, Weather }
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
  /** Set whenever the trigger carries an `encounter` action: the anchor zone's point (or an
   *  area zone's centre), where spawned tokens fan out from. */
  spawnAt?: { x: number; y: number }
}

/** A v2 room note, resolved the way triggers are: `roomId` set only for a `showOnReveal`
 *  note whose anchor resolves to a room; `inert` when it cannot pop (browse still works —
 *  a note is readable at the table regardless). */
export interface ResolvedNote {
  note: RoomNote
  roomId?: string
  inert?: string
}

export interface ResolvedPrep {
  triggers: ResolvedTrigger[]
  notes: ResolvedNote[]
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

/**
 * A DM's live edit to one light (M2) — every field it can touch, all optional: a patch merges
 * onto whatever the light was, `set-light` shallow-merges onto whatever it already had.
 */
export type LightEdit = Partial<{
  visible: boolean
  radius: number
  featherRadius: number
  intensity: number
  color: string
  falloff: 'linear' | 'quadratic'
  position: { x: number; y: number }
}>

export interface SceneTriggers {
  /** triggerId → the `now()` it last fired. */
  fired: Record<string, number>
  /** within-radius / enter-region inside-latch per triggerId (rising-edge re-arm on leave). */
  armed: Record<string, boolean>
  /** Runtime overrides from `set-enabled` — `true` blocks a trigger regardless of `def.enabled`. */
  disabled: Record<string, boolean>
  /** Superseded by `lightEdits[id].visible` — kept only so a `module_state` row saved before
   *  M2 still reads (`sceneTriggersOf` folds it in). Never written to again. */
  lightOverrides: Record<string, boolean>
  /** DM's live per-light edits (M2), keyed by light id — the table's own truth for a light,
   *  overlaid on whatever the map authored it as (`effectiveLight` in module.ts). */
  lightEdits: Record<string, LightEdit>
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

/** The four voices a Journal card can carry — `vocabLabel`-style Title case is the UI's job,
 *  this vocabulary is the wire's. Absent on a share request defaults to `'lore'`. */
export const JOURNAL_KICKERS = ['place', 'person', 'missive', 'lore'] as const
export type JournalKicker = (typeof JOURNAL_KICKERS)[number]

/**
 * A published Journal card — the table's player-facing feed. Published only by deliberate DM
 * action (`share-note` snapshots a `RoomNote`, `share-card` is authored on the fly): a
 * snapshot, never a live view of prep, so editing the source note after a share leaves
 * history alone.
 */
export interface JournalEntry {
  id: string
  at: number
  kicker: JournalKicker
  title: string
  body: string
  /** Snapshotted from the source note, if any and if it had some — never re-read from prep. */
  imageKeys?: string[]
  sceneId: string
  /** Set only by `share-note` — the `RoomNote` this entry was snapshotted from. */
  sourceNoteId?: string
}

/** DM-only bookkeeping: the last time a given note was shared, and into which entry — lets
 *  the DM's own panel show "Shared 9:41" without telling a player which notes exist. A
 *  published entry does carry its own `sourceNoteId` to every seat, but that is the id of a
 *  note the DM deliberately published; what stays DM-only is the map of *every* note to its
 *  share state, which is what would give away the unshared ones by their absence. */
export interface ShareReceipt {
  at: number
  journalEntryId: string
}

export interface TriggersState {
  byScene: Record<string, SceneTriggers>
  /** Absent until a DM touches the world — see `worldOf`. */
  world?: WorldState
  /** Published Journal cards — session-scoped like `world`, not per-scene: a card persists
   *  across scene switches. Visible to every role in redaction, since publishing IS sharing. */
  journal?: JournalEntry[]
  /** noteId → its last share. DM-only in redaction. */
  shareReceipts?: Record<string, ShareReceipt>
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

/** The one reading of the optional slice — a campaign with nothing shared yet reads empty. */
export const journalOf = (state: TriggersState): JournalEntry[] => state.journal ?? []

/** ditto, for the DM-only receipt map. */
export const shareReceiptsOf = (state: TriggersState): Record<string, ShareReceipt> =>
  state.shareReceipts ?? {}

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

/**
 * Read-compat for M2: a `module_state` row saved before `lightEdits` existed carries only the
 * boolean `lightOverrides`. Fold each into `lightEdits[id].visible` so a scene loaded from a
 * pre-M2 row reads exactly like one that always had `lightEdits` — every other field of the
 * edit stays whatever it already was (or absent, meaning "as authored"). `lightOverrides`
 * itself is never written to again, so once an id has a real `visible` in `lightEdits`, that's
 * the one that wins here too.
 */
function foldLightOverrides(scene: SceneTriggers): SceneTriggers {
  const stale = Object.keys(scene.lightOverrides).filter(
    (id) => scene.lightEdits[id]?.visible === undefined,
  )
  if (stale.length === 0) return scene
  const lightEdits = { ...scene.lightEdits }
  for (const id of stale) lightEdits[id] = { ...lightEdits[id], visible: scene.lightOverrides[id] }
  return { ...scene, lightEdits }
}

/** An untouched scene: nothing fired, nothing armed, no overrides. */
export function sceneTriggersOf(state: TriggersState, sceneId: string): SceneTriggers {
  const raw = state.byScene[sceneId] ?? {
    fired: {},
    armed: {},
    disabled: {},
    lightOverrides: {},
    lightEdits: {},
    env: {},
    prompts: [],
    log: [],
  }
  // `lightEdits` is absent on a `module_state` row saved before M2 — the type says otherwise
  // because everything written since has it, so the default lands here rather than in the shape.
  return foldLightOverrides(raw.lightEdits ? raw : { ...raw, lightEdits: {} })
}
