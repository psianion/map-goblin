// M4 — the registry's own plumbing for triggers: `dispatchInternal` reaches an action a
// module leaves out of `commands`, wire `dispatch` never can, and the tokens/fog → triggers
// cascade fires exactly when a write actually lands. Trigger evaluation itself (zones,
// prompts, fire actions) is triggers/module.ts's own test surface; this file is the
// registry's contract with it.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ANY_ROLE, type GameModule, type Viewer } from '@dnd/mechanics/contract'
import { tokensModule, type TokensState } from '@dnd/mechanics/tokens'
import { openDb } from '../db/db'
import { createStores } from '../db/stores'
import { ModuleRegistry, type DispatchContext } from './registry'

const DM: Viewer = { role: 'dm', identityId: 'dm-1' }
const SCENE = 'scene-1'

function baseCtx(campaignId: string, overrides: Partial<DispatchContext> = {}): DispatchContext {
  return {
    campaignId,
    sessionId: 'sess-1',
    activeSceneId: SCENE,
    sender: DM,
    players: [],
    broadcast: () => {},
    ...overrides,
  }
}

/**
 * Shaped exactly like the real triggers module for the property under test: `noop` is a
 * normal wire-reachable command, `event` is deliberately absent from `commands` — the same
 * asymmetry triggers/module.ts ships. What this stub does with `event` (count the calls) is
 * not the point; that the registry can even reach it, and only via `dispatchInternal`, is.
 */
function stubTriggers(onEvent?: (payload: unknown) => void): GameModule<{ calls: number }> {
  return {
    name: 'triggers',
    commands: { noop: ANY_ROLE },
    initialState: { calls: 0 },
    handler(action, payload, ctx) {
      if (action === 'noop') return
      if (action === 'event') {
        onEvent?.(payload)
        ctx.setState({ calls: ctx.state.calls + 1 })
        return
      }
      return { code: 'invalid-command', message: `stub triggers has no action '${action}'` }
    },
  }
}

function wired(triggers?: GameModule<{ calls: number }>) {
  const stores = createStores(openDb(':memory:'))
  const campaign = stores.campaigns.create('Camp')
  const registry = new ModuleRegistry(stores.moduleState)
  registry.register(tokensModule())
  if (triggers) registry.register(triggers)
  return { registry, campaignId: campaign.id, stores }
}

describe('dispatch vs dispatchInternal (M4)', () => {
  it('refuses `triggers.event` over the wire path even though the module is registered', () => {
    const { registry, campaignId } = wired(stubTriggers())
    const error = registry.dispatch('triggers', 'event', { sceneId: SCENE, source: {} }, baseCtx(campaignId))
    expect(error).toEqual({
      code: 'invalid-command',
      message: `module 'triggers' has no action 'event'`,
    })
  })

  it('dispatchInternal reaches the same action, skipping both the commands check and the role gate', () => {
    const seen: unknown[] = []
    const { registry, campaignId } = wired(stubTriggers((p) => seen.push(p)))
    const error = registry.dispatchInternal(
      'triggers',
      'event',
      { sceneId: SCENE, source: { module: 'tokens', action: 'move' } },
      baseCtx(campaignId, { sender: { role: 'player', identityId: 'p-1' } }),
    )
    expect(error).toBeNull()
    expect(seen).toEqual([{ sceneId: SCENE, source: { module: 'tokens', action: 'move' } }])
  })

  // N8 — `dispatchInternal` stays public only because this file's test above needs to call
  // it directly; that must not become a second door a socket can walk through. A grep-level
  // guard is cheap and catches the one thing that actually matters: nobody in ws/CommandRouter
  // ever writes `.dispatchInternal(`.
  it('CommandRouter never calls dispatchInternal — dispatch is its only door in', () => {
    const source = readFileSync(join(__dirname, '../ws/CommandRouter.ts'), 'utf8')
    expect(source).not.toContain('.dispatchInternal(')
  })
})

describe('the tokens/fog → triggers cascade', () => {
  function place(registry: ModuleRegistry, campaignId: string, x: number, y: number): string {
    const sent: unknown[] = []
    const error = registry.dispatch(
      'tokens',
      'place',
      { sceneId: SCENE, name: 'Rat', x, y },
      baseCtx(campaignId, { broadcast: (m) => sent.push(m) }),
    )
    expect(error).toBeNull()
    const state = sent.find(
      (m): m is { type: 'state-update'; module: string; state: TokensState } =>
        (m as { type: string }).type === 'state-update' && (m as { module: string }).module === 'tokens',
    )
    const token = Object.values(state!.state.byScene[SCENE] ?? {})[0]
    return token.id
  }

  it('fires after a successful tokens.move', () => {
    const events: unknown[] = []
    const { registry, campaignId } = wired(stubTriggers((p) => events.push(p)))
    const id = place(registry, campaignId, 0, 0)
    events.length = 0 // `place` cascades too (it's in CASCADES); only `move`'s is under test here

    const error = registry.dispatch('tokens', 'move', { sceneId: SCENE, id, x: 5, y: 5 }, baseCtx(campaignId))
    expect(error).toBeNull()
    expect(events).toEqual([{ sceneId: SCENE, source: { module: 'tokens', action: 'move' } }])
  })

  it('does not fire after a refused tokens.move', () => {
    const events: unknown[] = []
    const { registry, campaignId } = wired(stubTriggers((p) => events.push(p)))
    // No such token in that scene — `move` refuses before ever calling `setState`.
    const error = registry.dispatch(
      'tokens',
      'move',
      { sceneId: SCENE, id: 'no-such-token', x: 5, y: 5 },
      baseCtx(campaignId),
    )
    expect(error?.code).toBe('invalid-command')
    expect(events).toEqual([])
  })

  it('is a silent no-op when triggers is not registered', () => {
    const { registry, campaignId } = wired() // no triggers module at all
    const id = place(registry, campaignId, 0, 0)
    expect(() =>
      registry.dispatch('tokens', 'move', { sceneId: SCENE, id, x: 5, y: 5 }, baseCtx(campaignId)),
    ).not.toThrow()
    expect(registry.dispatch('tokens', 'move', { sceneId: SCENE, id, x: 6, y: 6 }, baseCtx(campaignId))).toBeNull()
  })
})
