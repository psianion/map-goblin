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
import type { Token } from '@dnd/mechanics/tokens'
import { lightingDrift, syncLightsToScene, tokenLightDrift, tokenLightId, tokenLights } from './lightSync'

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

/** A token as the scene's slice carries one — only the fields the light rule reads matter. */
const token = (over: Partial<Token> & Pick<Token, 'id'>): Token =>
  ({
    name: 'Scout',
    x: 3,
    y: 4,
    hidden: false,
    ownerId: 'p1',
    light: null,
    sight: null,
    ...over,
  }) as Token

const session = (
  lightOverrides: Record<string, boolean>,
  tokens: Token[] = [],
): SessionState =>
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
      tokens: {
        library: {},
        byScene: { 'scene-1': Object.fromEntries(tokens.map((t) => [t.id, t])) },
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

// ── S3 P3 §2 — a token's own torch, as a light on the map ───────────────────
// The renderer never learns that tokens exist: a carried light becomes a pseudo light child
// with a stable id, and LightManager's own sync picks it up like any authored one.

const TORCH = { dim: 4, bright: 2, color: '#ffbb66', angle: 360 }

/** The pseudo-lights on the loaded map right now. */
const carried = (): LightChild[] =>
  (useStore.getState().layers[0] as unknown as { children: LightChild[] }).children.filter((c) =>
    c.id.startsWith('token-light:'),
  )

describe('tokenLights', () => {
  it('reads the outer radius as reach and the inner one as the plateau', () => {
    const [made] = tokenLights([token({ id: 't1', x: 2, y: 7, light: TORCH })])
    expect(made).toMatchObject({
      id: 'token-light:t1',
      position: { x: 2, y: 7 },
      radius: 4,
      featherRadius: 2,
      color: '#ffbb66',
      visible: true,
    })
  })

  it('lights nothing for a token carrying nothing, or one taken off the board', () => {
    expect(tokenLights([token({ id: 't1' })])).toEqual([])
    expect(tokenLights([token({ id: 't1', light: TORCH, hidden: true })])).toEqual([])
  })
})

describe('tokenLightDrift', () => {
  it('writes a new torch, and nothing at all on the second look', () => {
    const tokens = [token({ id: 't1', light: TORCH })]
    const first = tokenLightDrift(tokens, [dungeon([light()])])
    expect(first.write.map((l) => l.id)).toEqual(['token-light:t1'])
    expect(first.remove).toEqual([])

    const settled = tokenLightDrift(tokens, [dungeon([light(), ...first.write])])
    expect(settled).toEqual({ write: [], remove: [] })
  })

  it('rewrites the same id when the token steps, rather than minting a second light', () => {
    const before = tokenLights([token({ id: 't1', light: TORCH })])
    const moved = tokenLightDrift([token({ id: 't1', x: 9, y: 9, light: TORCH })], [dungeon(before)])
    expect(moved.write).toHaveLength(1)
    expect(moved.write[0].id).toBe(tokenLightId('t1'))
    expect(moved.write[0].position).toEqual({ x: 9, y: 9 })
    expect(moved.remove).toEqual([])
  })

  it('takes the light off the map when the token is hidden, deleted, or drops it', () => {
    const lit = tokenLights([token({ id: 't1', light: TORCH })])
    for (const tokens of [
      [] as Token[],
      [token({ id: 't1', light: TORCH, hidden: true })],
      [token({ id: 't1', light: null })],
    ]) {
      expect(tokenLightDrift(tokens, [dungeon(lit)])).toEqual({
        write: [],
        remove: ['token-light:t1'],
      })
    }
  })
})

describe('syncLightsToScene — carried light', () => {
  beforeEach(() => {
    useStore.setState({ layers: [dungeon([light({ visible: true })])] })
    useSessionStore.setState({ session: session({}), you: dm })
  })

  it('puts a torch on the map when a token carrying one arrives, and moves it with them', () => {
    const stop = syncLightsToScene()
    expect(carried()).toEqual([])

    useSessionStore.setState({ session: session({}, [token({ id: 't1', light: TORCH })]) })
    expect(carried()).toHaveLength(1)
    expect(carried()[0]).toMatchObject({ id: 'token-light:t1', position: { x: 3, y: 4 } })

    // One step: the same light, moved — a second one would double the pool and orphan a
    // shadow-cache entry per step.
    useSessionStore.setState({
      session: session({}, [token({ id: 't1', x: 6, y: 4, light: TORCH })]),
    })
    expect(carried()).toHaveLength(1)
    expect(carried()[0].position).toEqual({ x: 6, y: 4 })

    // …and out again when the DM takes the token off the board.
    useSessionStore.setState({
      session: session({}, [token({ id: 't1', x: 6, y: 4, light: TORCH, hidden: true })]),
    })
    expect(carried()).toEqual([])
    stop()
  })

  it('leaves the map’s own lights exactly where they were', () => {
    const stop = syncLightsToScene()
    useSessionStore.setState({ session: session({}, [token({ id: 't1', light: TORCH })]) })
    const authored = (useStore.getState().layers[0] as unknown as { children: LightChild[] })
      .children.filter((c) => !c.id.startsWith('token-light:'))
    expect(authored).toHaveLength(1)
    expect(authored[0]).toMatchObject({ id: 'l1', visible: true })
    stop()
  })

  it('settles instead of looping when a torch and an override land together', () => {
    const stop = syncLightsToScene()
    let writes = 0
    const unsub = useStore.subscribe(() => {
      writes += 1
    })

    useSessionStore.setState({ session: session({ l1: false }, [token({ id: 't1', light: TORCH })]) })

    expect(writes).toBe(1)
    expect(isVisible()).toBe(false)
    expect(carried()).toHaveLength(1)
    unsub()
    stop()
  })
})
