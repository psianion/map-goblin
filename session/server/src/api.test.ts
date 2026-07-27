// The whole join flow over a real HTTP server, a real WebSocket and a real SQLite
// database on an ephemeral port — no mocks (D10). If a step here passes, a client can
// do it too, because there is nothing standing in for anything.

import { once } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { ServerMessage } from '@dnd/core/src/shared/protocol'
import { createAdminPass, signToken } from './auth'
import { MAX_MAP_BYTES } from './db/stores'
import { startServer, type RunningServer } from './index'

beforeAll(() => {
  // Keep the generated secrets file out of the package directory.
  process.env.GAME_SERVER_DATA = mkdtempSync(join(tmpdir(), 'game-server-api-'))
})

/** A minimal but *valid* `.mapbuilder` payload — the shape mapImport insists on. */
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
  /** A known-good admin pass; the one printed at boot is deliberately unrecoverable. */
  adminPass: string
}

async function withServer(body: (fixture: Fixture) => Promise<void>): Promise<void> {
  const server = await startServer({ port: 0, heartbeatMs: 60_000, dbPath: ':memory:' })
  try {
    await body({
      server,
      base: `http://127.0.0.1:${server.port}`,
      adminPass: createAdminPass(server.stores.passes),
    })
  } finally {
    await server.close()
  }
}

interface Sent {
  token?: string
  /** JSON-encoded for you. */
  body?: unknown
  /** Already-encoded body — how a `.mapbuilder` file goes up. */
  raw?: string
}

async function api(
  base: string,
  method: string,
  path: string,
  { token, body, raw }: Sent = {},
): Promise<{ status: number; body: Record<string, unknown>; text: string }> {
  const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body))
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

/** Opens a socket, joins, and returns it with the snapshot it was answered with. */
async function joinSocket(
  port: number,
  token: string,
): Promise<{ socket: WebSocket; state: Extract<ServerMessage, { type: 'session-state' }> }> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`)
  await once(socket, 'open')
  socket.send(JSON.stringify({ type: 'join', protocolVersion: 1 }))
  return { socket, state: await nextMessage(socket, 'session-state') }
}

function nextMessage<T extends ServerMessage['type']>(
  socket: WebSocket,
  type: T,
): Promise<Extract<ServerMessage, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for '${type}'`)), 2000)
    socket.on('message', (raw: Buffer) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage
      if (msg.type !== type) return
      clearTimeout(timer)
      resolve(msg as Extract<ServerMessage, { type: T }>)
    })
  })
}

/** The upgrade answers a bad token with a bare 401, which `ws` surfaces as an error. */
async function expectUpgradeRejected(port: number, token: string): Promise<void> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`)
  const [error] = (await once(socket, 'error')) as [Error]
  expect(error.message).toMatch(/401/)
  socket.terminate()
}

/** An upgraded socket that has *not* joined — the state the terminal-state tests care about. */
async function openSocket(port: number, token: string): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`)
  await once(socket, 'open')
  return socket
}

/** Campaign → session → one joined player, which is the setup most of the tests below want. */
async function table(base: string, adminPass: string): Promise<{
  campaignId: string
  dmToken: string
  sessionId: string
  inviteCode: string
  playerId: string
  playerToken: string
}> {
  const campaign = await api(base, 'POST', '/api/campaigns', { token: adminPass, body: {} })
  const campaignId = campaign.body.campaignId as string
  const dmToken = campaign.body.token as string
  const started = await api(base, 'POST', '/api/sessions', { token: dmToken, body: { campaignId } })
  const inviteCode = started.body.inviteCode as string
  const joined = await api(base, 'POST', '/api/join', { body: { code: inviteCode, name: 'Bob' } })
  return {
    campaignId,
    dmToken,
    sessionId: started.body.sessionId as string,
    inviteCode,
    playerId: joined.body.identityId as string,
    playerToken: joined.body.token as string,
  }
}

/**
 * A POST whose body the server is meant to refuse mid-flight. `declaredLength` set = the
 * Content-Length lie (the header claims more than the cap, the body never delivers);
 * unset = a chunked upload that really does overrun. Resolves with the status the server
 * answers *while the request is still being written*, which is the whole point.
 *
 * The server hangs up rather than draining a body it has already refused, so this answers
 * with the status when one arrives and with the socket error code when the hangup beats it.
 * Both are a refusal; which one you get depends on how much of the upload was still in
 * flight when the server stopped listening.
 */
async function refusedUpload(
  port: number,
  path: string,
  token: string,
  declaredLength?: number,
): Promise<number | string> {
  const req = request({
    host: '127.0.0.1',
    port,
    path,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(declaredLength === undefined ? {} : { 'content-length': String(declaredLength) }),
    },
  })
  let answered = false
  const answer = new Promise<number | string>((resolve) => {
    req.on('response', (res) => {
      res.resume()
      res.on('error', () => {}) // the hangup lands here once the status is already read
      answered = true
      resolve(res.statusCode ?? 0)
    })
    // The refusal arriving as a dead socket rather than a status is still a refusal.
    req.on('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? 'error'))
  })

  if (declaredLength !== undefined) {
    req.write('{"version":"3.0"') // nowhere near what the header promised, and never will be
  } else {
    // No Content-Length at all: Node chunks it, so only the running byte count can stop us.
    // Each write is awaited so the answer can land mid-upload, which is the point.
    const megabyte = Buffer.alloc(1024 * 1024, 0x61)
    req.write('[') // valid JSON start: nothing but the size can be the reason it fails
    for (let sent = 0; sent <= MAX_MAP_BYTES && !answered; sent += megabyte.length) {
      await new Promise<void>((flushed) => req.write(megabyte, () => flushed()))
    }
    if (!answered) req.end()
  }

  const status = await answer
  req.destroy()
  return status
}

describe('the full join flow', () => {
  it('goes admin pass → campaign → map → session → code → join → socket', async () => {
    await withServer(async ({ server, base, adminPass }) => {
      const created = await api(base, 'POST', '/api/campaigns', {
        token: adminPass,
        body: { name: 'Lost Mine', dmName: 'Ann' },
      })
      expect(created.status).toBe(201)
      const campaignId = created.body.campaignId as string
      const dmToken = created.body.token as string

      const uploaded = await api(base, 'POST', `/api/campaigns/${campaignId}/maps`, {
        token: dmToken,
        raw: JSON.stringify(MAP),
      })
      expect(uploaded.status).toBe(201)
      expect(uploaded.body.name).toBe('Cragmaw Hideout')
      const mapId = uploaded.body.mapId as string

      const started = await api(base, 'POST', '/api/sessions', {
        token: dmToken,
        body: { campaignId },
      })
      expect(started.status).toBe(201)
      const inviteCode = started.body.inviteCode as string
      // Six characters, none of them the ones people mis-read aloud (D6).
      expect(inviteCode).toMatch(/^[2-9ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/)

      const resolved = await api(base, 'GET', `/api/resolve/${inviteCode}`)
      expect(resolved.status).toBe(200)
      expect(resolved.body).toEqual({ campaignId, sessionId: started.body.sessionId })

      const joined = await api(base, 'POST', '/api/join', { body: { code: inviteCode, name: 'Bob' } })
      expect(joined.status).toBe(200)
      const playerToken = joined.body.token as string

      const { socket, state } = await joinSocket(server.port, playerToken)
      expect(state.you).toMatchObject({ name: 'Bob', role: 'player', connected: true })
      expect(state.state.sessionId).toBe(started.body.sessionId)
      expect(state.state.scenes).toEqual([{ id: mapId, name: 'Cragmaw Hideout' }])
      // Nothing sets `active_scene_id` in S1, so the campaign's first map is the active
      // scene by default. It used to be null here, which meant a table that had just
      // uploaded a map still rendered "Waiting for the DM to pick a scene…" forever.
      expect(state.state.activeSceneId).toBe(mapId)

      // The snapshot only names the scene; the payload comes back over HTTP (D7).
      const fetched = await api(base, 'GET', `/api/maps/${mapId}`, { token: playerToken })
      expect(fetched.status).toBe(200)
      expect(JSON.parse(fetched.text)).toEqual(MAP)

      const ended = nextMessage(socket, 'session-ended')
      const close = await api(base, 'POST', `/api/sessions/${started.body.sessionId as string}/end`, {
        token: dmToken,
      })
      expect(close.status).toBe(200)
      await ended
      // The code dies with the session: a stale invite link 404s (§2.3).
      expect((await api(base, 'GET', `/api/resolve/${inviteCode}`)).status).toBe(404)
      socket.terminate()
    })
  })
})

describe('rejections', () => {
  it('refuses a wrong admin pass and an absent one', async () => {
    await withServer(async ({ base, adminPass }) => {
      expect((await api(base, 'POST', '/api/campaigns', { token: 'hunter2', body: {} })).status).toBe(401)
      expect((await api(base, 'POST', '/api/campaigns', { body: {} })).status).toBe(401)
      expect((await api(base, 'POST', '/api/campaigns', { token: adminPass, body: {} })).status).toBe(201)
    })
  })

  it('refuses an oversized map by declared length and by what actually arrives', async () => {
    await withServer(async ({ server, base, adminPass }) => {
      const { body } = await api(base, 'POST', '/api/campaigns', { token: adminPass, body: {} })
      const path = `/api/campaigns/${body.campaignId as string}/maps`
      const token = body.token as string

      // A Content-Length over the cap is refused before a byte is buffered — cleanly, with
      // the reason, because there is nothing in flight for the hangup to cut across.
      expect(await refusedUpload(server.port, path, token, MAX_MAP_BYTES + 1)).toBe(413)
      // A body that lies (or declares nothing) is cut off by the running byte count. The
      // server answers and closes instead of reading the rest of an upload it has already
      // refused, so a sender still pushing megabytes loses the socket mid-write — which is
      // the point: the bytes stop either way.
      expect([413, 'ECONNRESET']).toContain(await refusedUpload(server.port, path, token))

      // Nothing that big made it in.
      expect(server.stores.maps.listByCampaign(body.campaignId as string)).toEqual([])
    })
  })

  it('refuses a .mapbuilder it cannot read', async () => {
    await withServer(async ({ base, adminPass }) => {
      const { body } = await api(base, 'POST', '/api/campaigns', { token: adminPass, body: {} })
      const path = `/api/campaigns/${body.campaignId as string}/maps`
      const token = body.token as string
      const post = (raw: string) => api(base, 'POST', path, { token, raw })

      expect((await post('{not json')).status).toBe(400)
      expect((await post('[]')).status).toBe(400)
      expect((await post('"a map, honest"')).status).toBe(400)
      expect((await post(JSON.stringify({ ...MAP, version: '9.9' }))).status).toBe(400)
      expect((await post(JSON.stringify({ ...MAP, layers: 'lots' }))).status).toBe(400)
      // JSON.stringify drops the undefined, so this really is a file with no mapSettings.
      expect((await post(JSON.stringify({ ...MAP, mapSettings: undefined }))).status).toBe(400)
    })
  })

  it('refuses an unknown invite code everywhere it can be presented', async () => {
    await withServer(async ({ base }) => {
      expect((await api(base, 'GET', '/api/resolve/ZZZZZZ')).status).toBe(404)
      expect((await api(base, 'POST', '/api/join', { body: { code: 'ZZZZZZ', name: 'Bob' } })).status).toBe(404)
      expect((await api(base, 'POST', '/api/join', { body: { name: 'Bob' } })).status).toBe(400)
    })
  })

  it('refuses a token that is invalid, expired, or belongs to a banned identity', async () => {
    await withServer(async ({ server, base, adminPass }) => {
      const secret = server.config.secrets.hmacSecret
      const campaign = await api(base, 'POST', '/api/campaigns', { token: adminPass, body: {} })
      const campaignId = campaign.body.campaignId as string
      const started = await api(base, 'POST', '/api/sessions', {
        token: campaign.body.token as string,
        body: { campaignId },
      })
      const joined = await api(base, 'POST', '/api/join', {
        body: { code: started.body.inviteCode as string, name: 'Bob' },
      })
      const identityId = joined.body.identityId as string

      await expectUpgradeRejected(server.port, 'not-a-token')
      // Right shape, wrong signature: the payload is ours, the HMAC is not.
      const [payload] = (joined.body.token as string).split('.')
      await expectUpgradeRejected(server.port, `${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`)
      await expectUpgradeRejected(
        server.port,
        signToken(secret, { identityId, campaignId, role: 'player', exp: Date.now() - 1 }),
      )

      // A live token stops working the moment its identity is banned.
      const token = joined.body.token as string
      const { socket } = await joinSocket(server.port, token)
      socket.terminate()
      server.stores.identities.ban(identityId)
      await expectUpgradeRejected(server.port, token)
      expect((await api(base, 'GET', '/api/maps/anything', { token })).status).toBe(403)
    })
  })

  it('keeps one campaign out of another and players out of the DM routes', async () => {
    await withServer(async ({ base, adminPass }) => {
      const mine = await api(base, 'POST', '/api/campaigns', { token: adminPass, body: { name: 'Mine' } })
      const yours = await api(base, 'POST', '/api/campaigns', { token: adminPass, body: { name: 'Yours' } })
      const myId = mine.body.campaignId as string
      const yourToken = yours.body.token as string

      expect((await api(base, 'POST', `/api/campaigns/${myId}/maps`, { token: yourToken, raw: JSON.stringify(MAP) })).status).toBe(403)
      expect((await api(base, 'POST', '/api/sessions', { token: yourToken, body: { campaignId: myId } })).status).toBe(403)

      // A player of my campaign cannot upload to it either.
      const started = await api(base, 'POST', '/api/sessions', { token: mine.body.token as string, body: { campaignId: myId } })
      const player = await api(base, 'POST', '/api/join', { body: { code: started.body.inviteCode as string, name: 'Bob' } })
      expect((await api(base, 'POST', `/api/campaigns/${myId}/maps`, { token: player.body.token as string, raw: JSON.stringify(MAP) })).status).toBe(403)

      // And my map is not even visible to the other campaign's DM.
      const uploaded = await api(base, 'POST', `/api/campaigns/${myId}/maps`, { token: mine.body.token as string, raw: JSON.stringify(MAP) })
      expect((await api(base, 'GET', `/api/maps/${uploaded.body.mapId as string}`, { token: yourToken })).status).toBe(404)
    })
  })
})

describe('a session that has ended stays ended', () => {
  it('refuses the upgrade and the join for a session the DM closed', async () => {
    await withServer(async ({ server, base, adminPass }) => {
      const { dmToken, sessionId, playerToken } = await table(base, adminPass)

      // Upgraded while the table was open, and still sitting there having never joined.
      const idle = await openSocket(server.port, playerToken)

      expect((await api(base, 'DELETE', `/api/sessions/${sessionId}`, { token: dmToken })).status).toBe(200)

      // The socket cannot join the session back into existence...
      const ended = nextMessage(idle, 'session-ended')
      idle.send(JSON.stringify({ type: 'join', protocolVersion: 1 }))
      await ended
      await once(idle, 'close')

      // ...and the token that opened it does not open another one.
      await expectUpgradeRejected(server.port, playerToken)
    })
  })

  it('does not let a token from the last session open the next one', async () => {
    await withServer(async ({ server, base, adminPass }) => {
      const { campaignId, dmToken, inviteCode, playerToken } = await table(base, adminPass)

      // Starting a session ends the one before it and mints a fresh invite code — the
      // closest thing S1 has to rotating one.
      const next = await api(base, 'POST', '/api/sessions', { token: dmToken, body: { campaignId } })
      expect(next.status).toBe(201)
      expect(next.body.inviteCode).not.toBe(inviteCode)

      // The old code is dead, and so is every token minted under it.
      expect((await api(base, 'GET', `/api/resolve/${inviteCode}`)).status).toBe(404)
      await expectUpgradeRejected(server.port, playerToken)

      // The DM's own token is campaign-wide on purpose: they own whatever table is running.
      const { socket, state } = await joinSocket(server.port, dmToken)
      expect(state.state.sessionId).toBe(next.body.sessionId)
      socket.terminate()
    })
  })

  it('answers an unauthenticated close with 401 rather than confirming the id exists', async () => {
    await withServer(async ({ base, adminPass }) => {
      const { dmToken, sessionId } = await table(base, adminPass)

      // Both of these used to answer 404 vs 401 depending on whether the id was real.
      expect((await api(base, 'DELETE', `/api/sessions/${sessionId}`)).status).toBe(401)
      expect((await api(base, 'DELETE', '/api/sessions/not-a-session')).status).toBe(401)

      // With a real token, a session that is not yours is indistinguishable from one that
      // does not exist — and the one that is yours closes.
      expect((await api(base, 'DELETE', '/api/sessions/not-a-session', { token: dmToken })).status).toBe(404)
      expect((await api(base, 'DELETE', `/api/sessions/${sessionId}`, { token: dmToken })).status).toBe(200)
    })
  })
})

describe('banning', () => {
  it('hangs up the live socket and refuses every later one', async () => {
    await withServer(async ({ server, base, adminPass }) => {
      const { dmToken, playerId, playerToken } = await table(base, adminPass)
      const { socket } = await joinSocket(server.port, playerToken)

      const banned = await api(base, 'POST', `/api/identities/${playerId}/ban`, { token: dmToken })
      expect(banned.status).toBe(200)
      expect(banned.body).toEqual({ identityId: playerId, banned: true })

      // The socket they were already holding goes, not just the next one they open.
      await once(socket, 'close')
      await expectUpgradeRejected(server.port, playerToken)
      expect((await api(base, 'GET', '/api/maps/anything', { token: playerToken })).status).toBe(403)
    })
  })

  it('is a DM-only route, scoped to that DM’s own campaign', async () => {
    await withServer(async ({ base, adminPass }) => {
      const mine = await table(base, adminPass)
      const other = await api(base, 'POST', '/api/campaigns', { token: adminPass, body: {} })
      const otherDm = other.body.identityId as string

      const ban = (id: string, token?: string) =>
        api(base, 'POST', `/api/identities/${id}/ban`, { token })

      expect((await ban(mine.playerId)).status).toBe(401)
      // A player cannot ban, not even themselves.
      expect((await ban(mine.playerId, mine.playerToken)).status).toBe(403)
      // Another campaign's identity is none of this DM's business.
      expect((await ban(otherDm, mine.dmToken)).status).toBe(404)
      expect((await ban('no-such-identity', mine.dmToken)).status).toBe(404)
      // And a DM cannot lock themselves out of their own campaign with one typo.
      expect((await ban(otherDm, other.body.token as string)).status).toBe(400)
    })
  })
})

describe('brute force', () => {
  it('rate-limits invite-code guessing and says how long to wait', async () => {
    await withServer(async ({ base }) => {
      // Ten guesses is more than anyone types by hand in a minute; the eleventh is a script.
      for (let attempt = 0; attempt < 10; attempt++) {
        expect((await api(base, 'GET', '/api/resolve/ZZZZZZ')).status).toBe(404)
      }
      const res = await fetch(`${base}/api/resolve/ZZZZZZ`)
      expect(res.status).toBe(429)
      expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
      await res.text()

      // The budget is per address, not per route: /api/join is the other way in.
      expect((await api(base, 'POST', '/api/join', { body: { code: 'ZZZZZZ', name: 'Bob' } })).status).toBe(429)
    })
  })

  it('closes a socket that sends a frame larger than the protocol needs', async () => {
    await withServer(async ({ server, base, adminPass }) => {
      const { playerToken } = await table(base, adminPass)
      const socket = await openSocket(server.port, playerToken)

      // Well under `ws`'s 100MiB default, well over anything a ClientMessage can be.
      socket.send(JSON.stringify({ type: 'ping', t: 1, pad: 'a'.repeat(512 * 1024) }))

      const [code] = (await once(socket, 'close')) as [number]
      expect(code).toBe(1009) // "message too big"
    })
  })
})
