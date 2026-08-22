// P4 — the world clock ticker, exercised directly against a real ModuleRegistry/store (the
// same `dispatch` path a DM's own `set-world` command takes) so a test failure here means the
// ticking rule itself is wrong, not some mock of it. Fake timers throughout (`vi.useFakeTimers`)
// — `Date.now()` inside WorldTicker and vitest's own `setInterval` share the same fake clock.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { triggersModule, worldOf, type TriggersState } from '@dnd/mechanics/triggers'
import { openDb } from '../db/db'
import { createStores } from '../db/stores'
import { ModuleRegistry } from '../modules/registry'
import { WorldTicker, type TickSession } from './WorldTicker'

const SCENE = 'scene-1'

function wired() {
  const stores = createStores(openDb(':memory:'))
  const campaign = stores.campaigns.create('Camp')
  const registry = new ModuleRegistry(stores.moduleState)
  registry.register(
    triggersModule({ prepOf: () => null, tokensOf: () => ({}), exploredOf: () => [] }),
  )
  return { registry, campaignId: campaign.id, stores }
}

function worldState(registry: ModuleRegistry, campaignId: string) {
  return worldOf(registry.readState(campaignId, 'triggers') as TriggersState)
}

/** DM-issued `set-world` — a manual scrub or dial turn, dispatched the normal wire way. */
function setWorld(registry: ModuleRegistry, campaignId: string, payload: Record<string, unknown>) {
  const error = registry.dispatch('triggers', 'set-world', payload, {
    campaignId,
    sessionId: 'sess-1',
    activeSceneId: SCENE,
    sender: { role: 'dm', identityId: 'dm-1' },
    players: [],
    broadcast: () => {},
  })
  expect(error).toBeNull()
}

function session(campaignId: string, overrides: Partial<TickSession> = {}): TickSession {
  return {
    sessionId: 'sess-1',
    campaignId,
    activeSceneId: () => SCENE,
    players: () => [],
    broadcast: () => {},
    ...overrides,
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('WorldTicker', () => {
  it('does no work — never writes — while paused (the default)', () => {
    const { registry, campaignId, stores } = wired()
    const revisionBefore = stores.moduleState.revision
    const ticker = new WorldTicker(registry, 1_000)
    ticker.start(session(campaignId))

    vi.advanceTimersByTime(10 * 60_000)

    expect(worldState(registry, campaignId).clock).toBe(720) // NOON, untouched
    expect(stores.moduleState.revision).toBe(revisionBefore)
  })

  it('advances the clock by whole minutes at the real rate (1x)', () => {
    const { registry, campaignId } = wired()
    setWorld(registry, campaignId, { timeSpeed: 'real' })
    const ticker = new WorldTicker(registry, 1_000)
    ticker.start(session(campaignId))

    // First tick only establishes the baseline — nothing to advance from yet.
    vi.advanceTimersByTime(1_000)
    expect(worldState(registry, campaignId).clock).toBe(720)

    vi.advanceTimersByTime(60_000) // a full real minute since the baseline
    expect(worldState(registry, campaignId).clock).toBe(721)

    vi.advanceTimersByTime(60_000)
    expect(worldState(registry, campaignId).clock).toBe(722)
  })

  it('runs a day in about an hour at the fast rate (24x)', () => {
    const { registry, campaignId } = wired()
    setWorld(registry, campaignId, { timeSpeed: 'fast' })
    const ticker = new WorldTicker(registry, 500)
    ticker.start(session(campaignId))

    vi.advanceTimersByTime(500) // baseline
    vi.advanceTimersByTime(2_500) // one game-minute at 24x
    expect(worldState(registry, campaignId).clock).toBe(721)
  })

  it('wraps at midnight instead of running the clock past 1439', () => {
    const { registry, campaignId } = wired()
    setWorld(registry, campaignId, { clock: 1439, timeSpeed: 'real' })
    const ticker = new WorldTicker(registry, 1_000)
    ticker.start(session(campaignId))

    vi.advanceTimersByTime(1_000) // baseline at clock 1439
    vi.advanceTimersByTime(60_000)
    expect(worldState(registry, campaignId).clock).toBe(0)
  })

  it('pauses and resumes without fabricating progress for the paused stretch', () => {
    const { registry, campaignId } = wired()
    setWorld(registry, campaignId, { timeSpeed: 'real' })
    const ticker = new WorldTicker(registry, 1_000)
    ticker.start(session(campaignId))
    vi.advanceTimersByTime(1_000) // baseline

    vi.advanceTimersByTime(40_000) // 40s in — short of a whole minute, nothing committed yet
    setWorld(registry, campaignId, { timeSpeed: 'paused' })
    vi.advanceTimersByTime(10 * 60_000) // sits paused for a long stretch
    expect(worldState(registry, campaignId).clock).toBe(720) // the 40s never banked, and paused added nothing

    setWorld(registry, campaignId, { timeSpeed: 'real' })
    vi.advanceTimersByTime(1_000) // baseline resets on resume
    vi.advanceTimersByTime(60_000)
    expect(worldState(registry, campaignId).clock).toBe(721) // ticking from the resume point, not before
  })

  it('a manual clock jump resets the base — no stale fraction leaks into the next advance', () => {
    const { registry, campaignId } = wired()
    setWorld(registry, campaignId, { timeSpeed: 'real' })
    const ticker = new WorldTicker(registry, 1_000)
    ticker.start(session(campaignId))
    vi.advanceTimersByTime(1_000) // baseline

    vi.advanceTimersByTime(50_000) // 50s of unbanked progress toward minute 721
    setWorld(registry, campaignId, { clock: 100 }) // DM scrubs the slider mid-flight
    vi.advanceTimersByTime(1_000) // ticker notices the jump and resets its base here

    vi.advanceTimersByTime(60_000) // one clean minute from the jump, not 50s + 60s
    expect(worldState(registry, campaignId).clock).toBe(101)
  })

  it('keeps ticking across a scene switch — the clock is campaign-global, not per-scene', () => {
    const { registry, campaignId } = wired()
    setWorld(registry, campaignId, { timeSpeed: 'real' })
    let scene = SCENE
    const ticker = new WorldTicker(registry, 1_000)
    ticker.start(session(campaignId, { activeSceneId: () => scene }))
    vi.advanceTimersByTime(1_000) // baseline

    scene = 'scene-2' // the DM switches scenes mid-flight
    vi.advanceTimersByTime(60_000)
    expect(worldState(registry, campaignId).clock).toBe(721) // the switch did not pause it
  })

  it('fires band-crossing narration on an auto-advance, exactly as a manual scrub would', () => {
    const { registry, campaignId } = wired()
    setWorld(registry, campaignId, { clock: 299, timeSpeed: 'real' }) // one minute short of dawn
    const ticker = new WorldTicker(registry, 1_000)
    ticker.start(session(campaignId))
    vi.advanceTimersByTime(1_000) // baseline

    vi.advanceTimersByTime(60_000) // crosses into dawn (BANDS.dawn = 300)
    const state = registry.readState(campaignId, 'triggers') as TriggersState
    expect(state.byScene[SCENE]?.log.at(-1)).toMatchObject({ text: 'Dawn breaks.', toPlayers: true })
  })

  it('stops ticking once the session closes', () => {
    const { registry, campaignId } = wired()
    setWorld(registry, campaignId, { timeSpeed: 'real' })
    const ticker = new WorldTicker(registry, 1_000)
    ticker.start(session(campaignId))
    vi.advanceTimersByTime(1_000) // baseline

    ticker.stop('sess-1')
    vi.advanceTimersByTime(10 * 60_000)
    expect(worldState(registry, campaignId).clock).toBe(720) // no timer left to advance it
  })
})
