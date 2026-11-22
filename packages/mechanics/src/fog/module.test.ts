import { describe, expect, it } from 'vitest'

import type { PlayerInfo } from '@dnd/core/src/shared/protocol'
import type { FogLayer, FogLook } from '@dnd/core/src/shared/fogLook'
import type { Viewer } from '../contract'
import { fogModule } from './module'
import { autoExploreOn, fogLookOf, fogOn, sceneFogOf } from './types'
import type { FogState } from './types'

const DM: Viewer = { role: 'dm', identityId: 'dm-1' }
const P1: Viewer = { role: 'player', identityId: 'p-1' }
const SCENE = 'map-1'

const fog = fogModule()

const empty: FogState = { byScene: {} }

/** Mirrors ModuleRegistry.dispatch: `commands` gates the role before the handler runs. */
function run(
  state: FogState,
  sender: Viewer,
  action: string,
  payload: unknown,
  activeSceneId: string | null = SCENE,
) {
  const roles = fog.commands[action]
  if (!roles) return { error: { code: 'invalid-command', message: '' }, next: state }
  if (!roles.includes(sender.role)) return { error: { code: 'unauthorized', message: '' }, next: state }
  let next = state
  const error = fog.handler(action, payload, {
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

describe('authz matrix', () => {
  it('has no player-runnable command at all', () => {
    expect(Object.values(fog.commands).flat()).not.toContain('player')
  })

  it('rejects an unknown action and a non-object payload', () => {
    const ctx = {
      campaignId: 'c-1',
      sessionId: 's-1',
      activeSceneId: SCENE,
      sender: DM,
      players: [],
      state: empty,
      setState: () => {},
      broadcast: () => {},
    }
    expect(fog.handler('nope', {}, ctx)).toMatchObject({ code: 'invalid-command' })
    expect(fog.handler('set-on', 'not-an-object', ctx)).toMatchObject({ code: 'invalid-command' })
  })
})

describe('defaults', () => {
  it('reads an untouched scene as fog off with auto-explore on', () => {
    const scene = sceneFogOf(empty, SCENE)
    expect(scene).toEqual({})
    expect(fogOn(scene)).toBe(false)
    expect(autoExploreOn(scene)).toBe(true)
  })
})

describe('set-auto-explore', () => {
  it('turns auto-explore off explicitly, never by toggle', () => {
    expect(run(empty, DM, 'set-auto-explore', { autoExplore: false }).next.byScene[SCENE].autoExplore).toBe(false)
    expect(run(empty, DM, 'set-auto-explore', { autoExplore: 'no' }).error?.code).toBe('invalid-command')
  })
})

describe('set-fog-look (D7)', () => {
  /** Loosely typed on purpose — some tests below deliberately pass a bad `type`/`tint`. */
  const layer = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
    type: 'billow',
    tint: '#aabbcc',
    strength: 0.5,
    scale: 1,
    speed: 0.05,
    angle: 10,
    ...patch,
  })
  const validLook: FogLook = {
    base: '#ffffff',
    layers: [layer(), layer({ type: 'smoke' }), layer({ type: 'haze' })] as unknown as [
      FogLayer,
      FogLayer,
      FogLayer,
    ],
    wind: 4,
    fade: 2.5,
    veil: 0.18,
    glow: 0.35,
    heavy: false,
  }

  it('is dm-only', () => {
    expect(run(empty, P1, 'set-fog-look', { look: validLook }).error).toMatchObject({
      code: 'unauthorized',
    })
    expect(run(empty, DM, 'set-fog-look', { look: validLook }).error?.code).not.toBe(
      'unauthorized',
    )
  })

  it('stores a full valid look whole', () => {
    const { next } = run(empty, DM, 'set-fog-look', { look: validLook })
    expect(next.byScene[SCENE].look).toEqual(validLook)
  })

  it('stores a partial payload, touching only the fields sent', () => {
    const { next } = run(empty, DM, 'set-fog-look', { look: { wind: 6 } })
    expect(next.byScene[SCENE].look).toEqual({ wind: 6 })
  })

  it('merges a later patch into the override instead of replacing it', () => {
    const base = run(empty, DM, 'set-fog-look', { look: { base: '#112233' } }).next
    const { next } = run(base, DM, 'set-fog-look', { look: { layers: validLook.layers } })
    expect(next.byScene[SCENE].look).toEqual({ base: '#112233', layers: validLook.layers })
  })

  it('clears the override with { look: null }, so fogLookOf falls back to the authored default', () => {
    const set = run(empty, DM, 'set-fog-look', { look: { wind: 6 } }).next
    const { next } = run(set, DM, 'set-fog-look', { look: null })
    expect(next.byScene[SCENE].look).toBeUndefined()
    const authored = { ...validLook, wind: 9 }
    expect(fogLookOf(sceneFogOf(next, SCENE), authored)).toEqual(authored)
  })

  it('merges a live override onto the authored default field by field (fogLookOf)', () => {
    const authored = { ...validLook, wind: 9, glow: 0.1 }
    const scene = run(empty, DM, 'set-fog-look', { look: { wind: 6 } }).next.byScene[SCENE]
    expect(fogLookOf(scene, authored)).toEqual({ ...authored, wind: 6 })
  })

  it('rejects each out-of-range or malformed field', () => {
    const rejects = (look: Record<string, unknown>) =>
      run(empty, DM, 'set-fog-look', { look }).error?.code

    expect(rejects({ base: 'red' })).toBe('invalid-command')
    expect(rejects({ wind: 0.1 })).toBe('invalid-command')
    expect(rejects({ wind: 13 })).toBe('invalid-command')
    expect(rejects({ fade: 0.5 })).toBe('invalid-command')
    expect(rejects({ fade: 5 })).toBe('invalid-command')
    expect(rejects({ veil: -0.1 })).toBe('invalid-command')
    expect(rejects({ veil: 0.6 })).toBe('invalid-command')
    expect(rejects({ glow: -0.1 })).toBe('invalid-command')
    expect(rejects({ glow: 1.1 })).toBe('invalid-command')
    expect(rejects({ heavy: 'yes' })).toBe('invalid-command')
    expect(rejects({ layers: [layer(), layer()] })).toBe('invalid-command')
    expect(rejects({ layers: [layer({ type: 'cloud' }), layer(), layer()] })).toBe(
      'invalid-command',
    )
    expect(rejects({ layers: [layer({ tint: 'blue' }), layer(), layer()] })).toBe(
      'invalid-command',
    )
    expect(rejects({ layers: [layer({ strength: 1.5 }), layer(), layer()] })).toBe(
      'invalid-command',
    )
    expect(rejects({ layers: [layer({ scale: 0.1 }), layer(), layer()] })).toBe('invalid-command')
    expect(rejects({ layers: [layer({ speed: 1 }), layer(), layer()] })).toBe('invalid-command')
    expect(rejects({ layers: [layer({ angle: 400 }), layer(), layer()] })).toBe('invalid-command')
    expect(run(empty, DM, 'set-fog-look', { look: 'clear' }).error?.code).toBe('invalid-command')
  })
})

describe('the table log (§2.4.3)', () => {
  const ROSTER: PlayerInfo[] = [{ identityId: 'dm-1', name: 'Ilsa', role: 'dm', connected: true }]

  /** `run`, but with a roster — the actor is stamped from it and never from the payload. */
  function fire(state: FogState, action: string, payload: unknown): FogState {
    let next = state
    fog.handler(action, payload, {
      campaignId: 'c-1',
      sessionId: 's-1',
      activeSceneId: SCENE,
      sender: DM,
      players: ROSTER,
      state,
      setState: (s) => {
        next = s
      },
      broadcast: () => {},
    })
    return next
  }

  it('says nothing about a setting the table cannot see', () => {
    expect(fire(empty, 'set-auto-explore', { autoExplore: false }).log ?? []).toEqual([])
  })

  it('says nothing about a fog-look change either', () => {
    expect(fire(empty, 'set-fog-look', { look: { wind: 6 } }).log ?? []).toEqual([])
  })
})
