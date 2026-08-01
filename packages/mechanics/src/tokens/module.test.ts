import { describe, expect, it, vi } from 'vitest'

// D10's fog seam: the stub is mocked so the tests can pin *that it is called* on every
// place and move, which is the contract S3 will tighten. Everything else in validate.ts
// stays real. It is `occupyRefusal` rather than `canOccupy` because the refusal carries
// the cause now — `canOccupy` is a thin boolean over the same call.
const { canOccupySpy } = vi.hoisted(() => ({
  canOccupySpy: vi.fn(
    (_token: unknown, _pos: { x: number; y: number }, _state: unknown): string | null => null,
  ),
}))
vi.mock('./validate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./validate')>()),
  occupyRefusal: canOccupySpy,
}))

import type { Viewer } from '../contract'
import { tokensModule as buildTokens } from './module'
import type { SceneVision, Token, TokensState } from './types'

const DM: Viewer = { role: 'dm', identityId: 'dm-1' }
const P1: Viewer = { role: 'player', identityId: 'p-1' }
const P2: Viewer = { role: 'player', identityId: 'p-2' }
const SCENE = 'scene-a'

/** No vision lookup wired: an unzoned map has no fog, which is every test but the last. */
const tokensModule = buildTokens()

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

/** Mirrors ModuleRegistry.dispatch: `commands` gates the role before the handler runs. */
function run(
  state: TokensState,
  sender: Viewer,
  action: string,
  payload: unknown,
  activeSceneId: string | null = SCENE,
) {
  const roles = tokensModule.commands[action]
  if (!roles) return { error: { code: 'invalid-command' }, next: state }
  if (!roles.includes(sender.role)) return { error: { code: 'unauthorized' }, next: state }
  let next = state
  const error = tokensModule.handler(action, payload, {
    campaignId: 'c-1',
    sessionId: 's-1',
    activeSceneId,
    sender,
    players: [],
    state,
    setState: (s) => {
      next = s
    },
    broadcast: () => {},
  })
  return { error: error ?? null, next }
}

const only = (s: TokensState): Token => Object.values(s.byScene[SCENE])[0]

describe('authz matrix', () => {
  const dmOnly = [
    ['library-upsert', { name: 'Orc' }],
    ['library-delete', { id: 'd1' }],
    ['place', { name: 'Orc', x: 1, y: 1 }],
    ['hide', { id: 't1' }],
    ['delete', { id: 't1' }],
  ] as const

  it.each(dmOnly)('%s is dm-only', (action, payload) => {
    expect(run(stateWith(token()), P1, action, payload).error).toMatchObject({
      code: 'unauthorized',
    })
    // …and reaches the handler for a DM (may still fail validation, never authz)
    expect(run(stateWith(token()), DM, action, payload).error?.code).not.toBe('unauthorized')
  })

  it('claim is player-only — a DM cannot claim', () => {
    expect(run(stateWith(token()), DM, 'claim', { id: 't1' }).error).toMatchObject({
      code: 'unauthorized',
    })
  })

  it.each(['move', 'update'])('%s is open to both roles at the table', (action) => {
    expect(tokensModule.commands[action]).toEqual(['dm', 'player'])
  })

  it('rejects an unknown action and a non-object payload', () => {
    const state = stateWith(token())
    expect(tokensModule.handler('nope', {}, ctxOf(state))).toMatchObject({
      code: 'invalid-command',
    })
    expect(tokensModule.handler('move', 'not-an-object', ctxOf(state))).toMatchObject({
      code: 'invalid-command',
    })
  })

  function ctxOf(state: TokensState) {
    return {
      campaignId: 'c-1',
      sessionId: 's-1',
      activeSceneId: SCENE,
      sender: DM,
      players: [],
      state,
      setState: () => {},
      broadcast: () => {},
    }
  }
})

describe('grid snap (D13)', () => {
  // odd widths (1, 3) land on cell centres, even widths (2, 4) on intersections,
  // tiny renders at 0.5 but snaps like a 1×1.
  const cases: Array<[Token['size'], number, number]> = [
    ['tiny', 3.2, 3.5],
    ['small', 3.2, 3.5],
    ['medium', 3.9, 3.5],
    ['huge', 3.2, 3.5],
    ['large', 3.2, 3],
    ['large', 3.7, 4],
    ['gargantuan', 3.2, 3],
    ['medium', -0.2, -0.5],
    ['large', -0.4, -0],
  ]

  it.each(cases)('places a %s at %f on %f', (size, input, expected) => {
    const { next } = run({ library: {}, byScene: {} }, DM, 'place', {
      name: 'X',
      size,
      x: input,
      y: input,
    })
    expect(only(next).x).toBe(expected)
    expect(only(next).y).toBe(expected)
  })

  it('re-snaps when a size change flips parity', () => {
    const { next } = run(stateWith(token({ x: 1.5, y: 2.5 })), DM, 'update', {
      id: 't1',
      size: 'large',
    })
    expect(only(next)).toMatchObject({ size: 'large', x: 2, y: 3 })
  })
})

describe('place', () => {
  it('copies the def and records provenance', () => {
    const state: TokensState = {
      library: {
        d1: {
          id: 'd1',
          name: 'Orc',
          imageAssetId: 'a1',
          size: 'large',
          disposition: 'hostile',
          sight: null,
          light: null,
        },
      },
      byScene: {},
    }
    const { next } = run(state, DM, 'place', { defId: 'd1', x: 4.4, y: 4.4 })
    expect(only(next)).toMatchObject({
      defId: 'd1',
      name: 'Orc',
      imageAssetId: 'a1',
      size: 'large',
      x: 4,
      y: 4,
      hidden: false,
      ownerId: null,
    })
  })

  it('accepts inline fields with no def', () => {
    const { next } = run({ library: {}, byScene: {} }, DM, 'place', {
      name: 'Wolf',
      disposition: 'neutral',
      x: 0,
      y: 0,
    })
    expect(only(next)).toMatchObject({ name: 'Wolf', defId: null, disposition: 'neutral' })
  })

  it('rejects an unknown defId, a nameless inline token, and non-finite coords', () => {
    const empty: TokensState = { library: {}, byScene: {} }
    expect(run(empty, DM, 'place', { defId: 'nope', x: 1, y: 1 }).error?.code).toBe('invalid-command')
    expect(run(empty, DM, 'place', { x: 1, y: 1 }).error?.code).toBe('invalid-command')
    expect(run(empty, DM, 'place', { name: 'X', x: Number.NaN, y: 1 }).error?.code).toBe(
      'invalid-command',
    )
    expect(run(empty, DM, 'place', { name: 'X'.repeat(61), x: 1, y: 1 }).error?.code).toBe(
      'invalid-command',
    )
  })

  it('falls back to the active scene, and refuses when there is neither', () => {
    const empty: TokensState = { library: {}, byScene: {} }
    expect(run(empty, DM, 'place', { name: 'X', x: 1, y: 1 }).next.byScene[SCENE]).toBeDefined()
    expect(
      run(empty, DM, 'place', { name: 'X', sceneId: 'scene-b', x: 1, y: 1 }).next.byScene['scene-b'],
    ).toBeDefined()
    expect(run(empty, DM, 'place', { name: 'X', x: 1, y: 1 }, null).error?.code).toBe(
      'invalid-command',
    )
  })
})

describe('move', () => {
  it('lets the owner move, and nobody else', () => {
    const mine = stateWith(token({ ownerId: 'p-1' }))
    expect(run(mine, P1, 'move', { id: 't1', x: 7.2, y: 7.2 }).error).toBeNull()
    expect(only(run(mine, P1, 'move', { id: 't1', x: 7.2, y: 7.2 }).next)).toMatchObject({
      x: 7.5,
      y: 7.5,
    })
    expect(run(mine, P2, 'move', { id: 't1', x: 7, y: 7 }).error).toMatchObject({
      code: 'unauthorized',
    })
    expect(run(stateWith(token()), P1, 'move', { id: 't1', x: 7, y: 7 }).error).toMatchObject({
      code: 'unauthorized',
    })
  })

  it('lets the DM move anything, including a claimed token', () => {
    expect(
      run(stateWith(token({ ownerId: 'p-1' })), DM, 'move', { id: 't1', x: 1, y: 1 }).error,
    ).toBeNull()
  })

  it('rejects unknown tokens, unknown scenes and non-finite coords', () => {
    const state = stateWith(token({ ownerId: 'p-1' }))
    expect(run(state, DM, 'move', { id: 'ghost', x: 1, y: 1 }).error?.code).toBe('invalid-command')
    expect(run(state, DM, 'move', { id: 't1', sceneId: 'nope', x: 1, y: 1 }).error?.code).toBe(
      'invalid-command',
    )
    expect(run(state, DM, 'move', { id: 't1', x: Number.POSITIVE_INFINITY, y: 1 }).error?.code).toBe(
      'invalid-command',
    )
    expect(run(state, DM, 'move', { id: 't1', x: '3', y: 1 }).error?.code).toBe('invalid-command')
  })
})

describe('canOccupy seam (D10)', () => {
  it('is consulted on every move', () => {
    canOccupySpy.mockClear()
    run(stateWith(token({ ownerId: 'p-1' })), P1, 'move', { id: 't1', x: 5.2, y: 6.2 })
    expect(canOccupySpy).toHaveBeenCalledTimes(1)
    // the snapped destination, not the raw pointer position
    expect(canOccupySpy.mock.calls[0][1]).toEqual({ x: 5.5, y: 6.5 })
  })

  it('is consulted on every place', () => {
    canOccupySpy.mockClear()
    run({ library: {}, byScene: {} }, DM, 'place', { name: 'X', x: 1, y: 1 })
    expect(canOccupySpy).toHaveBeenCalledTimes(1)
  })

  it('a refusal stops the move and leaves state alone', () => {
    canOccupySpy.mockReturnValueOnce('move-blocked: that space cannot be occupied')
    const state = stateWith(token({ ownerId: 'p-1' }))
    const { error, next } = run(state, P1, 'move', { id: 't1', x: 9, y: 9 })
    expect(error?.code).toBe('invalid-command')
    expect(next).toBe(state)
  })
})

describe('update', () => {
  it('lets the DM change any field', () => {
    const { next, error } = run(stateWith(token()), DM, 'update', {
      id: 't1',
      name: 'Boss',
      disposition: 'friendly',
      elevation: 10,
      z: 3,
    })
    expect(error).toBeNull()
    expect(only(next)).toMatchObject({ name: 'Boss', disposition: 'friendly', elevation: 10, z: 3 })
  })

  it('lets an owner rename their own token and nothing else', () => {
    const mine = stateWith(token({ ownerId: 'p-1' }))
    expect(only(run(mine, P1, 'update', { id: 't1', name: 'Rex' }).next).name).toBe('Rex')
    expect(run(mine, P1, 'update', { id: 't1', size: 'huge' }).error).toMatchObject({
      code: 'unauthorized',
    })
    expect(run(mine, P1, 'update', { id: 't1', name: 'Rex', z: 9 }).error).toMatchObject({
      code: 'unauthorized',
    })
    expect(run(mine, P2, 'update', { id: 't1', name: 'Rex' }).error).toMatchObject({
      code: 'unauthorized',
    })
  })

  it('caps the name and rejects an empty update', () => {
    const state = stateWith(token())
    expect(run(state, DM, 'update', { id: 't1', name: 'x'.repeat(61) }).error?.code).toBe(
      'invalid-command',
    )
    expect(run(state, DM, 'update', { id: 't1' }).error?.code).toBe('invalid-command')
  })
})

describe('hide and delete', () => {
  it('hides and unhides explicitly', () => {
    const state = stateWith(token())
    expect(only(run(state, DM, 'hide', { id: 't1' }).next).hidden).toBe(true)
    expect(only(run(stateWith(token({ hidden: true })), DM, 'hide', { id: 't1', hidden: false }).next).hidden).toBe(false)
  })

  it('deletes the instance only', () => {
    const { next } = run(stateWith(token(), token({ id: 't2' })), DM, 'delete', { id: 't1' })
    expect(Object.keys(next.byScene[SCENE])).toEqual(['t2'])
  })
})

describe('claim', () => {
  it('claims an unowned, visible token', () => {
    const { next, error } = run(stateWith(token()), P1, 'claim', { id: 't1' })
    expect(error).toBeNull()
    expect(only(next).ownerId).toBe('p-1')
  })

  it('refuses a token that is already owned or hidden', () => {
    expect(run(stateWith(token({ ownerId: 'p-2' })), P1, 'claim', { id: 't1' }).error).toMatchObject(
      { code: 'unauthorized' },
    )
    // Hidden answers as nonexistent, not as unauthorized — no id confirmation.
    expect(run(stateWith(token({ hidden: true })), P1, 'claim', { id: 't1' }).error).toMatchObject({
      code: 'invalid-command',
    })
  })
})

describe('hidden tokens and the command layer', () => {
  // The redactor already drops hidden tokens from player state; these pin that the command
  // layer agrees — a player who claimed a token before the DM hid it loses control of it.
  const hiddenOwned = () => stateWith(token({ hidden: true, ownerId: 'p-1' }))

  it('treats a hidden token as nonexistent for players, even its owner', () => {
    for (const [action, payload] of [
      ['move', { id: 't1', x: 3.5, y: 3.5 }],
      ['update', { id: 't1', name: 'Renamed' }],
    ] as const) {
      const { next, error } = run(hiddenOwned(), P1, action, payload)
      expect(error).toMatchObject({ code: 'invalid-command' })
      expect(next).toEqual(hiddenOwned())
    }
  })

  it('leaves the DM in full control of a hidden token', () => {
    expect(run(hiddenOwned(), DM, 'move', { id: 't1', x: 3.5, y: 3.5 }).error).toBeNull()
    expect(run(hiddenOwned(), DM, 'update', { id: 't1', name: 'Renamed' }).error).toBeNull()
  })
})

describe('library', () => {
  const upsert = (state: TokensState, payload: Record<string, unknown>) =>
    run(state, DM, 'library-upsert', payload).next

  it('mints an id on create and patches in place on re-upsert', () => {
    const created = upsert({ library: {}, byScene: {} }, { name: 'Orc', size: 'large' })
    const [id, def] = Object.entries(created.library)[0]
    expect(def).toMatchObject({ id, name: 'Orc', size: 'large', disposition: 'neutral' })

    const patched = upsert(created, { id, disposition: 'hostile' })
    expect(patched.library[id]).toMatchObject({ name: 'Orc', size: 'large', disposition: 'hostile' })
    expect(Object.keys(patched.library)).toHaveLength(1)
  })

  it('caps the name and validates the S3 schema fields', () => {
    const empty: TokensState = { library: {}, byScene: {} }
    expect(run(empty, DM, 'library-upsert', { name: 'x'.repeat(61) }).error?.code).toBe(
      'invalid-command',
    )
    expect(run(empty, DM, 'library-upsert', { name: 'x', sight: { range: 30 } }).error?.code).toBe(
      'invalid-command',
    )
    expect(
      run(empty, DM, 'library-upsert', {
        name: 'x',
        sight: { range: 30, angle: 360, visionMode: 'darkvision' },
      }).error,
    ).toBeNull()
  })

  it('deleting a def leaves placed instances intact', () => {
    const state: TokensState = {
      library: {
        d1: {
          id: 'd1',
          name: 'Orc',
          imageAssetId: null,
          size: 'medium',
          disposition: 'hostile',
          sight: null,
          light: null,
        },
      },
      byScene: { [SCENE]: { t1: token({ defId: 'd1' }) } },
    }
    const { next, error } = run(state, DM, 'library-delete', { id: 'd1' })
    expect(error).toBeNull()
    expect(next.library).toEqual({})
    expect(only(next)).toMatchObject({ id: 't1', defId: 'd1', name: 'Goblin' })
    expect(run(state, DM, 'library-delete', { id: 'ghost' }).error?.code).toBe('invalid-command')
  })
})

describe('redact (D4)', () => {
  const state: TokensState = {
    library: { d1: { id: 'd1', name: 'Orc', imageAssetId: null, size: 'medium', disposition: 'hostile', sight: null, light: null } },
    byScene: {
      [SCENE]: { t1: token(), t2: token({ id: 't2', hidden: true, x: 99, y: 99 }) },
      'scene-b': { t3: token({ id: 't3', hidden: true }) },
    },
  }
  const redact = tokensModule.redact!

  it('leaves the DM view untouched, object identity included', () => {
    expect(redact(state, DM)).toBe(state)
  })

  it('drops hidden tokens whole for players, in every scene', () => {
    const seen = redact(state, P1)
    expect(Object.keys(seen.byScene[SCENE])).toEqual(['t1'])
    expect(Object.keys(seen.byScene['scene-b'])).toEqual([])
    // the position of a hidden token must not survive anywhere in the payload
    expect(JSON.stringify(seen)).not.toContain('99')
    expect(seen.library).toEqual(state.library)
  })

  it('is idempotent and does not mutate the source', () => {
    const once = redact(state, P1)
    expect(redact(once, P1)).toEqual(once)
    expect(Object.keys(state.byScene[SCENE])).toEqual(['t1', 't2'])
  })
})

describe('redact under fog (S3 D7)', () => {
  // Two rooms side by side; the lit one is visible, the dark one is not.
  const vision: SceneVision = {
    roomAt: (x) => (x < 10 ? 'lit' : x < 20 ? 'dark' : null),
    visible: new Set(['lit']),
    occupiable: new Set(['lit', 'dark']),
  }
  const fogged = buildTokens((sceneId) => (sceneId === SCENE ? vision : null))
  const redact = fogged.redact!

  const inLit = token({ id: 'lit1', x: 1.5, y: 1.5 })
  const inDark = token({ id: 'dark1', x: 15.5, y: 1.5 })
  const outside = token({ id: 'out1', x: 25.5, y: 1.5 })
  const mine = token({ id: 'mine1', x: 15.5, y: 9.5, ownerId: 'p-1' })
  const theirs = token({ id: 'theirs1', x: 15.5, y: 8.5, ownerId: 'p-2' })
  const state: TokensState = {
    library: {},
    byScene: {
      [SCENE]: Object.fromEntries(
        [inLit, inDark, outside, mine, theirs].map((t) => [t.id, t]),
      ),
      // A scene the lookup knows nothing about is a scene with no fog.
      'scene-b': { b1: token({ id: 'b1', x: 15.5, y: 1.5 }) },
    },
  }

  it('drops tokens whose room the party cannot see, and unzoned ones with them', () => {
    const seen = redact(state, P1)
    expect(Object.keys(seen.byScene[SCENE]).sort()).toEqual(['lit1', 'mine1'])
    expect(Object.keys(seen.byScene['scene-b'])).toEqual(['b1'])
  })

  it('keeps your own claimed token in the dark (D7) but not another player\'s', () => {
    expect(Object.keys(redact(state, P1).byScene[SCENE])).toContain('mine1')
    expect(Object.keys(redact(state, P2).byScene[SCENE])).toContain('theirs1')
    expect(Object.keys(redact(state, P2).byScene[SCENE])).not.toContain('mine1')
  })

  it('still drops a hidden token standing in a visible room', () => {
    const withHidden: TokensState = {
      library: {},
      byScene: { [SCENE]: { h1: token({ id: 'h1', x: 1.5, y: 1.5, hidden: true, ownerId: 'p-1' }) } },
    }
    expect(redact(withHidden, P1).byScene[SCENE]).toEqual({})
  })

  it('leaves the DM view untouched, object identity included', () => {
    expect(redact(state, DM)).toBe(state)
  })
})
