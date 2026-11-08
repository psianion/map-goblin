import { describe, expect, it } from 'vitest'
import type { ServerMessage } from '@dnd/core/src/shared/protocol'
import type { Viewer } from '../contract'
import { fanAround, ringOffsets } from './fan'
import {
  MOVEMENT_LOCKED,
  TABLE_PAUSED,
  normalizeTokenDef,
  tickEffectList,
  tokensModule as buildTokens,
} from './module'
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

const token = (over: Partial<Token> = {}): Token => ({
  id: 't1',
  name: 'Goblin',
  imageAssetId: null,
  size: 'medium',
  disposition: 'hostile',
  sight: null,
  light: null,
  defId: null,
  x: 1.5,
  y: 2.5,
  elevation: 0,
  z: 0,
  hidden: false,
  ownerId: null,
  ...over,
})

const stateWith = (...tokens: Token[]): TokensState => ({
  library: {},
  byScene: { [SCENE]: Object.fromEntries(tokens.map((t) => [t.id, t])) },
})

function harness(table: TableFlags | null = null) {
  const module = buildTokens(undefined, undefined, undefined, () => table)
  const sent: ServerMessage[] = []
  const run = (state: TokensState, sender: Viewer, action: string, payload: unknown) => {
    const roles = module.commands[action]
    if (roles && !roles.includes(sender.role)) return { error: { code: 'unauthorized', message: '' }, next: state }
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
      broadcast: (msg) => sent.push(msg),
    })
    return { error, next }
  }
  return { module, run, sent }
}

const tok = (s: TokensState, id = 't1') => s.byScene[SCENE][id]

describe('TokenDef table v2 fields', () => {
  it('library-upsert stores the defaults: npc, hover nameplate, HP for the DM only, no conditions or effects', () => {
    const { run } = harness()
    const { next } = run({ library: {}, byScene: {} }, DM, 'library-upsert', { id: 'd1', name: 'Bram' })
    expect(next.library.d1).toMatchObject({ kind: 'npc', nameplate: 'hover', showHp: 'dm', conditions: [], effects: [] })
  })

  it('library-upsert takes kind, hp, ac, speed, nameplate, showHp and a PC owner', () => {
    const { run } = harness()
    const { next, error } = run({ library: {}, byScene: {} }, DM, 'library-upsert', {
      id: 'd1',
      name: 'Bram',
      kind: 'pc',
      hp: { max: 24 },
      ac: 16,
      speed: 30,
      nameplate: 'always',
      showHp: 'owner',
      ownerIdentityId: 'p-1',
      ownerName: 'Borin',
    })
    expect(error).toBeUndefined()
    expect(next.library.d1).toMatchObject({
      kind: 'pc',
      hp: { current: 24, max: 24 },
      ac: 16,
      speed: 30,
      nameplate: 'always',
      showHp: 'owner',
      ownerIdentityId: 'p-1',
      ownerName: 'Borin',
    })
  })

  it('refuses a bad kind, a zero pool, an AC past 99 and an unknown condition', () => {
    const { run } = harness()
    const base = { library: {}, byScene: {} }
    expect(run(base, DM, 'library-upsert', { name: 'X', kind: 'boss' }).error).toMatchObject({ code: 'invalid-command' })
    expect(run(base, DM, 'library-upsert', { name: 'X', hp: { max: 0 } }).error).toMatchObject({ code: 'invalid-command' })
    expect(run(base, DM, 'library-upsert', { name: 'X', ac: 120 }).error).toMatchObject({ code: 'invalid-command' })
    expect(run(base, DM, 'library-upsert', { name: 'X', conditions: ['sleepy'] }).error).toMatchObject({ code: 'invalid-command' })
  })

  it('normalizeTokenDef fills an old row and leaves a full one alone', () => {
    const old = { id: 'd', name: 'Old', imageAssetId: null, size: 'medium', disposition: 'neutral', sight: null, light: null } as TokenDef
    const filled = normalizeTokenDef(old)
    expect(filled).toMatchObject({ kind: 'npc', nameplate: 'hover', showHp: 'dm', conditions: [], effects: [] })
    expect(normalizeTokenDef(filled)).toBe(filled)
  })

  it('placing a PC def hands the token to its owner', () => {
    const { run } = harness()
    const lib = run({ library: {}, byScene: {} }, DM, 'library-upsert', { id: 'd1', name: 'Bram', kind: 'pc', ownerIdentityId: 'p-1' }).next
    const placed = run(lib, DM, 'place', { defId: 'd1', x: 3, y: 3 }).next
    const [t] = Object.values(placed.byScene[SCENE])
    expect(t).toMatchObject({ kind: 'pc', ownerId: 'p-1' })
  })

  it('a def edit carries the new pool size onto placed tokens without healing them', () => {
    const { run } = harness()
    let s = run({ library: {}, byScene: {} }, DM, 'library-upsert', { id: 'd1', name: 'Ogre', hp: { max: 50 } }).next
    s = run(s, DM, 'place', { defId: 'd1', x: 3, y: 3 }).next
    const id = Object.keys(s.byScene[SCENE])[0]
    s = run(s, DM, 'damage', { targets: [id], amount: 10 }).next
    s = run(s, DM, 'library-upsert', { id: 'd1', hp: { max: 60 } }).next
    expect(tok(s, id).hp).toEqual({ current: 50, max: 60 })
  })

  it('spawn carries the room key HP as the pool and marks the token a monster', () => {
    const { run } = harness()
    const { next } = run({ library: {}, byScene: {} }, DM, 'spawn', {
      tokens: [{ id: 'etok1', name: 'Wolf', x: 1, y: 1, hp: 11 }],
    })
    expect(next.byScene[SCENE].etok1).toMatchObject({ kind: 'monster', hp: { current: 11, max: 11 } })
  })
})

describe('damage and heal', () => {
  const s0 = stateWith(token({ id: 'a', hp: { current: 20, max: 20 } }), token({ id: 'b', hp: { current: 5, max: 10 } }), token({ id: 'c' }))

  it('damages every target with a pool and floors at 0', () => {
    const { run } = harness()
    const { next } = run(s0, DM, 'damage', { targets: ['a', 'b', 'c'], amount: 8 })
    expect(tok(next, 'a').hp).toEqual({ current: 12, max: 20 })
    expect(tok(next, 'b').hp).toEqual({ current: 0, max: 10 })
    expect(tok(next, 'c').hp).toBeUndefined()
  })

  it('half on save rounds down', () => {
    const { run } = harness()
    const { next } = run(s0, DM, 'damage', { targets: ['a'], amount: 7, half: true })
    expect(tok(next, 'a').hp?.current).toBe(17)
  })

  it('heals up to max', () => {
    const { run } = harness()
    const { next } = run(s0, DM, 'heal', { targets: ['b'], amount: 99 })
    expect(tok(next, 'b').hp).toEqual({ current: 10, max: 10 })
  })

  it('refuses when no target has a pool, a zero amount, and an empty target list', () => {
    const { run } = harness()
    expect(run(s0, DM, 'damage', { targets: ['c'], amount: 3 }).error).toMatchObject({ code: 'invalid-command' })
    expect(run(s0, DM, 'damage', { targets: ['a'], amount: 0 }).error).toMatchObject({ code: 'invalid-command' })
    expect(run(s0, DM, 'heal', { targets: [], amount: 3 }).error).toMatchObject({ code: 'invalid-command' })
  })

  it('a player may heal or damage their own token and nobody else’s', () => {
    const { run } = harness()
    const s = stateWith(token({ id: 'mine', ownerId: 'p-1', hp: { current: 4, max: 10 } }), token({ id: 'theirs', ownerId: 'p-2', hp: { current: 4, max: 10 } }))
    expect(tok(run(s, P1, 'heal', { targets: ['mine'], amount: 3 }).next, 'mine').hp?.current).toBe(7)
    expect(run(s, P1, 'damage', { targets: ['theirs'], amount: 3 }).error).toMatchObject({ code: 'unauthorized' })
  })

  it('a player cannot name a hidden token', () => {
    const { run } = harness()
    const s = stateWith(token({ id: 'h', hidden: true, ownerId: 'p-1', hp: { current: 4, max: 10 } }))
    expect(run(s, P1, 'heal', { targets: ['h'], amount: 1 }).error).toMatchObject({ code: 'invalid-command' })
  })
})

describe('set-condition, set-effect, gather', () => {
  it('set-condition toggles a catalogue condition on several tokens and is DM only', () => {
    const { run } = harness()
    const s = stateWith(token({ id: 'a' }), token({ id: 'b', conditions: ['prone'] }))
    const on = run(s, DM, 'set-condition', { targets: ['a', 'b'], name: 'prone', on: true }).next
    expect(tok(on, 'a').conditions).toEqual(['prone'])
    expect(tok(on, 'b').conditions).toEqual(['prone'])
    const off = run(on, DM, 'set-condition', { target: 'a', name: 'prone', on: false }).next
    expect(tok(off, 'a').conditions).toEqual([])
    expect(run(s, DM, 'set-condition', { target: 'a', name: 'sleepy', on: true }).error).toMatchObject({ code: 'invalid-command' })
    expect(run(s, P1, 'set-condition', { target: 'a', name: 'prone', on: true }).error).toMatchObject({ code: 'unauthorized' })
  })

  it('set-effect sets, replaces and removes a named timer', () => {
    const { run } = harness()
    let s = stateWith(token({ id: 'a' }))
    s = run(s, DM, 'set-effect', { target: 'a', name: 'Bless', rounds: 10 }).next
    s = run(s, DM, 'set-effect', { target: 'a', name: 'Bless', rounds: 3 }).next
    expect(tok(s, 'a').effects).toEqual([{ name: 'Bless', roundsLeft: 3 }])
    s = run(s, DM, 'set-effect', { target: 'a', name: 'Bless', rounds: 0 }).next
    expect(tok(s, 'a').effects).toEqual([])
    expect(run(s, DM, 'set-effect', { target: 'a', name: 'Bless', rounds: -2 }).error).toMatchObject({ code: 'invalid-command' })
  })

  it('tick-effects is internal, ticks every timer on the scene and tells the DM which ended', () => {
    const { module, run, sent } = harness()
    expect(module.commands['tick-effects']).toBeUndefined()
    const s = stateWith(
      token({ id: 'a', name: 'Bram', effects: [{ name: 'Bless', roundsLeft: 1 }, { name: 'Haste', roundsLeft: 3 }] }),
      token({ id: 'b' }),
    )
    const { next } = run(s, DM, 'tick-effects', { sceneId: SCENE })
    expect(tok(next, 'a').effects).toEqual([{ name: 'Haste', roundsLeft: 2 }])
    expect(sent).toEqual([{ type: 'effects-ended', sceneId: SCENE, ended: [{ tokenId: 'a', tokenName: 'Bram', name: 'Bless' }] }])
  })

  it('tickEffectList drops the ones at one round left', () => {
    expect(tickEffectList([{ name: 'A', roundsLeft: 1 }, { name: 'B', roundsLeft: 2 }])).toEqual({
      kept: [{ name: 'B', roundsLeft: 1 }],
      ended: ['A'],
    })
  })

  it('gather fans the targets out around the point, one per cell', () => {
    const { run } = harness()
    const s = stateWith(token({ id: 'a' }), token({ id: 'b' }), token({ id: 'c' }))
    const { next, error } = run(s, DM, 'gather', { targets: ['a', 'b', 'c'], x: 10.5, y: 10.5 })
    expect(error).toBeUndefined()
    const spots = ['a', 'b', 'c'].map((id) => `${tok(next, id).x},${tok(next, id).y}`)
    expect(new Set(spots).size).toBe(3)
    expect(spots[0]).toBe('10.5,10.5')
    expect(run(s, P1, 'gather', { targets: ['a'], x: 1, y: 1 }).error).toMatchObject({ code: 'unauthorized' })
  })

  it('fanAround gives distinct cells and grows rings as needed', () => {
    expect(ringOffsets(1)).toHaveLength(9)
    const spots = fanAround({ x: 0, y: 0 }, 12)
    expect(new Set(spots.map((p) => `${p.x},${p.y}`)).size).toBe(12)
  })
})

describe('update by a player who owns the token', () => {
  const s = stateWith(token({ id: 'mine', ownerId: 'p-1' }))

  it('may change name, art and nameplate', () => {
    const { run } = harness()
    const { next, error } = run(s, P1, 'update', { id: 'mine', name: 'Bram', imageAssetId: 'asset-9', nameplate: 'always' })
    expect(error).toBeUndefined()
    expect(tok(next, 'mine')).toMatchObject({ name: 'Bram', imageAssetId: 'asset-9', nameplate: 'always' })
  })

  it('may not change hit points, AC, kind or who sees the HP', () => {
    const { run } = harness()
    for (const field of [{ hp: { max: 99 } }, { ac: 30 }, { kind: 'monster' }, { showHp: 'all' }]) {
      expect(run(s, P1, 'update', { id: 'mine', ...field }).error).toMatchObject({ code: 'unauthorized' })
    }
  })

  it('the DM may set hp, ac, speed, kind and showHp, and clear hp with null', () => {
    const { run } = harness()
    let next = run(s, DM, 'update', { id: 'mine', hp: { max: 30, current: 12 }, ac: 15, speed: 25, kind: 'pc', showHp: 'all' }).next
    expect(tok(next, 'mine')).toMatchObject({ hp: { current: 12, max: 30 }, ac: 15, speed: 25, kind: 'pc', showHp: 'all' })
    next = run(next, DM, 'update', { id: 'mine', hp: null }).next
    expect(tok(next, 'mine').hp).toBeUndefined()
  })
})

describe('move while the DM holds the table', () => {
  const s = stateWith(token({ id: 'mine', ownerId: 'p-1' }))

  it('refuses a player while paused, and while movement is locked', () => {
    const paused = harness({ paused: true, movementLocked: false }).run(s, P1, 'move', { id: 'mine', x: 4, y: 4 })
    expect(paused.error).toMatchObject({ code: 'unauthorized' })
    expect(paused.error?.message.startsWith(TABLE_PAUSED)).toBe(true)
    const locked = harness({ paused: false, movementLocked: true }).run(s, P1, 'move', { id: 'mine', x: 4, y: 4 })
    expect(locked.error?.message.startsWith(MOVEMENT_LOCKED)).toBe(true)
  })

  it('never refuses the DM, and lets the player go once both are off', () => {
    expect(harness({ paused: true, movementLocked: true }).run(s, DM, 'move', { id: 'mine', x: 4, y: 4 }).error).toBeUndefined()
    expect(harness({ paused: false, movementLocked: false }).run(s, P1, 'move', { id: 'mine', x: 4, y: 4 }).error).toBeUndefined()
  })
})

describe('redaction by showHp', () => {
  const s: TokensState = {
    library: { d1: { id: 'd1', name: 'Bram', imageAssetId: null, size: 'medium', disposition: 'friendly', sight: null, light: null, kind: 'pc', hp: { current: 9, max: 9 }, showHp: 'owner', ownerIdentityId: 'p-1' } },
    byScene: {
      [SCENE]: {
        dmOnly: token({ id: 'dmOnly', hp: { current: 5, max: 7 }, ac: 13 }),
        owner: token({ id: 'owner', ownerId: 'p-1', hp: { current: 9, max: 9 }, showHp: 'owner', ac: 16 }),
        all: token({ id: 'all', hp: { current: 3, max: 4 }, showHp: 'all' }),
      },
    },
  }
  const { module } = harness()

  it('the DM keeps every pool', () => {
    expect(module.redact!(s, DM)).toBe(s)
  })

  it('a player gets `all` pools, their own `owner` pools, and no `dm` pools or AC', () => {
    const mine = module.redact!(s, P1)
    expect(mine.byScene[SCENE].dmOnly.hp).toBeUndefined()
    expect(mine.byScene[SCENE].dmOnly.ac).toBeUndefined()
    expect(mine.byScene[SCENE].owner.hp).toEqual({ current: 9, max: 9 })
    expect(mine.byScene[SCENE].all.hp).toEqual({ current: 3, max: 4 })
    expect(mine.library.d1.hp).toBeDefined()
    const theirs = module.redact!(s, P2)
    expect(theirs.byScene[SCENE].owner.hp).toBeUndefined()
    expect(theirs.library.d1.hp).toBeUndefined()
  })

  it('is idempotent', () => {
    const once = module.redact!(s, P2)
    expect(module.redact!(once, P2)).toEqual(once)
  })

  it('forgetScene drops the scene and keeps the library', () => {
    const left = module.forgetScene!(s, SCENE)
    expect(left.byScene).toEqual({})
    expect(left.library).toBe(s.library)
  })
})
