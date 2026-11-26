// Table v2 — pause and movement lock live on the session's row: the module writes them
// through, and a player's move is refused from the row.

import { describe, expect, it } from 'vitest'
import type { Viewer } from '@dnd/mechanics/contract'
import { rollsModule } from '@dnd/mechanics/rolls'
import { LOBBY_COMMANDS, TABLE_NOT_STARTED, TABLE_NOT_STARTED_ERROR, TABLE_PAUSED_ERROR } from '@dnd/mechanics/table'
import { storyModule } from '@dnd/mechanics/story'
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
    expect(t.flagsOf(session.id)).toMatchObject({ paused: true, movementLocked: true })
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
    const { run } = gated()
    const roll = { formula: '1d20' }

    run(DM, 'table', 'start', { on: true })
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
    expect(t.flagsOf(next.id)).toMatchObject({ paused: false, movementLocked: false })
  })
})

/** A registry behind the seat gate, as the server builds it. */
function gated() {
  const stores = createStores(openDb(':memory:'))
  const campaign = stores.campaigns.create('Camp')
  const session = stores.sessions.createSession(campaign.id, 'ABCD')
  const t = sessionTable(stores)
  const registry = new ModuleRegistry(stores.moduleState, undefined, t.seatGate)
  registry.register(rollsModule)
  registry.register(pingModule)
  registry.register(tokensModule(undefined, undefined, undefined, t.tableOf))
  registry.register(storyModule())
  registry.register(t.module)
  const run = (sender: Viewer, module: string, action: string, payload: unknown) =>
    registry.dispatch(module, action, payload, {
      campaignId: campaign.id,
      sessionId: session.id,
      activeSceneId: 'scene-1',
      sender,
      players: [{ identityId: 'p-1', name: 'Bob', role: 'player', connected: true }],
      broadcast: () => {},
    })
  return { stores, session, registry, run, t, campaignId: campaign.id }
}

/** Every lobby command, each with a payload its handler can judge; none may meet the gate. */
const LOBBY_CALLS: [string, string, unknown][] = LOBBY_COMMANDS.map((name) => {
  const [module, action] = name.split('.') as [string, string]
  return [module, action, action === 'ready' ? { key: 'scene-1:map-1' } : {}]
})

describe('the lobby (table lobby pass)', () => {
  it('a new session is not started, and its lobby switches start at their defaults', () => {
    const { t, session } = gated()
    expect(t.flagsOf(session.id)).toEqual({
      paused: false,
      movementLocked: false,
      started: false,
      playersMakePcs: true,
      lobbyShowsScene: false,
    })
  })

  it('refuses a player’s move and roll until Start, and lets the lobby list through', () => {
    const { run, registry, campaignId } = gated()
    run(DM, 'tokens', 'place', { name: 'Bram', x: 1, y: 1 })
    const [id] = Object.keys((registry.readState(campaignId, 'tokens') as TokensState).byScene['scene-1'])
    run(DM, 'tokens', 'assign', { id, identityId: 'p-1' })

    expect(run(PLAYER, 'tokens', 'move', { id, x: 3, y: 3 })).toEqual(TABLE_NOT_STARTED_ERROR)
    expect(run(PLAYER, 'rolls', 'roll', { formula: '1d20' })).toEqual(TABLE_NOT_STARTED_ERROR)
    expect(TABLE_NOT_STARTED_ERROR.message.startsWith(TABLE_NOT_STARTED)).toBe(true)
    for (const [module, action, payload] of LOBBY_CALLS) {
      expect(run(PLAYER, module, action, payload)).not.toEqual(TABLE_NOT_STARTED_ERROR)
    }
    // The DM is never held.
    expect(run(DM, 'tokens', 'move', { id, x: 2, y: 2 })).toBeNull()

    expect(run(DM, 'table', 'start', { on: true })).toBeNull()
    expect(run(PLAYER, 'tokens', 'move', { id, x: 3, y: 3 })).toBeNull()
    // Back to the lobby: held again.
    run(DM, 'table', 'start', { on: false })
    expect(run(PLAYER, 'tokens', 'move', { id, x: 5, y: 5 })).toEqual(TABLE_NOT_STARTED_ERROR)
  })

  it('a paused table still lets the lobby list through', () => {
    const { run } = gated()
    run(DM, 'table', 'start', { on: true })
    run(DM, 'table', 'pause', { on: true })
    expect(run(PLAYER, 'rolls', 'roll', { formula: '1d20' })).toEqual(TABLE_PAUSED_ERROR)
    for (const [module, action, payload] of LOBBY_CALLS) {
      expect(run(PLAYER, module, action, payload)).not.toEqual(TABLE_PAUSED_ERROR)
    }
  })

  it('start and the lobby switches write the row; ready is the seat’s own and not on it', () => {
    const { run, t, session, registry, campaignId, stores } = gated()
    expect(run(DM, 'table', 'set-lobby', { playersMakePcs: false, lobbyShowsScene: true })).toBeNull()
    expect(run(DM, 'table', 'start', { on: true })).toBeNull()
    expect(t.flagsOf(session.id)).toMatchObject({ started: true, playersMakePcs: false, lobbyShowsScene: true })
    expect(stores.sessions.get(session.id)).toMatchObject({ started: 1, players_make_pcs: 0, lobby_shows_scene: 1 })
    expect(run(PLAYER, 'table', 'ready', { key: 'scene-1:map-2' })).toBeNull()
    expect(registry.readState(campaignId, 'table')).toMatchObject({ ready: { 'p-1': 'scene-1:map-2' } })
    expect(run(PLAYER, 'table', 'start', { on: false })).toMatchObject({ code: 'unauthorized' })
    expect(run(PLAYER, 'table', 'set-lobby', { playersMakePcs: true })).toMatchObject({ code: 'unauthorized' })
    expect(run(DM, 'table', 'set-lobby', {})).toMatchObject({ code: 'invalid-command' })
  })
})
