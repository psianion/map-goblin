// Decision 12 and 13 over a real server: the canvas mints a single-use handoff code with its
// DM token, the table redeems it for a token of its own, and a live DM token refreshes.

import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { DM_TOKEN_TTL_MS, checkSeat, createAdminPass, issueToken, startSession, verifyToken } from './auth'
import { HANDOFF_TTL_MS, createHandoffStore } from './handoff'
import { startServer, type RunningServer } from './index'

beforeAll(() => {
  process.env.GAME_SERVER_DATA = mkdtempSync(join(tmpdir(), 'game-server-handoff-'))
})

afterEach(() => {
  delete process.env.PUBLIC_TABLE_URL
})

describe('the handoff store', () => {
  it('redeems a code once', () => {
    const store = createHandoffStore()
    const code = store.mint('camp', 'dm', 1000)
    expect(store.redeem(code, 1001)).toEqual({ campaignId: 'camp', identityId: 'dm', exp: 1000 + HANDOFF_TTL_MS })
    expect(store.redeem(code, 1002)).toBeNull()
  })

  it('refuses a code past its minute, and does not keep it', () => {
    const store = createHandoffStore()
    const code = store.mint('camp', 'dm', 1000)
    expect(store.redeem(code, 1000 + HANDOFF_TTL_MS)).toBeNull()
    expect(store.redeem(code, 1000)).toBeNull()
  })

  it('refuses a code it never minted', () => {
    const store = createHandoffStore()
    store.mint('camp', 'dm')
    expect(store.redeem('not-a-code')).toBeNull()
  })

  it('mints 32 random bytes per code', () => {
    const store = createHandoffStore()
    const a = store.mint('camp', 'dm')
    const b = store.mint('camp', 'dm')
    expect(a).not.toBe(b)
    expect(Buffer.from(a, 'base64url')).toHaveLength(32)
  })
})

interface Fixture {
  server: RunningServer
  base: string
  secret: string
  campaignId: string
  dmToken: string
}

async function withCampaign(body: (fixture: Fixture) => Promise<void>): Promise<void> {
  const server = await startServer({ port: 0, trustedPort: 0, heartbeatMs: 60_000, dbPath: ':memory:' })
  try {
    const base = `http://127.0.0.1:${server.port}`
    const adminPass = createAdminPass(server.stores.passes)
    const created = await call(base, 'POST', '/api/campaigns', { token: adminPass, body: { name: 'Emberhold' } })
    await body({
      server,
      base,
      secret: server.config.secrets.hmacSecret,
      campaignId: created.body.campaignId as string,
      dmToken: created.body.token as string,
    })
  } finally {
    await server.close()
  }
}

async function call(
  base: string,
  method: string,
  path: string,
  { token, body }: { token?: string; body?: unknown } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  return { status: response.status, body: text.startsWith('{') ? (JSON.parse(text) as Record<string, unknown>) : {} }
}

describe('DM tokens', () => {
  it('last 30 days from campaign create', async () => {
    await withCampaign(async ({ secret, dmToken }) => {
      const exp = verifyToken(secret, dmToken)!.exp
      expect(exp - Date.now()).toBeGreaterThan(DM_TOKEN_TTL_MS - 60_000)
    })
  })

  it('refresh to a new token with a later exp', async () => {
    await withCampaign(async ({ base, secret, campaignId, dmToken }) => {
      const before = verifyToken(secret, dmToken)!
      await new Promise((done) => setTimeout(done, 5))
      const refreshed = await call(base, 'POST', `/api/campaigns/${campaignId}/dm-token/refresh`, { token: dmToken })
      expect(refreshed.status).toBe(200)
      const after = verifyToken(secret, refreshed.body.token as string)!
      expect(refreshed.body.exp).toBe(after.exp)
      expect(after.exp).toBeGreaterThan(before.exp)
      expect(after).toMatchObject({ identityId: before.identityId, campaignId, role: 'dm' })
    })
  })

  it('refuse a refresh without a live DM token for that campaign', async () => {
    await withCampaign(async ({ base, campaignId, dmToken }) => {
      expect((await call(base, 'POST', `/api/campaigns/${campaignId}/dm-token/refresh`)).status).toBe(401)
      expect((await call(base, 'POST', `/api/campaigns/other/dm-token/refresh`, { token: dmToken })).status).toBe(403)
    })
  })
})

/** A player seated at a fresh table the way `POST /api/join` seats one. */
function seatPlayer(server: RunningServer, campaignId: string, ttlMs?: number) {
  const session = startSession(server.stores.sessions, campaignId)
  const player = server.stores.identities.mint(randomUUID(), campaignId, 'Pip', 'player')
  const token = issueToken(server.config.secrets.hmacSecret, player.id, campaignId, 'player', session.id, ttlMs)
  return { session, player, token }
}

describe('seat refresh', () => {
  it('renews a live player seat to the same identity and session', async () => {
    await withCampaign(async ({ server, base, secret, campaignId }) => {
      const { session, player, token } = seatPlayer(server, campaignId)
      const renewed = await call(base, 'POST', '/api/seat/refresh', { token })
      expect(renewed.status).toBe(200)
      const seat = checkSeat(secret, server.stores, renewed.body.token as string)!
      expect(seat.identity.id).toBe(player.id)
      expect(seat.session.id).toBe(session.id)
      expect(seat.claims).toMatchObject({ role: 'player', campaignId, sessionId: session.id, exp: renewed.body.exp })
    })
  })

  it('refuses an expired token', async () => {
    await withCampaign(async ({ server, base, campaignId }) => {
      const { token } = seatPlayer(server, campaignId, -60_000)
      const renewed = await call(base, 'POST', '/api/seat/refresh', { token })
      expect(renewed.status).toBe(401)
      expect(renewed.body.error).toBe('seat refused')
    })
  })

  it('refuses a seat at a table that has ended', async () => {
    await withCampaign(async ({ server, base, campaignId }) => {
      const { session, token } = seatPlayer(server, campaignId)
      server.stores.sessions.endSession(session.id)
      expect((await call(base, 'POST', '/api/seat/refresh', { token })).status).toBe(401)
    })
  })

  it('refuses a banned player', async () => {
    await withCampaign(async ({ server, base, campaignId }) => {
      const { player, token } = seatPlayer(server, campaignId)
      server.stores.identities.ban(player.id)
      expect((await call(base, 'POST', '/api/seat/refresh', { token })).status).toBe(401)
    })
  })

  it('renews an unbound DM token while its campaign runs a table, and leaves it unbound', async () => {
    await withCampaign(async ({ server, base, secret, campaignId, dmToken }) => {
      startSession(server.stores.sessions, campaignId)
      const renewed = await call(base, 'POST', '/api/seat/refresh', { token: dmToken })
      expect(renewed.status).toBe(200)
      const claims = verifyToken(secret, renewed.body.token as string)!
      expect(claims).toMatchObject({ identityId: verifyToken(secret, dmToken)!.identityId, campaignId, role: 'dm' })
      expect(claims.sessionId).toBeUndefined()
      expect(checkSeat(secret, server.stores, renewed.body.token as string)).not.toBeNull()
    })
  })
})

describe('the handoff routes', () => {
  it('mint a code the table redeems once for a DM token', async () => {
    process.env.PUBLIC_TABLE_URL = 'https://table.example.com/'
    await withCampaign(async ({ base, secret, campaignId, dmToken }) => {
      const minted = await call(base, 'POST', `/api/campaigns/${campaignId}/handoff`, { token: dmToken })
      expect(minted.status).toBe(200)
      const code = minted.body.code as string
      expect(minted.body.tableUrl).toBe(`https://table.example.com/host#handoff=${code}`)

      const redeemed = await call(base, 'POST', '/api/handoff/redeem', { body: { code } })
      expect(redeemed.status).toBe(200)
      expect(redeemed.body).toMatchObject({ campaignId, campaignName: 'Emberhold' })
      const claims = verifyToken(secret, redeemed.body.token as string)!
      expect(claims).toMatchObject({ campaignId, role: 'dm', identityId: verifyToken(secret, dmToken)!.identityId })
      expect(claims.exp - Date.now()).toBeGreaterThan(DM_TOKEN_TTL_MS - 60_000)

      expect((await call(base, 'POST', '/api/handoff/redeem', { body: { code } })).status).toBe(404)
    })
  })

  it('redeem for a campaign stood up the way the table e2e fixtures do it', async () => {
    // The fixtures create the campaign with the admin pass, upload a map, open a session, end
    // it and open another, all before the DM asks for a code.
    process.env.PUBLIC_TABLE_URL = 'http://localhost:5612'
    await withCampaign(async ({ base, campaignId, dmToken }) => {
      const text = readFileSync(join(import.meta.dirname, '../../testdata/goblin-warren.mapbuilder'), 'utf8')
      const res = await fetch(`${base}/api/campaigns/${campaignId}/maps`, {
        method: 'POST',
        headers: { authorization: `Bearer ${dmToken}`, 'content-type': 'application/json' },
        body: text,
      })
      expect(res.ok).toBe(true)
      const { sceneId } = (await res.json()) as { sceneId: string }
      const first = await call(base, 'POST', '/api/sessions', { token: dmToken, body: { campaignId, sceneId } })
      expect(first.status).toBeLessThan(300)
      const ended = await call(base, 'POST', `/api/sessions/${first.body.sessionId as string}/end`, { token: dmToken })
      expect(ended.status).toBeLessThan(300)
      expect((await call(base, 'POST', '/api/sessions', { token: dmToken, body: { campaignId, sceneId } })).status).toBeLessThan(300)

      const minted = await call(base, 'POST', `/api/campaigns/${campaignId}/handoff`, { token: dmToken })
      expect(minted.status).toBe(200)
      const redeemed = await call(base, 'POST', '/api/handoff/redeem', { body: { code: minted.body.code } })
      expect(redeemed.status).toBe(200)
      expect(redeemed.body.campaignId).toBe(campaignId)
    })
  })

  it('refuse a wrong code and a missing one', async () => {
    process.env.PUBLIC_TABLE_URL = 'https://table.example.com'
    await withCampaign(async ({ base }) => {
      expect((await call(base, 'POST', '/api/handoff/redeem', { body: { code: 'guess' } })).status).toBe(404)
      expect((await call(base, 'POST', '/api/handoff/redeem', { body: {} })).status).toBe(400)
    })
  })

  it('mint only for the campaign DM', async () => {
    process.env.PUBLIC_TABLE_URL = 'https://table.example.com'
    await withCampaign(async ({ base, campaignId }) => {
      expect((await call(base, 'POST', `/api/campaigns/${campaignId}/handoff`)).status).toBe(401)
    })
  })

  it('say so when the server does not know where the table is', async () => {
    await withCampaign(async ({ base, campaignId, dmToken }) => {
      const minted = await call(base, 'POST', `/api/campaigns/${campaignId}/handoff`, { token: dmToken })
      expect(minted.status).toBe(503)
      expect(minted.body.error).toMatch(/PUBLIC_TABLE_URL/)
    })
  })

  it('stop answering a flood of guesses', async () => {
    process.env.PUBLIC_TABLE_URL = 'https://table.example.com'
    await withCampaign(async ({ base }) => {
      const statuses: number[] = []
      for (let i = 0; i < 12; i++) {
        statuses.push((await call(base, 'POST', '/api/handoff/redeem', { body: { code: `guess-${i}` } })).status)
      }
      expect(statuses.slice(0, 10).every((s) => s === 404)).toBe(true)
      expect(statuses.at(-1)).toBe(429)
    })
  })
})
