import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { freshSeats, seatExpiresAt, SEAT_REFRESH_MARGIN_MS } from './seat'
import type { GoblinRest } from './rest'
import { openDb } from '../db/db'
import { createCampaigns, type Campaign } from '../db/stores'

/** Exactly how the game server signs one (session/server/src/auth.ts signToken). */
function signToken(claims: Record<string, unknown>, secret = 'test-secret'): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
}

const seat = (expiresInMs: number): string =>
  signToken({ identityId: 'bot', campaignId: 'camp-1', role: 'dm', exp: Date.now() + expiresInMs })

const DAY = 24 * 60 * 60 * 1000

describe('seatExpiresAt', () => {
  it('reads the expiry out of a token the server signed', () => {
    const exp = Date.now() + 7 * DAY
    expect(seatExpiresAt(signToken({ identityId: 'bot', campaignId: 'c', role: 'dm', exp }))).toBe(exp)
  })

  it('counts anything it cannot read as already expired', () => {
    for (const bad of [null, undefined, '', 'dm-token', '.sig', 'bm90LWpzb24.sig', signToken({ role: 'dm' })])
      expect(seatExpiresAt(bad)).toBe(0)
  })
})

function harness(over: Partial<GoblinRest> = {}) {
  const db = openDb(':memory:')
  const campaigns = createCampaigns(db)
  campaigns.upsert({
    goblinCampaignId: 'camp-1',
    name: 'The Sunken Keep',
    channelId: 'player-chan',
    dmChannelId: 'dm-chan',
    dmDiscordId: 'dm-1',
    roleId: 'role-1',
  })
  const mintServiceToken = vi.fn(async (_pass: string, campaignId: string, role: 'dm' | 'player') => ({
    token: signToken({ identityId: 'bot', campaignId, role, exp: Date.now() + 7 * DAY }),
    campaignId,
    role,
    name: 'Goblin Bot',
  }))
  const unused = (): never => {
    throw new Error('not used in this test')
  }
  const goblin: GoblinRest = {
    mintServiceToken,
    getScenes: unused,
    openSession: unused,
    endSession: unused,
    getMap: unused,
    getAsset: unused,
    ...over,
  }
  const set = (dm: string | null, player: string | null): Campaign =>
    campaigns.setTokens('camp-1', dm!, player)
  return { campaigns, goblin, mintServiceToken, deps: { goblin, goblinAdminPass: 'admin-pass', campaigns }, set }
}

describe('freshSeats', () => {
  it('leaves a live pair of seats alone and never calls the server', async () => {
    const { deps, mintServiceToken, set } = harness()
    const campaign = set(seat(7 * DAY), seat(7 * DAY))
    expect(await freshSeats(campaign, deps)).toBe(campaign)
    expect(mintServiceToken).not.toHaveBeenCalled()
  })

  it('re-mints both seats, saves them, and hands back the refreshed row', async () => {
    const { deps, campaigns, mintServiceToken, set } = harness()
    const refreshed = await freshSeats(set(seat(-DAY), seat(-DAY)), deps)

    expect(mintServiceToken.mock.calls.map((call) => call[2]).sort()).toEqual(['dm', 'player'])
    expect(seatExpiresAt(refreshed.serviceToken)).toBeGreaterThan(Date.now())
    expect(seatExpiresAt(refreshed.playerToken)).toBeGreaterThan(Date.now())
    expect(campaigns.byId('camp-1')).toMatchObject({
      serviceToken: refreshed.serviceToken,
      playerToken: refreshed.playerToken,
    })
  })

  it('re-mints before expiry, not after — a seat must not die mid-session', async () => {
    const { deps, mintServiceToken, set } = harness()
    await freshSeats(set(seat(SEAT_REFRESH_MARGIN_MS / 2), seat(7 * DAY)), deps)
    expect(mintServiceToken).toHaveBeenCalledTimes(2)
  })

  it('mints for a campaign that has no seat at all, or only half a pair', async () => {
    const { deps, mintServiceToken, set } = harness()
    await freshSeats(set(null, null), deps)
    expect(mintServiceToken).toHaveBeenCalledTimes(2)
    mintServiceToken.mockClear()
    await freshSeats(set(seat(7 * DAY), null), deps)
    expect(mintServiceToken).toHaveBeenCalledTimes(2)
  })
})
