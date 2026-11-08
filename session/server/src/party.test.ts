// Decision 16 over a real server: the party's PC tokens stand in the starting room when the
// table opens, a returning player gets their PC back by name, players upload their own art
// within the 2 MB cap, and token defs from before table v2 read with its defaults.

import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { TokenDef, TokensState } from '@dnd/mechanics/tokens'
import { createAdminPass } from './auth'
import { MAX_ASSET_BYTES } from './db/stores'
import { startServer, type RunningServer } from './index'
import { fillTokenDefaults } from './party'

beforeAll(() => {
  process.env.GAME_SERVER_DATA = mkdtempSync(join(tmpdir(), 'game-server-party-'))
})

const MAP = readFileSync(join(import.meta.dirname, '../../testdata/vision-two-rooms.mapbuilder'), 'utf8')
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** A def as a row written before table v2 stores it: no kind, nameplate or HP fields. */
const oldDef = (id: string, name: string): TokenDef => ({
  id,
  name,
  imageAssetId: null,
  size: 'medium',
  disposition: 'friendly',
  sight: null,
  light: null,
})

interface Fixture {
  server: RunningServer
  base: string
  adminPass: string
  campaignId: string
  dmToken: string
  sceneId: string
}

async function withScene(body: (fixture: Fixture) => Promise<void>): Promise<void> {
  const server = await startServer({ port: 0, trustedPort: 0, heartbeatMs: 60_000, dbPath: ':memory:' })
  try {
    const base = `http://127.0.0.1:${server.port}`
    const adminPass = createAdminPass(server.stores.passes)
    const campaign = await call(base, 'POST', '/api/campaigns', { token: adminPass, body: { name: 'Party' } })
    const campaignId = campaign.body.campaignId as string
    const dmToken = campaign.body.token as string
    const up = await call(base, 'POST', `/api/campaigns/${campaignId}/maps`, { token: dmToken, raw: MAP })
    await body({ server, base, adminPass, campaignId, dmToken, sceneId: up.body.sceneId as string })
  } finally {
    await server.close()
  }
}

async function call(
  base: string,
  method: string,
  path: string,
  { token, body, raw, bytes }: { token?: string; body?: unknown; raw?: string; bytes?: Buffer } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const payload = bytes ?? raw ?? (body === undefined ? undefined : JSON.stringify(body))
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...(payload === undefined ? {} : { 'content-type': bytes ? 'application/octet-stream' : 'application/json' }),
    },
    body: payload,
  })
  const text = await response.text()
  return { status: response.status, body: text.startsWith('{') ? (JSON.parse(text) as Record<string, unknown>) : {} }
}

const tokensOf = (server: RunningServer, campaignId: string) =>
  server.stores.moduleState.get(campaignId, 'tokens') as TokensState

describe('PC tokens at session start', () => {
  it('places every PC def in the starting room, and nothing for NPCs', async () => {
    await withScene(async ({ server, base, campaignId, dmToken, sceneId }) => {
      server.stores.moduleState.put(campaignId, 'tokens', {
        library: {
          bram: { ...oldDef('bram', 'Bram'), kind: 'pc', ownerIdentityId: 'seat-bram', ownerName: 'Bram' },
          ysolde: { ...oldDef('ysolde', 'Ysolde'), kind: 'pc' },
          goblin: oldDef('goblin', 'Goblin'),
        },
        byScene: {},
      })

      const opened = await call(base, 'POST', '/api/sessions', {
        token: dmToken,
        body: { campaignId, startingRoom: { sceneId, roomId: 'west' } },
      })
      expect(opened.status).toBe(201)

      const placed = Object.values(tokensOf(server, campaignId).byScene[sceneId] ?? {})
      expect(placed.map((t) => t.defId).sort()).toEqual(['bram', 'ysolde'])
      expect(new Set(placed.map((t) => `${t.x},${t.y}`)).size).toBe(2)
      // In the West Hall, not the East Vault (the rooms' centres are 12 cells apart).
      for (const token of placed) expect(Math.abs(token.x - 5) + Math.abs(token.y - 5)).toBeLessThan(6)
      expect(placed.find((t) => t.defId === 'bram')).toMatchObject({ kind: 'pc', ownerId: 'seat-bram' })
    })
  })

  it('does not place a PC twice when the table opens again', async () => {
    await withScene(async ({ server, base, campaignId, dmToken, sceneId }) => {
      server.stores.moduleState.put(campaignId, 'tokens', {
        library: { bram: { ...oldDef('bram', 'Bram'), kind: 'pc' } },
        byScene: {},
      })
      const open = () =>
        call(base, 'POST', '/api/sessions', { token: dmToken, body: { campaignId, startingRoom: { sceneId, roomId: 'west' } } })
      await open()
      await open()
      expect(Object.keys(tokensOf(server, campaignId).byScene[sceneId] ?? {})).toHaveLength(1)
    })
  })
})

describe('a returning player', () => {
  it('gets their PC back by name', async () => {
    await withScene(async ({ server, base, campaignId, dmToken, sceneId }) => {
      server.stores.moduleState.put(campaignId, 'tokens', {
        library: { bram: { ...oldDef('bram', 'Bram'), kind: 'pc', ownerIdentityId: 'old-seat', ownerName: 'Bram' } },
        byScene: {},
      })
      const opened = await call(base, 'POST', '/api/sessions', {
        token: dmToken,
        body: { campaignId, startingRoom: { sceneId, roomId: 'west' } },
      })
      const joined = await call(base, 'POST', '/api/join', { body: { code: opened.body.inviteCode, name: ' bram ' } })
      expect(joined.status).toBe(200)
      const seat = joined.body.identityId as string

      const state = tokensOf(server, campaignId)
      expect(state.library.bram!.ownerIdentityId).toBe(seat)
      expect(Object.values(state.byScene[sceneId]!)[0]).toMatchObject({ defId: 'bram', ownerId: seat })
    })
  })
})

describe('player art uploads', () => {
  it('take a 1 MB png from a player and refuse a 3 MB one', async () => {
    await withScene(async ({ server, base, campaignId, dmToken }) => {
      const opened = await call(base, 'POST', '/api/sessions', { token: dmToken, body: { campaignId } })
      const joined = await call(base, 'POST', '/api/join', { body: { code: opened.body.inviteCode, name: 'Ysolde' } })
      const playerToken = joined.body.token as string
      const png = (size: number) => Buffer.concat([PNG_HEADER, Buffer.alloc(size - PNG_HEADER.length)])
      const upload = (bytes: Buffer) => call(base, 'POST', `/api/campaigns/${campaignId}/assets`, { token: playerToken, bytes })

      expect(MAX_ASSET_BYTES).toBe(2 * 1024 * 1024)
      expect((await upload(png(1024 * 1024))).status).toBe(201)
      // Refused with a 413, or the socket cut mid-write once the server has answered (the
      // same race api.test.ts's oversized upload allows for): either way nothing is stored.
      const big = await upload(png(3 * 1024 * 1024)).then(
        (r) => r.status,
        (e: { cause?: { code?: string } }) => e.cause?.code,
      )
      expect([413, 'ECONNRESET', 'EPIPE']).toContain(big)
      expect(server.stores.assets.listByCampaign(campaignId)).toHaveLength(1)
    })
  })
})

describe('token defs from before table v2', () => {
  it('are filled with the defaults on startup, and left alone after', async () => {
    await withScene(async ({ server, campaignId, sceneId }) => {
      server.stores.moduleState.put(campaignId, 'tokens', {
        library: { goblin: oldDef('goblin', 'Goblin') },
        byScene: { [sceneId]: { t1: { ...oldDef('t1', 'Goblin'), defId: 'goblin', x: 1, y: 1, elevation: 0, z: 0, hidden: false, ownerId: null } } },
      })
      expect(fillTokenDefaults(server.stores)).toBe(1)
      const state = tokensOf(server, campaignId)
      const defaults = { kind: 'npc', nameplate: 'hover', showHp: 'dm', conditions: [], effects: [] }
      expect(state.library.goblin).toMatchObject(defaults)
      expect(state.byScene[sceneId]!.t1).toMatchObject(defaults)
      expect(fillTokenDefaults(server.stores)).toBe(0)
    })
  })
})
