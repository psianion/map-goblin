// Table fix pass, tests 6.1 rows 16 to 19: a live table carries on when opened again, a
// returning player gets their token back by name (and only when nobody at the table holds that
// name), the live scene reaches players whatever its hidden flag, and a party start spawns the
// party there.
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { DoorsState } from '@dnd/mechanics/doors'
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

describe('the acceptance walk (outdoor-cave.spec steps 3 to 5, By sight)', () => {
  // The browser spec's landmarks (`e2e/fixtures.ts` CAVE): keep the two in step.
  const CAVE = {
    partyStart: { x: 15.5, y: 7.5 },
    dirt: { x: 15.5, y: 9.5 },
    rock: { x: 17.5, y: 5.5 },
    besideDoor: { x: 13.5, y: 7.5 },
    inHall: { x: 10.5, y: 7.5 },
  }

  it('ships the cave and door, walks dirt, refuses rock, names the door from outside, opens it in reach and walks in', async () => {
    await withTable(async ({ server, base, campaignId, dmToken, upload }) => {
      const sceneId = await upload()
      server.stores.moduleState.put(campaignId, 'tokens', {
        library: { bram: { id: 'bram', name: 'Bram', imageAssetId: null, size: 'medium', disposition: 'friendly', sight: null, light: null, kind: 'pc' } },
        byScene: {},
      } satisfies TokensState)
      const opened = await api(base, 'POST', '/api/sessions', dmToken, {
        campaignId,
        sceneId,
        startingPoint: { sceneId, ...CAVE.partyStart, levelId: 'lvl-1' },
      })
      const joined = await api(base, 'POST', '/api/join', undefined, { code: opened.body.inviteCode, name: 'Pim' })
      const playerToken = joined.body.token as string
      const dm = await seat(server.port, dmToken)
      const pim = await seat(server.port, playerToken)
      // Fog on, with Auto-explore on as it starts: the party clears what it sees.
      const fogOn = () => (server.stores.moduleState.get(campaignId, 'fog') as FogState | undefined)?.byScene[sceneId]?.on === true
      dm.command('fog', 'set-on', { sceneId, on: true })
      await dm.until(fogOn)
      const bram = () => tokensOf(server, campaignId, sceneId)[0]!
      expect({ x: bram().x, y: bram().y }).toEqual(CAVE.partyStart)
      dm.command('tokens', 'assign', { id: bram().id, identityId: joined.body.identityId })
      await dm.until(() => bram().ownerId === joined.body.identityId)

      /** A player command, answered by its error frame or by `done` coming true. */
      const step = async (module: string, action: string, payload: Body, done: () => boolean): Promise<string | null> => {
        pim.frames.length = 0
        pim.command(module, action, payload)
        const out = await pim.until((m) => m.type === 'error' || done())
        return out.type === 'error' ? JSON.stringify(out) : null
      }
      const walk = (to: { x: number; y: number }) =>
        step('tokens', 'move', { id: bram().id, ...to }, () => bram().x === to.x && bram().y === to.y)

      // 3. From outside the player is shipped the open ground, the cave and the door.
      const shipped = async () => {
        const doc = (await api(base, 'GET', `/api/maps/${sceneId}`, playerToken)).body as {
          openGround?: unknown[]
          layers: { children?: { id: string }[] }[]
        }
        const ids = new Set(doc.layers.flatMap((l) => (l.children ?? []).map((c) => c.id)))
        return { open: (doc.openGround?.length ?? 0) > 0, cave: ids.has('cave-floor'), door: ids.has('door-hall') }
      }
      expect(await shipped()).toEqual({ open: true, cave: true, door: true })

      // 4. Walks on dirt, is refused by rock, and is told the door is closed.
      expect(await walk(CAVE.dirt)).toBeNull()
      expect(await walk(CAVE.rock)).toContain('solid-ground')
      expect(await walk(CAVE.inHall)).toContain('door-closed door-hall')

      // 5. Stands beside the door, opens it, and walks into the hall.
      expect(await walk(CAVE.besideDoor)).toBeNull()
      const doorOpen = () =>
        (server.stores.moduleState.get(campaignId, 'doors') as DoorsState | undefined)?.byScene[sceneId]?.['door-hall']?.open === true
      expect(await step('doors', 'toggle', { id: 'door-hall' }, doorOpen)).toBeNull()
      expect(await walk(CAVE.inHall)).toBeNull()
      expect((await shipped()).open).toBe(true)
      dm.socket.close()
      pim.socket.close()
    })
  })

  it('hands the player the outside door in their doors slice, and a double-click swings it', async () => {
    await withTable(async ({ server, base, campaignId, dmToken, upload }) => {
      const sceneId = await upload()
      server.stores.moduleState.put(campaignId, 'tokens', {
        library: { bram: { id: 'bram', name: 'Bram', imageAssetId: null, size: 'medium', disposition: 'friendly', sight: null, light: null, kind: 'pc' } },
        byScene: {},
      } satisfies TokensState)
      // A touched door, so the scene has a live entry for the player cut to keep or drop.
      server.stores.moduleState.put(campaignId, 'doors', {
        byScene: { [sceneId]: { 'door-hall': { open: false, locked: false, revealed: true } } },
      } satisfies DoorsState)
      const opened = await api(base, 'POST', '/api/sessions', dmToken, {
        campaignId,
        sceneId,
        startingPoint: { sceneId, ...CAVE.partyStart, levelId: 'lvl-1' },
      })
      const joined = await api(base, 'POST', '/api/join', undefined, { code: opened.body.inviteCode, name: 'Pim' })
      const dm = await seat(server.port, dmToken)
      dm.command('fog', 'set-on', { sceneId, on: true })
      await dm.until(() => (server.stores.moduleState.get(campaignId, 'fog') as FogState | undefined)?.byScene[sceneId]?.on === true)
      const pim = await seat(server.port, joined.body.token as string)
      // The assignment is a step Auto-explore answers: the ground round the door clears, and the
      // door's live state follows it to the player.
      const bram = () => tokensOf(server, campaignId, sceneId)[0]!
      dm.command('tokens', 'assign', { id: bram().id, identityId: joined.body.identityId })
      await dm.until(() => bram().ownerId === joined.body.identityId)
      const slice = (await pim.until(
        (m) => m.type === 'state-update' && m.module === 'doors' && 'door-hall' in ((m.state as DoorsState).byScene[sceneId] ?? {}),
      )) as { state: DoorsState }
      expect(Object.keys(slice.state.byScene[sceneId] ?? {})).toEqual(['door-hall'])
      pim.frames.length = 0
      pim.command('tokens', 'move', { id: bram().id, ...CAVE.besideDoor })
      await pim.until((m) => m.type === 'error' || (bram().x === CAVE.besideDoor.x && bram().y === CAVE.besideDoor.y))
      expect(pim.frames.find((m) => m.type === 'error')).toBeUndefined()
      // `DoorRenderer`'s double-click sends this payload: the door id alone, on the live scene.
      const doorOpen = () =>
        (server.stores.moduleState.get(campaignId, 'doors') as DoorsState).byScene[sceneId]?.['door-hall']?.open === true
      pim.command('doors', 'toggle', { id: 'door-hall' })
      const out = await pim.until((m) => m.type === 'error' || doorOpen())
      expect(out.type === 'error' ? JSON.stringify(out) : null).toBeNull()
      dm.socket.close()
      pim.socket.close()
    })
  })
})

describe('the party start (F18, decision f)', () => {
  it('19: a map with partyStart reads unchanged and the party spawns there, with nothing revealed', async () => {
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
      // Fog starts off, so the start writes no fog at all.
      expect(server.stores.moduleState.get(campaignId, 'fog')).toBeUndefined()
    })
  })
})
