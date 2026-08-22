import { describe, expect, it } from 'vitest'
import type { PlayerInfo } from '@dnd/core/src/shared/protocol'
import type { CommandError, ModuleContext } from '../contract'
import { initiativeModule } from './module'
import { INITIAL_STATE, isInitiativeRoll, ordered, type InitiativeState } from './types'

const MARRA: PlayerInfo = { identityId: 'i-marra', name: 'Marra', role: 'player', connected: true }
const TOMEN: PlayerInfo = { identityId: 'i-tomen', name: 'Tomen', role: 'player', connected: true }
const DM: PlayerInfo = { identityId: 'i-dm', name: 'Deb', role: 'dm', connected: true }
const ROSTER = [MARRA, TOMEN, DM]
const SCENE = 'scene-1'

/**
 * Mirrors `ModuleRegistry.dispatch`: the `commands` map gates the role before the handler
 * runs, so a test can never assert a permission the wire would not actually enforce.
 */
function run(
  state: InitiativeState,
  sender: PlayerInfo,
  action: string,
  payload: unknown = {},
): { error: CommandError | null; next: InitiativeState } {
  const roles = initiativeModule.commands[action]
  if (!roles) return { error: { code: 'invalid-command', message: 'no such action' }, next: state }
  if (!roles.includes(sender.role)) {
    return { error: { code: 'unauthorized', message: 'role may not' }, next: state }
  }
  let next = state
  const ctx: ModuleContext<InitiativeState> = {
    campaignId: 'c-1',
    sessionId: 's-1',
    activeSceneId: SCENE,
    sender: { identityId: sender.identityId, role: sender.role },
    players: ROSTER,
    state,
    setState: (s) => {
      next = s
    },
    // Same assert-by-explosion the rolls harness uses: everything this module says is state.
    broadcast: () => {
      throw new Error('initiative must never broadcast directly — state travels via setState')
    },
  }
  const error = initiativeModule.handler(action, payload, ctx) ?? null
  return { error, next }
}

/** A gathering encounter: two PCs and one NPC, nobody rolled yet. */
function gathering(): InitiativeState {
  const { error, next } = run(INITIAL_STATE, DM, 'start', {
    entries: [
      { name: 'Marra', kind: 'pc', identityId: MARRA.identityId, tokenId: 't-marra' },
      { name: 'Tomen', kind: 'pc', identityId: TOMEN.identityId, tokenId: 't-tomen' },
      { name: 'Goblin', kind: 'npc', tokenId: 't-gob' },
    ],
  })
  expect(error).toBeNull()
  return next
}

const keyOf = (state: InitiativeState, name: string): string =>
  state.entries.find((e) => e.name === name)!.key

const names = (state: InitiativeState): string[] => state.entries.map((e) => e.name)

describe('initiative — starting', () => {
  it('seeds the roster from the DM and gathers, keying to the active scene', () => {
    const state = gathering()
    expect(state.status).toBe('gathering')
    expect(state.sceneId).toBe(SCENE)
    expect(state.round).toBe(0)
    expect(state.entries.map((e) => e.initiative)).toEqual([null, null, null])
    expect(state.entries.every((e) => e.key.length > 0)).toBe(true)
  })

  it('refuses a player who tries to start one', () => {
    const { error } = run(INITIAL_STATE, MARRA, 'start', { entries: [{ name: 'X', kind: 'pc' }] })
    expect(error?.code).toBe('unauthorized')
  })

  it('refuses a second start rather than discarding a live order', () => {
    const { error } = run(gathering(), DM, 'start', { entries: [{ name: 'X', kind: 'pc' }] })
    expect(error?.code).toBe('invalid-command')
  })

  it('mints its own keys — a client cannot choose one', () => {
    const { next } = run(INITIAL_STATE, DM, 'start', {
      entries: [{ name: 'Marra', kind: 'pc', key: 'forged' }],
    })
    expect(next.entries[0].key).not.toBe('forged')
  })
})

describe('initiative — setting a number', () => {
  it('lets a player set their own entry', () => {
    const state = gathering()
    const { error, next } = run(state, MARRA, 'set', { key: keyOf(state, 'Marra'), value: 17 })
    expect(error).toBeNull()
    expect(next.entries.find((e) => e.name === 'Marra')?.initiative).toBe(17)
  })

  it("refuses a player reaching for someone else's", () => {
    const state = gathering()
    const { error } = run(state, MARRA, 'set', { key: keyOf(state, 'Tomen'), value: 30 })
    expect(error?.code).toBe('unauthorized')
  })

  it('refuses a player reaching for an NPC', () => {
    const state = gathering()
    const { error } = run(state, MARRA, 'set', { key: keyOf(state, 'Goblin'), value: 1 })
    expect(error?.code).toBe('unauthorized')
  })

  it('lets the DM set any entry — this is the manual NPC path', () => {
    const state = gathering()
    const { error, next } = run(state, DM, 'set', { key: keyOf(state, 'Goblin'), value: 12 })
    expect(error).toBeNull()
    expect(next.entries.find((e) => e.name === 'Goblin')?.initiative).toBe(12)
  })

  it('rejects a value outside the sane range', () => {
    const state = gathering()
    const { error } = run(state, DM, 'set', { key: keyOf(state, 'Goblin'), value: 100000 })
    expect(error?.code).toBe('invalid-command')
  })

  it('rejects an unknown combatant', () => {
    const { error } = run(gathering(), DM, 'set', { key: 'nope', value: 3 })
    expect(error?.code).toBe('invalid-command')
  })
})

describe('initiative — locking the order', () => {
  const rolled = (): InitiativeState => {
    let state = gathering()
    state = run(state, MARRA, 'set', { key: keyOf(state, 'Marra'), value: 12 }).next
    state = run(state, DM, 'set', { key: keyOf(state, 'Goblin'), value: 18 }).next
    return state
  }

  it('sorts highest first and sinks whoever never rolled', () => {
    const { next } = run(rolled(), DM, 'begin')
    expect(names(next)).toEqual(['Goblin', 'Marra', 'Tomen'])
    expect(next.status).toBe('running')
    expect(next.round).toBe(1)
    expect(next.turn).toBe(0)
  })

  it('breaks ties by the order the DM added them', () => {
    let state = gathering()
    state = run(state, MARRA, 'set', { key: keyOf(state, 'Marra'), value: 15 }).next
    state = run(state, TOMEN, 'set', { key: keyOf(state, 'Tomen'), value: 15 }).next
    state = run(state, DM, 'set', { key: keyOf(state, 'Goblin'), value: 15 }).next
    expect(names(run(state, DM, 'begin').next)).toEqual(['Marra', 'Tomen', 'Goblin'])
  })

  it('locks players out of changing a number once running', () => {
    const state = run(rolled(), DM, 'begin').next
    const { error } = run(state, MARRA, 'set', { key: keyOf(state, 'Marra'), value: 20 })
    expect(error?.code).toBe('unauthorized')
  })

  it('lets the DM fix a number without re-sorting mid-fight', () => {
    const state = run(rolled(), DM, 'begin').next
    const { next } = run(state, DM, 'set', { key: keyOf(state, 'Tomen'), value: 99 })
    expect(names(next)).toEqual(['Goblin', 'Marra', 'Tomen'])
  })

  it('refuses begin before a start', () => {
    expect(run(INITIAL_STATE, DM, 'begin').error?.code).toBe('invalid-command')
  })
})

describe('initiative — running the order', () => {
  const running = (): InitiativeState => run(gathering(), DM, 'begin').next

  it('advances a turn', () => {
    const { next } = run(running(), DM, 'next')
    expect(next.turn).toBe(1)
    expect(next.round).toBe(1)
  })

  it('wraps to the top and counts a new round', () => {
    let state = running()
    for (let i = 0; i < 3; i += 1) state = run(state, DM, 'next').next
    expect(state.turn).toBe(0)
    expect(state.round).toBe(2)
  })

  it('refuses a player advancing the turn', () => {
    expect(run(running(), MARRA, 'next').error?.code).toBe('unauthorized')
  })

  it('slots a reinforcement in by its roll and keeps the current turn current', () => {
    let state = gathering()
    state = run(state, MARRA, 'set', { key: keyOf(state, 'Marra'), value: 20 }).next
    state = run(state, TOMEN, 'set', { key: keyOf(state, 'Tomen'), value: 10 }).next
    state = run(state, DM, 'set', { key: keyOf(state, 'Goblin'), value: 5 }).next
    state = run(state, DM, 'begin').next
    state = run(state, DM, 'next').next // Tomen's turn (index 1)
    expect(state.entries[state.turn].name).toBe('Tomen')

    // An ogre on 25 goes to the top — ahead of the current turn, so the index shifts.
    state = run(state, DM, 'add', { name: 'Ogre', kind: 'npc', initiative: 25 }).next
    expect(names(state)).toEqual(['Ogre', 'Marra', 'Tomen', 'Goblin'])
    expect(state.entries[state.turn].name).toBe('Tomen')
  })

  it('keeps the current turn current when someone ahead of it dies', () => {
    let state = run(gathering(), DM, 'begin').next
    state = run(state, DM, 'next').next
    state = run(state, DM, 'next').next
    const current = state.entries[state.turn].name
    state = run(state, DM, 'remove', { key: keyOf(state, names(state)[0]) }).next
    expect(state.entries[state.turn].name).toBe(current)
  })

  it('wraps into a new round when the last combatant in the order dies on their turn', () => {
    let state = run(gathering(), DM, 'begin').next
    state = run(state, DM, 'next').next
    state = run(state, DM, 'next').next
    expect(state.turn).toBe(2)
    state = run(state, DM, 'remove', { key: state.entries[2].key }).next
    expect(state.turn).toBe(0)
    expect(state.round).toBe(2)
  })

  it('ends the encounter when the last combatant leaves it', () => {
    let state = run(INITIAL_STATE, DM, 'start', { entries: [{ name: 'Solo', kind: 'npc' }] }).next
    state = run(state, DM, 'remove', { key: state.entries[0].key }).next
    expect(state.status).toBe('idle')
    expect(state.entries).toEqual([])
  })

  it('clears the fight on end but keeps the log that describes it', () => {
    const { next } = run(running(), DM, 'end')
    expect(next.status).toBe('idle')
    expect(next.entries).toEqual([])
    expect(next.sceneId).toBeNull()
    expect(next.log.at(-1)?.text).toBe('The encounter ends.')
  })
})

describe('initiative — the log both readers print verbatim', () => {
  it('names the roller and the number', () => {
    const state = gathering()
    const { next } = run(state, MARRA, 'set', { key: keyOf(state, 'Marra'), value: 17 })
    expect(next.log.at(-1)?.text).toBe('Marra rolls initiative: 17')
  })

  it('reads out the whole order when it locks, and whose turn it is', () => {
    let state = gathering()
    state = run(state, DM, 'set', { key: keyOf(state, 'Goblin'), value: 18 }).next
    state = run(state, MARRA, 'set', { key: keyOf(state, 'Marra'), value: 12 }).next
    const { next } = run(state, DM, 'begin')
    expect(next.log.at(-1)?.text).toBe(
      "Initiative order: Goblin, Marra and Tomen. Round 1 — Goblin's turn.",
    )
  })

  it('calls the round only when the order wraps', () => {
    let state = run(gathering(), DM, 'begin').next
    state = run(state, DM, 'next').next
    expect(state.log.at(-1)?.text).toBe("Tomen's turn.")
    state = run(state, DM, 'next').next
    state = run(state, DM, 'next').next
    expect(state.log.at(-1)?.text).toBe("Round 2 — Marra's turn.")
  })

  it('starts a fresh log per encounter so a new fight does not inherit the last one', () => {
    let state = run(gathering(), DM, 'end').next
    state = run(state, DM, 'start', { entries: [{ name: 'Wolf', kind: 'npc' }] }).next
    expect(state.log.map((e) => e.text)).toEqual(['An encounter begins — roll initiative.'])
  })

  it('gives every line its own id, so a mirror can tell what it has already posted', () => {
    let state = gathering()
    state = run(state, MARRA, 'set', { key: keyOf(state, 'Marra'), value: 9 }).next
    state = run(state, TOMEN, 'set', { key: keyOf(state, 'Tomen'), value: 9 }).next
    expect(new Set(state.log.map((e) => e.id)).size).toBe(state.log.length)
  })
})

describe('isInitiativeRoll — the one capture rule', () => {
  it('matches what Beyond20 titles an initiative roll', () => {
    expect(isInitiativeRoll({ title: 'Initiative' })).toBe(true)
  })

  it('matches a manual roll a player typed', () => {
    expect(isInitiativeRoll({ text: 'rolling initiative, 1d20+3' })).toBe(true)
  })

  it('ignores an ordinary attack', () => {
    expect(isInitiativeRoll({ title: 'Longsword: Attack', text: '1d20+7' })).toBe(false)
  })

  it('ignores an empty roll rather than capturing everything', () => {
    expect(isInitiativeRoll({})).toBe(false)
  })
})

describe('ordered', () => {
  it('is a pure sort that leaves its input alone', () => {
    const entries = gathering().entries
    const copy = [...entries]
    ordered(entries)
    expect(entries).toEqual(copy)
  })
})

describe('hp / damage / condition — the DM\'s bookkeeping', () => {
  const key = (state: InitiativeState, name: string) =>
    state.entries.find((e) => e.name === name)!.key
  const last = (state: InitiativeState) => state.log[state.log.length - 1].text

  it('sets a pool, full by default, and logs it', () => {
    const s0 = gathering()
    const { error, next } = run(s0, DM, 'hp', { key: key(s0, 'Marra'), max: 12 })
    expect(error).toBeNull()
    expect(next.entries[0].hp).toEqual({ current: 12, max: 12 })
    expect(last(next)).toBe('Marra has 12/12 HP.')
  })

  it('clamps damage at 0 and healing at max, with the PC pool on the line', () => {
    const s0 = gathering()
    const k = key(s0, 'Marra')
    const s1 = run(s0, DM, 'hp', { key: k, max: 12 }).next
    const s2 = run(s1, DM, 'damage', { key: k, amount: 7 }).next
    expect(s2.entries[0].hp).toEqual({ current: 5, max: 12 })
    expect(last(s2)).toBe('Marra takes 7 damage (5/12).')
    const s3 = run(s2, DM, 'damage', { key: k, amount: 20 }).next
    expect(s3.entries[0].hp!.current).toBe(0)
    expect(last(s3)).toBe('Marra takes 20 damage and drops to 0 HP.')
    const s4 = run(s3, DM, 'damage', { key: k, amount: -50 }).next
    expect(s4.entries[0].hp!.current).toBe(12)
    expect(last(s4)).toBe('Marra heals 50 (12/12).')
  })

  it('keeps an NPC pool off the log line and away from players', () => {
    const s0 = gathering()
    const k = key(s0, 'Goblin')
    const s1 = run(s0, DM, 'hp', { key: k, max: 7 }).next
    expect(s1.log).toEqual(s0.log)
    const s2 = run(s1, DM, 'damage', { key: k, amount: 3 }).next
    expect(last(s2)).toBe('Goblin takes 3 damage.')
    const seen = initiativeModule.redact!(s2, { role: 'player', identityId: MARRA.identityId })
    expect(seen.entries[2].hp).toBeUndefined()
    expect(initiativeModule.redact!(seen, { role: 'player', identityId: MARRA.identityId })).toEqual(seen)
    const s3 = run(s2, DM, 'damage', { key: k, amount: 9 }).next
    const down = initiativeModule.redact!(s3, { role: 'player', identityId: MARRA.identityId })
    expect(down.entries[2].hp).toEqual({ current: 0, max: 0 })
    expect(initiativeModule.redact!(s3, { role: 'dm', identityId: DM.identityId })).toBe(s3)
  })

  it('refuses damage before a pool exists, a zero amount, and a player sender', () => {
    const s0 = gathering()
    const k = key(s0, 'Marra')
    expect(run(s0, DM, 'damage', { key: k, amount: 3 }).error?.code).toBe('invalid-command')
    const s1 = run(s0, DM, 'hp', { key: k, max: 12 }).next
    expect(run(s1, DM, 'damage', { key: k, amount: 0 }).error?.code).toBe('invalid-command')
    expect(run(s1, DM, 'damage', { key: k, amount: 1.5 }).error?.code).toBe('invalid-command')
    expect(run(s1, MARRA, 'damage', { key: k, amount: 3 }).error?.code).toBe('unauthorized')
    expect(run(s1, DM, 'hp', { key: k, max: 0 }).error?.code).toBe('invalid-command')
  })

  it('toggles a condition once, drops the field when empty, and ignores a no-op', () => {
    const s0 = gathering()
    const k = key(s0, 'Tomen')
    const s1 = run(s0, DM, 'condition', { key: k, name: 'prone', on: true }).next
    expect(s1.entries[1].conditions).toEqual(['prone'])
    expect(last(s1)).toBe('Tomen is Prone.')
    const again = run(s1, DM, 'condition', { key: k, name: 'prone', on: true })
    expect(again.error).toBeNull()
    expect(again.next).toBe(s1)
    const s2 = run(s1, DM, 'condition', { key: k, name: 'poisoned', on: true }).next
    expect(s2.entries[1].conditions).toEqual(['prone', 'poisoned'])
    const s3 = run(s2, DM, 'condition', { key: k, name: 'prone', on: false }).next
    expect(s3.entries[1].conditions).toEqual(['poisoned'])
    expect(last(s3)).toBe('Tomen is no longer Prone.')
    const s4 = run(s3, DM, 'condition', { key: k, name: 'poisoned', on: false }).next
    expect('conditions' in s4.entries[1]).toBe(false)
    expect(run(s4, DM, 'condition', { key: k, name: 'sleepy', on: true }).error?.code).toBe('invalid-command')
  })
})
