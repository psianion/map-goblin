// M5 — a trigger's `light` action turned into the actual relight. The chain under test is
// the scene's `lightOverrides` → the core store's light children → the flag LightManager
// reads, mirroring doorLighting.test.ts's shape for the door lane.

import { PROTOCOL_VERSION } from '@dnd/core/src/shared/protocol'
import { beforeEach, describe, expect, it } from 'vitest'
import type { LightChild } from '@dnd/core/src/shared/types'
import type { Layer } from '@dnd/core/src/store/types'
import type { PlayerInfo, SessionState } from '@dnd/core/src/shared/protocol'
import { useStore } from '@dnd/core/src/store/store'
import { useSessionStore } from '../../session/store'
import { lightingDrift, syncLightsToScene } from './lightSync'

const light = (over: Partial<LightChild> = {}): LightChild =>
  ({
    id: 'l1',
    name: 'Brazier',
    childType: 'light',
    visible: true,
    color: '#fff',
    radius: 5,
    featherRadius: 1,
    intensity: 1,
    falloff: 'linear',
    position: { x: 0, y: 0 },
    ...over,
  }) as LightChild

const dungeon = (children: LightChild[]): Layer =>
  ({
    id: 'l1',
    type: 'dungeon',
    visible: true,
    children,
    standaloneWalls: [],
    rooms: [],
  }) as unknown as Layer

const dm: PlayerInfo = { identityId: 'dm1', name: 'Ann', role: 'dm', connected: true }

const session = (lightOverrides: Record<string, boolean>): SessionState =>
  ({
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 's1',
    campaignId: 'c1',
    activeSceneId: 'scene-1',
    scenes: [{ id: 'scene-1', name: 'Crypt' }],
    players: [dm],
    modules: {
      triggers: {
        byScene: {
          'scene-1': {
            fired: {},
            armed: {},
            disabled: {},
            lightOverrides,
            env: {},
            prompts: [],
            log: [],
          },
        },
      },
    },
  }) as unknown as SessionState

const isVisible = (): boolean =>
  ((useStore.getState().layers[0] as unknown as { children: LightChild[] }).children[0]).visible

describe('lightingDrift', () => {
  it('is empty when the map already says what the scene overrides say', () => {
    const drift = lightingDrift({ l1: true }, [dungeon([light({ visible: true })])])
    expect(drift.size).toBe(0)
  })

  it('names only the lights that moved', () => {
    const drift = lightingDrift(
      { l1: false, l2: true },
      [dungeon([light({ id: 'l1', visible: true }), light({ id: 'l2', visible: true })])],
    )
    expect([...drift]).toEqual([['l1', false]])
  })

  it('ignores a light with no override at all — the map keeps its authored visibility', () => {
    const drift = lightingDrift({}, [dungeon([light({ visible: false })])])
    expect(drift.size).toBe(0)
  })
})

describe('syncLightsToScene', () => {
  beforeEach(() => {
    useStore.setState({ layers: [dungeon([light({ visible: true })])] })
    useSessionStore.setState({ session: session({}), you: dm })
  })

  it('turns a light off when a trigger overrides it', () => {
    const stop = syncLightsToScene()
    expect(isVisible()).toBe(true)

    useSessionStore.setState({ session: session({ l1: false }) })

    expect(isVisible()).toBe(false)
    stop()
  })

  it('turns it back on', () => {
    const stop = syncLightsToScene()
    useSessionStore.setState({ session: session({ l1: false }) })
    useSessionStore.setState({ session: session({ l1: true }) })

    expect(isVisible()).toBe(true)
    stop()
  })

  it('reapplies the override after a fresh map load resets authored visibility', () => {
    const stop = syncLightsToScene()
    useSessionStore.setState({ session: session({ l1: false }) })
    expect(isVisible()).toBe(false)

    // A new document lands — core's loader replaces `layers` wholesale, back to authored
    // (on) visibility, exactly like a scene switch or reload.
    useStore.setState({ layers: [dungeon([light({ visible: true })])] })

    expect(isVisible()).toBe(false)
    stop()
  })

  it('settles instead of looping — the write it makes finds nothing left to change', () => {
    const stop = syncLightsToScene()
    let writes = 0
    const unsub = useStore.subscribe(() => {
      writes += 1
    })

    useSessionStore.setState({ session: session({ l1: false }) })

    expect(writes).toBe(1)
    unsub()
    stop()
  })

  it('stops writing once unsubscribed', () => {
    syncLightsToScene()()
    useSessionStore.setState({ session: session({ l1: false }) })
    expect(isVisible()).toBe(true)
  })
})
