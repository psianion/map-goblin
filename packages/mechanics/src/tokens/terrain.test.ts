// Plateaus at the table (plan §7): a token stands at the height of the ground under it, set
// on every place and move unless the DM pinned one, and a player's move across an edge whose
// crossing kind blocks is refused while the DM's never is.
import { describe, expect, it } from 'vitest'
import type { Viewer } from '../contract'
import { tokensModule } from './module'
import type { SceneTerrain, Token, TokensState } from './types'

const DM: Viewer = { role: 'dm', identityId: 'dm-1' }
const P1: Viewer = { role: 'player', identityId: 'p-1' }
const SCENE = 'scene-a'

/** A plateau 3 cells high over x >= 10; crossing x = 10 is blocked. */
const terrain: SceneTerrain = {
  elevationAt: (x) => (x >= 10 ? 3 : 0),
  crossingRefusal: (from, to) => ((from.x < 10) !== (to.x < 10) ? 'CROSSING_BLOCKED impassable: Impassable' : null),
}
const module = tokensModule(undefined, undefined, (sceneId) => (sceneId === SCENE ? terrain : null))

const token = (over: Partial<Token> = {}): Token => ({
  id: 't1',
  name: 'Borin',
  imageAssetId: null,
  size: 'medium',
  disposition: 'friendly',
  sight: null,
  light: null,
  defId: null,
  x: 12.5,
  y: 2.5,
  elevation: 0,
  z: 0,
  hidden: false,
  ownerId: 'p-1',
  ...over,
})

const stateWith = (t: Token): TokensState => ({ library: {}, byScene: { [SCENE]: { [t.id]: t } } })

function run(state: TokensState, sender: Viewer, action: string, payload: unknown) {
  let next = state
  const error = module.handler(action, payload, {
    campaignId: 'c-1',
    sessionId: 's-1',
    activeSceneId: SCENE,
    sender,
    players: [],
    state,
    broadcast: () => {},
    setState: (s) => {
      next = s
    },
  })
  return { error: error ?? null, next, at: (id = 't1') => next.byScene[SCENE][id] }
}

describe('token elevation', () => {
  it('stands a placed token on the ground under it', () => {
    const { next } = run({ library: {}, byScene: {} }, DM, 'place', { name: 'Orc', x: 12.5, y: 1.5 })
    expect(Object.values(next.byScene[SCENE])[0].elevation).toBe(3)
  })

  it('follows the ground on every move', () => {
    const r = run(stateWith(token({ x: 12.5, elevation: 3 })), DM, 'move', { id: 't1', x: 5.5, y: 2.5 })
    expect(r.at().elevation).toBe(0)
  })

  it('leaves a DM-pinned height alone until it is unpinned', () => {
    const pinned = run(stateWith(token()), DM, 'update', { id: 't1', elevation: 7 })
    expect(pinned.at()).toMatchObject({ elevation: 7, elevationPinned: true })
    const moved = run(pinned.next, DM, 'move', { id: 't1', x: 13.5, y: 2.5 })
    expect(moved.at().elevation).toBe(7)
    const auto = run(moved.next, DM, 'update', { id: 't1', elevationPinned: false })
    expect(auto.at().elevation).toBe(3)
    expect(auto.at().elevationPinned).toBeUndefined()
  })

  it('keeps a player off the pin', () => {
    expect(run(stateWith(token()), P1, 'update', { id: 't1', elevationPinned: true }).error?.code).toBe('unauthorized')
  })
})

describe('crossing refusal', () => {
  it('refuses a player moving across a blocking edge and keeps the token where it was', () => {
    const r = run(stateWith(token({ x: 12.5 })), P1, 'move', { id: 't1', x: 8.5, y: 2.5 })
    expect(r.error?.message).toMatch(/^CROSSING_BLOCKED impassable/)
    expect(r.next.byScene[SCENE].t1.x).toBe(12.5)
  })

  it('never refuses the DM', () => {
    const r = run(stateWith(token({ x: 12.5 })), DM, 'move', { id: 't1', x: 8.5, y: 2.5 })
    expect(r.error).toBeNull()
    expect(r.at().x).toBe(8.5)
  })
})
