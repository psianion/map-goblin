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
import type { LightEdit } from '@dnd/mechanics/triggers'
import {
  lightingDrift,
  syncLightsToScene,
  tokenLightDrift,
  tokenLightId,
  tokenLights,
  type EditableLight,
} from './lightSync'

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

/** Same shape as `session`, but for a live `lightEdits` (M2) instead of a boolean override —
 *  radius/color/position/etc, not just visible. */
const sessionWithEdits = (lightEdits: Record<string, LightEdit>, tokens: Token[] = []): SessionState =>
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
            lightOverrides: {},
            lightEdits,
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

const firstLight = (): LightChild =>
  (useStore.getState().layers[0] as unknown as { children: LightChild[] }).children[0]

const isVisible = (): boolean => firstLight().visible
const radiusOf = (): number => firstLight().radius

describe('lightingDrift', () => {
  it('is empty when the map already says what the scene edits say', () => {
    const drift = lightingDrift({ l1: { visible: true } }, [dungeon([light({ visible: true })])], new Map())
    expect(drift.size).toBe(0)
  })

  it('names only the lights that moved, carrying every field of the light', () => {
    const drift = lightingDrift(
      { l1: { visible: false }, l2: { visible: true } },
      [dungeon([light({ id: 'l1', visible: true }), light({ id: 'l2', visible: true })])],
      new Map(),
    )
    expect([...drift.keys()]).toEqual(['l1'])
    expect(drift.get('l1')).toMatchObject({ visible: false, radius: 5, featherRadius: 1 })
  })

  it('ignores a light with no edit and no edit history — the map keeps its authored values', () => {
    const drift = lightingDrift({}, [dungeon([light({ visible: false })])], new Map())
    expect(drift.size).toBe(0)
  })

  it('overlays radius, color and position, not just visibility', () => {
    const drift = lightingDrift(
      { l1: { radius: 9, color: '#ff0000', position: { x: 3, y: 4 } } },
      [dungeon([light({ id: 'l1' })])],
      new Map(),
    )
    expect(drift.get('l1')).toMatchObject({ radius: 9, color: '#ff0000', position: { x: 3, y: 4 } })
  })

  it('shallow-overlays — a field the edit leaves alone keeps the light’s own value', () => {
    const drift = lightingDrift(
      { l1: { radius: 9 } },
      [dungeon([light({ id: 'l1', color: '#abcdef' })])],
      new Map(),
    )
    expect(drift.get('l1')).toMatchObject({ radius: 9, color: '#abcdef' })
  })

  it('captures the authored values on first edit, and reads them back once the edit is gone', () => {
    const authored = new Map<string, EditableLight>()
    const layers = [dungeon([light({ id: 'l1', radius: 5, color: '#fff' })])]

    let drift = lightingDrift({ l1: { radius: 9 } }, layers, authored)
    expect(drift.get('l1')).toMatchObject({ radius: 9, color: '#fff' })
    expect(authored.get('l1')).toMatchObject({ radius: 5, color: '#fff' })

    // The caller applies the write in real use — simulate that before asking again.
    ;(layers[0] as unknown as { children: LightChild[] }).children[0].radius = 9

    // The edit is gone (reset), but the light was touched before — its authored snapshot
    // is still on file, and reverting reads it back rather than the now-edited 9.
    drift = lightingDrift({}, layers, authored)
    expect(drift.get('l1')).toMatchObject({ radius: 5, color: '#fff' })
  })
})

describe('lightingDrift with a preview in flight', () => {
  const snapshot = (l: LightChild): EditableLight => ({
    visible: l.visible,
    radius: l.radius,
    featherRadius: l.featherRadius,
    intensity: l.intensity,
    color: l.color,
    position: { ...l.position },
  })

  it('leaves a previewed child alone even though it disagrees with the standing edit', () => {
    const child = light({ radius: 24 }) // mid-drag preview
    const previewed = new Map([['l1', snapshot(child)]])
    const authored = new Map<string, EditableLight>([['l1', snapshot(light({ radius: 5 }))]])
    const drift = lightingDrift({ l1: { radius: 8.5 } }, [dungeon([child])], authored, previewed)
    expect(drift.size).toBe(0)
    expect(previewed.has('l1')).toBe(true) // still in flight
  })

  it('also protects the first preview of a never-edited light from the authored snapback', () => {
    const child = light({ radius: 9 })
    const previewed = new Map([['l1', snapshot(child)]])
    const authored = new Map<string, EditableLight>([['l1', snapshot(light({ radius: 5 }))]])
    const drift = lightingDrift({}, [dungeon([child])], authored, previewed)
    expect(drift.size).toBe(0)
  })

  it('spends the mark once the committed edit says the same thing', () => {
    const child = light({ radius: 24 })
    const previewed = new Map([['l1', snapshot(child)]])
    const authored = new Map<string, EditableLight>([['l1', snapshot(light({ radius: 5 }))]])
    const drift = lightingDrift({ l1: { radius: 24 } }, [dungeon([child])], authored, previewed)
    expect(drift.size).toBe(0)
    expect(previewed.has('l1')).toBe(false) // commit landed, mark consumed
  })

  it('drops a superseded mark and reconciles when something else wrote the child', () => {
    const child = light({ radius: 12 }) // no longer what the preview wrote
    const previewed = new Map([['l1', snapshot(light({ radius: 24 }))]])
    const authored = new Map<string, EditableLight>([['l1', snapshot(light({ radius: 5 }))]])
    const drift = lightingDrift({ l1: { radius: 8.5 } }, [dungeon([child])], authored, previewed)
    expect(drift.get('l1')?.radius).toBe(8.5)
    expect(previewed.has('l1')).toBe(false)
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

  it('applies a radius edit, not just visibility', () => {
    const stop = syncLightsToScene()
    expect(radiusOf()).toBe(5) // light()'s own authored default

    useSessionStore.setState({ session: sessionWithEdits({ l1: { radius: 9 } }) })

    expect(radiusOf()).toBe(9)
    stop()
  })

  it('reverts to the authored radius once the edit is reset, with no map reload', () => {
    const stop = syncLightsToScene()
    useSessionStore.setState({ session: sessionWithEdits({ l1: { radius: 9 } }) })
    expect(radiusOf()).toBe(9)

    // The DM's `reset-light` — the id simply drops out of `lightEdits`.
    useSessionStore.setState({ session: sessionWithEdits({}) })

    expect(radiusOf()).toBe(5)
    stop()
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
