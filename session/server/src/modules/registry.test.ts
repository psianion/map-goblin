// M4 — the registry's own plumbing for triggers: `dispatchInternal` reaches an action a
// module leaves out of `commands`, wire `dispatch` never can, and the tokens/fog → triggers
// cascade fires exactly when a write actually lands. Trigger evaluation itself (zones,
// prompts, fire actions) is triggers/module.ts's own test surface; this file is the
// registry's contract with it.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ANY_ROLE, type GameModule, type Viewer } from '@dnd/mechanics/contract'
import { doorsModule, type AuthoredDoor, type DoorsState } from '@dnd/mechanics/doors'
import { fogModule, getCell, type FogState, type Frame } from '@dnd/mechanics/fog'
import { tokensModule, type TokensState } from '@dnd/mechanics/tokens'
import type { ServerMessage } from '@dnd/core/src/shared/protocol'
import { openDb } from '../db/db'
import { createStores } from '../db/stores'
import { Broadcaster } from '../ws/Broadcaster'
import type { ClientConnection } from '../ws/ClientConnection'
import { CommandRouter } from '../ws/CommandRouter'
import { ModuleRegistry, type AfterWrite, type DispatchContext } from './registry'

const DM: Viewer = { role: 'dm', identityId: 'dm-1' }
const SCENE = 'scene-1'

function baseCtx(campaignId: string, overrides: Partial<DispatchContext> = {}): DispatchContext {
  return {
    campaignId,
    sessionId: 'sess-1',
    activeSceneId: SCENE,
    sender: DM,
    players: [],
    broadcast: () => {},
    ...overrides,
  }
}

/**
 * Shaped exactly like the real triggers module for the property under test: `noop` is a
 * normal wire-reachable command, `event` is deliberately absent from `commands` — the same
 * asymmetry triggers/module.ts ships. What this stub does with `event` (count the calls) is
 * not the point; that the registry can even reach it, and only via `dispatchInternal`, is.
 */
function stubTriggers(onEvent?: (payload: unknown) => void): GameModule<{ calls: number }> {
  return {
    name: 'triggers',
    commands: { noop: ANY_ROLE },
    initialState: { calls: 0 },
    handler(action, payload, ctx) {
      if (action === 'noop') return
      if (action === 'event') {
        onEvent?.(payload)
        ctx.setState({ calls: ctx.state.calls + 1 })
        return
      }
      return { code: 'invalid-command', message: `stub triggers has no action '${action}'` }
    },
  }
}

function wired(triggers?: GameModule<{ calls: number }>) {
  const stores = createStores(openDb(':memory:'))
  const campaign = stores.campaigns.create('Camp')
  const registry = new ModuleRegistry(stores.moduleState)
  registry.register(tokensModule())
  if (triggers) registry.register(triggers)
  return { registry, campaignId: campaign.id, stores }
}

describe('dispatch vs dispatchInternal (M4)', () => {
  it('refuses `triggers.event` over the wire path even though the module is registered', () => {
    const { registry, campaignId } = wired(stubTriggers())
    const error = registry.dispatch('triggers', 'event', { sceneId: SCENE, source: {} }, baseCtx(campaignId))
    expect(error).toEqual({
      code: 'invalid-command',
      message: `module 'triggers' has no action 'event'`,
    })
  })

  it('dispatchInternal reaches the same action, skipping both the commands check and the role gate', () => {
    const seen: unknown[] = []
    const { registry, campaignId } = wired(stubTriggers((p) => seen.push(p)))
    const error = registry.dispatchInternal(
      'triggers',
      'event',
      { sceneId: SCENE, source: { module: 'tokens', action: 'move' } },
      baseCtx(campaignId, { sender: { role: 'player', identityId: 'p-1' } }),
    )
    expect(error).toBeNull()
    expect(seen).toEqual([{ sceneId: SCENE, source: { module: 'tokens', action: 'move' } }])
  })

  // N8 — `dispatchInternal` stays public only because this file's test above needs to call
  // it directly; that must not become a second door a socket can walk through. A grep-level
  // guard is cheap and catches the one thing that actually matters: nobody in ws/CommandRouter
  // ever writes `.dispatchInternal(`.
  it('CommandRouter never calls dispatchInternal — dispatch is its only door in', () => {
    const source = readFileSync(join(__dirname, '../ws/CommandRouter.ts'), 'utf8')
    expect(source).not.toContain('.dispatchInternal(')
  })
})

describe('the tokens/fog → triggers cascade', () => {
  function place(registry: ModuleRegistry, campaignId: string, x: number, y: number): string {
    const sent: unknown[] = []
    const error = registry.dispatch(
      'tokens',
      'place',
      { sceneId: SCENE, name: 'Rat', x, y },
      baseCtx(campaignId, { broadcast: (m) => sent.push(m) }),
    )
    expect(error).toBeNull()
    const state = sent.find(
      (m): m is { type: 'state-update'; module: string; state: TokensState } =>
        (m as { type: string }).type === 'state-update' && (m as { module: string }).module === 'tokens',
    )
    const token = Object.values(state!.state.byScene[SCENE] ?? {})[0]
    return token.id
  }

  it('fires after a successful tokens.move', () => {
    const events: unknown[] = []
    const { registry, campaignId } = wired(stubTriggers((p) => events.push(p)))
    const id = place(registry, campaignId, 0, 0)
    events.length = 0 // `place` cascades too (it's in CASCADES); only `move`'s is under test here

    const error = registry.dispatch('tokens', 'move', { sceneId: SCENE, id, x: 5, y: 5 }, baseCtx(campaignId))
    expect(error).toBeNull()
    expect(events).toEqual([{ sceneId: SCENE, source: { module: 'tokens', action: 'move' } }])
  })

  it('does not fire after a refused tokens.move', () => {
    const events: unknown[] = []
    const { registry, campaignId } = wired(stubTriggers((p) => events.push(p)))
    // No such token in that scene — `move` refuses before ever calling `setState`.
    const error = registry.dispatch(
      'tokens',
      'move',
      { sceneId: SCENE, id: 'no-such-token', x: 5, y: 5 },
      baseCtx(campaignId),
    )
    expect(error?.code).toBe('invalid-command')
    expect(events).toEqual([])
  })

  // `fog-all` is what re-arms room-revealed triggers, so it has to reach them. Left out of
  // CASCADES they would stay spent after the map went back under.
  it('fires after a successful fog.fog-all', () => {
    const events: unknown[] = []
    const { registry, campaignId } = wired(stubTriggers((p) => events.push(p)))
    registry.register(fogModule())

    expect(registry.dispatch('fog', 'fog-all', {}, baseCtx(campaignId))).toBeNull()
    expect(events).toEqual([{ sceneId: SCENE, source: { module: 'fog', action: 'fog-all' } }])
  })

  it('is a silent no-op when triggers is not registered', () => {
    const { registry, campaignId } = wired() // no triggers module at all
    const id = place(registry, campaignId, 0, 0)
    expect(() =>
      registry.dispatch('tokens', 'move', { sceneId: SCENE, id, x: 5, y: 5 }, baseCtx(campaignId)),
    ).not.toThrow()
    expect(registry.dispatch('tokens', 'move', { sceneId: SCENE, id, x: 6, y: 6 }, baseCtx(campaignId))).toBeNull()
  })
})

describe('undo for the DM (table lobby pass §5)', () => {
  const PLAYER: Viewer = { role: 'player', identityId: 'p-1' }
  const PLAYERS = [
    { identityId: 'dm-1', name: 'Ayla', role: 'dm' as const, connected: true },
    { identityId: 'p-1', name: 'Bo', role: 'player' as const, connected: true },
  ]

  /** Not recorded: Start places the party through an after-write rule. */
  const stubTable: GameModule<{ started: boolean }> = {
    name: 'table',
    commands: { start: ['dm'] },
    initialState: { started: false },
    handler(_action, _payload, ctx) {
      ctx.setState({ started: true })
    },
  }
  const placeOnStart: AfterWrite = (event, ctx, registry) => {
    if (event.module === 'table') registry.dispatch('tokens', 'place', { sceneId: SCENE, name: 'Hero', x: 1, y: 1 }, ctx)
  }

  function table(opts: { triggers?: boolean } = {}) {
    const stores = createStores(openDb(':memory:'))
    const campaignId = stores.campaigns.create('Camp').id
    const registry = new ModuleRegistry(stores.moduleState, placeOnStart)
    let frame: Frame = { minX: 0, minY: 0, maxX: 10, maxY: 10 }
    let doors: AuthoredDoor[] = [{ id: 'd1', state: 'closed', isSecret: false }]
    registry.register(tokensModule())
    registry.register(fogModule(() => frame, () => ['L'], () => true))
    registry.register(doorsModule(() => doors))
    registry.register(stubTable)
    if (opts.triggers) registry.register(stubTriggers())
    const sent: ServerMessage[] = []
    const ctx = (sender: Viewer = DM) =>
      baseCtx(campaignId, { sender, players: PLAYERS, broadcast: (m) => sent.push(m) })
    const dm = (module: string, action: string, payload: unknown, group?: string) => {
      const error = registry.dispatchRecorded(module, action, payload, ctx(), group)
      expect(error).toBeNull()
    }
    const state = <S>(name: string) => stores.moduleState.get(campaignId, name) as S
    const tokensOf = () => state<TokensState>('tokens').byScene[SCENE] ?? {}
    const place = (extra: Record<string, unknown> = {}) => {
      dm('tokens', 'place', { sceneId: SCENE, name: 'Rat', x: 0, y: 0, ...extra })
      return Object.keys(tokensOf()).at(-1)!
    }
    return {
      registry,
      campaignId,
      stores,
      ctx,
      dm,
      state,
      tokensOf,
      place,
      sent,
      undo: () => registry.stepHistory('undo', ctx()),
      redo: () => registry.stepHistory('redo', ctx()),
      cleared: (col: number, row: number) => getCell(state<FogState>('fog').byScene[SCENE]?.cleared?.L, col, row),
      republish: (next: { frame?: Frame; doors?: AuthoredDoor[] }) => {
        frame = next.frame ?? frame
        doors = next.doors ?? doors
      },
    }
  }

  it('undoes and redoes a move, a hide, an HP change and a delete', () => {
    const t = table()
    const id = t.place({ hp: { max: 10 } })
    const start = { ...t.tokensOf()[id] }

    t.dm('tokens', 'move', { sceneId: SCENE, id, x: 5, y: 5 })
    const moved = t.tokensOf()[id].x
    t.undo()
    expect(t.tokensOf()[id].x).toBe(start.x)
    t.redo()
    expect(t.tokensOf()[id].x).toBe(moved)

    t.dm('tokens', 'hide', { sceneId: SCENE, id, hidden: true })
    t.undo()
    expect(t.tokensOf()[id].hidden).toBe(false)
    t.redo()
    expect(t.tokensOf()[id].hidden).toBe(true)

    t.dm('tokens', 'damage', { sceneId: SCENE, target: id, amount: 3 })
    expect(t.tokensOf()[id].hp?.current).toBe(7)
    t.undo()
    expect(t.tokensOf()[id].hp?.current).toBe(10)
    t.redo()
    expect(t.tokensOf()[id].hp?.current).toBe(7)

    t.dm('tokens', 'delete', { sceneId: SCENE, id })
    t.undo()
    expect(t.tokensOf()[id]).toMatchObject({ x: moved, hidden: true })
    t.redo()
    expect(t.tokensOf()[id]).toBeUndefined()
  })

  it('makes a drag one step', () => {
    const t = table()
    const id = t.place()
    const startX = t.tokensOf()[id].x
    for (let x = 1; x <= 5; x++) t.dm('tokens', 'move', { sceneId: SCENE, id, x, y: 0 }, 'drag-1')
    t.undo()
    expect(t.tokensOf()[id].x).toBe(startX)
    expect(t.registry.historyOf('sess-1').undo).toEqual({ module: 'tokens', action: 'place' })
  })

  it('makes a fog stroke one step, and undoing it keeps the cells explored since', () => {
    const t = table()
    t.dm('fog', 'region-set', { sceneId: SCENE, levelId: 'L', op: 'clear', cells: [[1, 1]] }, 'stroke-1')
    t.dm('fog', 'region-set', { sceneId: SCENE, levelId: 'L', op: 'clear', cells: [[2, 2]] }, 'stroke-1')
    // The party's sight, which the server writes itself.
    t.registry.dispatchInternal('fog', 'auto-explore', { sceneId: SCENE, byLevel: { L: [[5, 5]] } }, t.ctx())
    t.undo()
    expect([t.cleared(1, 1), t.cleared(2, 2), t.cleared(5, 5)]).toEqual([false, false, true])
    expect(t.registry.historyOf('sess-1').undo).toBeNull()
    t.redo()
    expect([t.cleared(1, 1), t.cleared(2, 2), t.cleared(5, 5)]).toEqual([true, true, true])
  })

  it('leaves the log alone: an undo neither drops lines written since nor brings back old ones', () => {
    const t = table()
    t.dm('doors', 'toggle', { sceneId: SCENE, id: 'd1' })
    t.dm('fog', 'region-set', { sceneId: SCENE, levelId: 'L', op: 'clear', cells: [[1, 1]] })
    t.dm('doors', 'toggle', { sceneId: SCENE, id: 'd1' })
    const lines = t.state<DoorsState>('doors').log
    expect(lines).toHaveLength(2)
    t.undo()
    t.undo()
    expect(t.state<DoorsState>('doors').log).toEqual(lines)
    expect(t.state<FogState>('fog').log).toHaveLength(1)
    expect(t.state<DoorsState>('doors').byScene[SCENE].d1.open).toBe(true)
  })

  it('undoes a trigger the move fired along with the move', () => {
    const t = table({ triggers: true })
    const id = t.place()
    expect(t.state<{ calls: number }>('triggers').calls).toBe(1)
    t.dm('tokens', 'move', { sceneId: SCENE, id, x: 5, y: 5 })
    expect(t.state<{ calls: number }>('triggers').calls).toBe(2)
    t.undo()
    expect(t.state<{ calls: number }>('triggers').calls).toBe(1)
  })

  it("keeps a player's later move when the DM undoes something else", () => {
    const t = table()
    const mine = t.place()
    const theirs = t.place()
    t.dm('tokens', 'assign', { sceneId: SCENE, id: theirs, identityId: 'p-1' })
    t.dm('tokens', 'move', { sceneId: SCENE, id: mine, x: 5, y: 5 })
    expect(t.registry.dispatch('tokens', 'move', { sceneId: SCENE, id: theirs, x: 3, y: 3 }, t.ctx(PLAYER))).toBeNull()
    const playerAt = t.tokensOf()[theirs].x
    t.undo()
    expect(t.tokensOf()[mine].x).toBe(0.5)
    expect(t.tokensOf()[theirs].x).toBe(playerAt)
  })

  it('empties the redo list on a new command', () => {
    const t = table()
    const id = t.place()
    t.dm('tokens', 'move', { sceneId: SCENE, id, x: 5, y: 5 })
    t.undo()
    expect(t.registry.historyOf('sess-1').redo).toEqual({ module: 'tokens', action: 'move' })
    t.dm('tokens', 'hide', { sceneId: SCENE, id })
    expect(t.registry.historyOf('sess-1').redo).toBeNull()
  })

  it('records one diff per DM dispatch, and none for a player, the server, or an unrecorded module', () => {
    const t = table({ triggers: true })
    const id = t.place()
    t.dm('tokens', 'assign', { sceneId: SCENE, id, identityId: 'p-1' })
    const diffs = t.registry.historyStats.diffs
    // A move that cascades into triggers is still one diff.
    t.dm('tokens', 'move', { sceneId: SCENE, id, x: 5, y: 5 })
    expect(t.registry.historyStats.diffs).toBe(diffs + 1)
    const top = t.registry.historyOf('sess-1')

    t.registry.dispatch('tokens', 'move', { sceneId: SCENE, id, x: 6, y: 6 }, t.ctx(PLAYER))
    t.registry.dispatch('tokens', 'move', { sceneId: SCENE, id, x: 7, y: 7 }, t.ctx())
    // Start writes the table and places a token through an after-write rule: neither is a step.
    t.dm('table', 'start', {})
    expect(Object.keys(t.tokensOf())).toHaveLength(2)
    expect(t.registry.historyStats.diffs).toBe(diffs + 1)
    expect(t.registry.historyOf('sess-1')).toEqual(top)
  })

  it('walks under 1,000 nodes to diff one move on a 200-token scene', () => {
    const t = table()
    for (let i = 0; i < 199; i++) {
      t.registry.dispatch('tokens', 'place', { sceneId: SCENE, name: `Rat ${i}`, x: i % 20, y: Math.floor(i / 20) }, t.ctx())
    }
    const id = t.place()
    expect(Object.keys(t.tokensOf())).toHaveLength(200)
    t.registry.historyStats.visited = 0
    t.dm('tokens', 'move', { sceneId: SCENE, id, x: 5, y: 5 })
    expect(t.registry.historyStats.visited).toBeLessThan(1000)
  })

  it('tells the table, tagged with the step’s scene, and re-sends the slices the write re-redacts', () => {
    const t = table()
    t.dm('fog', 'region-set', { sceneId: SCENE, levelId: 'L', op: 'clear', cells: [[1, 1]] })
    t.sent.length = 0
    t.undo()
    expect(t.sent.map((m) => [m.type, (m as { module?: string }).module, (m as { sceneId?: string }).sceneId])).toEqual([
      ['state-update', 'fog', SCENE],
      ['state-update', 'tokens', SCENE],
      ['state-update', 'doors', SCENE],
    ])
  })

  it('forgets the history when a scene is deleted or the session ends', () => {
    const t = table()
    t.place()
    t.registry.forgetScene(t.campaignId, 'some-other-scene')
    expect(t.registry.historyOf('sess-1').undo).toBeNull()
    t.place()
    t.registry.forgetHistory('sess-1')
    expect(t.registry.historyOf('sess-1').undo).toBeNull()
  })

  it('undoes across a republish that removed the door and moved the map the step names', () => {
    const t = table()
    t.dm('doors', 'toggle', { sceneId: SCENE, id: 'd1' })
    t.dm('fog', 'region-set', { sceneId: SCENE, levelId: 'L', op: 'clear', cells: [[3, 3]] })
    t.republish({ frame: { minX: -2, minY: -2, maxX: 10, maxY: 10 }, doors: [{ id: 'd2', state: 'closed', isSecret: false }] })
    // The next write re-bases the record onto the new frame: world (3, 3) is now (5, 5).
    t.dm('fog', 'region-set', { sceneId: SCENE, levelId: 'L', op: 'clear', cells: [[0, 0]] })
    t.undo()
    t.undo()
    expect([t.cleared(5, 5), t.cleared(0, 0)]).toEqual([false, false])
    t.undo()
    expect(t.state<DoorsState>('doors').byScene[SCENE]?.d1).toBeUndefined()
    t.redo()
    expect(t.state<DoorsState>('doors').byScene[SCENE].d1.open).toBe(true)
    // The new map's doors still work.
    t.dm('doors', 'toggle', { sceneId: SCENE, id: 'd2' })
    expect(t.state<DoorsState>('doors').byScene[SCENE].d2.open).toBe(true)
  })

  it('reaches the router: a DM command is recorded and told to every DM seat, never to a player', () => {
    const t = table()
    const frames: { conn: string; msg: ServerMessage }[] = []
    const conn = (name: string, viewer: Viewer) =>
      ({
        identity: { ...viewer, name, sessionId: 'sess-1', campaignId: t.campaignId },
        deliver: (payload: string) => frames.push({ conn: name, msg: JSON.parse(payload) }),
      }) as unknown as ClientConnection
    const dmConn = conn('dm', DM)
    const otherDm = conn('dm-2', { role: 'dm', identityId: 'dm-2' })
    const playerConn = conn('player', PLAYER)
    const router = new CommandRouter(t.registry, new Broadcaster(() => [dmConn, otherDm, playerConn], (m) => m))
    const scope = { activeSceneId: SCENE, players: PLAYERS }
    const history = () => frames.filter((f) => f.msg.type === 'history')
    const placed = { type: 'history', undo: { module: 'tokens', action: 'place' }, redo: null }

    router.handle(dmConn, { type: 'command', module: 'tokens', action: 'place', payload: { sceneId: SCENE, name: 'Rat', x: 0, y: 0 }, seq: 1 }, scope)
    expect(history()).toEqual([
      { conn: 'dm', msg: placed },
      { conn: 'dm-2', msg: placed },
    ])

    router.handle(playerConn, { type: 'command', module: 'doors', action: 'toggle', payload: { sceneId: SCENE, id: 'd1' }, seq: 1 }, scope)
    expect(history()).toHaveLength(2)

    router.history(dmConn, 'undo', scope)
    expect(history().at(-1)).toEqual({ conn: 'dm-2', msg: { type: 'history', undo: null, redo: { module: 'tokens', action: 'place' } } })
    expect(t.tokensOf()).toEqual({})

    // A scene delete empties the history, and the DM seats are told again.
    t.registry.forgetScene(t.campaignId, SCENE)
    router.sayHistory('sess-1')
    expect(history().slice(-2)).toEqual([
      { conn: 'dm', msg: { type: 'history', undo: null, redo: null } },
      { conn: 'dm-2', msg: { type: 'history', undo: null, redo: null } },
    ])
    expect(history().some((f) => f.conn === 'player')).toBe(false)
  })
})
