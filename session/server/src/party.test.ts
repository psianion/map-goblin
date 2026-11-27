// Decision 16 over a real server: the party's PC tokens stand in the party start area when the
// DM starts the table, a returning player gets their PC back by name, players upload their own art
// within the 2 MB cap, and token defs from before table v2 read with its defaults.

import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { StoryState } from '@dnd/mechanics/story'
import type { TokenDef, TokensState } from '@dnd/mechanics/tokens'
import { createAdminPass } from './auth'
import { PROTOCOL_VERSION } from './config'
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

/** A joined socket, its frames, a wait on a condition, and a command sender. */
async function seat(port: number, token: string) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`)
  const frames: Record<string, unknown>[] = []
  socket.on('message', (raw: Buffer) => frames.push(JSON.parse(raw.toString()) as Record<string, unknown>))
  await once(socket, 'open')
  socket.send(JSON.stringify({ type: 'join', protocolVersion: PROTOCOL_VERSION }))
  const until = async (done: () => boolean, ms = 3000): Promise<void> => {
    const end = Date.now() + ms
    while (!done()) {
      if (Date.now() > end) throw new Error('timed out')
      await new Promise((r) => setTimeout(r, 20))
    }
  }
  await until(() => frames.some((m) => m.type === 'session-state'))
  const you = frames.find((m) => m.type === 'session-state')!.you as { identityId: string }
  const command = (module: string, action: string, payload: unknown) =>
    socket.send(JSON.stringify({ type: 'command', module, action, payload, seq: 1 }))
  return { socket, frames, until, command, identityId: you.identityId }
}

describe('the party at Start (table lobby pass §3.5)', () => {
  const library = {
    bram: { ...oldDef('bram', 'Bram'), kind: 'pc' as const },
    ysolde: { ...oldDef('ysolde', 'Ysolde'), kind: 'pc' as const },
    cora: { ...oldDef('cora', 'Cora'), kind: 'pc' as const },
    goblin: oldDef('goblin', 'Goblin'),
  }

  /** Opens the table on the West Hall, seats the DM and a player per name, each picking that PC. */
  async function lobby(fixture: Fixture, picks: Record<string, string>) {
    const { server, base, campaignId, dmToken, sceneId } = fixture
    server.stores.moduleState.put(campaignId, 'tokens', { library, byScene: {} })
    const opened = await call(base, 'POST', '/api/sessions', {
      token: dmToken,
      body: { campaignId, startingRoom: { sceneId, roomId: 'west' } },
    })
    expect(opened.status).toBe(201)
    const dm = await seat(server.port, dmToken)
    const players: Record<string, Awaited<ReturnType<typeof seat>>> = {}
    for (const [name, defId] of Object.entries(picks)) {
      const joined = await call(base, 'POST', '/api/join', { body: { code: opened.body.inviteCode, name } })
      players[name] = await seat(server.port, joined.body.token as string)
      players[name].command('tokens', 'pc-claim', { defId })
      await dm.until(() => !!tokensOf(server, campaignId).library[defId]!.ownerIdentityId)
    }
    const onScene = () => Object.values(tokensOf(server, campaignId).byScene[sceneId] ?? {})
    const start = async (count: number) => {
      dm.command('table', 'start', { on: true })
      await dm.until(() => onScene().length >= count)
    }
    const close = () => [dm, ...Object.values(players)].forEach((s) => s.socket.close())
    return { dm, players, onScene, start, close, opened }
  }

  it('opening stores the area round the room and places nobody; Start fills it from the centre with the picked PCs only', async () => {
    await withScene(async (fixture) => {
      const t = await lobby(fixture, { Pim: 'bram', Yara: 'ysolde' })
      const area = tokensOf(fixture.server, fixture.campaignId).partyStart?.[fixture.sceneId]
      expect(area).toBeDefined()
      expect(area!.x1 - area!.x0).toBe(2)
      expect(t.onScene()).toEqual([])

      await t.start(2)
      const placed = t.onScene()
      // Cora, picked by nobody, and the goblin stay off the map.
      expect(placed.map((tok) => tok.defId).sort()).toEqual(['bram', 'ysolde'])
      expect(new Set(placed.map((tok) => `${tok.x},${tok.y}`)).size).toBe(2)
      const centre = { x: area!.x0 + 1.5, y: area!.y0 + 1.5 }
      expect(placed.some((tok) => tok.x === centre.x && tok.y === centre.y)).toBe(true)
      for (const tok of placed) {
        expect(tok.x).toBeGreaterThanOrEqual(area!.x0)
        expect(tok.x).toBeLessThanOrEqual(area!.x1 + 1)
        expect(tok.y).toBeGreaterThanOrEqual(area!.y0)
        expect(tok.y).toBeLessThanOrEqual(area!.y1 + 1)
      }
      expect(placed.find((tok) => tok.defId === 'bram')).toMatchObject({ kind: 'pc', ownerId: t.players.Pim!.identityId })
      t.close()
    })
  })

  it('a full area fans out round its centre, and a PC already on the scene does not move', async () => {
    await withScene(async (fixture) => {
      const t = await lobby(fixture, { Pim: 'bram', Yara: 'ysolde', Cy: 'cora' })
      // One cell of area, and Cora already put down by hand somewhere else.
      t.dm.command('tokens', 'set-party-start', { sceneId: fixture.sceneId, rect: { x0: 5, y0: 5, x1: 5, y1: 5 } })
      t.dm.command('tokens', 'place', { sceneId: fixture.sceneId, defId: 'cora', x: 3.5, y: 3.5 })
      await t.dm.until(() => t.onScene().length === 1)
      await t.start(3)
      const at = (defId: string) => t.onScene().find((tok) => tok.defId === defId)!
      expect(at('cora')).toMatchObject({ x: 3.5, y: 3.5 })
      const [first, second] = [at('bram'), at('ysolde')]
      expect([first, second].some((tok) => tok.x === 5.5 && tok.y === 5.5)).toBe(true)
      for (const tok of [first, second]) expect(Math.max(Math.abs(tok.x - 5.5), Math.abs(tok.y - 5.5))).toBeLessThanOrEqual(1)
      expect(`${first.x},${first.y}`).not.toBe(`${second.x},${second.y}`)
      t.close()
    })
  })

  it('a seat that picks after Start lands beside the party', async () => {
    await withScene(async (fixture) => {
      const t = await lobby(fixture, { Pim: 'bram' })
      await t.start(1)
      const bram = t.onScene()[0]!
      const late = await call(fixture.base, 'POST', '/api/join', { body: { code: t.opened.body.inviteCode, name: 'Late' } })
      const seated = await seat(fixture.server.port, late.body.token as string)
      seated.command('tokens', 'pc-create', { name: 'Latecomer' })
      await t.dm.until(() => t.onScene().length === 2)
      const made = t.onScene().find((tok) => tok.id !== bram.id)!
      expect(made).toMatchObject({ name: 'Latecomer', ownerId: late.body.identityId })
      expect(Math.max(Math.abs(made.x - bram.x), Math.abs(made.y - bram.y))).toBeLessThanOrEqual(1)
      seated.socket.close()
      t.close()
    })
  })

  it('the DM puts a character on the map, or hands one to a seat, beside the party (finishing pass 12.1)', async () => {
    await withScene(async (fixture) => {
      const t = await lobby(fixture, { Pim: 'bram' })
      await t.start(1)
      const bram = t.onScene()[0]!
      t.dm.command('tokens', 'place-pc', { defId: 'cora' })
      await t.dm.until(() => t.onScene().length === 2)
      const late = await call(fixture.base, 'POST', '/api/join', { body: { code: t.opened.body.inviteCode, name: 'Yara' } })
      const yara = await seat(fixture.server.port, late.body.token as string)
      t.dm.command('tokens', 'library-upsert', { id: 'ysolde', ownerIdentityId: yara.identityId, ownerName: 'Yara' })
      await t.dm.until(() => t.onScene().length === 3)
      for (const defId of ['cora', 'ysolde']) {
        const tok = t.onScene().find((x) => x.defId === defId)!
        expect(Math.max(Math.abs(tok.x - bram.x), Math.abs(tok.y - bram.y))).toBeLessThanOrEqual(1)
      }
      expect(t.onScene().find((x) => x.defId === 'ysolde')).toMatchObject({ ownerId: yara.identityId })
      // Once there, it is not put down twice.
      t.dm.command('tokens', 'place-pc', { defId: 'cora' })
      await t.dm.until(() => t.dm.frames.some((m) => m.type === 'error'))
      expect(t.onScene()).toHaveLength(3)
      yara.socket.close()
      t.close()
    })
  })
})

describe('a scene with no party start area (finishing pass 12.1)', () => {
  const bram = { ...oldDef('bram', 'Bram'), kind: 'pc' as const }

  it('gets one when the table opens, when the DM switches to it, and when the table is joined again', async () => {
    await withScene(async ({ server, base, campaignId, dmToken, sceneId }) => {
      const other = (await call(base, 'POST', `/api/campaigns/${campaignId}/maps`, { token: dmToken, raw: MAP })).body.sceneId as string
      server.stores.moduleState.put(campaignId, 'tokens', { library: { bram }, byScene: {} })
      const opened = await call(base, 'POST', '/api/sessions', { token: dmToken, body: { campaignId, sceneId } })
      const areaOf = (id: string) => tokensOf(server, campaignId).partyStart?.[id]
      const area = areaOf(sceneId)
      expect(area).toBeDefined()
      expect([area!.x1 - area!.x0, area!.y1 - area!.y0]).toEqual([2, 2])
      expect(areaOf(other)).toBeUndefined()

      const dm = await seat(server.port, dmToken)
      const snapshot = dm.frames.find((m) => m.type === 'session-state')!.state as { campaignName?: string }
      expect(snapshot.campaignName).toBe('Party')
      const joined = await call(base, 'POST', '/api/join', { body: { code: opened.body.inviteCode, name: 'Pim' } })
      const pim = await seat(server.port, joined.body.token as string)
      pim.command('tokens', 'pc-claim', { defId: 'bram' })
      await dm.until(() => !!tokensOf(server, campaignId).library.bram!.ownerIdentityId)

      // Switched to before Start: the party still has somewhere to stand.
      dm.command('scenes', 'activate', { sceneId: other })
      await dm.until(() => !!areaOf(other))
      dm.command('table', 'start', { on: true })
      await dm.until(() => Object.keys(tokensOf(server, campaignId).byScene[other] ?? {}).length === 1)
      const placed = Object.values(tokensOf(server, campaignId).byScene[other]!)[0]!
      const inside = areaOf(other)!
      expect(placed.x).toBeGreaterThanOrEqual(inside.x0)
      expect(placed.x).toBeLessThanOrEqual(inside.x1 + 1)
      expect(placed.y).toBeGreaterThanOrEqual(inside.y0)
      expect(placed.y).toBeLessThanOrEqual(inside.y1 + 1)

      // A table every seat left, its live scene's area gone, gets one back when it is joined again.
      dm.command('tokens', 'set-party-start', { sceneId: other, rect: null })
      await dm.until(() => !areaOf(other))
      dm.socket.close()
      pim.socket.close()
      await new Promise((r) => setTimeout(r, 100))
      const again = await seat(server.port, dmToken)
      expect(areaOf(other)).toBeDefined()
      again.socket.close()
    })
  })
})

describe('a returning player', () => {
  it('gets their PC back by name', async () => {
    await withScene(async ({ server, base, campaignId, dmToken, sceneId }) => {
      const bram = { ...oldDef('bram', 'Bram'), kind: 'pc' as const, ownerIdentityId: 'old-seat', ownerName: 'Bram' }
      server.stores.moduleState.put(campaignId, 'tokens', {
        library: { bram },
        byScene: { [sceneId]: { t1: { ...bram, id: 't1', defId: 'bram', x: 5.5, y: 5.5, elevation: 0, z: 0, hidden: false, ownerId: 'old-seat' } } },
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

  it('keeps the title card they hid, and is never sent who hid it', async () => {
    await withScene(async ({ server, base, campaignId, dmToken }) => {
      const opened = await call(base, 'POST', '/api/sessions', { token: dmToken, body: { campaignId } })
      server.stores.moduleState.put(campaignId, 'story', {
        handouts: [],
        shown: null,
        titleCard: { text: 'Chapter One', mode: 'over', shownAt: 1, dismissed: [{ id: 'old-seat', name: 'Pim' }] },
        journal: [],
      } satisfies StoryState)
      const joined = await call(base, 'POST', '/api/join', { body: { code: opened.body.inviteCode, name: ' PIM ' } })
      const story = server.stores.moduleState.get(campaignId, 'story') as StoryState
      expect(story.titleCard!.dismissed.map((d) => d.id)).toEqual(['old-seat', joined.body.identityId])

      const pim = await seat(server.port, joined.body.token as string)
      const other = await call(base, 'POST', '/api/join', { body: { code: opened.body.inviteCode, name: 'Ysolde' } })
      const ysolde = await seat(server.port, other.body.token as string)
      const snapshot = (s: Awaited<ReturnType<typeof seat>>) =>
        (s.frames.find((m) => m.type === 'session-state')!.state as { modules: { story: StoryState } }).modules.story
      expect(snapshot(pim).titleCard).toBeNull()
      expect(snapshot(ysolde).titleCard).toMatchObject({ text: 'Chapter One', dismissed: [] })
      pim.socket.close()
      ysolde.socket.close()
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
