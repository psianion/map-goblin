// A fresh table in rooms mode: the DM has revealed nothing yet, and the party is standing in a
// room. That room counts as revealed (read-time, nothing written), so a player sees the ground
// under their own feet and can walk on it without the DM first knowing to reveal it.
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { Token, TokensState } from '@dnd/mechanics/tokens'
import type { FogState } from '@dnd/mechanics/fog'
import { openDb } from '../db/db'
import { createStores } from '../db/stores'
import { createVision } from './vision'
import { createAdminPass } from '../auth'
import { startServer } from '../index'
import { PROTOCOL_VERSION } from '../config'
import { ensureClipperReady } from './clipperBoot'

// The scene's room faces are cut by Clipper, as at a running table.
beforeAll(async () => {
  expect(await ensureClipperReady()).toBe(true)
}, 30_000)

const MAP = readFileSync(join(import.meta.dirname, '../../../testdata/plateau-test.mapbuilder'), 'utf8')
const SCENE = 'scene-field'

/** The plateau map with a second room walled off in its south-east corner. */
function withCellar(): string {
  const map = JSON.parse(MAP)
  const layer = map.layers.find((l: { type: string }) => l.type === 'dungeon')
  layer.standaloneWalls = [
    ...(layer.standaloneWalls ?? []),
    {
      id: 'cellar-wall',
      points: [[32, 24], [40, 24], [40, 32], [32, 32], [32, 24]],
      wallType: 'normal',
      direction: 'both',
      color: '#000',
      width: 0.5,
      roughness: 0,
    },
  ]
  layer.rooms = [...layer.rooms, { id: 'room-cellar', name: 'Cellar', anchor: [36, 28] }]
  return JSON.stringify(map)
}

function table(map = MAP) {
  const stores = createStores(openDb(':memory:'))
  const campaign = stores.campaigns.create('Field')
  stores.maps.insert(SCENE, campaign.id, 'Field', map)
  stores.scenes.create(SCENE, campaign.id, SCENE, 'Field')
  return { stores, campaignId: campaign.id, vision: createVision(stores) }
}

const party = (x: number, y: number, ownerId: string | null = 'p-1'): TokensState => ({
  library: {},
  byScene: { [SCENE]: { pc: { id: 'pc', x, y, ownerId, hidden: false } as Token } },
})

describe('the party’s room on a fresh table', () => {
  it('is somewhere to stand and to see with no DM reveal, and no other room is', () => {
    const { stores, campaignId, vision } = table(withCellar())
    stores.moduleState.put(campaignId, 'tokens', party(34.5, 18.5))
    const scene = vision.visionOf(SCENE)!
    expect(scene.roomAt(34.5, 18.5)).toBe('room-field')
    expect(scene.roomAt(36, 28)).toBe('room-cellar')
    expect([...scene.occupiable]).toEqual(['room-field'])
    expect([...scene.visible]).toEqual(['room-field'])
    // Read-time only: the fog the DM's panel reads is untouched.
    expect(stores.moduleState.get(campaignId, 'fog')).toBeUndefined()
  })

  it('gives nobody anything while no party token stands in a room', () => {
    const { stores, campaignId, vision } = table()
    stores.moduleState.put(campaignId, 'tokens', party(34.5, 18.5, null))
    expect([...vision.visionOf(SCENE)!.occupiable]).toEqual([])
  })

  it('steps aside once the DM reveals a room: the stored fog is the answer again', () => {
    const { stores, campaignId, vision } = table(withCellar())
    stores.moduleState.put(campaignId, 'tokens', party(34.5, 18.5))
    stores.moduleState.put(campaignId, 'fog', {
      byScene: { [SCENE]: { rooms: { 'room-cellar': { status: 'revealed', wasEverRevealed: true } }, concealBehindDoors: false } },
    } satisfies FogState)
    expect([...vision.visionOf(SCENE)!.occupiable]).toEqual(['room-cellar'])
  })
})

async function api(base: string, method: string, path: string, token?: string, raw?: string) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(raw ? { 'content-type': 'application/json' } : {}) },
    body: raw,
  })
  const text = await response.text()
  return { status: response.status, body: text.startsWith('{') ? (JSON.parse(text) as Record<string, unknown>) : {} }
}

type Msg = Record<string, unknown>

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
  return { socket, frames, until, command }
}

type Tok = { id: string; x: number; y: number }
const tokensIn = (m: Msg, sceneId: string): Tok[] =>
  Object.values(((m.state as { byScene?: Record<string, Record<string, Tok>> }).byScene ?? {})[sceneId] ?? {})

describe('a player’s first move on a fresh table', () => {
  it('walks inside the party’s room with no DM reveal: no room-unexplored refusal', async () => {
    const server = await startServer({ port: 0, trustedPort: 0, heartbeatMs: 60_000, dbPath: ':memory:' })
    try {
      const base = `http://127.0.0.1:${server.port}`
      const campaign = await api(base, 'POST', '/api/campaigns', createAdminPass(server.stores.passes), JSON.stringify({}))
      const dmToken = campaign.body.token as string
      const campaignId = campaign.body.campaignId as string
      const uploaded = await api(base, 'POST', `/api/campaigns/${campaignId}/maps`, dmToken, MAP)
      expect(uploaded.status).toBe(201)
      const sceneId = uploaded.body.sceneId as string
      await api(base, 'PATCH', `/api/scenes/${sceneId}`, dmToken, JSON.stringify({ visibleToPlayers: true }))
      const started = await api(base, 'POST', '/api/sessions', dmToken, JSON.stringify({ campaignId, sceneId }))
      const joined = await api(base, 'POST', '/api/join', undefined, JSON.stringify({ code: started.body.inviteCode, name: 'Bob' }))

      const dm = await seat(server.port, dmToken)
      const player = await seat(server.port, joined.body.token as string)
      await dm.until((m) => m.type === 'session-state')
      await player.until((m) => m.type === 'session-state')

      dm.command('tokens', 'place', { name: 'Borin', x: 34.5, y: 18.5, disposition: 'friendly' })
      const placed = await dm.until((m) => m.type === 'state-update' && m.module === 'tokens' && tokensIn(m, sceneId).length > 0)
      const borin = tokensIn(placed, sceneId)[0]
      dm.command('tokens', 'assign', { id: borin.id, identityId: joined.body.identityId })
      // The claim is what puts the party in the field, so the field's geometry rides with it.
      const claimed = await player.until(
        (m) => m.type === 'state-update' && m.module === 'tokens' && tokensIn(m, sceneId).some((t) => t.id === borin.id),
      )
      expect(JSON.stringify(claimed.mapDelta ?? null)).toContain('room-field')

      player.frames.length = 0
      player.command('tokens', 'move', { id: borin.id, x: 36.5, y: 20.5 })
      const moved = await player.until(
        (m) =>
          m.type === 'error' ||
          (m.type === 'state-update' && m.module === 'tokens' && tokensIn(m, sceneId).some((t) => t.id === borin.id && t.x === 36.5)),
      )
      expect(JSON.stringify(moved)).not.toContain('room-unexplored')
      expect(moved.type, JSON.stringify(moved)).toBe('state-update')
      dm.socket.close()
      player.socket.close()
    } finally {
      await server.close()
    }
  })
})
