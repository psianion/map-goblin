// The triggers module (M4). A trigger is authored once (prep.ts) and lives its runtime life
// here: arming on token movement, firing its actions, and turning a trap/ability-check into
// a prompt the target (or the DM, for an unclaimed token) resolves with a roll.
//
// Role gating is data, same as fog/tokens: `commands` is what the registry checks before the
// handler runs, so everything below is the *extra* validation. One action, `event`, is
// deliberately absent from `commands` — it is not a player-reachable command at all, it is
// how the server tells this module "a token moved" / "fog reset" after tokens/fog already
// committed their own write. Dispatching it over the wire must fail the same way an unknown
// action does, which is exactly what leaving it out of `commands` gets for free.

import { ANY_ROLE, type GameModule, type ModuleContext } from '../contract'
import { roll, type RollResult } from '../dice/roll'
import { COLOR_MAX, ID_MAX, Reject, bad, bool, denied, num, obj, oneOf, str } from '../tokens/validate'
import {
  AMBIENT_DARKNESS,
  darknessLevel,
  JOURNAL_KICKERS,
  journalOf,
  roomEditsOf,
  roomKeysOf,
  roomRevealKey,
  roomShareKey,
  roomSpawnKey,
  sceneTriggersOf,
  shareReceiptsOf,
  worldOf,
  type JournalEntry,
  type LightEdit,
  type ResolvedPrep,
  type RoomEdit,
  type ResolvedRoomKey,
  type ResolvedTrigger,
  type SceneTriggers,
  type ShareReceipt,
  type TriggerLogEntry,
  type TriggerPrompt,
  type TriggersState,
  type WorldState,
} from './types'
import {
  AMBIENTS,
  TIMES,
  WEATHERS,
  type AmbientLevel,
  type MonsterEntry,
  type TimeOfDay,
  type TriggerAction,
  type Weather,
} from '@dnd/core/src/shared/prep'
import { DAY_MINUTES, NIGHT_SKIES, TIME_SPEEDS, timeOfDayAt } from '@dnd/core/src/shared/world'

const MOODS = ['lit', 'dim', 'dark'] as const

export * from './types'

const PROMPTS_MAX = 20
const LOG_MAX = 200

/** The token shape this module needs — enough to test "is it inside this shape" and who
 *  would answer a prompt it triggers. */
export interface TriggerToken {
  id: string
  x: number
  y: number
  ownerId: string | null
  hidden?: boolean
}

/** What an `encounter` fire hands back to the server: concrete instances to materialize.
 *  The ctx is the dispatch context the fire ran under — the server re-dispatches the
 *  internal tokens/initiative writes with it. */
export interface EncounterEffects {
  sceneId: string
  name: string
  /** Empty when the action's `spawn` is off. Ids are minted here ('etok' prefix — never
   *  colliding with the tokens module's own 'tok' mints). */
  spawn: {
    id: string
    name: string
    x: number
    y: number
    size: MonsterEntry['size'] & string
    packAsset?: { packId: string; assetId: string }
  }[]
  /** Empty when the action's `seedInitiative` is off. `hp` is already rolled. */
  seed: { name: string; hp?: number; tokenId?: string }[]
}

export type EncounterCtx = Omit<ModuleContext<unknown>, 'state' | 'setState'>

export interface TriggerDeps {
  /** Fresh read every call — prep PUTs are quiet, so this module never caches it. */
  prepOf(campaignId: string, sceneId: string): ResolvedPrep | null
  tokensOf(campaignId: string, sceneId: string): Record<string, TriggerToken>
  /** Room ids currently revealed-or-explored. */
  exploredOf(campaignId: string, sceneId: string): readonly string[]
  /**
   * Materializes an encounter's spawn/seed lists (server: internal `tokens.spawn` and
   * `initiative.seed` dispatches). Optional so the pure-module tests run without a server;
   * an encounter fired with no impl still logs, it just places nothing.
   */
  applyEncounter?(effects: EncounterEffects, ctx: EncounterCtx): void
  /** Default `../dice/roll` — injected for tests. */
  rollFn?: typeof roll
  /** Default `Date.now` — injected for tests. */
  now?: () => number
  /** Every placed light's id in a scene's map, darkness sources left out — what
   *  `set-lights-all` switches. Absent ⇒ only the lights that already carry an edit are. */
  lightIdsOf?(campaignId: string, sceneId: string): readonly string[]
  /** The light ids a player's copy of the map keeps (lights in explored rooms), or null when
   *  every light ships. `redact` drops the `lightEdits` of the rest. */
  keptLightsOf?(sceneId: string): ReadonlySet<string> | null
}

type Ctx = ModuleContext<TriggersState>
type Payload = Record<string, unknown>

let minted = 0
const mintId = (prefix: string): string => `${prefix}${Date.now().toString(36)}${(minted++).toString(36)}`

export function triggersModule(deps: TriggerDeps): GameModule<TriggersState> {
  return {
    name: 'triggers',
    commands: {
      'set-environment': ['dm'],
      'set-world': ['dm'],
      fire: ['dm'],
      'set-enabled': ['dm'],
      'set-light': ['dm'],
      'reset-light': ['dm'],
      'set-lights-all': ['dm'],
      'set-room': ['dm'],
      'set-seat-level': ['dm'],
      'set-dm-level': ['dm'],
      'roll-prompt': ANY_ROLE,
      'dismiss-prompt': ['dm'],
      'share-note': ['dm'],
      'share-card': ['dm'],
      'spawn-encounter': ['dm'],
      // no 'event' entry — see the file header.
    },
    initialState: { byScene: {} },

    handler(action, payload, ctx) {
      try {
        run(action, obj(payload ?? {}, 'payload'), ctx, deps)
      } catch (err) {
        if (err instanceof Reject) return { code: err.code, message: err.message }
        throw err
      }
    },

    // player: prompts and log lines are per-seat (D4 style), fired/armed/disabled are the
    // DM's own bookkeeping and never ride to a player at all. env and lightOverrides are
    // world state everyone already sees on the table. Pure and idempotent: a scene with
    // nothing addressed to this viewer re-filters to the same empty arrays every time.
    //
    // This function rebuilds its answer key by key, so anything NOT copied here is dropped
    // from every player's copy — `world` is copied for the same reason `env` is: the clock and
    // the sky are what the whole table is looking at. `journal` rides the same way: a card is
    // published (i.e. shared) by definition, so there is nothing about it to hide. Its DM-only
    // sibling `shareReceipts` is dropped instead — a player must not learn a note exists just
    // because the DM has, or hasn't, shared it.
    redact(state, viewer) {
      if (viewer.role === 'dm') return state
      const byScene: TriggersState['byScene'] = {}
      for (const [sceneId, scene] of Object.entries(state.byScene)) {
        // A light in a room the party has not explored is not on the player's map, so its live
        // edit does not ship either. Room moods are not secrets: `roomEdits` ship whole. The
        // DM's own level pick stays the DM's; seat pins ship (each seat reads its own).
        const kept = deps.keptLightsOf?.(sceneId) ?? null
        byScene[sceneId] = {
          fired: {},
          armed: {},
          disabled: {},
          lightOverrides: kept ? keepKeys(scene.lightOverrides, kept) : scene.lightOverrides,
          lightEdits: kept ? keepKeys(scene.lightEdits, kept) : scene.lightEdits,
          ...(scene.roomEdits ? { roomEdits: scene.roomEdits } : {}),
          ...(scene.seatLevel ? { seatLevel: scene.seatLevel } : {}),
          env: scene.env,
          prompts: scene.prompts.filter((p) => p.targetIdentityId === viewer.identityId),
          log: scene.log.filter((e) => e.toPlayers || e.forIdentityId === viewer.identityId),
        }
      }
      return { byScene, world: state.world, journal: state.journal }
    },
  }
}

function run(action: string, p: Payload, ctx: Ctx, deps: TriggerDeps): void {
  switch (action) {
    case 'set-environment':
      return setEnvironment(p, ctx)
    case 'set-world':
      return setWorld(p, ctx)
    case 'fire':
      return fireCommand(p, ctx, deps)
    case 'set-enabled':
      return setEnabled(p, ctx)
    case 'set-light':
      return setLight(p, ctx)
    case 'reset-light':
      return resetLight(p, ctx)
    case 'set-lights-all':
      return setLightsAll(p, ctx, deps)
    case 'set-room':
      return setRoom(p, ctx)
    case 'set-seat-level':
      return setSeatLevel(p, ctx)
    case 'set-dm-level':
      return setDmLevel(p, ctx)
    case 'roll-prompt':
      return rollPrompt(p, ctx, deps)
    case 'dismiss-prompt':
      return dismissPrompt(p, ctx)
    case 'share-note':
      return shareNote(p, ctx, deps)
    case 'share-card':
      return shareCard(p, ctx, deps)
    case 'spawn-encounter':
      return spawnEncounter(p, ctx, deps)
    case 'event':
      return event(p, ctx, deps)
    default:
      bad(`triggers has no action '${action}'`)
  }
}

/** Payload scene, else the table's active scene; a command with neither is nonsense. */
function sceneOf(p: Payload, ctx: Ctx): string {
  const sceneId = p.sceneId === undefined ? ctx.activeSceneId : str(p.sceneId, 'sceneId', ID_MAX)
  if (!sceneId) bad('no sceneId in the payload and no active scene')
  return sceneId
}

/** A weather an authored `environment` action set while firing into `scene`: `setScene` writes
 *  it to `world.weather` in the same `setState`. */
const pendingWeather = new WeakMap<SceneTriggers, Weather>()

function setScene(ctx: Ctx, sceneId: string, scene: SceneTriggers): void {
  const weather = pendingWeather.get(scene)
  ctx.setState({
    ...ctx.state,
    byScene: { ...ctx.state.byScene, [sceneId]: scene },
    ...(weather ? { world: { ...worldOf(ctx.state), weather } } : {}),
  })
}

/** `record` with only the keys in `kept`. */
function keepKeys<V>(record: Record<string, V>, kept: ReadonlySet<string>): Record<string, V> {
  const out: Record<string, V> = {}
  for (const [k, v] of Object.entries(record)) if (kept.has(k)) out[k] = v
  return out
}

function pushLog(scene: SceneTriggers, entry: Omit<TriggerLogEntry, 'id' | 'at'>, now: number): void {
  scene.log.push({ ...entry, id: mintId('l'), at: now })
  if (scene.log.length > LOG_MAX) scene.log.splice(0, scene.log.length - LOG_MAX)
}

function pushPrompt(scene: SceneTriggers, prompt: Omit<TriggerPrompt, 'id'>): void {
  scene.prompts.push({ ...prompt, id: mintId('p') })
  if (scene.prompts.length > PROMPTS_MAX) scene.prompts.splice(0, scene.prompts.length - PROMPTS_MAX)
}

/** Quiet diegetic narration, never the debug-shaped "Time: dusk" — one phrase per value,
 *  read at the table like any other trigger line. */
const TIME_PHRASES: Record<TimeOfDay, string> = {
  dawn: 'Dawn breaks',
  day: 'Daylight returns',
  dusk: 'Dusk settles',
  night: 'Night falls',
}
const WEATHER_PHRASES: Record<Weather, string> = {
  clear: 'The sky clears',
  overcast: 'Clouds gather',
  rain: 'Rain begins to fall',
  storm: 'A storm rolls in',
  fog: 'Fog creeps in',
  snow: 'Snow begins to fall',
}

/** The light level in the same voice — what the table *sees* happen, never "ambient: darkness". */
const AMBIENT_PHRASES: Record<AmbientLevel, string> = {
  daylight: 'The dark lifts',
  dusk: 'The light thins',
  darkness: 'Darkness closes in',
}

/** …and the dial handed back: the scene lights itself the way its map was authored again. */
const AMBIENT_CLEARED = 'The light settles as it was'

/** Narration for the darkness slider landing, in the voice of the level it reads as. */
function darknessText(darkness: number | null): string {
  if (darkness === null) return AMBIENT_CLEARED
  return AMBIENT_PHRASES[darknessLevel(darkness)]
}

type EnvDelta = { time?: TimeOfDay; weather?: Weather; ambient?: AmbientLevel }

/** Shared by `set-environment` and the `environment` fire-action — one sentence, one place.
 *  Takes the DELTA (only the field(s) this change actually touches), never the whole merged
 *  env: restating an unchanged field alongside the one that moved would narrate a no-op. */
function envText(delta: EnvDelta, ambientCleared = false): string {
  const parts: string[] = []
  if (delta.time) parts.push(TIME_PHRASES[delta.time])
  if (delta.weather) parts.push(WEATHER_PHRASES[delta.weather])
  if (delta.ambient) parts.push(AMBIENT_PHRASES[delta.ambient])
  if (ambientCleared) parts.push(AMBIENT_CLEARED)
  return parts.map((p) => p + '.').join(' ')
}

/** The `light` fire-action's log line — the light's own authored name, or the nameless
 *  fallback. Never the id: that means nothing to a player. A default auto-name like
 *  "Light 3" is not authorship, so it narrates nameless too. */
function lightText(name: string | undefined, on: boolean): string {
  const trimmed = name?.trim()
  const named = trimmed && !/^Light \d+$/.test(trimmed) ? trimmed : undefined
  if (on) return named ? `${named} lights` : 'A light kindles'
  return named ? `${named} goes dark` : 'A light goes dark'
}

// ── DM commands ──────────────────────────────────────────────────────────────

/**
 * The narration labels, plus two compatibility paths for clients built before the Lighting
 * pass: `weather` also lands on `world.weather` (the live weather lives beside the clock
 * now), and the old 3-state `ambient` dial lands on the darkness slider (daylight 0, dusk 0.5,
 * darkness 1, `null` = follow the sky). Nothing is stored in `env.ambient` any more.
 */
function setEnvironment(p: Payload, ctx: Ctx): void {
  const sceneId = sceneOf(p, ctx)
  const scene = sceneTriggersOf(ctx.state, sceneId)
  if (p.time === undefined && p.weather === undefined && p.ambient === undefined) {
    bad('set-environment needs time, weather or ambient')
  }
  const delta: EnvDelta = {}
  if (p.time !== undefined) delta.time = oneOf(p.time, TIMES, 'time')
  if (p.weather !== undefined) delta.weather = oneOf(p.weather, WEATHERS, 'weather')
  const clearAmbient = p.ambient === null
  if (p.ambient !== undefined && !clearAmbient) delta.ambient = oneOf(p.ambient, AMBIENTS, 'ambient')
  const env: SceneTriggers['env'] = { ...scene.env }
  delete (env as { ambient?: unknown }).ambient
  if (delta.time) env.time = delta.time
  if (delta.weather) env.weather = delta.weather
  const next = { ...scene, env, log: [...scene.log] }
  pushLog(
    next,
    { kind: 'environment', text: envText(delta, clearAmbient), toPlayers: true },
    Date.now(),
  )
  const world: WorldState = { ...worldOf(ctx.state) }
  if (delta.weather) world.weather = delta.weather
  if (delta.ambient) world.darkness = AMBIENT_DARKNESS[delta.ambient]
  if (clearAmbient) world.darkness = null
  const touchesWorld = delta.weather !== undefined || delta.ambient !== undefined || clearAmbient
  ctx.setState({
    ...ctx.state,
    byScene: { ...ctx.state.byScene, [sceneId]: next },
    ...(touchesWorld ? { world } : {}),
  })
}

/**
 * The world's own dials — one clock and one sky for the whole campaign (`WorldState`), so this
 * is the one handler that writes beside `byScene` rather than into it.
 *
 * The clock is where `env.time` came from all along: rather than keep a second source of truth
 * for the hour, moving the clock across a band narrates the change in exactly the voice the
 * time dial used (`TIME_PHRASES`), and only when the band actually turns over — a DM nudging
 * the slider through the afternoon is not four announcements of the same daylight.
 */
function setWorld(p: Payload, ctx: Ctx): void {
  if (
    p.clock === undefined &&
    p.nightSky === undefined &&
    p.timeSpeed === undefined &&
    p.weather === undefined &&
    p.darkness === undefined
  ) {
    bad('set-world needs clock, nightSky, timeSpeed, weather or darkness')
  }
  const before = worldOf(ctx.state)
  const next: WorldState = { ...before }
  if (p.clock !== undefined) {
    const clock = Math.floor(num(p.clock, 'clock'))
    if (!Number.isFinite(clock) || clock < 0 || clock >= DAY_MINUTES) {
      bad(`clock must be a minute of the day, 0-${DAY_MINUTES - 1}`)
    }
    next.clock = clock
  }
  if (p.nightSky !== undefined) next.nightSky = oneOf(p.nightSky, NIGHT_SKIES, 'nightSky')
  if (p.timeSpeed !== undefined) next.timeSpeed = oneOf(p.timeSpeed, TIME_SPEEDS, 'timeSpeed')
  if (p.weather !== undefined) next.weather = oneOf(p.weather, WEATHERS, 'weather')
  if (p.darkness !== undefined) {
    if (p.darkness === null) next.darkness = null
    else {
      const darkness = num(p.darkness, 'darkness')
      if (!(darkness >= 0 && darkness <= 1)) bad('darkness must be 0..1, or null to follow the sky')
      next.darkness = darkness
    }
  }
  // The weather and the slider landing narrate like the dials they replace, and only when
  // they actually change. A DM dragging the slider commits once, on release.
  const said: string[] = []
  if (next.weather && next.weather !== before.weather) said.push(`${WEATHER_PHRASES[next.weather]}.`)
  if (p.darkness !== undefined && next.darkness !== before.darkness) {
    said.push(`${darknessText(next.darkness ?? null)}.`)
  }

  const band = timeOfDayAt(next.clock)
  if (band !== timeOfDayAt(before.clock)) said.unshift(`${TIME_PHRASES[band]}.`)
  if (said.length > 0) {
    const sceneId = ctx.activeSceneId
    if (sceneId) {
      const scene = sceneTriggersOf(ctx.state, sceneId)
      const narrated = { ...scene, log: [...scene.log] }
      pushLog(narrated, { kind: 'environment', text: said.join(' '), toPlayers: true }, Date.now())
      ctx.setState({
        ...ctx.state,
        world: next,
        byScene: { ...ctx.state.byScene, [sceneId]: narrated },
      })
      return
    }
  }
  ctx.setState({ ...ctx.state, world: next })
}

function setEnabled(p: Payload, ctx: Ctx): void {
  const sceneId = sceneOf(p, ctx)
  const scene = sceneTriggersOf(ctx.state, sceneId)
  const triggerId = str(p.triggerId, 'triggerId', ID_MAX)
  const enabled = bool(p.enabled, 'enabled')
  setScene(ctx, sceneId, { ...scene, disabled: { ...scene.disabled, [triggerId]: !enabled } })
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i
const FALLOFFS = ['linear', 'quadratic'] as const
const ANIMATIONS = ['flicker', 'pulse'] as const

/** Everything a DM's live edit can touch (M2), validated field-by-field — same shape as
 *  `parseDefFields`/`parseLight` in tokens/validate.ts, kept here since it is this module's
 *  own payload, not a token's. */
function parseLightPatch(v: unknown): LightEdit {
  const p = obj(v, 'patch')
  const patch: LightEdit = {}
  if (p.visible !== undefined) patch.visible = bool(p.visible, 'patch.visible')
  if (p.radius !== undefined) {
    const radius = num(p.radius, 'patch.radius')
    if (radius <= 0) bad('patch.radius must be > 0')
    patch.radius = radius
  }
  if (p.featherRadius !== undefined) {
    const featherRadius = num(p.featherRadius, 'patch.featherRadius')
    if (featherRadius < 0) bad('patch.featherRadius must be >= 0')
    patch.featherRadius = featherRadius
  }
  if (p.intensity !== undefined) {
    const intensity = num(p.intensity, 'patch.intensity')
    if (intensity < 0 || intensity > 1) bad('patch.intensity must be 0..1')
    patch.intensity = intensity
  }
  if (p.color !== undefined) {
    const color = str(p.color, 'patch.color', COLOR_MAX)
    if (!HEX_COLOR.test(color)) bad('patch.color must be a 6-digit hex colour, e.g. #a0c4ff')
    patch.color = color
  }
  if (p.falloff !== undefined) patch.falloff = oneOf(p.falloff, FALLOFFS, 'patch.falloff')
  if (p.position !== undefined) {
    const pos = obj(p.position, 'patch.position')
    patch.position = { x: num(pos.x, 'patch.position.x'), y: num(pos.y, 'patch.position.y') }
  }
  if (p.cone !== undefined) {
    const cone = obj(p.cone, 'patch.cone')
    const angle = num(cone.angle, 'patch.cone.angle')
    if (angle < 10 || angle > 360) bad('patch.cone.angle must be 10..360')
    patch.cone = { angle, direction: num(cone.direction, 'patch.cone.direction') }
  }
  if (p.animation !== undefined) {
    const animation = obj(p.animation, 'patch.animation')
    const speed = num(animation.speed, 'patch.animation.speed')
    if (speed < 0.25 || speed > 4) bad('patch.animation.speed must be 0.25..4')
    patch.animation = { kind: oneOf(animation.kind, ANIMATIONS, 'patch.animation.kind'), speed }
  }
  if (p.throughWalls !== undefined) patch.throughWalls = bool(p.throughWalls, 'patch.throughWalls')
  if (p.nightOnly !== undefined) {
    const range = obj(p.nightOnly, 'patch.nightOnly')
    const min = num(range.min, 'patch.nightOnly.min')
    const max = num(range.max, 'patch.nightOnly.max')
    if (!(min >= 0 && max <= 1 && min <= max)) bad('patch.nightOnly must be 0 <= min <= max <= 1')
    patch.nightOnly = { min, max }
  }
  if (p.darkness !== undefined) patch.darkness = bool(p.darkness, 'patch.darkness')
  if (p.darkvisionSees !== undefined) patch.darkvisionSees = bool(p.darkvisionSees, 'patch.darkvisionSees')
  if (Object.keys(patch).length === 0) bad('patch needs at least one field')
  return patch
}

/**
 * DM-only live light edit (M2). Shallow-merges onto whatever `lightId` already had — a DM
 * nudging just the colour does not disturb a radius someone else already set. The one
 * cross-field rule (`featherRadius <= radius`) is checked against the *merged* result, because
 * a patch that only ever touches one of the two is still comparing against the other's real
 * current value, not a stale one the payload happens not to mention.
 */
function setLight(p: Payload, ctx: Ctx): void {
  const sceneId = sceneOf(p, ctx)
  const lightId = str(p.lightId, 'lightId', ID_MAX)
  const patch = parseLightPatch(p.patch)
  const scene = sceneTriggersOf(ctx.state, sceneId)
  const merged: LightEdit = { ...scene.lightEdits[lightId], ...patch }
  if (
    merged.featherRadius !== undefined &&
    merged.radius !== undefined &&
    merged.featherRadius > merged.radius
  ) {
    bad('patch.featherRadius must be <= radius')
  }
  setScene(ctx, sceneId, { ...scene, lightEdits: { ...scene.lightEdits, [lightId]: merged } })
}

/**
 * DM-only: every placed light on or off at once (the World panel's All lights). Writes
 * `visible` into each light's edit, so a later per-light toggle still works and `reset-light`
 * still hands one back to the map.
 */
function setLightsAll(p: Payload, ctx: Ctx, deps: TriggerDeps): void {
  const sceneId = sceneOf(p, ctx)
  const on = bool(p.on, 'on')
  const scene = sceneTriggersOf(ctx.state, sceneId)
  // Lights, not darkness sources: a darkness the DM placed is not one of the table's lights.
  const ids = deps.lightIdsOf ? deps.lightIdsOf(ctx.campaignId, sceneId) : Object.keys(scene.lightEdits)
  const lightEdits = { ...scene.lightEdits }
  for (const id of ids) {
    if (lightEdits[id]?.darkness) continue
    lightEdits[id] = { ...lightEdits[id], visible: on }
  }
  setScene(ctx, sceneId, { ...scene, lightEdits })
}

/** DM-only: a room's live mood (`patch.mood`; `null` hands it back to the map's look chain). */
function setRoom(p: Payload, ctx: Ctx): void {
  const sceneId = sceneOf(p, ctx)
  const roomId = str(p.roomId, 'roomId', ID_MAX)
  const patch = obj(p.patch, 'patch')
  if (patch.mood === undefined) bad('patch needs mood')
  const scene = sceneTriggersOf(ctx.state, sceneId)
  const roomEdits = { ...roomEditsOf(scene) }
  const edit: RoomEdit = { ...roomEdits[roomId] }
  if (patch.mood === null) delete edit.mood
  else edit.mood = oneOf(patch.mood, MOODS, 'patch.mood')
  if (Object.keys(edit).length === 0) delete roomEdits[roomId]
  else roomEdits[roomId] = edit
  setScene(ctx, sceneId, { ...scene, roomEdits })
}

/** DM-only: pins a seat to a level (`levelId`), or `null` to let it follow its token again. */
function setSeatLevel(p: Payload, ctx: Ctx): void {
  const sceneId = sceneOf(p, ctx)
  const identity = str(p.identity, 'identity', ID_MAX)
  const scene = sceneTriggersOf(ctx.state, sceneId)
  const seatLevel = { ...scene.seatLevel }
  if (p.levelId === null) delete seatLevel[identity]
  else seatLevel[identity] = str(p.levelId, 'levelId', ID_MAX)
  setScene(ctx, sceneId, { ...scene, seatLevel })
}

/** DM-only: the level the DM's own view shows. */
function setDmLevel(p: Payload, ctx: Ctx): void {
  const sceneId = sceneOf(p, ctx)
  const scene = sceneTriggersOf(ctx.state, sceneId)
  setScene(ctx, sceneId, { ...scene, dmLevelId: str(p.levelId, 'levelId', ID_MAX) })
}

/** Drops a light back to however the map authored it — the DM's whole edit, not one field. */
function resetLight(p: Payload, ctx: Ctx): void {
  const sceneId = sceneOf(p, ctx)
  const lightId = str(p.lightId, 'lightId', ID_MAX)
  const scene = sceneTriggersOf(ctx.state, sceneId)
  if (!(lightId in scene.lightEdits)) return // nothing edited — quiet no-op
  const lightEdits = { ...scene.lightEdits }
  delete lightEdits[lightId]
  setScene(ctx, sceneId, { ...scene, lightEdits })
}

/**
 * A light as a DM's live edit leaves it (M2) — an edit's absent fields fall back to the
 * light's own (authored) values, and no edit at all is the light untouched. One function so
 * the server's vision sweep and the client's renderer never answer "what does this light look
 * like right now" two different ways.
 *
 * Generic over the light shape on purpose: the server's fog code and the client's `LightChild`
 * are different types that happen to share these fields, and this module has no reason to
 * import either just to name one.
 *
 * A light authored "off at the table" (`tableOn: false`) starts out; a live `visible` edit
 * (a per-light toggle, All lights, a trigger) still wins.
 */
export function effectiveLight<
  T extends {
    visible: boolean
    radius: number
    featherRadius: number
    intensity: number
    color: string
    position: { x: number; y: number }
    tableOn?: boolean
  },
>(light: T, edit: LightEdit | undefined): T {
  const authored = light.tableOn === false && light.visible ? { ...light, visible: false } : light
  return edit ? { ...authored, ...edit } : authored
}

/**
 * Manual force-fire. Only "does this trigger exist and is it sane" gates it — `def.enabled`,
 * `disabled`, `once`/already-fired are all runtime brakes on the *automatic* evaluation
 * (`event`), and a DM reaching for the manual override is explicitly asking to skip past
 * them. Only `inert` (a broken authoring reference) and an unknown id still refuse.
 */
function fireCommand(p: Payload, ctx: Ctx, deps: TriggerDeps): void {
  const sceneId = sceneOf(p, ctx)
  const triggerId = str(p.triggerId, 'triggerId', ID_MAX)
  const prep = deps.prepOf(ctx.campaignId, sceneId)
  const trigger = prep?.triggers.find((t) => t.def.id === triggerId)
  if (!trigger) bad(`no trigger '${triggerId}' in that scene`)
  if (trigger.inert) bad(`trigger '${triggerId}' is inert: ${trigger.inert}`)

  const scene = cloneScene(sceneTriggersOf(ctx.state, sceneId))
  const now = (deps.now ?? Date.now)()
  fireTrigger(scene, trigger, null, deps, now, sceneId, ctx)
  setScene(ctx, sceneId, scene)
}

function rollPrompt(p: Payload, ctx: Ctx, deps: TriggerDeps): void {
  const sceneId = sceneOf(p, ctx)
  const scene = sceneTriggersOf(ctx.state, sceneId)
  const promptId = str(p.promptId, 'promptId', ID_MAX)
  const prompt = scene.prompts.find((pr) => pr.id === promptId)
  if (!prompt) bad(`no prompt '${promptId}' in that scene`)
  if (ctx.sender.role !== 'dm' && prompt.targetIdentityId !== ctx.sender.identityId) {
    denied('that prompt is not yours to roll')
  }

  const rollFn = deps.rollFn ?? roll
  const now = (deps.now ?? Date.now)()
  const dc = prompt.dc ?? 0
  const save = rollFn('1d20')
  const success = save.total >= dc
  let damage: RollResult | undefined
  // A malformed formula must not crash the roll a player just asked to make: the save
  // outcome still lands, damage is simply skipped, and the DM's log carries why.
  let malformedDamage: string | undefined
  if (!success && prompt.kind === 'trap' && prompt.damage) {
    try {
      damage = rollFn(prompt.damage)
    } catch {
      malformedDamage = prompt.damage
    }
  }

  const next = cloneScene(scene)
  next.prompts = next.prompts.filter((pr) => pr.id !== promptId)
  pushLog(
    next,
    {
      triggerId: prompt.triggerId,
      kind: 'roll-outcome',
      text: rollOutcomeText(prompt, ctx, save, dc, success),
      toPlayers: false,
      forIdentityId: prompt.targetIdentityId ?? undefined,
      detail: { save, ...(damage ? { damage } : {}), success, dc },
    },
    now,
  )
  if (malformedDamage !== undefined) {
    pushLog(
      next,
      {
        triggerId: prompt.triggerId,
        kind: 'error',
        text: `Trap damage formula '${malformedDamage}' is malformed — no damage rolled`,
        toPlayers: false,
      },
      now,
    )
  }
  setScene(ctx, sceneId, next)
}

function rollOutcomeText(
  prompt: TriggerPrompt,
  ctx: Ctx,
  save: RollResult,
  dc: number,
  success: boolean,
): string {
  const who = prompt.targetIdentityId
    ? (ctx.players.find((pl) => pl.identityId === prompt.targetIdentityId)?.name ?? 'Someone')
    : 'The DM'
  const word = prompt.kind === 'trap' ? 'save' : 'check'
  const ability = prompt.ability ? `${prompt.ability.toUpperCase()} ` : ''
  return `${who}'s ${ability}${word}: ${save.total} vs DC ${dc} — ${success ? 'success' : 'failure'}`
}

function dismissPrompt(p: Payload, ctx: Ctx): void {
  const sceneId = sceneOf(p, ctx)
  const scene = sceneTriggersOf(ctx.state, sceneId)
  const promptId = str(p.promptId, 'promptId', ID_MAX)
  if (!scene.prompts.some((pr) => pr.id === promptId)) bad(`no prompt '${promptId}' in that scene`)
  setScene(ctx, sceneId, { ...scene, prompts: scene.prompts.filter((pr) => pr.id !== promptId) })
}

// ── the Journal (share-note / share-card) ────────────────────────────────────

const JOURNAL_MAX = 500
const JOURNAL_TITLE_MAX = 120
const JOURNAL_BODY_MAX = 4000

/**
 * Appends one entry to the session-scoped journal and narrates its arrival on the *target*
 * scene's own trigger log — `show-text`/`toPlayers: true` is a kind the client's toast picker
 * already treats as world narration (useTriggerToasts.ts's `WORLD_KINDS`), so a card's
 * arrival toasts at the table with zero new client plumbing. One `setState`, same as every
 * other handler in this file — `extra` folds in `share-note`'s receipt write so it lands in
 * that one call too.
 */
function publishJournalEntry(
  ctx: Ctx,
  sceneId: string,
  entry: JournalEntry,
  now: number,
  extra: { shareReceipts?: Record<string, ShareReceipt> } = {},
): void {
  const journal = [...journalOf(ctx.state), entry]
  if (journal.length > JOURNAL_MAX) journal.splice(0, journal.length - JOURNAL_MAX)
  const scene = cloneScene(sceneTriggersOf(ctx.state, sceneId))
  pushLog(scene, { kind: 'show-text', text: `${entry.title} — shared to the Journal`, toPlayers: true }, now)
  ctx.setState({
    ...ctx.state,
    journal,
    ...(extra.shareReceipts ? { shareReceipts: extra.shareReceipts } : {}),
    byScene: { ...ctx.state.byScene, [sceneId]: scene },
  })
}

/**
 * DM-only. Snapshots a `RoomNote`'s title/body/imageKeys into the Journal — read fresh off
 * `deps.prepOf` (prep PUTs are quiet, same as `fireCommand`) and copied field by field, never
 * held by reference, so a DM editing the note afterward cannot rewrite what already went out.
 */
function shareNote(p: Payload, ctx: Ctx, deps: TriggerDeps): void {
  const sceneId = sceneOf(p, ctx)
  const noteId = str(p.noteId, 'noteId', ID_MAX)
  const kicker = p.kicker !== undefined ? oneOf(p.kicker, JOURNAL_KICKERS, 'kicker') : 'lore'
  const prep = deps.prepOf(ctx.campaignId, sceneId)
  const resolved = prep?.notes.find((n) => n.note.id === noteId)
  if (!resolved) bad(`no note '${noteId}' in that scene`)
  const note = resolved.note

  const now = (deps.now ?? Date.now)()
  const entry: JournalEntry = {
    id: mintId('j'),
    at: now,
    kicker,
    title: note.title,
    body: note.body,
    ...(note.imageKeys.length > 0 ? { imageKeys: [...note.imageKeys] } : {}),
    sceneId,
    sourceNoteId: noteId,
  }
  const shareReceipts = { ...shareReceiptsOf(ctx.state), [noteId]: { at: now, journalEntryId: entry.id } }
  publishJournalEntry(ctx, sceneId, entry, now, { shareReceipts })
}

/**
 * DM-only. Two forms:
 * - `{ title, body, kicker? }`: an on-the-fly text card, no image support (authored notes
 *   carry images).
 * - `{ roomId, kicker? }`: snapshots that room key's read-aloud, exactly as authored, under
 *   the room's label. Read fresh off `deps.prepOf` like `share-note`, and receipted under
 *   `roomShareKey(roomId)` so the DM's own panel can say when it went out.
 */
function shareCard(p: Payload, ctx: Ctx, deps: TriggerDeps): void {
  const sceneId = sceneOf(p, ctx)
  if (p.roomId !== undefined) return shareRoomKey(p, sceneId, ctx, deps)
  const kicker = p.kicker !== undefined ? oneOf(p.kicker, JOURNAL_KICKERS, 'kicker') : 'lore'
  const title = str(p.title, 'title', JOURNAL_TITLE_MAX)
  const body = str(p.body, 'body', JOURNAL_BODY_MAX)
  const now = (deps.now ?? Date.now)()
  const entry: JournalEntry = { id: mintId('j'), at: now, kicker, title, body, sceneId }
  publishJournalEntry(ctx, sceneId, entry, now)
}

function shareRoomKey(p: Payload, sceneId: string, ctx: Ctx, deps: TriggerDeps): void {
  const roomId = str(p.roomId, 'roomId', ID_MAX)
  const kicker = p.kicker !== undefined ? oneOf(p.kicker, JOURNAL_KICKERS, 'kicker') : 'place'
  const resolved = roomKeyIn(deps.prepOf(ctx.campaignId, sceneId), roomId)
  const readAloud = resolved.key.readAloud.trim()
  if (!readAloud) bad(`room '${roomId}' has no read-aloud to share`)

  const now = (deps.now ?? Date.now)()
  const entry: JournalEntry = {
    id: mintId('j'),
    at: now,
    kicker,
    title: (resolved.label || 'A room').slice(0, JOURNAL_TITLE_MAX),
    body: readAloud.slice(0, JOURNAL_BODY_MAX),
    sceneId,
    sourceRoomId: roomId,
  }
  const shareReceipts = {
    ...shareReceiptsOf(ctx.state),
    [roomShareKey(roomId)]: { at: now, journalEntryId: entry.id },
  }
  publishJournalEntry(ctx, sceneId, entry, now, { shareReceipts })
}

/** The resolved key for a room, or a refusal naming why there is none. */
function roomKeyIn(prep: ResolvedPrep | null, roomId: string): ResolvedRoomKey {
  const resolved = prep ? roomKeysOf(prep).find((r) => r.key.roomId === roomId) : undefined
  if (!resolved) bad(`no room key for '${roomId}' in that scene`)
  return resolved
}

/**
 * DM-only. Runs a room key's encounter through the same runner an `encounter` trigger action
 * uses, with the room's face as the spawn region: tokens fan out from the room's anchor and
 * only onto cells inside the room. `seedInitiative` defaults on (a keyed encounter is a fight
 * the DM is starting). Deliberate and repeatable: the spawn is stamped in `fired` under
 * `roomSpawnKey` for the DM's panel, but a second call spawns a second wave.
 */
function spawnEncounter(p: Payload, ctx: Ctx, deps: TriggerDeps): void {
  const sceneId = sceneOf(p, ctx)
  const roomId = str(p.roomId, 'roomId', ID_MAX)
  const seedInitiative = p.seedInitiative === undefined ? true : bool(p.seedInitiative, 'seedInitiative')
  const resolved = roomKeyIn(deps.prepOf(ctx.campaignId, sceneId), roomId)
  if (resolved.inert) bad(`room key '${roomId}' is inert: ${resolved.inert}`)
  const encounter = resolved.key.encounter
  if (!encounter || encounter.monsters.length === 0) bad(`room '${roomId}' has no encounter`)
  if (resolved.encounterInert) bad(`room '${roomId}' encounter is inert: ${resolved.encounterInert}`)

  const scene = cloneScene(sceneTriggersOf(ctx.state, sceneId))
  const now = (deps.now ?? Date.now)()
  runEncounter(
    scene,
    { name: encounter.name || resolved.label || 'Encounter', monsters: encounter.monsters, spawn: true, seedInitiative },
    { at: resolved.spawnAt, region: resolved.region },
    { roomId },
    deps,
    now,
    sceneId,
    ctx,
  )
  scene.fired[roomSpawnKey(roomId)] = now
  setScene(ctx, sceneId, scene)
}

// ── the internal 'event' action ──────────────────────────────────────────────

interface EventSource {
  module: 'tokens' | 'fog'
  action: string
}

/**
 * Recomputed from post-write truth every call — `deps` reads are fresh, so this never trusts
 * a cached view of tokens/fog. One `ctx.setState` at the end of the whole cascade: the
 * registry persists and broadcasts per `setState` call, and a scene full of triggers firing
 * off one token move is one moment at the table, not a flurry of separate updates.
 */
function event(p: Payload, ctx: Ctx, deps: TriggerDeps): void {
  const sceneId = str(p.sceneId, 'sceneId', ID_MAX)
  const sourceRaw = obj(p.source, 'source')
  const source: EventSource = {
    module: oneOf(sourceRaw.module, ['tokens', 'fog'] as const, 'source.module'),
    action: str(sourceRaw.action, 'source.action', ID_MAX),
  }

  const prep = deps.prepOf(ctx.campaignId, sceneId)
  if (!prep) return // no prep authored for this scene — nothing can fire.

  const scene = cloneScene(sceneTriggersOf(ctx.state, sceneId))
  const now = (deps.now ?? Date.now)()

  // Most cascades change nothing (every token drag step lands here) — skip the setState
  // entirely then, or every move would double the table's broadcast traffic with an
  // identical triggers state-update.
  let changed = false

  // A true fog reset re-arms room-revealed triggers only — a sprung trap stays sprung, the
  // room just goes dark again and can be walked into a second time. Reveal-notes re-arm on
  // the same rule (their `fired` keys are `note:`-prefixed so the two namespaces never mix).
  if (source.module === 'fog' && source.action === 'reset') {
    for (const t of prep.triggers) {
      if (t.def.when.kind === 'room-revealed' && t.def.id in scene.fired) {
        delete scene.fired[t.def.id]
        changed = true
      }
    }
    for (const n of prep.notes) {
      if (noteKey(n.note.id) in scene.fired) {
        delete scene.fired[noteKey(n.note.id)]
        changed = true
      }
    }
    for (const r of roomKeysOf(prep)) {
      if (roomRevealKey(r.key.roomId) in scene.fired) {
        delete scene.fired[roomRevealKey(r.key.roomId)]
        changed = true
      }
    }
  }

  const tokens = Object.values(deps.tokensOf(ctx.campaignId, sceneId)).filter((t) => !t.hidden)
  const explored = deps.exploredOf(ctx.campaignId, sceneId)

  // Reveal-notes: the DM's read-aloud text surfacing at exactly the moment the party uncovers
  // the room. DM-only always — a note is prep, never player narration.
  for (const n of prep.notes) {
    if (!n.note.showOnReveal || n.inert || !n.roomId) continue
    if (explored.includes(n.roomId) && !scene.fired[noteKey(n.note.id)]) {
      pushLog(
        scene,
        {
          kind: 'note',
          text: n.note.title ? `${n.note.title} — ${n.note.body}` : n.note.body,
          toPlayers: false,
          detail: { noteId: n.note.id },
        },
        now,
      )
      scene.fired[noteKey(n.note.id)] = now
      changed = true
    }
  }

  // Room keys (prep v3) pop the same way the moment their room is uncovered: a DM-only line
  // carrying a preview of the read-aloud, which the DM's toast offers to Share. A key with no
  // read-aloud has nothing to read out, so it stays quiet.
  for (const r of roomKeysOf(prep)) {
    const roomId = r.key.roomId
    const readAloud = r.key.readAloud.trim()
    if (r.inert || !readAloud) continue
    if (explored.includes(roomId) && !scene.fired[roomRevealKey(roomId)]) {
      pushLog(
        scene,
        {
          kind: 'room-key',
          text: `${r.label || 'A room'} — ${preview(readAloud)}`,
          toPlayers: false,
          detail: { roomId },
        },
        now,
      )
      scene.fired[roomRevealKey(roomId)] = now
      changed = true
    }
  }

  for (const t of prep.triggers) {
    if (!t.def.enabled) continue
    if (scene.disabled[t.def.id]) continue
    if (t.inert) continue

    if (t.def.when.kind === 'room-revealed') {
      if (t.roomId && explored.includes(t.roomId) && !scene.fired[t.def.id]) {
        fireTrigger(scene, t, null, deps, now, sceneId, ctx)
        changed = true
      }
      continue
    }

    // enter-region and within-radius share one rising-edge latch: the DM-facing distinction
    // between "stepped into the room" and "got within N feet of the thing" is entirely in
    // how the server resolved `shape` (a full zone vs. a radius around it) — the latch and
    // the fire-on-entry mechanics are identical, so one code path serves both.
    if (t.def.when.kind === 'enter-region' || t.def.when.kind === 'within-radius') {
      const shape = t.shape
      const insideToken = shape ? tokens.find((tok) => insideShape(tok, shape)) : undefined
      const wasArmed = !!scene.armed[t.def.id]
      if (insideToken) {
        if (!wasArmed) {
          if (!(t.def.once && scene.fired[t.def.id])) {
            fireTrigger(scene, t, insideToken, deps, now, sceneId, ctx)
          }
          scene.armed[t.def.id] = true
          changed = true
        }
      } else if (wasArmed) {
        scene.armed[t.def.id] = false
        changed = true
      }
    }
  }

  if (changed) setScene(ctx, sceneId, scene)
}

function insideShape(token: TriggerToken, shape: NonNullable<ResolvedTrigger['shape']>): boolean {
  if (shape.kind === 'circle') {
    const dx = token.x - shape.x
    const dy = token.y - shape.y
    return Math.sqrt(dx * dx + dy * dy) <= shape.radius
  }
  return (
    token.x >= shape.x &&
    token.x <= shape.x + shape.width &&
    token.y >= shape.y &&
    token.y <= shape.y + shape.height
  )
}

/** A scene about to be mutated in place across a cascade of actions/triggers — one copy in,
 *  one `setState` out. */
function cloneScene(scene: SceneTriggers): SceneTriggers {
  return {
    ...scene,
    fired: { ...scene.fired },
    armed: { ...scene.armed },
    disabled: { ...scene.disabled },
    lightOverrides: { ...scene.lightOverrides },
    lightEdits: { ...scene.lightEdits },
    env: { ...scene.env },
    prompts: [...scene.prompts],
    log: [...scene.log],
  }
}

/** The `fired`-map key a reveal-note uses — prefixed so the note and trigger id namespaces
 *  can never collide in the one shared map. */
const noteKey = (noteId: string): string => `note:${noteId}`

/** How much of a read-aloud the reveal toast carries; the whole text is one Share away. */
const PREVIEW_MAX = 160

function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ')
  return flat.length <= PREVIEW_MAX ? flat : `${flat.slice(0, PREVIEW_MAX - 1).trimEnd()}…`
}

/** Runs every action on a trigger and marks it fired. `token` is the one whose entry caused
 *  this (enter-region/within-radius) or null (room-revealed, and a manual `fire`). */
function fireTrigger(
  scene: SceneTriggers,
  t: ResolvedTrigger,
  token: TriggerToken | null,
  deps: TriggerDeps,
  now: number,
  sceneId: string,
  ctx: Ctx,
): void {
  for (const action of t.def.actions) runFireAction(scene, t, action, token, deps, now, sceneId, ctx)
  scene.fired[t.def.id] = now
}

function runFireAction(
  scene: SceneTriggers,
  t: ResolvedTrigger,
  action: TriggerAction,
  token: TriggerToken | null,
  deps: TriggerDeps,
  now: number,
  sceneId: string,
  ctx: Ctx,
): void {
  const targetIdentityId = token ? token.ownerId : null
  switch (action.kind) {
    case 'show-text':
      pushLog(scene, { triggerId: t.def.id, kind: 'show-text', text: action.text, toPlayers: action.toPlayers }, now)
      return

    case 'light':
      // M2 — writes go to `lightEdits` now; `lightOverrides` is read-compat only (types.ts).
      scene.lightEdits[action.lightId] = { ...scene.lightEdits[action.lightId], visible: action.on }
      // M5 — the client's relight is live (lightSync.ts), so the log line rides along with
      // it: player-visible, and never a raw light-child id (an unnamed light still reads as
      // a light, never as a UUID).
      pushLog(
        scene,
        {
          triggerId: t.def.id,
          kind: 'light',
          text: lightText(t.lightNames?.[action.lightId], action.on),
          toPlayers: action.toPlayers ?? true,
        },
        now,
      )
      return

    case 'trap':
      // A trap with no authored save has nothing to prompt anyone for — it just hits.
      // Roll the damage (if any) immediately and log the outcome; only a trap that has a
      // save becomes a `TriggerPrompt` a player answers.
      if (!action.save) {
        if (action.damage) {
          // A malformed authored formula must not crash the cascade a token's own move
          // kicked off — the trigger still fires (fireTrigger marks it below), only the
          // damage roll is skipped, and the DM's log carries why.
          try {
            const dmg = (deps.rollFn ?? roll)(action.damage)
            pushLog(
              scene,
              {
                triggerId: t.def.id,
                kind: 'trap',
                text: `${action.text} — ${dmg.total} damage`,
                toPlayers: false,
                forIdentityId: targetIdentityId ?? undefined,
                detail: { damage: dmg },
              },
              now,
            )
          } catch {
            pushLog(
              scene,
              {
                triggerId: t.def.id,
                kind: 'error',
                text: `Trap damage formula '${action.damage}' is malformed — ${action.text}`,
                toPlayers: false,
              },
              now,
            )
          }
        } else {
          pushLog(scene, { triggerId: t.def.id, kind: 'trap', text: action.text, toPlayers: false }, now)
        }
        return
      }
      pushPrompt(scene, {
        triggerId: t.def.id,
        kind: 'trap',
        targetIdentityId,
        tokenId: token?.id,
        text: action.text,
        ability: action.save.ability,
        dc: action.save.dc,
        damage: action.damage,
        at: now,
      })
      pushLog(scene, { triggerId: t.def.id, kind: 'trap', text: action.text, toPlayers: false }, now)
      return

    case 'ability-check':
      pushPrompt(scene, {
        triggerId: t.def.id,
        kind: 'ability-check',
        targetIdentityId,
        tokenId: token?.id,
        text: action.text,
        ability: action.ability,
        dc: action.dc,
        at: now,
      })
      pushLog(scene, { triggerId: t.def.id, kind: 'ability-check', text: action.text, toPlayers: false }, now)
      return

    case 'prompt':
      // v1: initiative/attack prompts are DM-only narration, no player-facing UX yet.
      pushLog(
        scene,
        {
          triggerId: t.def.id,
          kind: 'prompt',
          text: action.text ?? `${action.prompt} prompt`,
          toPlayers: false,
        },
        now,
      )
      return

    case 'environment': {
      // ponytail: an authored trigger sets time/weather only — the light level is the DM's
      // live dial (§1). Add `ambient` to the action the day a map wants to author a blackout,
      // which is an editor field as much as a line here.
      const delta: EnvDelta = {}
      if (action.time !== undefined) delta.time = action.time
      if (action.weather !== undefined) delta.weather = action.weather
      scene.env = { ...scene.env, ...delta }
      // The live weather is the world's now; `setScene` writes it there in the same write.
      if (delta.weather) pendingWeather.set(scene, delta.weather)
      pushLog(scene, { triggerId: t.def.id, kind: 'environment', text: envText(delta), toPlayers: true }, now)
      return
    }

    case 'encounter':
      runEncounter(scene, action, { at: t.spawnAt }, { triggerId: t.def.id }, deps, now, sceneId, ctx)
      return
  }
}

/** Where an encounter lands: a zone trigger fans out around its anchor; a room key also hands
 *  its face, and only cells inside it are used. */
interface SpawnPlace {
  at?: { x: number; y: number }
  region?: readonly [number, number][]
}

/**
 * The one encounter runner — an `encounter` trigger action and a room key's Spawn both come
 * through here. The module rolls HP and lays out spawn positions (it owns the dice and the
 * resolved anchor); materializing the token/initiative rows is the server's (`applyEncounter`).
 */
function runEncounter(
  scene: SceneTriggers,
  action: { name: string; monsters: readonly MonsterEntry[]; spawn: boolean; seedInitiative: boolean },
  place: SpawnPlace,
  source: { triggerId?: string; roomId?: string },
  deps: TriggerDeps,
  now: number,
  sceneId: string,
  ctx: Ctx,
): void {
  const rollFn = deps.rollFn ?? roll
  const cells = place.at ? spawnCells(place.at, place.region) : []
  const spawn: NonNullable<EncounterEffects['spawn']> = []
  const seed: NonNullable<EncounterEffects['seed']> = []
  let placed = 0
  for (const monster of action.monsters) {
    // A row the DM left unnamed still spawns something a table can call by name.
    const base = monster.name.trim() || 'Monster'
    for (let n = 1; n <= monster.count; n++) {
      const name = monster.count > 1 ? `${base} ${n}` : base
      let hp: number | undefined
      if (monster.hp) {
        // Resolver validates the formula (a bad one marks the trigger inert), so this
        // guard is only against the two drifting — skip HP, never kill the cascade.
        try {
          hp = rollFn(monster.hp).total
        } catch {
          hp = undefined
        }
      }
      const id = mintId('etok')
      const willSpawn = action.spawn && cells.length > 0
      if (willSpawn) {
        const [x, y] = cells[Math.min(placed, cells.length - 1)]
        spawn.push({
          id,
          name,
          x,
          y,
          size: monster.size ?? 'medium',
          ...(monster.tokenRef ? { packAsset: monster.tokenRef } : {}),
        })
        placed++
      }
      if (action.seedInitiative) {
        seed.push({
          name,
          ...(hp !== undefined ? { hp } : {}),
          ...(willSpawn ? { tokenId: id } : {}),
        })
      }
    }
  }
  if (deps.applyEncounter && (spawn.length > 0 || seed.length > 0)) {
    deps.applyEncounter({ sceneId, name: action.name, spawn, seed }, ctx)
  }
  const total = action.monsters.reduce((s, m) => s + m.count, 0)
  const what = [
    spawn.length > 0 ? `${spawn.length} placed` : null,
    seed.length > 0 ? 'initiative seeded' : null,
  ].filter(Boolean)
  pushLog(
    scene,
    {
      ...(source.triggerId ? { triggerId: source.triggerId } : {}),
      kind: 'encounter',
      text: `${action.name} — ${total} combatant${total === 1 ? '' : 's'}${what.length ? ` (${what.join(', ')})` : ''}`,
      toPlayers: false,
      detail: { spawned: spawn.length, seeded: seed.length, ...(source.roomId ? { roomId: source.roomId } : {}) },
    },
    now,
  )
}

/** Grid-cell offsets fanning out from the anchor — centre first, then rings out to `rings`. */
function ringOffsets(rings: number): [number, number][] {
  const cells: [number, number][] = [[0, 0]]
  for (let r = 1; r <= rings; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === r) cells.push([dx, dy])
      }
    }
  }
  return cells
}

/** A zone anchor's fan: two rings, 25 cells. A roster past 25 stacks on the last cell (the
 *  resolver caps rosters well below that anyway). */
const SPAWN_OFFSETS = ringOffsets(2)
/** A room's fan reaches further, because cells outside the room's face are dropped from it. */
const ROOM_SPAWN_OFFSETS = ringOffsets(6)

/**
 * The positions a roster fills, in order. Without a region, the anchor plus `SPAWN_OFFSETS`
 * exactly as an anchored zone always spawned. With one (a room's face), the anchor's cell
 * centre plus every offset whose cell centre lies inside the face — so a narrow room never
 * spills tokens through its walls. A face too small for any cell keeps the anchor alone.
 */
function spawnCells(
  at: { x: number; y: number },
  region: readonly [number, number][] | undefined,
): [number, number][] {
  if (!region || region.length < 3) return SPAWN_OFFSETS.map(([dx, dy]) => [at.x + dx, at.y + dy])
  const cx = Math.floor(at.x) + 0.5
  const cy = Math.floor(at.y) + 0.5
  const inside = ROOM_SPAWN_OFFSETS.map(([dx, dy]): [number, number] => [cx + dx, cy + dy]).filter(
    ([x, y]) => pointInRing(region, x, y),
  )
  return inside.length > 0 ? inside : [[at.x, at.y]]
}

/** Ray casting — the module stays free of any geometry import. */
function pointInRing(ring: readonly [number, number][], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
