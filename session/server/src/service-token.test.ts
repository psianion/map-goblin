// POST /api/campaigns/:id/service-token — the one server-side seam the Discord bot needs
// (bot plan §4). Same real-server-on-an-ephemeral-port shape as api.test.ts; kept in its own
// file because the route belongs to the bot, not to the join flow.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { createAdminPass, verifyToken } from './auth'
import { startServer, type RunningServer } from './index'

beforeAll(() => {
  process.env.GAME_SERVER_DATA = mkdtempSync(join(tmpdir(), 'game-server-service-token-'))
})

/** The same minimal but *valid* `.mapbuilder` payload api.test.ts uses. */
const MAP = {
  version: '3.0',
  mapSettings: {
    name: 'Cragmaw Hideout',
    gridType: 'square',
    cellScale: { value: 5, unit: 'ft' },
    ambientLight: '#101018',
  },
  grid: { visible: true, snapDivision: 1, style: 'clean' },
  layers: [{ id: 'layer-1', name: 'Dungeon', type: 'dungeon', visible: true, locked: false, opacity: 1 }],
  customImages: {},
}

interface Fixture {
  server: RunningServer
  base: string
  adminPass: string
  secret: string
}

async function withServer(body: (fixture: Fixture) => Promise<void>): Promise<void> {
  const server = await startServer({ port: 0, heartbeatMs: 60_000, dbPath: ':memory:' })
  try {
    await body({
      server,
      base: `http://127.0.0.1:${server.port}`,
      adminPass: createAdminPass(server.stores.passes),
      secret: server.config.secrets.hmacSecret,
    })
  } finally {
    await server.close()
  }
}

async function api(
  base: string,
  method: string,
  path: string,
  { token, body }: { token?: string; body?: unknown } = {},
): Promise<{ status: number; body: Record<string, unknown>; text: string }> {
  const payload = body === undefined ? undefined : JSON.stringify(body)
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: payload,
  })
  const text = await response.text()
  return {
    status: response.status,
    text,
    body: text.startsWith('{') ? (JSON.parse(text) as Record<string, unknown>) : {},
  }
}

/** A campaign with one published scene, and the DM token that made it. */
async function campaignWithScene(fixture: Fixture): Promise<{ campaignId: string; sceneId: string }> {
  const created = await api(fixture.base, 'POST', '/api/campaigns', {
    token: fixture.adminPass,
    body: { name: 'Bridge Test' },
  })
  const campaignId = created.body.campaignId as string
  const uploaded = await api(fixture.base, 'POST', `/api/campaigns/${campaignId}/maps`, {
    token: created.body.token as string,
    body: MAP,
  })
  return { campaignId, sceneId: uploaded.body.sceneId as string }
}

describe('POST /api/campaigns/:id/service-token', () => {
  it('refuses anything but the admin pass', async () => {
    await withServer(async (fixture) => {
      const { campaignId } = await campaignWithScene(fixture)
      expect((await api(fixture.base, 'POST', `/api/campaigns/${campaignId}/service-token`)).status).toBe(401)
      const wrong = await api(fixture.base, 'POST', `/api/campaigns/${campaignId}/service-token`, {
        token: 'not-the-pass',
      })
      expect(wrong.status).toBe(401)
    })
  })

  it('404s an unknown campaign', async () => {
    await withServer(async (fixture) => {
      const missing = await api(fixture.base, 'POST', '/api/campaigns/nope/service-token', {
        token: fixture.adminPass,
      })
      expect(missing.status).toBe(404)
    })
  })

  it('mints an unbound DM token by default', async () => {
    await withServer(async (fixture) => {
      const { campaignId } = await campaignWithScene(fixture)
      const minted = await api(fixture.base, 'POST', `/api/campaigns/${campaignId}/service-token`, {
        token: fixture.adminPass,
      })
      expect(minted.status).toBe(200)
      expect(minted.body).toMatchObject({ campaignId, role: 'dm', name: 'Goblin Bot' })

      const claims = verifyToken(fixture.secret, minted.body.token as string)
      expect(claims).toMatchObject({ campaignId, role: 'dm' })
      // Unbound on purpose: the bot watches whatever table the campaign is running.
      expect(claims?.sessionId).toBeUndefined()
    })
  })

  it('mints a player-role token when asked, on its own identity', async () => {
    await withServer(async (fixture) => {
      const { campaignId } = await campaignWithScene(fixture)
      const dm = await api(fixture.base, 'POST', `/api/campaigns/${campaignId}/service-token`, {
        token: fixture.adminPass,
        body: { role: 'dm' },
      })
      const player = await api(fixture.base, 'POST', `/api/campaigns/${campaignId}/service-token`, {
        token: fixture.adminPass,
        body: { role: 'player' },
      })
      expect(player.body.role).toBe('player')
      expect(verifyToken(fixture.secret, player.body.token as string)).toMatchObject({ role: 'player' })
      // Two seats, two identities — a role change must not repurpose the other one's row.
      expect(verifyToken(fixture.secret, dm.body.token as string)?.identityId).not.toBe(
        verifyToken(fixture.secret, player.body.token as string)?.identityId,
      )
    })
  })

  it('rejects a role that is not a seat at the table', async () => {
    await withServer(async (fixture) => {
      const { campaignId } = await campaignWithScene(fixture)
      const bad = await api(fixture.base, 'POST', `/api/campaigns/${campaignId}/service-token`, {
        token: fixture.adminPass,
        body: { role: 'admin' },
      })
      expect(bad.status).toBe(400)
    })
  })

  it('reuses the bot identity rather than leaving one behind per call', async () => {
    await withServer(async (fixture) => {
      const { campaignId } = await campaignWithScene(fixture)
      const first = await api(fixture.base, 'POST', `/api/campaigns/${campaignId}/service-token`, {
        token: fixture.adminPass,
      })
      const second = await api(fixture.base, 'POST', `/api/campaigns/${campaignId}/service-token`, {
        token: fixture.adminPass,
      })
      expect(verifyToken(fixture.secret, second.body.token as string)?.identityId).toBe(
        verifyToken(fixture.secret, first.body.token as string)?.identityId,
      )
      // …and it is not the human DM's seat: the bot's activity belongs to the bot.
      const names = fixture.server.stores.identities.listByCampaign(campaignId).map((i) => i.name)
      expect(names.filter((n) => n === 'Goblin Bot')).toHaveLength(1)
      expect(names).toContain('DM')
    })
  })

  /**
   * The milestone-6 gate: a session-*unbound* player token has to pass the map route, or the
   * bot cannot render a player-safe map without filtering the DM's copy itself. `requireSession`
   * never reads `sessionId` — only the WS upgrade does — so it does.
   */
  it('lets an unbound player token read the redacted map', async () => {
    await withServer(async (fixture) => {
      const { campaignId, sceneId } = await campaignWithScene(fixture)
      const player = await api(fixture.base, 'POST', `/api/campaigns/${campaignId}/service-token`, {
        token: fixture.adminPass,
        body: { role: 'player' },
      })
      const map = await api(fixture.base, 'GET', `/api/maps/${sceneId}`, {
        token: player.body.token as string,
      })
      expect(map.status).toBe(200)
      expect(map.body.mapSettings).toBeDefined()
    })
  })
})
