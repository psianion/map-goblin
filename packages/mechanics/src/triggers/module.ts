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
import { ID_MAX, Reject, bad, bool, denied, num, obj, oneOf, str } from '../tokens/validate'
import {
  sceneTriggersOf,
  worldOf,
  type ResolvedTrigger,
  type SceneTriggers,
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
  type TimeOfDay,
  type TriggerAction,
  type Weather,
} from '@dnd/core/src/shared/prep'
import { DAY_MINUTES, NIGHT_SKIES, TIME_SPEEDS, timeOfDayAt } from '@dnd/core/src/shared/world'

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

export interface TriggerDeps {
  /** Fresh read every call — prep PUTs are quiet, so this module never caches it. */
  prepOf(campaignId: string, sceneId: string): { triggers: ResolvedTrigger[] } | null
  tokensOf(campaignId: string, sceneId: string): Record<string, TriggerToken>
  /** Room ids currently revealed-or-explored. */
  exploredOf(campaignId: string, sceneId: string): readonly string[]
  /** Default `../dice/roll` — injected for tests. */
  rollFn?: typeof roll
  /** Default `Date.now` — injected for tests. */
  now?: () => number
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
      'roll-prompt': ANY_ROLE,
      'dismiss-prompt': ['dm'],
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
    // the sky are what the whole table is looking at.
    redact(state, viewer) {
      if (viewer.role === 'dm') return state
      const byScene: TriggersState['byScene'] = {}
      for (const [sceneId, scene] of Object.entries(state.byScene)) {
        byScene[sceneId] = {
          fired: {},
          armed: {},
          disabled: {},
          lightOverrides: scene.lightOverrides,
          env: scene.env,
          prompts: scene.prompts.filter((p) => p.targetIdentityId === viewer.identityId),
          log: scene.log.filter((e) => e.toPlayers || e.forIdentityId === viewer.identityId),
        }
      }
      return { byScene, world: state.world }
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
    case 'roll-prompt':
      return rollPrompt(p, ctx, deps)
    case 'dismiss-prompt':
      return dismissPrompt(p, ctx)
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

function setScene(ctx: Ctx, sceneId: string, scene: SceneTriggers): void {
  ctx.setState({ ...ctx.state, byScene: { ...ctx.state.byScene, [sceneId]: scene } })
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

function setEnvironment(p: Payload, ctx: Ctx): void {
  const sceneId = sceneOf(p, ctx)
  const scene = sceneTriggersOf(ctx.state, sceneId)
  if (p.time === undefined && p.weather === undefined && p.ambient === undefined) {
    bad('set-environment needs time, weather or ambient')
  }
  const delta: EnvDelta = {}
  if (p.time !== undefined) delta.time = oneOf(p.time, TIMES, 'time')
  if (p.weather !== undefined) delta.weather = oneOf(p.weather, WEATHERS, 'weather')
  // The light level rides the same command and the same delta-merge: one dial the DM turns,
  // one narrated line, and every reader of `env` picks it up for free (S3 P3 §1).
  //
  // …with one exception to the merge's "a field is never cleared" rule: an explicit `null`
  // takes the dial off. Absent and `daylight` are not the same scene — absent leaves the
  // lighting composite exactly as the map authored it, `daylight` bites at AMBIENT_BITE — so
  // a DM who has touched the dial needs a way back to untouched (D2). `undefined` still means
  // "leave it alone", for this field as for every other.
  const clearAmbient = p.ambient === null
  if (p.ambient !== undefined && !clearAmbient) delta.ambient = oneOf(p.ambient, AMBIENTS, 'ambient')
  const env = { ...scene.env, ...delta }
  if (clearAmbient) delete env.ambient
  const next = { ...scene, env, log: [...scene.log] }
  pushLog(
    next,
    { kind: 'environment', text: envText(delta, clearAmbient), toPlayers: true },
    Date.now(),
  )
  setScene(ctx, sceneId, next)
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
  if (p.clock === undefined && p.nightSky === undefined && p.timeSpeed === undefined) {
    bad('set-world needs clock, nightSky or timeSpeed')
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

  const band = timeOfDayAt(next.clock)
  if (band !== timeOfDayAt(before.clock)) {
    const sceneId = ctx.activeSceneId
    if (sceneId) {
      const scene = sceneTriggersOf(ctx.state, sceneId)
      const narrated = { ...scene, log: [...scene.log] }
      pushLog(narrated, { kind: 'environment', text: `${TIME_PHRASES[band]}.`, toPlayers: true }, Date.now())
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
  fireTrigger(scene, trigger, null, deps, now)
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
  // room just goes dark again and can be walked into a second time.
  if (source.module === 'fog' && source.action === 'reset') {
    for (const t of prep.triggers) {
      if (t.def.when.kind === 'room-revealed' && t.def.id in scene.fired) {
        delete scene.fired[t.def.id]
        changed = true
      }
    }
  }

  const tokens = Object.values(deps.tokensOf(ctx.campaignId, sceneId)).filter((t) => !t.hidden)
  const explored = deps.exploredOf(ctx.campaignId, sceneId)

  for (const t of prep.triggers) {
    if (!t.def.enabled) continue
    if (scene.disabled[t.def.id]) continue
    if (t.inert) continue

    if (t.def.when.kind === 'room-revealed') {
      if (t.roomId && explored.includes(t.roomId) && !scene.fired[t.def.id]) {
        fireTrigger(scene, t, null, deps, now)
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
            fireTrigger(scene, t, insideToken, deps, now)
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
    fired: { ...scene.fired },
    armed: { ...scene.armed },
    disabled: { ...scene.disabled },
    lightOverrides: { ...scene.lightOverrides },
    env: { ...scene.env },
    prompts: [...scene.prompts],
    log: [...scene.log],
  }
}

/** Runs every action on a trigger and marks it fired. `token` is the one whose entry caused
 *  this (enter-region/within-radius) or null (room-revealed, and a manual `fire`). */
function fireTrigger(
  scene: SceneTriggers,
  t: ResolvedTrigger,
  token: TriggerToken | null,
  deps: TriggerDeps,
  now: number,
): void {
  for (const action of t.def.actions) runFireAction(scene, t, action, token, deps, now)
  scene.fired[t.def.id] = now
}

function runFireAction(
  scene: SceneTriggers,
  t: ResolvedTrigger,
  action: TriggerAction,
  token: TriggerToken | null,
  deps: TriggerDeps,
  now: number,
): void {
  const targetIdentityId = token ? token.ownerId : null
  switch (action.kind) {
    case 'show-text':
      pushLog(scene, { triggerId: t.def.id, kind: 'show-text', text: action.text, toPlayers: action.toPlayers }, now)
      return

    case 'light':
      scene.lightOverrides[action.lightId] = action.on
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
      pushLog(scene, { triggerId: t.def.id, kind: 'environment', text: envText(delta), toPlayers: true }, now)
      return
    }
  }
}
