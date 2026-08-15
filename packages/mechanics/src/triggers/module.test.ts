import { describe, expect, it } from 'vitest'

import type { PlayerInfo } from '@dnd/core/src/shared/protocol'
import type { TriggerDef } from '@dnd/core/src/shared/prep'
import type { GameModule, Viewer } from '../contract'
import type { RollResult } from '../dice/roll'
import {
  ambientOf,
  needsLight,
  sceneTriggersOf,
  triggersModule,
  type ResolvedTrigger,
  type TriggerDeps,
  type TriggersState,
} from './module'

const DM: Viewer = { role: 'dm', identityId: 'dm-1' }
const P1: Viewer = { role: 'player', identityId: 'p-1' }
const P2: Viewer = { role: 'player', identityId: 'p-2' }
const SCENE = 'scene-1'
const ROSTER: PlayerInfo[] = [
  { identityId: 'dm-1', name: 'Ilsa', role: 'dm', connected: true },
  { identityId: 'p-1', name: 'Borin', role: 'player', connected: true },
  { identityId: 'p-2', name: 'Elowen', role: 'player', connected: true },
]

const empty: TriggersState = { byScene: {} }

/** A resolved trigger with sane defaults — one field to override per test. */
function trigger(over: Partial<TriggerDef> & Pick<TriggerDef, 'id' | 'when' | 'actions'>, extra: Partial<ResolvedTrigger> = {}): ResolvedTrigger {
  const def: TriggerDef = { name: over.id, once: false, enabled: true, ...over }
  return { def, ...extra }
}

function makeDeps(over: Partial<TriggerDeps> = {}): TriggerDeps {
  return {
    prepOf: () => null,
    tokensOf: () => ({}),
    exploredOf: () => [],
    now: () => 1000,
    ...over,
  }
}

/** Mirrors ModuleRegistry.dispatch: `commands` gates the role before the handler runs. This
 *  is the only path a network client can reach — `event` is never dispatched through it. */
function run(
  mod: GameModule<TriggersState>,
  state: TriggersState,
  sender: Viewer,
  action: string,
  payload: unknown,
  players: PlayerInfo[] = ROSTER,
) {
  const roles = mod.commands[action]
  if (!roles) return { error: { code: 'invalid-command', message: '' }, next: state }
  if (!roles.includes(sender.role)) return { error: { code: 'unauthorized', message: '' }, next: state }
  let next = state
  const error = mod.handler(action, payload, {
    campaignId: 'c-1',
    sessionId: 's-1',
    activeSceneId: SCENE,
    sender,
    players,
    state,
    setState: (s) => {
      next = s
    },
    broadcast: () => {},
  })
  return { error: error ?? null, next }
}

/** The server's own call site — direct handler invocation, no role gate at all. Only this
 *  path can ever run `event`. */
function fireEvent(mod: GameModule<TriggersState>, state: TriggersState, payload: unknown): TriggersState {
  let next = state
  mod.handler('event', payload, {
    campaignId: 'c-1',
    sessionId: 's-1',
    activeSceneId: SCENE,
    sender: DM,
    players: ROSTER,
    state,
    setState: (s) => {
      next = s
    },
    broadcast: () => {},
  })
  return next
}

const sceneOf = (state: TriggersState) => state.byScene[SCENE]

describe('authz matrix', () => {
  const mod = triggersModule(makeDeps())
  const dmOnly = [
    ['set-environment', { weather: 'rain' }],
    ['fire', { triggerId: 'x' }],
    ['set-enabled', { triggerId: 'x', enabled: false }],
    ['dismiss-prompt', { promptId: 'x' }],
  ] as const

  it.each(dmOnly)('%s is dm-only', (action, payload) => {
    expect(run(mod, empty, P1, action, payload).error).toMatchObject({ code: 'unauthorized' })
    expect(run(mod, empty, DM, action, payload).error?.code).not.toBe('unauthorized')
  })

  it('roll-prompt is open to any role (ownership is checked inside)', () => {
    expect(run(mod, empty, P1, 'roll-prompt', { promptId: 'x' }).error?.code).not.toBe('unauthorized')
  })

  it('has no wire entry for `event` — the role gate refuses it for every role', () => {
    for (const sender of [DM, P1]) {
      expect(run(mod, empty, sender, 'event', { sceneId: SCENE, source: { module: 'tokens', action: 'move' } }).error).toMatchObject(
        { code: 'invalid-command' },
      )
    }
  })

  it('rejects an unknown action', () => {
    expect(run(mod, empty, DM, 'nope', {}).error?.code).toBe('invalid-command')
  })
})

describe('enter-region / within-radius arming', () => {
  const circle = trigger(
    { id: 'er1', when: { kind: 'enter-region', zoneId: 'z1' }, actions: [{ kind: 'show-text', text: 'stepped in', toPlayers: true }] },
    { shape: { kind: 'circle', x: 0, y: 0, radius: 5 } },
  )
  const tok = (x: number) => ({ tok1: { id: 'tok1', x, y: 0, ownerId: null } })
  const deps = makeDeps({ prepOf: () => ({ triggers: [circle] }), tokensOf: () => tok(currentX) })
  const mod = triggersModule(deps)
  let currentX = 100 // outside

  it('fires on the rising edge, not while already armed, then re-arms on leaving', () => {
    currentX = 100
    let state = fireEvent(mod, empty, { sceneId: SCENE, source: { module: 'tokens', action: 'move' } })
    // Nothing to arm or fire — a no-op cascade skips setState entirely (every token drag
    // step lands here; writing identical state would double the table's broadcast traffic).
    expect(state).toBe(empty)

    currentX = 0 // inside
    state = fireEvent(mod, state, { sceneId: SCENE, source: { module: 'tokens', action: 'move' } })
    expect(sceneOf(state).fired.er1).toBe(1000)
    expect(sceneOf(state).armed.er1).toBe(true)
    expect(sceneOf(state).log).toHaveLength(1)

    // still inside — no refire, latch holds, and the no-op skips setState
    const held = fireEvent(mod, state, { sceneId: SCENE, source: { module: 'tokens', action: 'move' } })
    expect(held).toBe(state)

    currentX = 100 // leaves
    state = fireEvent(mod, state, { sceneId: SCENE, source: { module: 'tokens', action: 'move' } })
    expect(sceneOf(state).armed.er1).toBe(false)

    currentX = 0 // re-enters
    state = fireEvent(mod, state, { sceneId: SCENE, source: { module: 'tokens', action: 'move' } })
    expect(sceneOf(state).log).toHaveLength(2)
  })

  it('`once` never refires after the first leave/re-enter', () => {
    const once = trigger(
      { id: 'once1', when: { kind: 'within-radius', zoneId: 'z2' }, once: true, actions: [{ kind: 'show-text', text: 'once', toPlayers: true }] },
      { shape: { kind: 'circle', x: 0, y: 0, radius: 5 } },
    )
    let x = 0
    const d = makeDeps({ prepOf: () => ({ triggers: [once] }), tokensOf: () => tok(x) })
    const m = triggersModule(d)
    let state = fireEvent(m, empty, { sceneId: SCENE, source: { module: 'tokens', action: 'move' } })
    expect(sceneOf(state).log).toHaveLength(1)
    x = 100
    state = fireEvent(m, state, { sceneId: SCENE, source: { module: 'tokens', action: 'move' } })
    x = 0
    state = fireEvent(m, state, { sceneId: SCENE, source: { module: 'tokens', action: 'move' } })
    expect(sceneOf(state).log).toHaveLength(1) // no second fire
  })

  it('a hidden token does not arm anything', () => {
    const d = makeDeps({
      prepOf: () => ({ triggers: [circle] }),
      tokensOf: () => ({ tok1: { id: 'tok1', x: 0, y: 0, ownerId: null, hidden: true } }),
    })
    const m = triggersModule(d)
    const state = fireEvent(m, empty, { sceneId: SCENE, source: { module: 'tokens', action: 'move' } })
    // Hidden tokens change nothing, so the whole event is a skipped no-op.
    expect(state).toBe(empty)
  })
})

describe('fog.reset re-arms room-revealed only', () => {
  const roomRevealed = trigger(
    { id: 'rr1', when: { kind: 'room-revealed', zoneId: 'z1' }, actions: [{ kind: 'show-text', text: 'lit', toPlayers: true }] },
    { roomId: 'room-1' },
  )
  const region = trigger(
    { id: 'er1', when: { kind: 'enter-region', zoneId: 'z2' }, actions: [{ kind: 'show-text', text: 'sprung', toPlayers: true }] },
    { shape: { kind: 'rect', x: 0, y: 0, width: 10, height: 10 } },
  )

  it('clears the room-revealed latch but leaves a sprung trap fired', () => {
    let explored: readonly string[] = ['room-1']
    const deps = makeDeps({
      prepOf: () => ({ triggers: [roomRevealed, region] }),
      tokensOf: () => ({ t: { id: 't', x: 5, y: 5, ownerId: null } }),
      exploredOf: () => explored,
    })
    const mod = triggersModule(deps)

    let state = fireEvent(mod, empty, { sceneId: SCENE, source: { module: 'fog', action: 'reveal' } })
    expect(sceneOf(state).fired.rr1).toBe(1000)
    expect(sceneOf(state).fired.er1).toBe(1000) // the token was already standing in the region

    explored = [] // the reset itself clears the fog's revealed set
    state = fireEvent(mod, state, { sceneId: SCENE, source: { module: 'fog', action: 'reset' } })
    expect(sceneOf(state).fired.rr1).toBeUndefined()
    expect(sceneOf(state).fired.er1).toBe(1000) // untouched — sprung traps stay sprung
  })
})

describe('trap and ability-check prompts', () => {
  const trap = trigger(
    {
      id: 'trap1',
      when: { kind: 'enter-region', zoneId: 'z1' },
      actions: [{ kind: 'trap', text: 'Spikes!', save: { ability: 'dex', dc: 13 }, damage: '2d6' }],
    },
    { shape: { kind: 'circle', x: 0, y: 0, radius: 5 } },
  )
  const abilityCheck = trigger(
    { id: 'ac1', when: { kind: 'enter-region', zoneId: 'z2' }, actions: [{ kind: 'ability-check', ability: 'wis', dc: 10, text: 'Notice the runes' }] },
    { shape: { kind: 'circle', x: 100, y: 100, radius: 5 } },
  )

  function rollQueue(results: RollResult[]) {
    let i = 0
    return (formula: string) => results[i++] ?? { formula, rolls: [0], modifier: 0, total: 0 }
  }

  it('an owned token creates a prompt targeting its owner; success needs no damage roll', () => {
    const deps = makeDeps({
      prepOf: () => ({ triggers: [trap] }),
      tokensOf: () => ({ tok1: { id: 'tok1', x: 0, y: 0, ownerId: 'p-1' } }),
      rollFn: rollQueue([{ formula: '1d20', rolls: [14], modifier: 0, total: 14 }]),
    })
    const mod = triggersModule(deps)
    let state = fireEvent(mod, empty, { sceneId: SCENE, source: { module: 'tokens', action: 'move' } })
    const prompt = sceneOf(state).prompts[0]
    expect(prompt).toMatchObject({ kind: 'trap', targetIdentityId: 'p-1', tokenId: 'tok1', ability: 'dex', dc: 13, damage: '2d6' })

    const { next, error } = run(mod, state, P1, 'roll-prompt', { promptId: prompt.id })
    expect(error).toBeNull()
    expect(sceneOf(next).prompts).toHaveLength(0)
    const line = sceneOf(next).log.at(-1)!
    expect(line.forIdentityId).toBe('p-1')
    expect(line.toPlayers).toBe(false)
    expect(line.text).toBe("Borin's DEX save: 14 vs DC 13 — success")
    expect(line.detail).toEqual({ save: { formula: '1d20', rolls: [14], modifier: 0, total: 14 }, success: true, dc: 13 })
  })

  it('failure also rolls the trap damage and logs it', () => {
    const deps = makeDeps({
      prepOf: () => ({ triggers: [trap] }),
      tokensOf: () => ({ tok1: { id: 'tok1', x: 0, y: 0, ownerId: 'p-1' } }),
      rollFn: rollQueue([
        { formula: '1d20', rolls: [5], modifier: 0, total: 5 },
        { formula: '2d6', rolls: [3, 4], modifier: 0, total: 7 },
      ]),
    })
    const mod = triggersModule(deps)
    let state = fireEvent(mod, empty, { sceneId: SCENE, source: { module: 'tokens', action: 'move' } })
    const prompt = sceneOf(state).prompts[0]
    const { next } = run(mod, state, P1, 'roll-prompt', { promptId: prompt.id })
    const line = sceneOf(next).log.at(-1)!
    expect(line.detail).toMatchObject({ success: false, damage: { total: 7 } })
    expect(line.text).toContain('failure')
  })

  it('an unclaimed token targets nobody, and the DM may roll it', () => {
    const deps = makeDeps({
      prepOf: () => ({ triggers: [abilityCheck] }),
      tokensOf: () => ({ tok1: { id: 'tok1', x: 100, y: 100, ownerId: null } }),
      rollFn: rollQueue([{ formula: '1d20', rolls: [12], modifier: 0, total: 12 }]),
    })
    const mod = triggersModule(deps)
    let state = fireEvent(mod, empty, { sceneId: SCENE, source: { module: 'tokens', action: 'move' } })
    const prompt = sceneOf(state).prompts[0]
    expect(prompt.targetIdentityId).toBeNull()

    // a player may not answer an unclaimed prompt
    expect(run(mod, state, P1, 'roll-prompt', { promptId: prompt.id }).error).toMatchObject({ code: 'unauthorized' })

    const { next, error } = run(mod, state, DM, 'roll-prompt', { promptId: prompt.id })
    expect(error).toBeNull()
    expect(sceneOf(next).log.at(-1)?.text).toContain('The DM')
  })

  it('a player cannot roll someone else\'s prompt', () => {
    const deps = makeDeps({
      prepOf: () => ({ triggers: [trap] }),
      tokensOf: () => ({ tok1: { id: 'tok1', x: 0, y: 0, ownerId: 'p-1' } }),
      rollFn: rollQueue([{ formula: '1d20', rolls: [14], modifier: 0, total: 14 }]),
    })
    const mod = triggersModule(deps)
    const state = fireEvent(mod, empty, { sceneId: SCENE, source: { module: 'tokens', action: 'move' } })
    const prompt = sceneOf(state).prompts[0]
    expect(run(mod, state, P2, 'roll-prompt', { promptId: prompt.id }).error).toMatchObject({ code: 'unauthorized' })
  })
})

describe('a malformed damage formula never crashes the module (F1)', () => {
  it('failed-save damage: the save outcome still lands, damage is skipped, DM sees why', () => {
    const badTrap = trigger(
      {
        id: 'trap-bad',
        when: { kind: 'enter-region', zoneId: 'z1' },
        actions: [{ kind: 'trap', text: 'Spikes!', save: { ability: 'dex', dc: 13 }, damage: 'nope' }],
      },
      { shape: { kind: 'circle', x: 0, y: 0, radius: 5 } },
    )
    const deps = makeDeps({
      prepOf: () => ({ triggers: [badTrap] }),
      tokensOf: () => ({ tok1: { id: 'tok1', x: 0, y: 0, ownerId: 'p-1' } }),
      rollFn: (formula: string) => {
        if (formula === 'nope') throw new Error('malformed dice formula')
        return { formula, rolls: [5], modifier: 0, total: 5 } // fails DC 13
      },
    })
    const mod = triggersModule(deps)
    const state = fireEvent(mod, empty, { sceneId: SCENE, source: { module: 'tokens', action: 'move' } })
    const prompt = sceneOf(state).prompts[0]

    const { next, error } = run(mod, state, P1, 'roll-prompt', { promptId: prompt.id })
    expect(error).toBeNull()
    const lines = sceneOf(next).log
    const outcome = lines.find((l) => l.kind === 'roll-outcome')!
    expect(outcome.detail).toMatchObject({ success: false })
    expect(outcome.detail).not.toHaveProperty('damage')
    const err = lines.find((l) => l.kind === 'error')!
    expect(err.toPlayers).toBe(false)
    expect(err.text).toContain('nope')
  })

  it('no-save immediate trap: still fires, damage is skipped, DM sees why', () => {
    const badTrap = trigger(
      { id: 'x', when: { kind: 'room-revealed', zoneId: 'z1' }, actions: [{ kind: 'trap', text: 'Boom', damage: 'nope' }] },
      { roomId: 'r1' },
    )
    const mod = triggersModule(
      makeDeps({
        prepOf: () => ({ triggers: [badTrap] }),
        rollFn: (formula: string) => {
          if (formula === 'nope') throw new Error('malformed dice formula')
          return { formula, rolls: [1], modifier: 0, total: 1 }
        },
      }),
    )
    const { next, error } = run(mod, empty, DM, 'fire', { triggerId: 'x' })
    expect(error).toBeNull()
    expect(sceneOf(next).fired.x).toBe(1000)
    const err = sceneOf(next).log.find((l) => l.kind === 'error')!
    expect(err.toPlayers).toBe(false)
    expect(err.text).toContain('nope')
  })
})

describe('light fire-action (M5)', () => {
  it('names the light and narrates on/off, player-visible', () => {
    const t = trigger(
      { id: 'x', when: { kind: 'room-revealed', zoneId: 'z1' }, actions: [{ kind: 'light', lightId: 'l1', on: true }] },
      { roomId: 'r1', lightNames: { l1: 'Brazier' } },
    )
    const mod = triggersModule(makeDeps({ prepOf: () => ({ triggers: [t] }) }))
    const { next, error } = run(mod, empty, DM, 'fire', { triggerId: 'x' })
    expect(error).toBeNull()
    const line = sceneOf(next).log.at(-1)!
    expect(line).toMatchObject({ text: 'Brazier lights', toPlayers: true })
    expect(sceneOf(next).lightOverrides).toEqual({ l1: true })
  })

  it('narrates turning a named light off', () => {
    const t = trigger(
      { id: 'x', when: { kind: 'room-revealed', zoneId: 'z1' }, actions: [{ kind: 'light', lightId: 'l1', on: false }] },
      { roomId: 'r1', lightNames: { l1: 'Brazier' } },
    )
    const mod = triggersModule(makeDeps({ prepOf: () => ({ triggers: [t] }) }))
    const { next } = run(mod, empty, DM, 'fire', { triggerId: 'x' })
    expect(sceneOf(next).log.at(-1)).toMatchObject({ text: 'Brazier goes dark', toPlayers: true })
  })

  it('falls back to the nameless wording for a default auto-name (F1) — never a raw id', () => {
    // lightNames always resolves an entry for a light action against an existing light
    // (N1) — the resolver-impossible fixture here used to be `{ roomId: 'r1' }` with no
    // lightNames at all. A never-renamed light's real authored name is its auto-name,
    // 'Light 3', which is not authorship either, so it narrates nameless too.
    const t = trigger(
      { id: 'x', when: { kind: 'room-revealed', zoneId: 'z1' }, actions: [{ kind: 'light', lightId: 'l1', on: true }] },
      { roomId: 'r1', lightNames: { l1: 'Light 3' } },
    )
    const mod = triggersModule(makeDeps({ prepOf: () => ({ triggers: [t] }) }))
    const { next } = run(mod, empty, DM, 'fire', { triggerId: 'x' })
    const line = sceneOf(next).log.at(-1)!
    expect(line.text).toBe('A light kindles')
    expect(line.text).not.toContain('l1')
    expect(line.text).not.toContain('Light 3')

    const off = trigger(
      { id: 'y', when: { kind: 'room-revealed', zoneId: 'z1' }, actions: [{ kind: 'light', lightId: 'l1', on: false }] },
      { roomId: 'r1', lightNames: { l1: 'Light 3' } },
    )
    const m2 = triggersModule(makeDeps({ prepOf: () => ({ triggers: [off] }) }))
    const offResult = run(m2, empty, DM, 'fire', { triggerId: 'y' })
    expect(offResult.next.byScene[SCENE].log.at(-1)?.text).toBe('A light goes dark')
  })

  it('honours toPlayers on the light action (O1) — default on, explicit off keeps it DM-only', () => {
    const t = trigger(
      { id: 'x', when: { kind: 'room-revealed', zoneId: 'z1' }, actions: [{ kind: 'light', lightId: 'l1', on: true, toPlayers: false }] },
      { roomId: 'r1', lightNames: { l1: 'Brazier' } },
    )
    const mod = triggersModule(makeDeps({ prepOf: () => ({ triggers: [t] }) }))
    const { next } = run(mod, empty, DM, 'fire', { triggerId: 'x' })
    expect(sceneOf(next).log.at(-1)).toMatchObject({ text: 'Brazier lights', toPlayers: false })
  })
})

describe('environment fire-action (F3)', () => {
  it('narrates only its own delta, not the merged environment', () => {
    const t = trigger(
      { id: 'x', when: { kind: 'room-revealed', zoneId: 'z1' }, actions: [{ kind: 'environment', weather: 'fog' }] },
      { roomId: 'r1' },
    )
    const mod = triggersModule(makeDeps({ prepOf: () => ({ triggers: [t] }) }))
    let state = run(mod, empty, DM, 'set-environment', { time: 'dawn' }).next
    const { next } = run(mod, state, DM, 'fire', { triggerId: 'x' })
    expect(sceneOf(next).env).toEqual({ time: 'dawn', weather: 'fog' })
    expect(sceneOf(next).log.at(-1)).toMatchObject({ text: 'Fog creeps in.', toPlayers: true })
  })
})

describe('inert and disabled triggers never fire', () => {
  const shape = { kind: 'circle' as const, x: 0, y: 0, radius: 5 }
  const tokens = () => ({ tok1: { id: 'tok1', x: 0, y: 0, ownerId: null } })

  it('an inert trigger is skipped', () => {
    const t = trigger({ id: 'x', when: { kind: 'enter-region', zoneId: 'z1' }, actions: [{ kind: 'show-text', text: 'x', toPlayers: true }] }, { shape, inert: 'zone missing' })
    const mod = triggersModule(makeDeps({ prepOf: () => ({ triggers: [t] }), tokensOf: tokens }))
    const state = fireEvent(mod, empty, { sceneId: SCENE, source: { module: 'tokens', action: 'move' } })
    expect(sceneOf(state)?.fired.x).toBeUndefined()
  })

  it('def.enabled=false is skipped', () => {
    const t = trigger({ id: 'x', when: { kind: 'enter-region', zoneId: 'z1' }, enabled: false, actions: [{ kind: 'show-text', text: 'x', toPlayers: true }] }, { shape })
    const mod = triggersModule(makeDeps({ prepOf: () => ({ triggers: [t] }), tokensOf: tokens }))
    const state = fireEvent(mod, empty, { sceneId: SCENE, source: { module: 'tokens', action: 'move' } })
    expect(sceneOf(state)?.fired.x).toBeUndefined()
  })

  it('a runtime set-enabled(false) blocks it, and re-enabling lets it fire on the next edge', () => {
    const t = trigger({ id: 'x', when: { kind: 'enter-region', zoneId: 'z1' }, actions: [{ kind: 'show-text', text: 'x', toPlayers: true }] }, { shape })
    const mod = triggersModule(makeDeps({ prepOf: () => ({ triggers: [t] }), tokensOf: tokens }))

    let { next: state } = run(mod, empty, DM, 'set-enabled', { triggerId: 'x', enabled: false })
    state = fireEvent(mod, state, { sceneId: SCENE, source: { module: 'tokens', action: 'move' } })
    expect(sceneOf(state).fired.x).toBeUndefined()

    state = run(mod, state, DM, 'set-enabled', { triggerId: 'x', enabled: true }).next
    state = fireEvent(mod, state, { sceneId: SCENE, source: { module: 'tokens', action: 'move' } })
    expect(sceneOf(state).fired.x).toBe(1000)
  })
})

describe('redact', () => {
  const state: TriggersState = {
    byScene: {
      [SCENE]: {
        fired: { t1: 1 },
        armed: { t1: true },
        disabled: { t2: true },
        lightOverrides: { l1: true },
        env: { weather: 'rain' },
        prompts: [
          { id: 'pr1', triggerId: 't1', kind: 'trap', targetIdentityId: 'p-1', text: 'a', at: 1 },
          { id: 'pr2', triggerId: 't1', kind: 'trap', targetIdentityId: 'p-2', text: 'b', at: 1 },
        ],
        log: [
          { id: 'l1', at: 1, kind: 'environment', text: 'Weather: rain', toPlayers: true },
          { id: 'l2', at: 2, kind: 'trap', text: 'p1 outcome', toPlayers: false, forIdentityId: 'p-1' },
          { id: 'l3', at: 3, kind: 'trap', text: 'dm only', toPlayers: false },
        ],
      },
    },
  }
  const mod = triggersModule(makeDeps())
  const redact = mod.redact!

  it('leaves the DM view untouched, object identity included', () => {
    expect(redact(state, DM)).toBe(state)
  })

  it('gives a player only their own prompts and log lines, keeping shared world state', () => {
    const seen = redact(state, P1).byScene[SCENE]
    expect(seen.prompts.map((p) => p.id)).toEqual(['pr1'])
    expect(seen.log.map((l) => l.id)).toEqual(['l1', 'l2'])
    expect(seen.fired).toEqual({})
    expect(seen.armed).toEqual({})
    expect(seen.disabled).toEqual({})
    expect(seen.lightOverrides).toEqual({ l1: true })
    expect(seen.env).toEqual({ weather: 'rain' })
  })

  it('is idempotent', () => {
    const once = redact(state, P1)
    expect(redact(once, P1)).toEqual(once)
  })
})

describe('caps', () => {
  it('caps the log at 200 entries, dropping the oldest', () => {
    const t = trigger({ id: 'x', when: { kind: 'room-revealed', zoneId: 'z1' }, actions: [{ kind: 'show-text', text: 'x', toPlayers: true }] }, { roomId: 'r1' })
    const mod = triggersModule(makeDeps({ prepOf: () => ({ triggers: [t] }) }))
    let state = empty
    for (let i = 0; i < 250; i++) {
      state = run(mod, state, DM, 'fire', { triggerId: 'x' }).next
    }
    expect(sceneOf(state).log).toHaveLength(200)
  })

  it('caps open prompts at 20, dropping the oldest', () => {
    const t = trigger({
      id: 'x',
      when: { kind: 'room-revealed', zoneId: 'z1' },
      actions: [{ kind: 'ability-check', ability: 'wis', dc: 10, text: 'check' }],
    })
    const mod = triggersModule(makeDeps({ prepOf: () => ({ triggers: [t] }) }))
    let state = empty
    for (let i = 0; i < 25; i++) {
      state = run(mod, state, DM, 'fire', { triggerId: 'x' }).next
    }
    expect(sceneOf(state).prompts).toHaveLength(20)
  })
})

describe('set-environment', () => {
  it('merges time/weather and logs quiet diegetic narration, toPlayers', () => {
    const mod = triggersModule(makeDeps())
    const { next, error } = run(mod, empty, DM, 'set-environment', { weather: 'rain' })
    expect(error).toBeNull()
    expect(sceneOf(next).env).toEqual({ weather: 'rain' })
    expect(sceneOf(next).log.at(-1)).toMatchObject({ text: 'Rain begins to fall.', toPlayers: true })
  })

  it('rejects a payload with neither field', () => {
    const mod = triggersModule(makeDeps())
    expect(run(mod, empty, DM, 'set-environment', {}).error?.code).toBe('invalid-command')
  })

  it('narrates only the field this change touches (F3) — an unchanged field is not restated', () => {
    const mod = triggersModule(makeDeps())
    let state = run(mod, empty, DM, 'set-environment', { time: 'dusk' }).next
    expect(sceneOf(state).log.at(-1)).toMatchObject({ text: 'Dusk settles.' })
    state = run(mod, state, DM, 'set-environment', { weather: 'storm' }).next
    expect(sceneOf(state).env).toEqual({ time: 'dusk', weather: 'storm' })
    expect(sceneOf(state).log.at(-1)).toMatchObject({ text: 'A storm rolls in.' })
  })

  it('joins both fields as separate sentences when both change at once', () => {
    const mod = triggersModule(makeDeps())
    const { next } = run(mod, empty, DM, 'set-environment', { time: 'night', weather: 'snow' })
    expect(sceneOf(next).log.at(-1)).toMatchObject({ text: 'Night falls. Snow begins to fall.' })
  })

  // S3 P3 §1 — the light level rides the same command, and it is the one field with mechanics
  // behind it: `needsLight` is what the referee and the mask both gate normal vision on.
  it('merges the ambient level and narrates it in the same voice', () => {
    const mod = triggersModule(makeDeps())
    let state = run(mod, empty, DM, 'set-environment', { time: 'night' }).next
    const { next, error } = run(mod, state, DM, 'set-environment', { ambient: 'darkness' })
    expect(error).toBeNull()
    expect(sceneOf(next).env).toEqual({ time: 'night', ambient: 'darkness' })
    expect(sceneOf(next).log.at(-1)).toMatchObject({ text: 'Darkness closes in.', toPlayers: true })

    // …and back again, without disturbing the time it was set alongside.
    state = run(mod, next, DM, 'set-environment', { ambient: 'daylight' }).next
    expect(sceneOf(state).env).toEqual({ time: 'night', ambient: 'daylight' })
    expect(sceneOf(state).log.at(-1)).toMatchObject({ text: 'The dark lifts.' })
  })

  it('reads daylight until a DM says otherwise, and only darkness asks for a light', () => {
    const mod = triggersModule(makeDeps())
    expect(ambientOf(sceneTriggersOf(empty, SCENE))).toBe('daylight')
    expect(needsLight(sceneTriggersOf(empty, SCENE))).toBe(false)

    for (const [ambient, dark] of [
      ['daylight', false],
      ['dusk', false],
      ['darkness', true],
    ] as const) {
      const { next } = run(mod, empty, DM, 'set-environment', { ambient })
      expect(ambientOf(sceneTriggersOf(next, SCENE))).toBe(ambient)
      // dusk differs from daylight in presentation alone — mechanically they are one answer.
      expect(needsLight(sceneTriggersOf(next, SCENE))).toBe(dark)
    }
  })

  // D2 — the one field a command may clear. An untouched scene lights as its map was
  // authored; an explicit `daylight` bites the composite. A DM who picks one needs the way
  // back, and the delta-merge's "a field is never cleared" rule still holds for `undefined`.
  it('takes the light dial back off on an explicit null, and narrates that too', () => {
    const mod = triggersModule(makeDeps())
    let state = run(mod, empty, DM, 'set-environment', { time: 'night', ambient: 'darkness' }).next
    const { next, error } = run(mod, state, DM, 'set-environment', { ambient: null })
    expect(error).toBeNull()
    // Gone, not `daylight` and not present-but-undefined — the field itself is off the scene.
    expect(sceneOf(next).env).toEqual({ time: 'night' })
    expect('ambient' in sceneOf(next).env).toBe(false)
    expect(sceneOf(next).log.at(-1)).toMatchObject({
      text: 'The light settles as it was.',
      toPlayers: true,
    })
  })

  it('still leaves an untouched field alone — undefined is not a clear', () => {
    const mod = triggersModule(makeDeps())
    const state = run(mod, empty, DM, 'set-environment', { ambient: 'darkness' }).next
    const { next } = run(mod, state, DM, 'set-environment', { weather: 'fog', ambient: undefined })
    expect(sceneOf(next).env).toEqual({ weather: 'fog', ambient: 'darkness' })
    expect(sceneOf(next).log.at(-1)).toMatchObject({ text: 'Fog creeps in.' })
  })

  it('refuses a light level that is not in the vocabulary', () => {
    const mod = triggersModule(makeDeps())
    expect(run(mod, empty, DM, 'set-environment', { ambient: 'gloomy' }).error?.code).toBe(
      'invalid-command',
    )
  })
})

describe('manual fire', () => {
  it('refuses an unknown trigger id and an inert one', () => {
    const t = trigger({ id: 'x', when: { kind: 'room-revealed', zoneId: 'z1' }, actions: [] }, { inert: 'broken' })
    const mod = triggersModule(makeDeps({ prepOf: () => ({ triggers: [t] }) }))
    expect(run(mod, empty, DM, 'fire', { triggerId: 'x' }).error?.code).toBe('invalid-command')
    expect(run(mod, empty, DM, 'fire', { triggerId: 'nope' }).error?.code).toBe('invalid-command')
  })

  it('ignores enabled/disabled and once/fired — the override is unconditional', () => {
    const t = trigger(
      { id: 'x', when: { kind: 'room-revealed', zoneId: 'z1' }, once: true, enabled: false, actions: [{ kind: 'show-text', text: 'x', toPlayers: true }] },
    )
    const mod = triggersModule(makeDeps({ prepOf: () => ({ triggers: [t] }) }))
    let state = run(mod, empty, DM, 'set-enabled', { triggerId: 'x', enabled: false }).next
    state = run(mod, state, DM, 'fire', { triggerId: 'x' }).next
    expect(sceneOf(state).log).toHaveLength(1)
    state = run(mod, state, DM, 'fire', { triggerId: 'x' }).next
    expect(sceneOf(state).log).toHaveLength(2) // once + already-fired do not block a manual fire
  })
})
