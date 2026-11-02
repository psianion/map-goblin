import { describe, expect, it } from 'vitest'
import type { Viewer } from '../contract'
import { crossingRefusalMessage, crossingsModule, sceneCrossings, type CrossingsState } from './module'

const DM: Viewer = { role: 'dm', identityId: 'dm-1' }

function run(state: CrossingsState, action: string, payload: unknown) {
  let next = state
  const error = crossingsModule.handler(action, payload, {
    campaignId: 'c-1',
    sessionId: 's-1',
    activeSceneId: 'scene-a',
    sender: DM,
    players: [],
    state,
    broadcast: () => {},
    setState: (s) => {
      next = s
    },
  })
  return { error: error ?? null, next }
}

describe('crossings', () => {
  it('is the DM’s alone', () => {
    expect(crossingsModule.commands['set-edge']).toEqual(['dm'])
    expect(crossingsModule.commands['set-blocks']).toEqual(['dm'])
  })

  it('sets and clears an edge’s live kind', () => {
    const set = run(crossingsModule.initialState, 'set-edge', { targetId: 'top', crossingId: 'impassable' })
    expect(sceneCrossings(set.next, 'scene-a').edges).toEqual({ top: 'impassable' })
    const cleared = run(set.next, 'set-edge', { targetId: 'top', crossingId: null })
    expect(sceneCrossings(cleared.next, 'scene-a').edges).toEqual({})
  })

  it('switches whether a kind blocks', () => {
    const r = run(crossingsModule.initialState, 'set-blocks', { kindId: 'climb', blocks: true })
    expect(sceneCrossings(r.next, 'scene-a').blocks).toEqual({ climb: true })
  })

  it('refuses a bad payload', () => {
    expect(run(crossingsModule.initialState, 'set-blocks', { kindId: 'climb', blocks: 'yes' }).error).not.toBeNull()
    expect(run(crossingsModule.initialState, 'nope', {}).error).not.toBeNull()
  })

  it('says the kind and the DM’s note in a refusal', () => {
    expect(crossingRefusalMessage({ id: 'climb', name: 'Climb', note: 'DC 12' })).toBe('CROSSING_BLOCKED climb: Climb — DC 12')
  })
})
