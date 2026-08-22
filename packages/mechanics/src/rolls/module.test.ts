import { describe, expect, it } from 'vitest'
import type { PlayerInfo } from '@dnd/core/src/shared/protocol'
import type { ModuleContext } from '../contract'
import { MAX_LOG, rollsModule } from './module'
import type { RollEvent, RollPost, RollsState } from './types'

const ALICE: PlayerInfo = { identityId: 'alice', name: 'Alice', role: 'player', connected: true }
const BOB: PlayerInfo = { identityId: 'bob', name: 'Bob', role: 'player', connected: true }
const DM: PlayerInfo = { identityId: 'dm', name: 'Deb', role: 'dm', connected: true }

/** A ModuleContext that just records what setState was handed. */
function harness(sender: PlayerInfo = ALICE, state: RollsState = { log: [] }) {
  const ctx: ModuleContext<RollsState> = {
    campaignId: 'c1',
    sessionId: 's1',
    activeSceneId: null,
    sender: { role: sender.role, identityId: sender.identityId },
    players: [ALICE, BOB, DM],
    state,
    setState: (next) => {
      ctx.state = next
    },
    broadcast: () => {
      throw new Error('rolls must never broadcast state directly (D3)')
    },
  }
  const post = (payload: unknown) => rollsModule.handler('post', payload, ctx)
  return { ctx, post }
}

const PUBLIC_MANUAL: RollPost = { source: 'manual', text: 'stealth 17', visibility: 'public' }

describe('rolls.post validation', () => {
  it('rejects a missing or unknown source', () => {
    const { post, ctx } = harness()
    expect(post({ visibility: 'public' })).toMatchObject({ code: 'invalid-command' })
    expect(post({ source: 'roll20', visibility: 'public' })).toMatchObject({
      code: 'invalid-command',
    })
    expect(post(undefined)).toMatchObject({ code: 'invalid-command' })
    expect(ctx.state.log).toHaveLength(0)
  })

  it("accepts 'discord' — the bot forwarding a /roll over its own seat", () => {
    const { post, ctx } = harness()
    expect(post({ source: 'discord', characterName: 'Zed', total: 17, visibility: 'public' })).toBeUndefined()
    expect(ctx.state.log[0]).toMatchObject({ source: 'discord', characterName: 'Zed', total: 17 })
  })

  it('rejects an unknown visibility', () => {
    const { post } = harness()
    expect(post({ source: 'manual', text: 'hi' })).toMatchObject({ code: 'invalid-command' })
    expect(post({ source: 'manual', visibility: 'dm-only' })).toMatchObject({
      code: 'invalid-command',
    })
  })

  it.each([
    ['characterName', 60],
    ['title', 100],
    ['formula', 100],
    ['breakdown', 200],
    ['text', 200],
  ])('caps %s at %i characters', (field, max) => {
    const { post, ctx } = harness()
    const base = { source: 'manual', visibility: 'public' }
    expect(post({ ...base, [field]: 'x'.repeat(max) })).toBeUndefined()
    expect(post({ ...base, [field]: 'x'.repeat(max + 1) })).toMatchObject({
      code: 'invalid-command',
    })
    expect(post({ ...base, [field]: 42 })).toMatchObject({ code: 'invalid-command' })
    // Only the in-cap one landed.
    expect(ctx.state.log).toHaveLength(1)
  })

  it('rejects a non-finite total and keeps a finite one', () => {
    const { post, ctx } = harness()
    const base = { source: 'dndbeyond', visibility: 'public' }
    expect(post({ ...base, total: Number.NaN })).toMatchObject({ code: 'invalid-command' })
    expect(post({ ...base, total: Number.POSITIVE_INFINITY })).toMatchObject({
      code: 'invalid-command',
    })
    expect(post({ ...base, total: '17' })).toMatchObject({ code: 'invalid-command' })
    expect(post({ ...base, total: 0 })).toBeUndefined()
    expect(ctx.state.log).toEqual([expect.objectContaining({ total: 0 })])
  })

  it('ignores fields the client is not allowed to set', () => {
    const { post, ctx } = harness()
    post({ ...PUBLIC_MANUAL, id: 'forged', at: 1, identityId: 'bob', playerName: 'Bob' })
    expect(ctx.state.log[0]).toMatchObject({ id: expect.not.stringMatching(/^forged$/) })
    expect(ctx.state.log[0].identityId).toBe('alice')
    expect(ctx.state.log[0].playerName).toBe('Alice')
  })
})

describe('rolls.post minting', () => {
  it('stamps id/at/identity/playerName from the sender and roster', () => {
    const before = Date.now()
    const { post, ctx } = harness(BOB)
    expect(post(PUBLIC_MANUAL)).toBeUndefined()
    const [event] = ctx.state.log
    expect(event.id).toBeTruthy()
    expect(event.at).toBeGreaterThanOrEqual(before)
    expect(event).toMatchObject({
      identityId: 'bob',
      playerName: 'Bob',
      source: 'manual',
      text: 'stealth 17',
      visibility: 'public',
    })
  })

  it('falls back to "Someone" when the sender is off the roster', () => {
    const ghost: PlayerInfo = { ...ALICE, identityId: 'ghost', name: 'Ghost' }
    const { post, ctx } = harness({ ...ghost, name: 'Ghost' })
    // harness lists ALICE/BOB/DM only, so 'ghost' has no roster entry.
    post(PUBLIC_MANUAL)
    expect(ctx.state.log[0].playerName).toBe('Someone')
  })

  it('mints distinct ids for rolls in the same millisecond', () => {
    const { post, ctx } = harness()
    for (let i = 0; i < 20; i += 1) post(PUBLIC_MANUAL)
    expect(new Set(ctx.state.log.map((e) => e.id)).size).toBe(20)
  })

  it('drops empty optional strings instead of storing them', () => {
    const { post, ctx } = harness()
    post({ source: 'manual', visibility: 'public', text: '', title: '' })
    expect(ctx.state.log[0]).not.toHaveProperty('text')
    expect(ctx.state.log[0]).not.toHaveProperty('title')
  })
})

describe('rolls log trimming', () => {
  it(`keeps only the most recent ${MAX_LOG}`, () => {
    const { post, ctx } = harness()
    for (let i = 0; i < MAX_LOG + 25; i += 1) post({ ...PUBLIC_MANUAL, text: `roll ${i}` })
    expect(ctx.state.log).toHaveLength(MAX_LOG)
    expect(ctx.state.log[0].text).toBe('roll 25')
    expect(ctx.state.log.at(-1)?.text).toBe(`roll ${MAX_LOG + 24}`)
  })

  it('never mutates the state it was handed', () => {
    const state: RollsState = { log: [] }
    const { post, ctx } = harness(ALICE, state)
    post(PUBLIC_MANUAL)
    expect(state.log).toHaveLength(0)
    expect(ctx.state.log).toHaveLength(1)
  })
})

describe('rolls redact', () => {
  const event = (over: Partial<RollEvent>): RollEvent => ({
    id: over.id ?? 'e',
    at: 0,
    identityId: 'alice',
    playerName: 'Alice',
    source: 'manual',
    visibility: 'public',
    ...over,
  })
  const state: RollsState = {
    log: [
      event({ id: 'alice-public', identityId: 'alice', visibility: 'public' }),
      event({ id: 'alice-private', identityId: 'alice', visibility: 'private' }),
      event({ id: 'bob-private', identityId: 'bob', visibility: 'private' }),
    ],
  }
  const ids = (role: 'dm' | 'player', identityId: string) =>
    rollsModule.redact?.(state, { role, identityId }).log.map((e) => e.id)

  it('shows the roller their own whispers', () => {
    expect(ids('player', 'alice')).toEqual(['alice-public', 'alice-private'])
  })

  it('hides other players whispers', () => {
    expect(ids('player', 'bob')).toEqual(['alice-public', 'bob-private'])
    expect(ids('player', 'carol')).toEqual(['alice-public'])
  })

  it('shows the DM everything', () => {
    expect(ids('dm', 'dm')).toEqual(['alice-public', 'alice-private', 'bob-private'])
  })

  it('is pure and idempotent', () => {
    const viewer = { role: 'player' as const, identityId: 'bob' }
    const once = rollsModule.redact!(state, viewer)
    const twice = rollsModule.redact!(once, viewer)
    expect(twice).toEqual(once)
    expect(state.log).toHaveLength(3)
  })
})
