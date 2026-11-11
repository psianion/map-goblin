// Table v2 — pause and movement lock live on the session's row: the module writes them
// through, and a player's move is refused from the row.

import { describe, expect, it } from 'vitest'
import type { Viewer } from '@dnd/mechanics/contract'
import { rollsModule } from '@dnd/mechanics/rolls'
import { TABLE_PAUSED_ERROR } from '@dnd/mechanics/table'
import { TABLE_PAUSED, tokensModule, type TokensState } from '@dnd/mechanics/tokens'
import { openDb } from '../db/db'
import { createStores } from '../db/stores'
import { pingModule } from './ping'
import { ModuleRegistry, type DispatchContext } from './registry'
import { sessionTable } from './table'

const DM: Viewer = { role: 'dm', identityId: 'dm-1' }
const PLAYER: Viewer = { role: 'player', identityId: 'p-1' }

function table() {
  const stores = createStores(openDb(':memory:'))
  const campaign = stores.campaigns.create('Camp')
  const session = stores.sessions.createSession(campaign.id, 'ABCD')
  const t = sessionTable(stores)
  const registry = new ModuleRegistry(stores.moduleState)
  registry.register(tokensModule(undefined, undefined, undefined, t.tableOf))
  registry.register(t.module)
  const ctx = (sender: Viewer): DispatchContext => ({
    campaignId: campaign.id,
    sessionId: session.id,
    activeSceneId: 'scene-1',
    sender,
    players: [{ identityId: 'p-1', name: 'Bob', role: 'player', connected: true }],
    broadcast: () => {},
  })
  const run = (sender: Viewer, module: string, action: string, payload: unknown) => registry.dispatch(module, action, payload, ctx(sender))
  return { stores, session, registry, run, t, campaignId: campaign.id }
}

describe('table on the session row', () => {
  it('pause and lock write the row', () => {
    const { run, stores, session, t } = table()
    expect(run(DM, 'table', 'pause', { on: true })).toBeNull()
    expect(stores.sessions.get(session.id)).toMatchObject({ paused: 1, movement_locked: 0 })
    run(DM, 'table', 'lock-movement', { on: true })
    expect(t.flagsOf(session.id)).toEqual({ paused: true, movementLocked: true })
  })

  it('a player’s move is refused while paused and goes once it is lifted', () => {
    const { run, registry, campaignId } = table()
    run(DM, 'tokens', 'place', { name: 'Bram', x: 1, y: 1 })
    const [id] = Object.keys((registry.readState(campaignId, 'tokens') as TokensState).byScene['scene-1'])
    run(DM, 'tokens', 'assign', { id, identityId: 'p-1' })
    run(DM, 'table', 'pause', { on: true })
    expect(run(PLAYER, 'tokens', 'move', { id, x: 3, y: 3 })).toMatchObject({ code: 'unauthorized' })
    expect(run(DM, 'tokens', 'move', { id, x: 3, y: 3 })).toBeNull()
    run(DM, 'table', 'pause', { on: false })
    expect(run(PLAYER, 'tokens', 'move', { id, x: 5, y: 5 })).toBeNull()
  })

  it('a pause refuses every player command at dispatch, whatever its module, and never the DM', () => {
    const stores = createStores(openDb(':memory:'))
    const campaign = stores.campaigns.create('Camp')
    const session = stores.sessions.createSession(campaign.id, 'ABCD')
    const t = sessionTable(stores)
    const registry = new ModuleRegistry(stores.moduleState, undefined, (id) => t.flagsOf(id)?.paused === true)
    registry.register(rollsModule)
    registry.register(pingModule)
    registry.register(t.module)
    const run = (sender: Viewer, module: string, action: string, payload: unknown) =>
      registry.dispatch(module, action, payload, {
        campaignId: campaign.id,
        sessionId: session.id,
        activeSceneId: null,
        sender,
        players: [],
        broadcast: () => {},
      })
    const roll = { formula: '1d20' }

    run(DM, 'table', 'pause', { on: true })
    expect(run(PLAYER, 'rolls', 'roll', roll)).toEqual(TABLE_PAUSED_ERROR)
    expect(run(PLAYER, 'ping', 'echo', { t: 1 })).toEqual(TABLE_PAUSED_ERROR)
    expect(TABLE_PAUSED_ERROR.message.startsWith(TABLE_PAUSED)).toBe(true)
    expect(run(DM, 'rolls', 'roll', roll)).toBeNull()
    expect(run(DM, 'ping', 'echo', { t: 1 })).toBeNull()

    run(DM, 'table', 'pause', { on: false })
    expect(run(PLAYER, 'rolls', 'roll', roll)).toBeNull()
    expect(run(PLAYER, 'ping', 'echo', { t: 2 })).toBeNull()
  })

  it('a new session starts unpaused whatever the last one did', () => {
    const { run, stores, campaignId, t } = table()
    run(DM, 'table', 'pause', { on: true })
    const next = stores.sessions.createSession(campaignId, 'EFGH')
    expect(t.flagsOf(next.id)).toEqual({ paused: false, movementLocked: false })
  })
})
