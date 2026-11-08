import { describe, expect, it } from 'vitest'
import type { ModuleContext, Viewer } from '../contract'
import { tableModule, type TableState } from '../table/module'
import { pinsModule, type PinsState } from './module'

const DM: Viewer = { role: 'dm', identityId: 'dm' }
const P1: Viewer = { role: 'player', identityId: 'p1' }

function runner<S>(module: { commands: Record<string, readonly string[]>; handler: (a: string, p: unknown, c: ModuleContext<S>) => unknown }, initial: S) {
  let current = initial
  const run = (who: Viewer, action: string, payload: unknown) => {
    if (!module.commands[action]?.includes(who.role)) return { code: 'unauthorized' }
    return module.handler(action, payload, {
      campaignId: 'c1',
      sessionId: 's1',
      activeSceneId: 'scene-1',
      sender: who,
      players: [],
      state: current,
      setState: (next) => {
        current = next
      },
      broadcast: () => {},
    })
  }
  return { run, state: () => current }
}

describe('pins', () => {
  it('the DM adds, edits and deletes pins on the active scene', () => {
    const t = runner<PinsState>(pinsModule, { byScene: {} })
    expect(t.run(DM, 'add', { x: 2, y: 3, text: 'Trapdoor' })).toBeUndefined()
    const [pin] = t.state().byScene['scene-1']
    expect(pin).toMatchObject({ x: 2, y: 3, text: 'Trapdoor', dmOnly: false })
    t.run(DM, 'update', { id: pin.id, text: 'Trapdoor (open)', dmOnly: true })
    expect(t.state().byScene['scene-1'][0]).toMatchObject({ text: 'Trapdoor (open)', dmOnly: true })
    t.run(DM, 'delete', { id: pin.id })
    expect(t.state().byScene['scene-1']).toEqual([])
  })

  it('refuses players, overlong text and unknown ids', () => {
    const t = runner<PinsState>(pinsModule, { byScene: {} })
    expect(t.run(P1, 'add', { x: 1, y: 1, text: 'x' })).toMatchObject({ code: 'unauthorized' })
    expect(t.run(DM, 'add', { x: 1, y: 1, text: 'x'.repeat(201) })).toMatchObject({ code: 'invalid-command' })
    expect(t.run(DM, 'delete', { id: 'nope' })).toMatchObject({ code: 'invalid-command' })
  })

  it('a DM-only pin never reaches a player; forgetScene drops the scene', () => {
    const state: PinsState = {
      byScene: { s: [{ id: 'a', x: 0, y: 0, text: 'Secret', dmOnly: true }, { id: 'b', x: 1, y: 1, text: 'Inn', dmOnly: false }] },
    }
    expect(pinsModule.redact!(state, P1).byScene.s.map((p) => p.id)).toEqual(['b'])
    expect(pinsModule.redact!(state, DM)).toBe(state)
    expect(pinsModule.forgetScene!(state, 's')).toEqual({ byScene: {} })
  })
})

describe('table', () => {
  it('the DM pauses and locks movement; players may not', () => {
    const t = runner<TableState>(tableModule, tableModule.initialState)
    expect(t.run(DM, 'pause', { on: true })).toBeUndefined()
    expect(t.run(DM, 'lock-movement', { on: true })).toBeUndefined()
    expect(t.state()).toEqual({ paused: true, movementLocked: true })
    t.run(DM, 'pause', { on: false })
    expect(t.state().paused).toBe(false)
    expect(t.run(P1, 'pause', { on: true })).toMatchObject({ code: 'unauthorized' })
    expect(t.run(DM, 'pause', {})).toMatchObject({ code: 'invalid-command' })
  })
})

describe('table sync', () => {
  it('is internal and sets both flags from the session row', () => {
    expect(tableModule.commands.sync).toBeUndefined()
    let state: TableState = { paused: true, movementLocked: true }
    tableModule.handler('sync', { paused: false, movementLocked: false }, {
      campaignId: 'c1',
      sessionId: 's1',
      activeSceneId: null,
      sender: DM,
      players: [],
      state,
      setState: (next) => {
        state = next
      },
      broadcast: () => {},
    })
    expect(state).toEqual({ paused: false, movementLocked: false })
  })
})
