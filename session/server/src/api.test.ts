// The whole join flow over a real HTTP server, a real WebSocket and a real SQLite
// database on an ephemeral port — no mocks (D10). If a step here passes, a client can
// do it too, because there is nothing standing in for anything.

import { once } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
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
  socket.send(JSON.stringify({ type: 'join', protocolVersion: 4 }))
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
    // Each write is raced against the answer: a small cap (assets) pauses the server's
    // reading long before we finish, and a write stuck against buffers nobody will ever
    // drain would otherwise await a flush that never comes.
    const megabyte = Buffer.alloc(1024 * 1024, 0x61)
    req.write('[') // valid JSON start: nothing but the size can be the reason it fails
    for (let sent = 0; sent <= MAX_MAP_BYTES && !answered; sent += megabyte.length) {
      await Promise.race([
        answer,
        new Promise<void>((flushed) => req.write(megabyte, () => flushed())),
      ])
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
      const sceneId = uploaded.body.sceneId as string
      expect(sceneId).toBe(mapId) // upload doubles as first publish (#47) — same id

      // #47 D5 — hidden from players by default; the DM opts a scene into their list.
      const shown = await api(base, 'PATCH', `/api/scenes/${sceneId}`, {
        token: dmToken,
        body: { visibleToPlayers: true },
      })
      expect(shown.status).toBe(200)

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
      expect(state.state.scenes).toEqual([{ id: mapId, name: 'Cragmaw Hideout', mapId }])
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

/**
 * §2.6 — the DM's starting room. Nothing here is a new fog concept: the assertions are all
 * about the *stored* fog, because that is the one source of truth the DM's panel, the map
 * redaction and every join already read. If the reveal is in there, none of them had to be
 * taught anything.
 */
describe('the starting room the DM picks while setting up', () => {
  /** `MAP` with somewhere to stand: rooms are read straight off the dungeon layer. */
  const ROOMED = {
    ...MAP,
    layers: [
      {
        ...MAP.layers[0],
        rooms: [
          { id: 'r-hall', name: 'Great Hall', boundary: [], centroid: [0, 0], area: 100, isPathway: false },
          { id: 'r-cell', name: 'Cell', boundary: [], centroid: [9, 9], area: 10, isPathway: false },
        ],
      },
    ],
  }

  /** Campaign + the roomed map, stopping short of the session the tests open themselves. */
  async function readyToOpen(base: string, adminPass: string) {
    const campaign = await api(base, 'POST', '/api/campaigns', { token: adminPass, body: {} })
    const campaignId = campaign.body.campaignId as string
    const dmToken = campaign.body.token as string
    const uploaded = await api(base, 'POST', `/api/campaigns/${campaignId}/maps`, {
      token: dmToken,
      raw: JSON.stringify(ROOMED),
    })
    // A scene id is a map id — which is why the client can name the scene from the upload.
    return { campaignId, dmToken, mapId: uploaded.body.mapId as string }
  }

  it('stores it as a plain reveal, and hands it to the first player who joins', async () => {
    await withServer(async ({ server, base, adminPass }) => {
      const { campaignId, dmToken, mapId } = await readyToOpen(base, adminPass)

      const started = await api(base, 'POST', '/api/sessions', {
        token: dmToken,
        body: { campaignId, startingRoom: { sceneId: mapId, roomId: 'r-hall' } },
      })
      expect(started.status).toBe(201)

      // Byte-for-byte what a DM clicking the room in the fog panel would have written, which
      // is what lets the panel render it as Revealed with no idea where it came from.
      expect(server.stores.moduleState.get(campaignId, 'fog')).toEqual({
        byScene: {
          [mapId]: {
            rooms: { 'r-hall': { status: 'revealed', wasEverRevealed: true } },
            concealBehindDoors: true,
          },
        },
      })

      // …and the player is told about that room and no other: redaction did its usual job on
      // state it was never told was special. The cell is absent whole, not marked hidden.
      const joined = await api(base, 'POST', '/api/join', {
        body: { code: started.body.inviteCode as string, name: 'Bob' },
      })
      const { socket, state } = await joinSocket(server.port, joined.body.token as string)
      expect(state.state.modules.fog).toEqual({
        byScene: {
          [mapId]: {
            rooms: { 'r-hall': { status: 'revealed', wasEverRevealed: true } },
            concealBehindDoors: true,
          },
        },
      })
      socket.terminate()
    })
  })

  it('writes no fog at all when the DM skips it', async () => {
    await withServer(async ({ server, base, adminPass }) => {
      const { campaignId, dmToken } = await readyToOpen(base, adminPass)

      const started = await api(base, 'POST', '/api/sessions', { token: dmToken, body: { campaignId } })
      expect(started.status).toBe(201)
      // Not "an empty scene" — nothing was written, so the table is the black one a fresh
      // session has always been.
      expect(server.stores.moduleState.get(campaignId, 'fog')).toBeUndefined()
    })
  })

  it('refuses a room the scene does not have, before the table is opened', async () => {
    await withServer(async ({ server, base, adminPass }) => {
      const { campaignId, dmToken, mapId } = await readyToOpen(base, adminPass)

      const bad = await api(base, 'POST', '/api/sessions', {
        token: dmToken,
        body: { campaignId, startingRoom: { sceneId: mapId, roomId: 'r-nowhere' } },
      })
      expect(bad.status).toBe(400)
      expect(bad.body.error).toContain('r-nowhere')

      const half = await api(base, 'POST', '/api/sessions', {
        token: dmToken,
        body: { campaignId, startingRoom: { sceneId: mapId } },
      })
      expect(half.status).toBe(400)

      // The refusal cost nothing: no session was started and no fog was written, so the DM
      // can pick again rather than hunt for a table whose invite code went out in an error.
      expect(server.stores.sessions.getActiveByCampaign(campaignId)).toBeUndefined()
      expect(server.stores.moduleState.get(campaignId, 'fog')).toBeUndefined()
    })
  })

  /**
   * The gate walk's failure, which every test above missed by uploading exactly one map: with
   * a second map in the campaign the reveal landed on the map the wizard had just uploaded
   * while the table opened on the campaign's *other* one. Both halves answered 201 and the
   * fog was written correctly — it was simply written about a scene nobody was looking at, so
   * the DM's panel called the room Unrevealed and the player joined to full black.
   */
  it('opens the table on the scene it revealed, not on an older map in the campaign', async () => {
    await withServer(async ({ server, base, adminPass }) => {
      const campaign = await api(base, 'POST', '/api/campaigns', { token: adminPass, body: {} })
      const campaignId = campaign.body.campaignId as string
      const dmToken = campaign.body.token as string

      const older = await api(base, 'POST', `/api/campaigns/${campaignId}/maps`, {
        token: dmToken,
        raw: JSON.stringify(ROOMED),
      })
      const picked = await api(base, 'POST', `/api/campaigns/${campaignId}/maps`, {
        token: dmToken,
        raw: JSON.stringify(ROOMED),
      })
      const olderId = older.body.mapId as string
      const pickedId = picked.body.mapId as string
      expect(olderId).not.toBe(pickedId)

      const started = await api(base, 'POST', '/api/sessions', {
        token: dmToken,
        body: { campaignId, startingRoom: { sceneId: pickedId, roomId: 'r-hall' } },
      })
      expect(started.status).toBe(201)

      const joined = await api(base, 'POST', '/api/join', {
        body: { code: started.body.inviteCode as string, name: 'Bob' },
      })
      const { socket, state } = await joinSocket(server.port, joined.body.token as string)

      // The one assertion that would have caught it: the scene the player is looking at is
      // the scene the reveal is stored under, so the fog they were handed is about their map.
      expect(state.state.activeSceneId).toBe(pickedId)
      expect(state.state.modules.fog).toEqual({
        byScene: {
          [pickedId]: {
            rooms: { 'r-hall': { status: 'revealed', wasEverRevealed: true } },
            concealBehindDoors: true,
          },
        },
      })
      socket.terminate()
    })
  })

  /**
   * …and with no room picked either, because the scene is the wizard's to name: the map
   * order cannot answer it. Not a guess at "the newest map" — an in-session import must
   * leave the table on the scene being played (D6).
   */
  it('opens on the scene the wizard names, with no starting room at all', async () => {
    await withServer(async ({ server, base, adminPass }) => {
      const campaign = await api(base, 'POST', '/api/campaigns', { token: adminPass, body: {} })
      const campaignId = campaign.body.campaignId as string
      const dmToken = campaign.body.token as string

      await api(base, 'POST', `/api/campaigns/${campaignId}/maps`, { token: dmToken, raw: JSON.stringify(ROOMED) })
      const newest = await api(base, 'POST', `/api/campaigns/${campaignId}/maps`, {
        token: dmToken,
        raw: JSON.stringify(ROOMED),
      })

      const started = await api(base, 'POST', '/api/sessions', {
        token: dmToken,
        body: { campaignId, sceneId: newest.body.mapId },
      })
      const joined = await api(base, 'POST', '/api/join', {
        body: { code: started.body.inviteCode as string, name: 'Bob' },
      })
      const { socket, state } = await joinSocket(server.port, joined.body.token as string)
      expect(state.state.activeSceneId).toBe(newest.body.mapId as string)
      socket.terminate()
    })
  })

  it('refuses a scene belonging to somebody else’s campaign', async () => {
    await withServer(async ({ server, base, adminPass }) => {
      const { campaignId, dmToken } = await readyToOpen(base, adminPass)
      const bad = await api(base, 'POST', '/api/sessions', {
        token: dmToken,
        body: { campaignId, sceneId: 'not-a-map-here' },
      })
      expect(bad.status).toBe(400)
      expect(server.stores.sessions.getActiveByCampaign(campaignId)).toBeUndefined()
    })
  })

  /** An in-session import leaves the table where it is — the DM switches scenes on purpose. */
  it('does not move the table onto a map uploaded after it opened', async () => {
    await withServer(async ({ server, base, adminPass }) => {
      const { campaignId, dmToken, mapId } = await readyToOpen(base, adminPass)
      const started = await api(base, 'POST', '/api/sessions', {
        token: dmToken,
        body: { campaignId, sceneId: mapId },
      })
      await api(base, 'POST', `/api/campaigns/${campaignId}/maps`, { token: dmToken, raw: JSON.stringify(ROOMED) })

      const joined = await api(base, 'POST', '/api/join', {
        body: { code: started.body.inviteCode as string, name: 'Bob' },
      })
      const { socket, state } = await joinSocket(server.port, joined.body.token as string)
      expect(state.state.activeSceneId).toBe(mapId)
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

describe('scenes (#47)', () => {
  it('publishes a scene on upload, lists it for the DM, and keeps it off the player’s list', async () => {
    await withServer(async ({ base, adminPass }) => {
      const campaign = await api(base, 'POST', '/api/campaigns', { token: adminPass, body: {} })
      const campaignId = campaign.body.campaignId as string
      const dmToken = campaign.body.token as string

      const uploaded = await api(base, 'POST', `/api/campaigns/${campaignId}/maps`, {
        token: dmToken,
        raw: JSON.stringify(MAP),
      })
      const sceneId = uploaded.body.sceneId as string
      // Upload doubles as first publish (D1) — same id, not a second thing to track.
      expect(sceneId).toBe(uploaded.body.mapId)

      const list = await api(base, 'GET', `/api/campaigns/${campaignId}/scenes`, { token: dmToken })
      expect(list.status).toBe(200)
      expect(list.body.scenes).toEqual([
        {
          id: sceneId,
          name: 'Cragmaw Hideout',
          sortIndex: 0,
          visibleToPlayers: false, // D5 — hidden until the DM opts in
          mapId: uploaded.body.mapId,
          updatedAt: expect.any(Number),
        },
      ])

      // The DM's own library, not a player's to browse.
      const { playerToken } = await seatedTable(base, adminPass)
      expect(
        (await api(base, 'GET', `/api/campaigns/${campaignId}/scenes`, { token: playerToken })).status,
      ).toBe(403)
    })
  })

  it('renames and toggles visibility, refusing a blank name and a scene from someone else’s campaign', async () => {
    await withServer(async ({ base, adminPass }) => {
      const campaign = await api(base, 'POST', '/api/campaigns', { token: adminPass, body: {} })
      const campaignId = campaign.body.campaignId as string
      const dmToken = campaign.body.token as string
      const uploaded = await api(base, 'POST', `/api/campaigns/${campaignId}/maps`, {
        token: dmToken,
        raw: JSON.stringify(MAP),
      })
      const sceneId = uploaded.body.sceneId as string

      const patch = (body: unknown, token = dmToken) =>
        api(base, 'PATCH', `/api/scenes/${sceneId}`, { token, body })

      const renamed = await patch({ name: 'The Hideout' })
      expect(renamed.status).toBe(200)
      expect(renamed.body).toEqual({ id: sceneId, name: 'The Hideout', visibleToPlayers: false })

      const shown = await patch({ visibleToPlayers: true })
      expect(shown.body.visibleToPlayers).toBe(true)

      expect((await patch({})).status).toBe(400) // neither field
      expect((await patch({ name: '   ' })).status).toBe(400) // blank
      expect((await patch({ visibleToPlayers: 'yes' })).status).toBe(400) // not a boolean

      // Someone else's campaign gets 404, same as a scene that never existed (no oracle).
      const other = await api(base, 'POST', '/api/campaigns', { token: adminPass, body: {} })
      const foreignToken = other.body.token as string
      expect((await patch({ name: 'Stolen' }, foreignToken)).status).toBe(404)
      expect((await api(base, 'PATCH', '/api/scenes/no-such-scene', { token: dmToken, body: { name: 'x' } })).status).toBe(404)

      // A player, even one seated at the right table, cannot edit the library.
      const started = await api(base, 'POST', '/api/sessions', { token: dmToken, body: { campaignId } })
      const joined = await api(base, 'POST', '/api/join', {
        body: { code: started.body.inviteCode as string, name: 'Bob' },
      })
      expect((await patch({ name: 'Mine now' }, joined.body.token as string)).status).toBe(403)
    })
  })

  it('reorders the flat list, refusing a partial, duplicate or foreign order (D4)', async () => {
    await withServer(async ({ base, adminPass }) => {
      const campaign = await api(base, 'POST', '/api/campaigns', { token: adminPass, body: {} })
      const campaignId = campaign.body.campaignId as string
      const dmToken = campaign.body.token as string
      const a = await api(base, 'POST', `/api/campaigns/${campaignId}/maps`, { token: dmToken, raw: JSON.stringify(MAP) })
      const b = await api(base, 'POST', `/api/campaigns/${campaignId}/maps`, { token: dmToken, raw: JSON.stringify(MAP) })
      const [sceneA, sceneB] = [a.body.sceneId as string, b.body.sceneId as string]

      const reorder = (order: unknown) =>
        api(base, 'PUT', `/api/campaigns/${campaignId}/scenes/order`, { token: dmToken, body: { order } })

      expect((await reorder('not-an-array')).status).toBe(400)
      expect((await reorder([sceneA])).status).toBe(400) // partial — missing sceneB
      expect((await reorder([sceneA, sceneA])).status).toBe(400) // duplicate
      expect((await reorder([sceneA, 'not-a-scene-here'])).status).toBe(400) // foreign/unknown

      const ok = await reorder([sceneB, sceneA])
      expect(ok.status).toBe(200)
      const list = await api(base, 'GET', `/api/campaigns/${campaignId}/scenes`, { token: dmToken })
      expect((list.body.scenes as { id: string }[]).map((s) => s.id)).toEqual([sceneB, sceneA])
    })
  })

  it('deletes a scene, clearing it from any session that had it active', async () => {
    await withServer(async ({ server, base, adminPass }) => {
      const campaign = await api(base, 'POST', '/api/campaigns', { token: adminPass, body: {} })
      const campaignId = campaign.body.campaignId as string
      const dmToken = campaign.body.token as string
      const uploaded = await api(base, 'POST', `/api/campaigns/${campaignId}/maps`, {
        token: dmToken,
        raw: JSON.stringify(MAP),
      })
      const sceneId = uploaded.body.sceneId as string

      const started = await api(base, 'POST', '/api/sessions', {
        token: dmToken,
        body: { campaignId, sceneId },
      })
      const sessionId = started.body.sessionId as string
      expect(server.stores.sessions.get(sessionId)?.active_scene_id).toBe(sceneId)

      const deleted = await api(base, 'DELETE', `/api/scenes/${sceneId}`, { token: dmToken })
      expect(deleted.status).toBe(200)
      expect(server.stores.scenes.get(sceneId)).toBeUndefined()
      // The session that had it active is not left pointing at a ghost.
      expect(server.stores.sessions.get(sessionId)?.active_scene_id).toBeNull()

      expect((await api(base, 'DELETE', `/api/scenes/${sceneId}`, { token: dmToken })).status).toBe(404)
    })
  })

  /**
   * The whole point of #47 D1: re-publishing a scene from a fresh file must not orphan
   * whatever fog and tokens already remember about it. The scene's own id is what those
   * are keyed on, and re-publish is the one write that must never move it.
   */
  it('re-publishes a scene in place, preserving its id and the fog/token state keyed on it', async () => {
    await withServer(async ({ server, base, adminPass }) => {
      const campaign = await api(base, 'POST', '/api/campaigns', { token: adminPass, body: {} })
      const campaignId = campaign.body.campaignId as string
      const dmToken = campaign.body.token as string

      const first = await api(base, 'POST', `/api/campaigns/${campaignId}/maps`, {
        token: dmToken,
        raw: JSON.stringify(MAP),
      })
      const sceneId = first.body.sceneId as string
      const originalMapId = first.body.mapId as string

      // A table mid-session: fog revealed and a token placed, both keyed on `sceneId`.
      server.stores.moduleState.put(campaignId, 'fog', {
        byScene: { [sceneId]: { rooms: { hall: { status: 'revealed', wasEverRevealed: true } }, concealBehindDoors: true } },
      })
      server.stores.moduleState.put(campaignId, 'tokens', {
        library: {},
        byScene: { [sceneId]: { t1: { id: 't1', x: 1, y: 1, ownerId: null, hidden: false } } },
      })

      const RENAMED = { ...MAP, mapSettings: { ...MAP.mapSettings, name: 'Cragmaw Hideout (redrawn)' } }
      const republished = await api(base, 'PUT', `/api/scenes/${sceneId}/publish`, {
        token: dmToken,
        raw: JSON.stringify(RENAMED),
      })
      expect(republished.status).toBe(200)
      expect(republished.body.sceneId).toBe(sceneId) // never moves
      expect(republished.body.name).toBe('Cragmaw Hideout (redrawn)')
      const newMapId = republished.body.mapId as string
      expect(newMapId).not.toBe(originalMapId) // a fresh, immutable map row underneath

      // The scene row now points at the new map, same id as always.
      const scene = server.stores.scenes.get(sceneId)!
      expect(scene.id).toBe(sceneId)
      expect(scene.map_id).toBe(newMapId)

      // The map GET (keyed by scene id, D1) answers with the *new* content — not the cache
      // of whatever the scene used to point at.
      const fetched = await api(base, 'GET', `/api/maps/${sceneId}`, { token: dmToken })
      expect(fetched.status).toBe(200)
      expect((JSON.parse(fetched.text).mapSettings as { name: string }).name).toBe('Cragmaw Hideout (redrawn)')

      // …and nothing tied to the scene moved: same key, same fog, same token.
      expect(server.stores.moduleState.get(campaignId, 'fog')).toEqual({
        byScene: { [sceneId]: { rooms: { hall: { status: 'revealed', wasEverRevealed: true } }, concealBehindDoors: true } },
      })
      expect(server.stores.moduleState.get(campaignId, 'tokens')).toEqual({
        library: {},
        byScene: { [sceneId]: { t1: { id: 't1', x: 1, y: 1, ownerId: null, hidden: false } } },
      })

      // A player's own view of the map is redacted fresh off the *new* file too.
      const started = await api(base, 'POST', '/api/sessions', { token: dmToken, body: { campaignId, sceneId } })
      const joined = await api(base, 'POST', '/api/join', {
        body: { code: started.body.inviteCode as string, name: 'Bob' },
      })
      const playerMap = await api(base, 'GET', `/api/maps/${sceneId}`, { token: joined.body.token as string })
      expect(playerMap.status).toBe(200)

      // Republishing is a DM act, campaign-scoped like the others.
      const outsider = await api(base, 'POST', '/api/campaigns', { token: adminPass, body: {} })
      expect(
        (
          await api(base, 'PUT', `/api/scenes/${sceneId}/publish`, {
            token: outsider.body.token as string,
            raw: JSON.stringify(MAP),
          })
        ).status,
      ).toBe(404)
      expect((await api(base, 'PUT', '/api/scenes/no-such-scene/publish', { token: dmToken, raw: JSON.stringify(MAP) })).status).toBe(404)
    })
  })

  it('lists every campaign for the admin pass, and refuses anyone else', async () => {
    await withServer(async ({ base, adminPass }) => {
      const mine = await api(base, 'POST', '/api/campaigns', { token: adminPass, body: { name: 'Lost Mine' } })
      const other = await api(base, 'POST', '/api/campaigns', { token: adminPass, body: { name: 'Wave Echo' } })

      const list = await api(base, 'GET', '/api/campaigns', { token: adminPass })
      expect(list.status).toBe(200)
      const ids = (list.body.campaigns as { id: string }[]).map((c) => c.id)
      expect(ids).toContain(mine.body.campaignId)
      expect(ids).toContain(other.body.campaignId)

      // A DM token is scoped to its one campaign, not a login — it does not get to list.
      expect((await api(base, 'GET', '/api/campaigns', { token: mine.body.token as string })).status).toBe(401)
      expect((await api(base, 'GET', '/api/campaigns')).status).toBe(401)
      expect((await api(base, 'GET', '/api/campaigns', { token: 'hunter2' })).status).toBe(401)
    })
  })

  it('shows a player only what the DM has made visible, but still loads the active scene either way (D5)', async () => {
    await withServer(async ({ server, base, adminPass }) => {
      const campaign = await api(base, 'POST', '/api/campaigns', { token: adminPass, body: {} })
      const campaignId = campaign.body.campaignId as string
      const dmToken = campaign.body.token as string

      const shown = await api(base, 'POST', `/api/campaigns/${campaignId}/maps`, { token: dmToken, raw: JSON.stringify(MAP) })
      const hidden = await api(base, 'POST', `/api/campaigns/${campaignId}/maps`, { token: dmToken, raw: JSON.stringify(MAP) })
      const shownId = shown.body.sceneId as string
      const hiddenId = hidden.body.sceneId as string
      await api(base, 'PATCH', `/api/scenes/${shownId}`, { token: dmToken, body: { visibleToPlayers: true } })
      // hiddenId stays at the D5 default (false) — never opted in.

      // The DM opens the table on the *hidden* scene — the flag gates the browsing list,
      // never the table's own currently-active content (fog/door redaction do that job).
      const started = await api(base, 'POST', '/api/sessions', { token: dmToken, body: { campaignId, sceneId: hiddenId } })
      const joined = await api(base, 'POST', '/api/join', {
        body: { code: started.body.inviteCode as string, name: 'Bob' },
      })
      const { socket, state } = await joinSocket(server.port, joined.body.token as string)
      expect(state.state.activeSceneId).toBe(hiddenId) // still loads
      expect(state.state.scenes).toEqual([{ id: shownId, name: 'Cragmaw Hideout', mapId: shownId }]) // hiddenId absent
      socket.terminate()
    })
  })
})

describe('dm-token (M3)', () => {
  it('mints a fresh DM token for an existing campaign, admin-pass gated', async () => {
    await withServer(async ({ base, adminPass }) => {
      const campaign = await api(base, 'POST', '/api/campaigns', {
        token: adminPass,
        body: { name: 'Lost Mine' },
      })
      const campaignId = campaign.body.campaignId as string

      expect(
        (await api(base, 'POST', `/api/campaigns/${campaignId}/dm-token`, { token: 'hunter2' })).status,
      ).toBe(401)
      expect((await api(base, 'POST', `/api/campaigns/${campaignId}/dm-token`)).status).toBe(401)
      expect(
        (await api(base, 'POST', '/api/campaigns/no-such-campaign/dm-token', { token: adminPass })).status,
      ).toBe(404)

      const minted = await api(base, 'POST', `/api/campaigns/${campaignId}/dm-token`, { token: adminPass })
      expect(minted.status).toBe(200)
      expect(minted.body).toEqual({ token: expect.any(String), campaignId, name: 'Lost Mine' })

      // Authorizes exactly like any other DM token, though it names a fresh identity.
      const list = await api(base, 'GET', `/api/campaigns/${campaignId}/scenes`, {
        token: minted.body.token as string,
      })
      expect(list.status).toBe(200)
    })
  })

  it('reuses the campaign’s existing DM identity instead of minting a fresh one each call (N10)', async () => {
    await withServer(async ({ server, base, adminPass }) => {
      const campaign = await api(base, 'POST', '/api/campaigns', {
        token: adminPass,
        body: { name: 'Lost Mine' },
      })
      const campaignId = campaign.body.campaignId as string

      // `createCampaign` already minted one DM identity; two more mints must not add to it.
      const before = server.stores.identities.listByCampaign(campaignId).length
      expect((await api(base, 'POST', `/api/campaigns/${campaignId}/dm-token`, { token: adminPass })).status).toBe(200)
      expect((await api(base, 'POST', `/api/campaigns/${campaignId}/dm-token`, { token: adminPass })).status).toBe(200)
      expect(server.stores.identities.listByCampaign(campaignId).length).toBe(before)
    })
  })
})

describe('scene prep (M3)', () => {
  const PREP = {
    version: 1,
    triggers: [
      {
        id: 't1',
        name: 'Trap',
        when: { kind: 'enter-region', zoneId: 'z1' },
        actions: [],
        once: true,
        enabled: true,
      },
    ],
  }
  const EMPTY_PREP = { version: 1, triggers: [] }

  it('extracts prep on upload, and leaves it null when the file carries none', async () => {
    await withServer(async ({ base, adminPass }) => {
      const campaign = await api(base, 'POST', '/api/campaigns', { token: adminPass, body: {} })
      const campaignId = campaign.body.campaignId as string
      const dmToken = campaign.body.token as string

      const withPrep = await api(base, 'POST', `/api/campaigns/${campaignId}/maps`, {
        token: dmToken,
        raw: JSON.stringify({ ...MAP, prep: PREP }),
      })
      const sceneWithPrep = withPrep.body.sceneId as string
      expect(
        (await api(base, 'GET', `/api/scenes/${sceneWithPrep}/prep`, { token: dmToken })).body,
      ).toEqual({ prep: PREP })

      const withoutPrep = await api(base, 'POST', `/api/campaigns/${campaignId}/maps`, {
        token: dmToken,
        raw: JSON.stringify(MAP),
      })
      const sceneWithoutPrep = withoutPrep.body.sceneId as string
      expect(
        (await api(base, 'GET', `/api/scenes/${sceneWithoutPrep}/prep`, { token: dmToken })).body,
      ).toEqual({ prep: null })
    })
  })

  it('keeps stored prep on a prep-less republish, overwrites on an explicit one, and clears on an explicit empty one', async () => {
    await withServer(async ({ base, adminPass }) => {
      const campaign = await api(base, 'POST', '/api/campaigns', { token: adminPass, body: {} })
      const campaignId = campaign.body.campaignId as string
      const dmToken = campaign.body.token as string
      const uploaded = await api(base, 'POST', `/api/campaigns/${campaignId}/maps`, {
        token: dmToken,
        raw: JSON.stringify({ ...MAP, prep: PREP }),
      })
      const sceneId = uploaded.body.sceneId as string
      const getPrep = async () =>
        (await api(base, 'GET', `/api/scenes/${sceneId}/prep`, { token: dmToken })).body

      // No `prep` key at all — the DM never opened prep in this save, so it survives.
      await api(base, 'PUT', `/api/scenes/${sceneId}/publish`, { token: dmToken, raw: JSON.stringify(MAP) })
      expect(await getPrep()).toEqual({ prep: PREP })

      // An explicit prep overwrites whatever was there.
      const OTHER_PREP = { version: 1, triggers: [{ ...PREP.triggers[0], id: 't2' }] }
      await api(base, 'PUT', `/api/scenes/${sceneId}/publish`, {
        token: dmToken,
        raw: JSON.stringify({ ...MAP, prep: OTHER_PREP }),
      })
      expect(await getPrep()).toEqual({ prep: OTHER_PREP })

      // An explicit *empty* prep still overwrites — distinct from "never touched".
      await api(base, 'PUT', `/api/scenes/${sceneId}/publish`, {
        token: dmToken,
        raw: JSON.stringify({ ...MAP, prep: EMPTY_PREP }),
      })
      expect(await getPrep()).toEqual({ prep: EMPTY_PREP })
    })
  })

  it('round-trips PUT/GET, refuses players and outsiders, and refuses an invalid body', async () => {
    await withServer(async ({ base, adminPass }) => {
      const campaign = await api(base, 'POST', '/api/campaigns', { token: adminPass, body: {} })
      const campaignId = campaign.body.campaignId as string
      const dmToken = campaign.body.token as string
      const uploaded = await api(base, 'POST', `/api/campaigns/${campaignId}/maps`, {
        token: dmToken,
        raw: JSON.stringify(MAP),
      })
      const sceneId = uploaded.body.sceneId as string
      const originalMapId = uploaded.body.mapId as string

      const put = await api(base, 'PUT', `/api/scenes/${sceneId}/prep`, { token: dmToken, body: PREP })
      expect(put.status).toBe(200)
      expect(put.body).toEqual({ prep: PREP })
      expect(
        (await api(base, 'GET', `/api/scenes/${sceneId}/prep`, { token: dmToken })).body,
      ).toEqual({ prep: PREP })

      // A prep edit never touches the scene's map — it is not a republish in disguise.
      const scenes = await api(base, 'GET', `/api/campaigns/${campaignId}/scenes`, { token: dmToken })
      expect((scenes.body.scenes as { id: string; mapId: string }[])[0].mapId).toBe(originalMapId)

      // A player seated at this table, and no token at all, can neither read nor write it.
      const started = await api(base, 'POST', '/api/sessions', { token: dmToken, body: { campaignId } })
      const joined = await api(base, 'POST', '/api/join', {
        body: { code: started.body.inviteCode as string, name: 'Bob' },
      })
      const playerToken = joined.body.token as string
      expect((await api(base, 'GET', `/api/scenes/${sceneId}/prep`, { token: playerToken })).status).toBe(403)
      expect(
        (await api(base, 'PUT', `/api/scenes/${sceneId}/prep`, { token: playerToken, body: PREP })).status,
      ).toBe(403)
      expect((await api(base, 'GET', `/api/scenes/${sceneId}/prep`)).status).toBe(401)
      expect((await api(base, 'PUT', `/api/scenes/${sceneId}/prep`, { body: PREP })).status).toBe(401)

      // Shapes the trigger runtime could not read are refused rather than stored.
      const putBody = (body: unknown) => api(base, 'PUT', `/api/scenes/${sceneId}/prep`, { token: dmToken, body })
      expect((await putBody({ version: 2, triggers: [] })).status).toBe(400)
      expect((await putBody({ version: 1, triggers: 'nope' })).status).toBe(400)
      expect((await putBody('not an object')).status).toBe(400)
    })
  })

  it('strips extra top-level keys instead of storing the raw body (N3)', async () => {
    await withServer(async ({ server, base, adminPass }) => {
      const campaign = await api(base, 'POST', '/api/campaigns', { token: adminPass, body: {} })
      const campaignId = campaign.body.campaignId as string
      const dmToken = campaign.body.token as string
      const uploaded = await api(base, 'POST', `/api/campaigns/${campaignId}/maps`, {
        token: dmToken,
        raw: JSON.stringify(MAP),
      })
      const sceneId = uploaded.body.sceneId as string

      const put = await api(base, 'PUT', `/api/scenes/${sceneId}/prep`, {
        token: dmToken,
        body: { ...EMPTY_PREP, evil: 'payload' },
      })
      expect(put.status).toBe(200)
      expect(put.body).toEqual({ prep: EMPTY_PREP })
      // Not just the response — the column itself carries only the declared shape.
      expect(server.stores.scenes.get(sceneId)?.prep).toBe(JSON.stringify(EMPTY_PREP))
    })
  })

  it('stores SQL NULL, not the string "null", for an explicit prep: null (N4)', async () => {
    await withServer(async ({ server, base, adminPass }) => {
      const campaign = await api(base, 'POST', '/api/campaigns', { token: adminPass, body: {} })
      const campaignId = campaign.body.campaignId as string
      const dmToken = campaign.body.token as string

      // A hand-made file can carry a literal `"prep": null`.
      const uploaded = await api(base, 'POST', `/api/campaigns/${campaignId}/maps`, {
        token: dmToken,
        raw: JSON.stringify({ ...MAP, prep: null }),
      })
      const sceneId = uploaded.body.sceneId as string
      expect(
        (await api(base, 'GET', `/api/scenes/${sceneId}/prep`, { token: dmToken })).body,
      ).toEqual({ prep: null })
      expect(server.stores.scenes.get(sceneId)?.prep).toBeNull()

      // publishScene's explicit-clear path: give it prep, then explicitly null it back out.
      await api(base, 'PUT', `/api/scenes/${sceneId}/prep`, { token: dmToken, body: PREP })
      expect(server.stores.scenes.get(sceneId)?.prep).not.toBeNull()
      await api(base, 'PUT', `/api/scenes/${sceneId}/publish`, {
        token: dmToken,
        raw: JSON.stringify({ ...MAP, prep: null }),
      })
      expect(server.stores.scenes.get(sceneId)?.prep).toBeNull()
    })
  })
})

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

  // Four streamed uploads in one test outgrow the 5s default.
  it('refuses an oversized map or asset by declared length and by what actually arrives', { timeout: 20_000 }, async () => {
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

      // The asset route takes the same mid-stream refusal without crossing the process.
      const assets = `/api/campaigns/${body.campaignId as string}/assets`
      expect(await refusedUpload(server.port, assets, token, MAX_ASSET_BYTES + 1)).toBe(413)
      expect([413, 'ECONNRESET']).toContain(await refusedUpload(server.port, assets, token))

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

      // A container with the right magic and rubbish behind it is not a readable map either.
      const corrupt = Buffer.concat([Buffer.from('MPBLD\0', 'latin1'), Buffer.from('not gzip')])
      expect((await api(base, 'POST', path, { token, bytes: corrupt })).status).toBe(400)
    })
  })

  /**
   * The editor's own save, byte for byte: `MPBLD\0` + gzip(JSON) (canvas/src/io/saveLoad.ts).
   * The table used to `JSON.parse` these bytes raw and refuse every one of them, so no map
   * authored in the editor had ever been loadable — the format is built here rather than
   * mocked so the sniff is tested against the thing it has to accept.
   */
  it('takes the editor’s gzipped .mapbuilder as readily as plain JSON', async () => {
    await withServer(async ({ base, adminPass }) => {
      const { body } = await api(base, 'POST', '/api/campaigns', { token: adminPass, body: {} })
      const path = `/api/campaigns/${body.campaignId as string}/maps`
      const token = body.token as string

      const json = JSON.stringify(MAP)
      const container = Buffer.concat([Buffer.from('MPBLD\0', 'latin1'), gzipSync(Buffer.from(json, 'utf8'))])
      expect(container.subarray(0, 6).toString('latin1')).toBe('MPBLD\0')

      const uploaded = await api(base, 'POST', path, { token, bytes: container })
      expect(uploaded.status).toBe(201)
      expect(uploaded.body.name).toBe('Cragmaw Hideout')

      // Stored decoded: everything downstream — the scene index, the player redaction, the
      // DM's own map GET — reads the row with a bare `JSON.parse`.
      const fetched = await api(base, 'GET', `/api/maps/${uploaded.body.mapId as string}`, { token })
      expect(fetched.status).toBe(200)
      expect(JSON.parse(fetched.text)).toEqual(MAP)

      // …and the plain-JSON fixtures keep working unchanged.
      const plain = await api(base, 'POST', path, { token, raw: json })
      expect(plain.status).toBe(201)
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

describe('a session that has ended stays ended', () => {
  it('refuses the upgrade and the join for a session the DM closed', async () => {
    await withServer(async ({ server, base, adminPass }) => {
      const { dmToken, sessionId, playerToken } = await table(base, adminPass)

      // Upgraded while the table was open, and still sitting there having never joined.
      const idle = await openSocket(server.port, playerToken)

      expect((await api(base, 'DELETE', `/api/sessions/${sessionId}`, { token: dmToken })).status).toBe(200)

      // The socket cannot join the session back into existence...
      const ended = nextMessage(idle, 'session-ended')
      idle.send(JSON.stringify({ type: 'join', protocolVersion: 4 }))
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

  it('rate-limits admin-pass guessing on the dm-token route the same way (N9)', async () => {
    await withServer(async ({ base }) => {
      // isAdminPass fails before the campaign lookup, so a real campaign is not needed to
      // exercise the budget on this route.
      for (let attempt = 0; attempt < 10; attempt++) {
        expect(
          (await api(base, 'POST', '/api/campaigns/no-such-campaign/dm-token', { token: 'hunter2' })).status,
        ).toBe(401)
      }
      const res = await fetch(`${base}/api/campaigns/no-such-campaign/dm-token`, {
        method: 'POST',
        headers: { authorization: 'Bearer hunter2' },
      })
      expect(res.status).toBe(429)
      expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
      await res.text()
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

describe('map images — externalized JSON and the binary image route', () => {
  // A 1×1 PNG, enough to be real bytes with a real mime.
  const PNG_B64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  const MAP_WITH_IMAGES = {
    ...MAP,
    customImages: {
      '__terrain-splat-0__': `data:image/png;base64,${PNG_B64}`,
      'asset-1': `data:image/png;base64,${PNG_B64}`,
    },
  }

  async function uploadedScene(base: string, adminPass: string) {
    const created = await api(base, 'POST', '/api/campaigns', {
      token: adminPass,
      body: { name: 'C' },
    })
    const campaignId = created.body.campaignId as string
    const dmToken = created.body.token as string
    const uploaded = await api(base, 'POST', `/api/campaigns/${campaignId}/maps`, {
      token: dmToken,
      raw: JSON.stringify(MAP_WITH_IMAGES),
    })
    return { campaignId, dmToken, sceneId: uploaded.body.sceneId as string }
  }

  it('?images=external strips the payloads and lists the keys; binary route serves the bytes', async () => {
    await withServer(async ({ base, adminPass }) => {
      const { dmToken, sceneId } = await uploadedScene(base, adminPass)

      // Without the flag: byte-for-byte as uploaded — the old contract holds.
      const inline = await api(base, 'GET', `/api/maps/${sceneId}`, { token: dmToken })
      expect(JSON.parse(inline.text)).toEqual(MAP_WITH_IMAGES)

      const external = await api(base, 'GET', `/api/maps/${sceneId}?images=external`, {
        token: dmToken,
      })
      expect(external.status).toBe(200)
      const doc = JSON.parse(external.text) as Record<string, unknown>
      expect(doc.customImages).toEqual({})
      expect((doc.imageKeys as string[]).sort()).toEqual(['__terrain-splat-0__', 'asset-1'])

      const image = await fetch(`${base}/api/maps/${sceneId}/images/__terrain-splat-0__`, {
        headers: { authorization: `Bearer ${dmToken}` },
      })
      expect(image.status).toBe(200)
      expect(image.headers.get('content-type')).toBe('image/png')
      const bytes = Buffer.from(await image.arrayBuffer())
      expect(bytes.equals(Buffer.from(PNG_B64, 'base64'))).toBe(true)
    })
  })

  it('answers 404 for unknown keys and refuses tokens from another campaign', async () => {
    await withServer(async ({ base, adminPass }) => {
      const { dmToken, sceneId } = await uploadedScene(base, adminPass)

      const missing = await api(base, 'GET', `/api/maps/${sceneId}/images/nope`, {
        token: dmToken,
      })
      expect(missing.status).toBe(404)

      const other = await api(base, 'POST', '/api/campaigns', {
        token: adminPass,
        body: { name: 'Other' },
      })
      const outsider = await api(base, 'GET', `/api/maps/${sceneId}/images/asset-1`, {
        token: other.body.token as string,
      })
      expect(outsider.status).toBe(404)
    })
  })
})
