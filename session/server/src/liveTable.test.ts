// Table fix pass, tests 6.1 rows 16 to 19: a live table carries on when opened again, a
// returning player gets their token back by name (and only when nobody at the table holds that
// name), the live scene reaches players whatever its hidden flag, and a party start spawns the
// party there.
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { FogState } from '@dnd/mechanics/fog'
import type { Token, TokensState } from '@dnd/mechanics/tokens'
import { createAdminPass } from './auth'
import { PROTOCOL_VERSION } from './config'
import { startServer, type RunningServer } from './index'
import { parseMapFile } from './mapImport'

const MAP = readFileSync(join(import.meta.dirname, '../../testdata/outdoor-cave.ggvtt'), 'utf8')

type Body = Record<string, unknown>
type Msg = Record<string, unknown>

async function api(base: string, method: string, path: string, token?: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
  const text = await response.text()
  return { status: response.status, body: (text.startsWith('{') ? JSON.parse(text) : {}) as Body }
}

async function seat(port: number, token: string) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`)
  const frames: Msg[] = []
  socket.on('message', (raw: Buffer) => frames.push(JSON.parse(raw.toString()) as Msg))
  await once(socket, 'open')
  socket.send(JSON.stringify({ type: 'join', protocolVersion: PROTOCOL_VERSION }))
  const until = async (match: (m: Msg) => boolean, ms = 3000): Promise<Msg> => {
    const end = Date.now() + ms
    for (;;) {
      const hit = frames.find(match)
      if (hit) return hit
      if (Date.now() > end) throw new Error('timed out')
      await new Promise((r) => setTimeout(r, 20))
    }
  }
  const command = (module: string, action: string, payload: unknown) =>
    socket.send(JSON.stringify({ type: 'command', module, action, payload, seq: 1 }))
  await until((m) => m.type === 'session-state')
  return { socket, frames, until, command }
}

async function withTable(body: (t: { server: RunningServer; base: string; campaignId: string; dmToken: string; upload: () => Promise<string> }) => Promise<void>) {
  const server = await startServer({ port: 0, trustedPort: 0, heartbeatMs: 60_000, dbPath: ':memory:' })
  try {
    const base = `http://127.0.0.1:${server.port}`
    const campaign = await api(base, 'POST', '/api/campaigns', createAdminPass(server.stores.passes), {})
    const campaignId = campaign.body.campaignId as string
    const dmToken = campaign.body.token as string
    const upload = async () => (await api(base, 'POST', `/api/campaigns/${campaignId}/maps`, dmToken, MAP)).body.sceneId as string
    await body({ server, base, campaignId, dmToken, upload })
  } finally {
    await server.close()
  }
}

const tokensOf = (server: RunningServer, campaignId: string, sceneId: string): Token[] =>
  Object.values((server.stores.moduleState.get(campaignId, 'tokens') as TokensState | undefined)?.byScene[sceneId] ?? {})

describe('a live table (F1, F19)', () => {
  it('16: a second open continues the first and switches scene', async () => {
    await withTable(async ({ server, base, campaignId, dmToken, upload }) => {
      const first = await upload()
      const second = await upload()
      const opened = await api(base, 'POST', '/api/sessions', dmToken, { campaignId, sceneId: first })
      expect(opened.status).toBe(201)
      const again = await api(base, 'POST', '/api/sessions', dmToken, { campaignId, sceneId: second })
      expect(again.status).toBe(200)
      expect(again.body).toMatchObject({ sessionId: opened.body.sessionId, inviteCode: opened.body.inviteCode, resumed: true })
      expect(server.stores.sessions.get(opened.body.sessionId as string)?.active_scene_id).toBe(second)
      expect((await api(base, 'GET', `/api/resolve/${opened.body.inviteCode as string}`)).status).toBe(200)
    })
  })

  it('18: the live scene reaches a player even while it is marked hidden', async () => {
    await withTable(async ({ server, base, campaignId, dmToken, upload }) => {
      const shown = await upload()
      const hidden = await upload()
      await api(base, 'PATCH', `/api/scenes/${shown}`, dmToken, { visibleToPlayers: true })
      const opened = await api(base, 'POST', '/api/sessions', dmToken, { campaignId, sceneId: shown })
      const joined = await api(base, 'POST', '/api/join', undefined, { code: opened.body.inviteCode, name: 'Pim' })
      const dm = await seat(server.port, dmToken)
      const player = await seat(server.port, joined.body.token as string)
      player.frames.length = 0
      dm.command('scenes', 'activate', { sceneId: hidden })
      const changed = await player.until((m) => m.type === 'scene-changed')
      expect(changed).toMatchObject({ sceneId: hidden, hidden: true })
      const state = await player.until((m) => m.type === 'session-state')
      const scenes = (state.state as { scenes: { id: string }[] }).scenes.map((s) => s.id)
      expect(scenes).toContain(hidden)
      expect((await api(base, 'GET', `/api/maps/${hidden}`, joined.body.token as string)).status).toBe(200)
      dm.socket.close()
      player.socket.close()
    })
  })
})

describe('a returning player (F2)', () => {
  it('17: gets the token the Owner picker handed them by name; a second connected seat of that name does not', async () => {
    await withTable(async ({ server, base, campaignId, dmToken, upload }) => {
      const sceneId = await upload()
      const opened = await api(base, 'POST', '/api/sessions', dmToken, { campaignId, sceneId })
      const code = opened.body.inviteCode as string
      const pim = await api(base, 'POST', '/api/join', undefined, { code, name: 'Pim' })
      const dm = await seat(server.port, dmToken)
      const first = await seat(server.port, pim.body.token as string)
      await dm.until((m) => m.type === 'player-joined')
      dm.command('tokens', 'place', { name: 'Rook', x: 15.5, y: 7.5, disposition: 'friendly' })
      await dm.until(() => tokensOf(server, campaignId, sceneId).length > 0)
      const rook = tokensOf(server, campaignId, sceneId)[0]!
      dm.command('tokens', 'assign', { id: rook.id, identityId: pim.body.identityId })
      await dm.until(() => tokensOf(server, campaignId, sceneId)[0]?.ownerId === pim.body.identityId)
      expect(tokensOf(server, campaignId, sceneId)[0]?.ownerName).toBe('Pim')

      // While the first Pim is at the table, another seat of the same name is handed nothing.
      const twin = await api(base, 'POST', '/api/join', undefined, { code, name: 'Pim' })
      expect(tokensOf(server, campaignId, sceneId)[0]?.ownerId).toBe(pim.body.identityId)

      // The first Pim leaves; coming back under the name returns the token.
      first.socket.close()
      await dm.until((m) => m.type === 'player-left')
      const back = await api(base, 'POST', '/api/join', undefined, { code, name: 'pim' })
      expect(back.body.identityId).not.toBe(twin.body.identityId)
      expect(tokensOf(server, campaignId, sceneId)[0]?.ownerId).toBe(back.body.identityId)
      dm.socket.close()
    })
  })
})

describe('the party start (F18, decision f)', () => {
  it('19: a map with partyStart reads unchanged and the party spawns there, with Outdoors revealed', async () => {
    const parsed = parseMapFile(MAP)
    expect(parsed.ok && !parsed.migrated && parsed.data.mapSettings.partyStart).toEqual({ x: 15.5, y: 7.5, levelId: 'lvl-1' })
    await withTable(async ({ server, base, campaignId, dmToken, upload }) => {
      const sceneId = await upload()
      server.stores.moduleState.put(campaignId, 'tokens', {
        library: {
          bram: { id: 'bram', name: 'Bram', imageAssetId: null, size: 'medium', disposition: 'friendly', sight: null, light: null, kind: 'pc' },
          ayla: { id: 'ayla', name: 'Ayla', imageAssetId: null, size: 'medium', disposition: 'friendly', sight: null, light: null, kind: 'pc' },
        },
        byScene: {},
      } satisfies TokensState)
      const opened = await api(base, 'POST', '/api/sessions', dmToken, {
        campaignId,
        sceneId,
        startingPoint: { sceneId, x: 15.5, y: 7.5, levelId: 'lvl-1' },
      })
      expect(opened.status).toBe(201)
      const party = tokensOf(server, campaignId, sceneId)
      expect(party.map((t) => t.defId).sort()).toEqual(['ayla', 'bram'])
      for (const t of party) expect(Math.hypot(t.x - 15.5, t.y - 7.5)).toBeLessThan(3)
      const fog = server.stores.moduleState.get(campaignId, 'fog') as FogState
      expect(fog.byScene[sceneId].rooms['@outdoors']).toEqual({ status: 'revealed', wasEverRevealed: true })
    })
  })
})
