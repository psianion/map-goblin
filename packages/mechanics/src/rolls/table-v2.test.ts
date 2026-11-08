import { describe, expect, it } from 'vitest'
import type { PlayerInfo, ServerMessage } from '@dnd/core/src/shared/protocol'
import type { ModuleContext } from '../contract'
import { createRollsModule, modeOf, requestSummary } from './module'
import type { RollEvent, RollsState } from './types'

const ALICE: PlayerInfo = { identityId: 'alice', name: 'Alice', role: 'player', connected: true }
const BOB: PlayerInfo = { identityId: 'bob', name: 'Bob', role: 'player', connected: true }
const DM: PlayerInfo = { identityId: 'dm', name: 'Deb', role: 'dm', connected: true }

/** rng pinned at 0.5: a d20 lands on 11, a d6 on 4. */
const module = createRollsModule({ rng: () => 0.5 })

function table(state: RollsState = { log: [] }) {
  const sent: ServerMessage[] = []
  let current = state
  const run = (who: PlayerInfo, action: string, payload: unknown) => {
    const roles = module.commands[action]
    if (!roles?.includes(who.role)) return { code: 'unauthorized' }
    const ctx: ModuleContext<RollsState> = {
      campaignId: 'c1',
      sessionId: 's1',
      activeSceneId: null,
      sender: { role: who.role, identityId: who.identityId },
      players: [ALICE, BOB, DM],
      state: current,
      setState: (next) => {
        current = next
      },
      broadcast: (msg) => sent.push(msg),
    }
    return module.handler(action, payload, ctx)
  }
  return { run, sent, state: () => current, view: (who: PlayerInfo) => module.redact!(current, { role: who.role, identityId: who.identityId }) }
}

describe('roll modes', () => {
  it('rolls on the server and stamps the mode', () => {
    const t = table()
    expect(t.run(ALICE, 'roll', { formula: '1d20+2', mode: 'public', title: 'Stealth' })).toBeUndefined()
    expect(t.state().log[0]).toMatchObject({ source: 'server', mode: 'public', visibility: 'public', total: 13, formula: '1d20+2', title: 'Stealth' })
  })

  it('refuses a bad formula and an unknown mode', () => {
    const t = table()
    expect(t.run(ALICE, 'roll', { formula: 'banana' })).toMatchObject({ code: 'invalid-command' })
    expect(t.run(ALICE, 'roll', { formula: '1d20', mode: 'secret' })).toMatchObject({ code: 'invalid-command' })
  })

  it('advantage keeps the better pool and says so in the formula', () => {
    const t = table()
    t.run(ALICE, 'roll', { formula: '1d20', adv: 'adv' })
    expect(t.state().log[0].formula).toBe('1d20 (adv)')
  })

  it('public reaches everyone; To DM reaches the roller and the DM', () => {
    const t = table()
    t.run(ALICE, 'roll', { formula: '1d6', mode: 'public' })
    t.run(ALICE, 'roll', { formula: '1d6', mode: 'dm' })
    expect(t.view(DM).log).toHaveLength(2)
    expect(t.view(ALICE).log).toHaveLength(2)
    expect(t.view(BOB).log).toHaveLength(1)
  })

  it('GM only reaches the DM alone, the roller included', () => {
    const t = table()
    t.run(ALICE, 'roll', { formula: '1d6', mode: 'gmonly' })
    expect(t.view(DM).log).toHaveLength(1)
    expect(t.view(ALICE).log).toHaveLength(0)
    expect(t.view(BOB).log).toHaveLength(0)
  })

  it('a blind roll shows the roller that they rolled and never the result', () => {
    const t = table()
    t.run(ALICE, 'roll', { formula: '1d20', mode: 'blind', title: 'Insight' })
    expect(t.view(DM).log[0].total).toBe(11)
    const [mine] = t.view(ALICE).log
    expect(mine).toMatchObject({ blind: true, title: 'Insight', formula: '1d20' })
    expect(mine.total).toBeUndefined()
    expect(mine.breakdown).toBeUndefined()
    expect(JSON.stringify(t.view(ALICE))).not.toContain('"total"')
    expect(t.view(BOB).log).toHaveLength(0)
    // idempotent
    const once = t.view(ALICE)
    expect(module.redact!(once, { role: 'player', identityId: 'alice' })).toEqual(once)
  })

  it('post accepts a mode, and an old visibility still reads as before', () => {
    const t = table()
    t.run(ALICE, 'post', { source: 'manual', text: 'stealth 17', mode: 'blind' })
    t.run(ALICE, 'post', { source: 'manual', text: 'perception 9', visibility: 'private' })
    const [blind, legacy] = t.state().log
    expect(blind.mode).toBe('blind')
    expect(legacy.mode).toBeUndefined()
    expect(modeOf(legacy)).toBe('dm')
  })
})

describe('roll requests', () => {
  it('the DM asks; the request reaches its targets and the nudge names them', () => {
    const t = table()
    expect(t.run(DM, 'request', { targets: ['alice'], label: 'Perception check', ability: 'perception', dc: 14 })).toBeUndefined()
    const [req] = t.state().requests!
    expect(req).toMatchObject({ label: 'Perception check', dc: 14, targets: ['alice'], results: [] })
    expect(t.sent).toEqual([
      { type: 'roll-requested', request: { requestId: req.id, label: 'Perception check', ability: 'perception', dc: 14, targets: ['alice'] } },
    ])
    expect(t.view(ALICE).requests).toHaveLength(1)
    expect(t.view(BOB).requests).toHaveLength(0)
  })

  it('refuses a player asking, an unknown target and a DC out of range', () => {
    const t = table()
    expect(t.run(ALICE, 'request', { label: 'x' })).toMatchObject({ code: 'unauthorized' })
    expect(t.run(DM, 'request', { label: 'x', targets: ['nobody'] })).toMatchObject({ code: 'invalid-command' })
    expect(t.run(DM, 'request', { label: 'x', dc: 0 })).toMatchObject({ code: 'invalid-command' })
  })

  it('a target answers once, by formula or by total, and sees only their own answer', () => {
    const t = table()
    t.run(DM, 'request', { targets: 'all', label: 'Perception check', dc: 12 })
    const id = t.state().requests![0].id
    expect(t.run(ALICE, 'roll-result', { requestId: id, formula: '1d20+3' })).toBeUndefined()
    expect(t.run(ALICE, 'roll-result', { requestId: id, total: 20 })).toMatchObject({ code: 'invalid-command' })
    expect(t.run(BOB, 'roll-result', { requestId: id, total: 8 })).toBeUndefined()
    expect(t.state().requests![0].results.map((r) => [r.playerName, r.total])).toEqual([['Alice', 14], ['Bob', 8]])
    expect(t.view(ALICE).requests![0].results).toHaveLength(1)
    // The answer lands in the log To DM: Alice sees hers, Bob does not.
    expect(t.view(ALICE).log.map((e) => e.total)).toEqual([14])
  })

  it('a seat the request does not name may not answer it', () => {
    const t = table()
    t.run(DM, 'request', { targets: ['alice'], label: 'Save' })
    const id = t.state().requests![0].id
    expect(t.run(BOB, 'roll-result', { requestId: id, total: 3 })).toMatchObject({ code: 'unauthorized' })
  })

  it('Share results posts the pass/fail summary publicly; close drops the request', () => {
    const t = table()
    t.run(DM, 'request', { targets: 'all', label: 'Perception', dc: 12 })
    const id = t.state().requests![0].id
    t.run(ALICE, 'roll-result', { requestId: id, total: 15 })
    t.run(BOB, 'roll-result', { requestId: id, total: 9 })
    t.run(DM, 'share-request', { requestId: id })
    const last = t.state().log.at(-1) as RollEvent
    expect(last).toMatchObject({ mode: 'public', text: 'Perception, DC 12: Alice 15 pass, Bob 9 fail' })
    expect(t.state().requests![0].shared).toBe(true)
    t.run(DM, 'close-request', { requestId: id })
    expect(t.state().requests).toEqual([])
  })

  it('requestSummary without a DC lists totals only', () => {
    expect(
      requestSummary({ id: 'q', at: 0, label: 'Luck', targets: null, results: [{ identityId: 'a', playerName: 'A', total: 3, at: 0 }], shared: false }),
    ).toBe('Luck: A 3')
  })
})

describe('rollable tables and saved rolls', () => {
  const rows = [
    { range: [1, 10], text: 'Nothing' },
    { range: [11, 20], text: 'A wandering ogre' },
  ]

  it('the DM keeps tables, rolls one, and the row lands in the log', () => {
    const t = table()
    expect(t.run(DM, 'table-upsert', { id: 'tb1', name: 'Encounters', die: '1d20', rows })).toBeUndefined()
    t.run(DM, 'roll-table', { id: 'tb1' })
    expect(t.state().log[0]).toMatchObject({ title: 'Encounters', total: 11, text: 'A wandering ogre' })
    t.run(DM, 'table-delete', { id: 'tb1' })
    expect(t.state().tables).toEqual([])
  })

  it('refuses a backwards range, a bad die and a player editing tables', () => {
    const t = table()
    expect(t.run(DM, 'table-upsert', { name: 'X', die: '1d20', rows: [{ range: [5, 1], text: 'x' }] })).toMatchObject({ code: 'invalid-command' })
    expect(t.run(DM, 'table-upsert', { name: 'X', die: 'd', rows })).toMatchObject({ code: 'invalid-command' })
    expect(t.run(ALICE, 'table-upsert', { name: 'X', die: '1d20', rows })).toMatchObject({ code: 'unauthorized' })
  })

  it('saved rolls upsert and delete; players see neither tables nor saved rolls', () => {
    const t = table()
    t.run(DM, 'saved-upsert', { id: 'sv1', name: 'Goblin attack', formula: '1d20+4' })
    t.run(DM, 'saved-upsert', { id: 'sv1', name: 'Goblin hit', formula: '1d20+4' })
    t.run(DM, 'table-upsert', { name: 'Loot', die: '1d20', rows })
    expect(t.state().saved).toEqual([{ id: 'sv1', name: 'Goblin hit', formula: '1d20+4' }])
    expect(t.view(ALICE).saved).toEqual([])
    expect(t.view(ALICE).tables).toEqual([])
    expect(t.run(DM, 'saved-upsert', { name: 'Bad', formula: 'x' })).toMatchObject({ code: 'invalid-command' })
    t.run(DM, 'saved-delete', { id: 'sv1' })
    expect(t.state().saved).toEqual([])
  })
})
