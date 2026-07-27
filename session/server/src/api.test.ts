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
import { MAX_ASSET_BYTES, MAX_MAP_BYTES } from './db/stores'
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
  /** Raw bytes — how an image goes up (D11). */
  bytes?: Buffer
}

async function api(
  base: string,
  method: string,
  path: string,
  { token, body, raw, bytes }: Sent = {},
): Promise<{ status: number; body: Record<string, unknown>; text: string }> {
  const payload = bytes ?? raw ?? (body === undefined ? undefined : JSON.stringify(body))
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
  socket.send(JSON.stringify({ type: 'join', protocolVersion: 2 }))
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

/**
 * A POST whose body the server is meant to refuse mid-flight. `declaredLength` set = the
 * Content-Length lie (the header claims more than the cap, the body never delivers);
 * unset = a chunked upload that really does overrun. Resolves with the status the server
 * answers *while the request is still being written*, which is the whole point.
 */
async function refusedUpload(
  port: number,
  path: string,
  token: string,
  declaredLength?: number,
): Promise<number> {
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
  const answer = new Promise<number>((resolve, reject) => {
    req.on('response', (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('error', reject) // ignored once resolved — a settled promise cannot change
  })

  if (declaredLength !== undefined) {
    req.write('{"version":"3.0"') // nowhere near what the header promised, and never will be
  } else {
    // No Content-Length at all: Node chunks it, so only the running byte count can stop us.
    // Each write is awaited so the answer can land mid-upload, which is the point.
    const megabyte = Buffer.alloc(1024 * 1024, 0x61)
    req.write('[') // valid JSON start: nothing but the size can be the reason it fails
    for (let sent = 0; sent <= MAX_MAP_BYTES; sent += megabyte.length) {
      await new Promise<void>((flushed) => req.write(megabyte, () => flushed()))
    }
    req.end()
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

/** Just enough of each format for the magic-byte sniff to have something to read. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('pixels')])
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('pixels')])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPpixels')])

/** A campaign with a live session, its DM token and a player's. */
async function seatedTable(base: string, adminPass: string) {
  const campaign = await api(base, 'POST', '/api/campaigns', { token: adminPass, body: {} })
  const dmToken = campaign.body.token as string
  const campaignId = campaign.body.campaignId as string
  const started = await api(base, 'POST', '/api/sessions', { token: dmToken, body: { campaignId } })
  const joined = await api(base, 'POST', '/api/join', {
    body: { code: started.body.inviteCode as string, name: 'Bob' },
  })
  return { campaignId, dmToken, playerToken: joined.body.token as string }
}

describe('assets (D11)', () => {
  it('takes png/jpeg/webp from the DM and serves them back to the table, cached forever', async () => {
    await withServer(async ({ base, adminPass }) => {
      const { campaignId, dmToken, playerToken } = await seatedTable(base, adminPass)

      for (const [bytes, mime] of [[PNG, 'image/png'], [JPEG, 'image/jpeg'], [WEBP, 'image/webp']] as const) {
        const up = await api(base, 'POST', `/api/campaigns/${campaignId}/assets`, { token: dmToken, bytes })
        expect(up.status).toBe(201)
        const id = up.body.id as string
        expect(id).toBeTruthy()

        // Any seat at the table may read it — the portrait is on a token everyone can see.
        const down = await fetch(`${base}/api/assets/${id}`, {
          headers: { authorization: `Bearer ${playerToken}` },
        })
        expect(down.status).toBe(200)
        // The mime is what the bytes are, not what the uploader's header claimed.
        expect(down.headers.get('content-type')).toBe(mime)
        expect(down.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
        expect(Buffer.from(await down.arrayBuffer()).equals(bytes)).toBe(true)
      }
    })
  })

  it('refuses non-images, oversized uploads, players and outsiders', async () => {
    await withServer(async ({ base, adminPass }) => {
      const { campaignId, dmToken, playerToken } = await seatedTable(base, adminPass)
      const post = (bytes: Buffer, token = dmToken) =>
        api(base, 'POST', `/api/campaigns/${campaignId}/assets`, { token, bytes })

      // A GIF, an SVG and a PNG header one byte short are all "not an image we take".
      expect((await post(Buffer.from('GIF89a...'))).status).toBe(400)
      expect((await post(Buffer.from('<svg onload="alert(1)"/>'))).status).toBe(400)
      expect((await post(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x00]))).status).toBe(400)
      expect((await post(Buffer.alloc(0))).status).toBe(400)

      // Over the 2MB cap, refused on the declared length before a byte is buffered.
      expect((await post(Buffer.concat([PNG, Buffer.alloc(MAX_ASSET_BYTES)]))).status).toBe(413)

      // Uploading is a DM thing; a player with a valid seat still cannot.
      expect((await post(PNG, playerToken)).status).toBe(403)

      const stored = (await post(PNG)).body.id as string
      // ...and reading needs a token for *this* campaign.
      expect((await api(base, 'GET', `/api/assets/${stored}`)).status).toBe(401)
      const outsider = await seatedTable(base, adminPass)
      expect((await api(base, 'GET', `/api/assets/${stored}`, { token: outsider.dmToken })).status).toBe(404)
      expect((await api(base, 'GET', '/api/assets/no-such-asset', { token: playerToken })).status).toBe(404)
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

      // A Content-Length over the cap is refused before a byte is buffered...
      expect(await refusedUpload(server.port, path, token, MAX_MAP_BYTES + 1)).toBe(413)
      // ...and a body that lies (or declares nothing) is cut off by the running count.
      expect(await refusedUpload(server.port, path, token)).toBe(413)

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

  it('refuses a join with no usable name before it mints an identity (§2.3.7)', async () => {
    await withServer(async ({ server, base, adminPass }) => {
      const campaign = await api(base, 'POST', '/api/campaigns', { token: adminPass, body: {} })
      const campaignId = campaign.body.campaignId as string
      const started = await api(base, 'POST', '/api/sessions', {
        token: campaign.body.token as string,
        body: { campaignId },
      })
      const code = started.body.inviteCode as string
      const join = (name: unknown) => api(base, 'POST', '/api/join', { body: { code, name } })

      // Whitespace is not a name — this is the ghost "Someone" from the S1 gate.
      for (const name of ['', '   ', '\t\n', 42, null, undefined]) {
        const refused = await join(name)
        expect(refused.status).toBe(400)
        expect(refused.body.error).toBe('name-required')
      }
      // A real name still works, and arrives trimmed.
      const ok = await join('  Borin  ')
      expect(ok.status).toBe(200)
      expect(server.stores.identities.get(ok.body.identityId as string)?.name).toBe('Borin')
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
