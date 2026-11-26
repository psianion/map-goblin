// Table lobby pass §3.3 to 3.5 — a seat's own character (claim, make, edit, let go), its ring,
// and the DM's party start area.

import { describe, expect, it } from 'vitest'
import type { Viewer } from '../contract'
import { tokensModule as buildTokens } from './module'
import { NO_OWN_PC, PC_ALREADY_OWNED, PC_TAKEN, PLAYER_PCS_OFF } from './types'
import type { TableFlags, Token, TokenDef, TokensState } from './types'

const DM: Viewer = { role: 'dm', identityId: 'dm-1' }
const P1: Viewer = { role: 'player', identityId: 'p-1' }
const P2: Viewer = { role: 'player', identityId: 'p-2' }
const SCENE = 'scene-a'
const ROSTER = [
  { identityId: 'dm-1', name: 'Ayla', role: 'dm' as const, connected: true },
  { identityId: 'p-1', name: 'Borin', role: 'player' as const, connected: true },
  { identityId: 'p-2', name: 'Cass', role: 'player' as const, connected: true },
]

const pc = (id: string, over: Partial<TokenDef> = {}): TokenDef => ({
  id,
  name: id,
  imageAssetId: null,
  size: 'medium',
  disposition: 'friendly',
  sight: null,
  light: null,
  kind: 'pc',
  ...over,
})

const placed = (def: TokenDef, id: string): Token => ({ ...def, id, defId: def.id, x: 1.5, y: 1.5, elevation: 0, z: 0, hidden: false, ownerId: null })

function harness(playersMakePcs = true) {
  const table: TableFlags = { paused: false, movementLocked: false, started: false, playersMakePcs, lobbyShowsScene: false }
  const module = buildTokens(undefined, undefined, undefined, () => table)
  const run = (state: TokensState, sender: Viewer, action: string, payload: unknown = {}) => {
    const roles = module.commands[action]
    if (!roles?.includes(sender.role)) return { error: { code: 'unauthorized', message: '' }, next: state }
    let next = state
    const error = module.handler(action, payload, {
      campaignId: 'c-1',
      sessionId: 's-1',
      activeSceneId: SCENE,
      sender,
      players: ROSTER,
      state,
      setState: (s) => {
        next = s
      },
      broadcast: () => {},
    })
    return { error, next }
  }
  return { module, run }
}

const free = pc('bram')
const start: TokensState = { library: { bram: free, saved: pc('saved', { ownerName: 'Dana' }) }, byScene: { [SCENE]: { t1: placed(free, 't1') } } }

describe('a seat’s character', () => {
  it('claims a free PC: the def and every token placed from it are the seat’s', () => {
    const { run } = harness()
    const { error, next } = run(start, P1, 'pc-claim', { defId: 'bram' })
    expect(error).toBeUndefined()
    expect(next.library.bram).toMatchObject({ ownerIdentityId: 'p-1', ownerName: 'Borin' })
    expect(next.byScene[SCENE]!.t1).toMatchObject({ ownerId: 'p-1', ownerIdentityId: 'p-1', ownerName: 'Borin' })
  })

  it('refuses a PC someone holds, one saved for a name, and a second PC for one seat', () => {
    const { run } = harness()
    const held = run(start, P1, 'pc-claim', { defId: 'bram' }).next
    expect(run(held, P2, 'pc-claim', { defId: 'bram' }).error?.message.startsWith(PC_TAKEN)).toBe(true)
    expect(run(start, P1, 'pc-claim', { defId: 'saved' }).error?.message.startsWith(PC_TAKEN)).toBe(true)
    const withSecond = { ...held, library: { ...held.library, cora: pc('cora') } }
    expect(run(withSecond, P1, 'pc-claim', { defId: 'cora' }).error?.message.startsWith(PC_ALREADY_OWNED)).toBe(true)
    expect(run(withSecond, P1, 'pc-create', { name: 'Again' }).error?.message.startsWith(PC_ALREADY_OWNED)).toBe(true)
    // A def that is not a PC is not a character.
    const npc = { ...start, library: { ...start.library, gob: pc('gob', { kind: 'npc' }) } }
    expect(run(npc, P1, 'pc-claim', { defId: 'gob' }).error).toMatchObject({ code: 'invalid-command' })
  })

  it('makes a medium PC of the seat’s own, with its art and ring, unless the DM turned it off', () => {
    const { run } = harness()
    const { error, next } = run(start, P2, 'pc-create', { name: 'Cass the Bold', imageAssetId: 'art-1', ring: '#aa33cc' })
    expect(error).toBeUndefined()
    const made = Object.values(next.library).find((d) => d.ownerIdentityId === 'p-2')
    expect(made).toMatchObject({ name: 'Cass the Bold', kind: 'pc', size: 'medium', imageAssetId: 'art-1', ring: '#aa33cc', ownerName: 'Cass' })
    expect(made!.sight).not.toBeNull()

    const off = harness(false).run(start, P2, 'pc-create', { name: 'Cass' })
    expect(off.error?.message.startsWith(PLAYER_PCS_OFF)).toBe(true)
  })

  it('updates the seat’s own PC and every token placed from it; with none, refuses', () => {
    const { run } = harness()
    const held = run(start, P1, 'pc-claim', { defId: 'bram' }).next
    const { error, next } = run(held, P1, 'pc-update', { name: 'Bram Ironside', imageAssetId: 'art-2', ring: 'none' })
    expect(error).toBeUndefined()
    expect(next.library.bram).toMatchObject({ name: 'Bram Ironside', imageAssetId: 'art-2', ring: 'none' })
    expect(next.byScene[SCENE]!.t1).toMatchObject({ name: 'Bram Ironside', imageAssetId: 'art-2', ring: 'none' })
    const cleared = run(next, P1, 'pc-update', { ring: null }).next
    expect(cleared.library.bram!.ring).toBeUndefined()
    expect(cleared.byScene[SCENE]!.t1!.ring).toBeUndefined()

    expect(run(start, P2, 'pc-update', { name: 'X' }).error?.message.startsWith(NO_OWN_PC)).toBe(true)
    expect(run(start, P2, 'pc-release').error?.message.startsWith(NO_OWN_PC)).toBe(true)
  })

  it('releases: the def stays in the library and on the map, held by nobody', () => {
    const { run } = harness()
    const held = run(start, P1, 'pc-claim', { defId: 'bram' }).next
    const { error, next } = run(held, P1, 'pc-release')
    expect(error).toBeUndefined()
    expect(next.library.bram).toBeDefined()
    expect(next.library.bram!.ownerIdentityId).toBeUndefined()
    expect(next.library.bram!.ownerName).toBeUndefined()
    expect(next.byScene[SCENE]!.t1).toMatchObject({ ownerId: null })
    expect(next.byScene[SCENE]!.t1!.ownerName).toBeUndefined()
    // Free again for anyone.
    expect(run(next, P2, 'pc-claim', { defId: 'bram' }).error).toBeUndefined()
  })

  it('are player commands; the DM keeps assign and the library', () => {
    const { run } = harness()
    for (const action of ['pc-claim', 'pc-create', 'pc-update', 'pc-release']) {
      expect(run(start, DM, action, {}).error).toMatchObject({ code: 'unauthorized' })
    }
  })
})

describe('the ring', () => {
  it('takes #rrggbb or none, from the DM’s library and a player’s own token, and nothing else', () => {
    const { run } = harness()
    expect(run(start, DM, 'library-upsert', { id: 'bram', ring: '#00FF7f' }).next.library.bram!.ring).toBe('#00FF7f')
    for (const ring of ['red', '#abc', '#12345g', 7, '']) {
      expect(run(start, DM, 'library-upsert', { id: 'bram', ring }).error).toMatchObject({ code: 'invalid-command' })
    }
    const held = run(start, P1, 'pc-claim', { defId: 'bram' }).next
    const moved = run(held, P1, 'update', { id: 't1', ring: '#123456' })
    expect(moved.error).toBeUndefined()
    expect(moved.next.byScene[SCENE]!.t1!.ring).toBe('#123456')
    expect(run(held, P1, 'update', { id: 't1', ring: 'blue' }).error).toMatchObject({ code: 'invalid-command' })
  })

  it('reaches the placed tokens when the DM edits the def', () => {
    const { run } = harness()
    const next = run(start, DM, 'library-upsert', { id: 'bram', ring: '#ff0000' }).next
    expect(next.byScene[SCENE]!.t1!.ring).toBe('#ff0000')
  })
})

describe('the party start area', () => {
  it('is the DM’s rectangle of cells, corners in any order, cleared by null, and never sent to a player', () => {
    const { run, module } = harness()
    const set = run(start, DM, 'set-party-start', { rect: { x0: 6, y0: 4, x1: 4, y1: 2 }, levelId: 'lvl-2' })
    expect(set.error).toBeUndefined()
    expect(set.next.partyStart).toEqual({ [SCENE]: { x0: 4, y0: 2, x1: 6, y1: 4, levelId: 'lvl-2' } })
    expect(module.redact!(set.next, P1).partyStart).toBeUndefined()
    expect(module.redact!(set.next, DM).partyStart).toEqual(set.next.partyStart)
    expect(run(set.next, DM, 'set-party-start', { rect: null }).next.partyStart).toEqual({})
    expect(run(start, DM, 'set-party-start', { rect: { x0: 0.5, y0: 0, x1: 1, y1: 1 } }).error).toMatchObject({ code: 'invalid-command' })
    expect(run(start, DM, 'set-party-start', { rect: { x0: 0, y0: 0, x1: 40, y1: 1 } }).error).toMatchObject({ code: 'invalid-command' })
    expect(run(start, P1, 'set-party-start', { rect: null }).error).toMatchObject({ code: 'unauthorized' })
  })

  it('goes with its scene', () => {
    const { run, module } = harness()
    const set = run(start, DM, 'set-party-start', { rect: { x0: 0, y0: 0, x1: 2, y1: 2 } }).next
    expect(module.forgetScene!(set, SCENE).partyStart).toEqual({})
  })
})
