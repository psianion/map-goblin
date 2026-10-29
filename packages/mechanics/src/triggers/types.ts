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
  RoomKey,
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
import { skyFrame, type SkyFrame } from '@dnd/core/src/shared/sky'
import type { LightAnimation, Mood } from '@dnd/core/src/shared/types'

// Consumers of the module (server wiring, table client) get the shared prep vocabulary from
// here rather than deep-importing @dnd/core themselves. `normalizePrep` rides along as a
// value for the same reason `resolveWorldLight` does: D3 bars the server from runtime-
// importing @dnd/core directly, and this leaf is pure.
export { normalizePrep, roomLabel } from '@dnd/core/src/shared/prep'
export type { Ability, AmbientLevel, RoomKey, RoomNote, TimeOfDay, TriggerDef, Weather }
// …and the world rules with it, so the referee and the table read the light off one import
// (`worldLightOf` below) the way they already read `needsLight`.
export { resolveWorldLight, skyFrame }
export type { MapEnvironment, Mood, NightSky, SkyFrame, TimeSpeed, WorldLight }

export interface ResolvedTrigger {
  def: TriggerDef
  /** room-revealed only: the condition's own `roomId`, or its zone's containing room, resolved
   *  server-side. */
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

/**
 * A v3 room key, resolved against the map it keys: the room's display label for the Journal
 * card and the DM's toast, and where its encounter spawns. `inert` when the key names a room
 * the map no longer has; the key still lists at the table, it just cannot pop or spawn.
 */
export interface ResolvedRoomKey {
  key: RoomKey
  /** `N · name` (the bare name when unnumbered), what the DM and the Journal read. */
  label?: string
  /** A point inside the room (its anchor) that spawned tokens fan out from. */
  spawnAt?: { x: number; y: number }
  /** The room's face in map units; spawn positions are kept inside it. */
  region?: readonly [number, number][]
  inert?: string
  /** Why the key's encounter cannot spawn (bad count, bad HP formula, roster too big) — the
   *  same checks an `encounter` trigger action gets. The rest of the key still works. */
  encounterInert?: string
}

export interface ResolvedPrep {
  triggers: ResolvedTrigger[]
  notes: ResolvedNote[]
  /** v3 room keys. Absent reads as none (a resolver that predates v3). */
  rooms?: ResolvedRoomKey[]
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
  cone: { angle: number; direction: number }
  animation: LightAnimation
  throughWalls: boolean
  nightOnly: { min: number; max: number }
  darkness: boolean
  darkvisionSees: boolean
}>

/** A DM's live edit to one room: today only its mood. Moods are not secrets, so these ship whole. */
export type RoomEdit = { mood?: Mood }

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
  /** DM's live per-room edits (`set-room`), keyed by room id, overlaid on the authored look.
   *  Absent on a row saved before the Lighting pass — read through `roomEditsOf`. */
  roomEdits?: Record<string, RoomEdit>
  /** Seats the DM pinned to a level, by identity (`set-seat-level`). Absent ⇒ none. */
  seatLevel?: Record<string, string>
  /** The level the DM's own view shows (`set-dm-level`). Absent ⇒ the map's first level. */
  dmLevelId?: string
  /** Narration labels. `weather` here is legacy: the live weather is `world.weather` now.
   *  A row saved before the Lighting pass may still carry an `ambient` key; `worldOf` folds
   *  it into `world.darkness` on read (`legacyDarkness`). */
  env: { time?: TimeOfDay; weather?: Weather }
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
  /** The live weather (light only). Absent ⇒ the map's default weather. */
  weather?: Weather
  /** The DM's darkness slider, 0..1. `null` ⇒ follow the sky; absent ⇒ not yet migrated. */
  darkness?: number | null
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
  /** Set only by `share-card` with a `roomId`: the room whose key's read-aloud this is. */
  sourceRoomId?: string
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
  /** noteId (or `roomShareKey(roomId)` for a room key's read-aloud) → its last share. DM-only
   *  in redaction. */
  shareReceipts?: Record<string, ShareReceipt>
}

/** The old 3-state ambient dial as a darkness slider value (the Lighting pass migration). */
export const AMBIENT_DARKNESS: Record<AmbientLevel, number> = { daylight: 0, dusk: 0.5, darkness: 1 }

/** The darkness slider read back as the old 3-state level, for the badge and narration. */
export function darknessLevel(darkness: number): AmbientLevel {
  return darkness >= 0.75 ? 'darkness' : darkness >= 0.25 ? 'dusk' : 'daylight'
}

/**
 * Read-compat for the Lighting pass: a row saved before the darkness slider carries the old
 * per-scene `env.ambient` dial. The first scene that has one becomes the campaign's slider
 * value; none is `null` (follow the sky). Only consulted while `world.darkness` is absent, so
 * the first `set-world` after an upgrade writes it down and this never runs again.
 */
export function legacyDarkness(state: TriggersState): number | null {
  for (const scene of Object.values(state.byScene)) {
    const ambient = (scene.env as { ambient?: AmbientLevel }).ambient
    if (ambient && ambient in AMBIENT_DARKNESS) return AMBIENT_DARKNESS[ambient]
  }
  return null
}

/** The world as it stands, defaulted: midday, a full moon over it, and not moving. */
export const WORLD_DEFAULT: WorldState = { clock: NOON, nightSky: 'full-moon', timeSpeed: 'paused' }

/** The one reading of the optional slice — a campaign that predates the clock reads midday. */
export const worldOf = (state: TriggersState): WorldState => {
  const world = { ...WORLD_DEFAULT, ...state.world }
  if (world.darkness === undefined) world.darkness = legacyDarkness(state)
  return world
}

/**
 * The sky the table is playing under: the map's authored defaults, the campaign's clock, and
 * the DM's live weather, night sky and darkness on top. The one `SkyFrame` the referee, the
 * table renderer and the fog all read.
 */
export function worldSkyOf(map: MapEnvironment, state: TriggersState): SkyFrame {
  const world = worldOf(state)
  return skyFrame({
    ...map,
    minutes: world.clock,
    nightSky: state.world?.nightSky ?? map.nightSky ?? world.nightSky,
    weather: world.weather ?? map.weather,
    override: world.darkness ?? null,
  })
}

/** A scene's room edits, defaulted: a row saved before the Lighting pass has none. */
export const roomEditsOf = (scene: SceneTriggers): Record<string, RoomEdit> => scene.roomEdits ?? {}

/**
 * The level a seat is looking at: the DM's own pick for the DM; for a player, the level the
 * DM pinned the seat to, else the level of the first token the seat claims, else the map's
 * first level. A token without a level stands on the first level.
 */
export function viewedLevel(
  scene: SceneTriggers,
  tokens: Iterable<{ ownerId: string | null; levelId?: string }>,
  viewer: { role: string; identityId: string },
  firstLevelId: string,
): string {
  if (viewer.role === 'dm') return scene.dmLevelId ?? firstLevelId
  const pinned = scene.seatLevel?.[viewer.identityId]
  if (pinned) return pinned
  for (const token of tokens) if (token.ownerId === viewer.identityId) return token.levelId ?? firstLevelId
  return firstLevelId
}

/** The one reading of the optional slice — a campaign with nothing shared yet reads empty. */
export const journalOf = (state: TriggersState): JournalEntry[] => state.journal ?? []

/** The receipt key a room key's read-aloud share is filed under: prefixed so a room id can
 *  never collide with a note id in the one shared map. */
export const roomShareKey = (roomId: string): string => `room:${roomId}`

/** `SceneTriggers.fired` keys for room keys, prefixed like reveal-notes' `note:` so the room,
 *  note and trigger namespaces never mix in the one map: the reveal pop (re-armed by a fog
 *  reset), and the last time the DM spawned the key's encounter. */
export const roomRevealKey = (roomId: string): string => `room:${roomId}`
export const roomSpawnKey = (roomId: string): string => `spawn:${roomId}`

/** The one reading of the optional v3 slice: a resolver that predates room keys has none. */
export const roomKeysOf = (prep: ResolvedPrep): ResolvedRoomKey[] => prep.rooms ?? []

/** ditto, for the DM-only receipt map. */
export const shareReceiptsOf = (state: TriggersState): Record<string, ShareReceipt> =>
  state.shareReceipts ?? {}

/**
 * The scene's light, as the whole rule sees it: the map's authored environment, the campaign's
 * clock and sky, and the DM's own override on top.
 *
 * The badge and narration read this; the vision gate reads `worldSkyOf` and the per-region
 * rule (`isDarkRegion`). The DM's darkness slider stands in as the override, read back as the
 * old three levels (`darknessLevel`).
 */
export function worldLightOf(
  map: MapEnvironment,
  state: TriggersState,
  _sceneId?: string,
): WorldLight {
  const world = worldOf(state)
  return resolveWorldLight({
    ...map,
    clockMinutes: world.clock,
    nightSky: world.nightSky,
    override: world.darkness === null || world.darkness === undefined ? null : darknessLevel(world.darkness),
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
