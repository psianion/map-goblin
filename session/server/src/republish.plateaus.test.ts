// A live republish must move the referee onto the new map at once: a player's move onto ground
// the new map adds is taken, and the token's height is read off the new map's plateaus.
import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { PROTOCOL_VERSION } from './config'
import { createAdminPass } from './auth'
import { startServer } from './index'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the merged floor the editor saves with the file
import { computeMergedFloor } from '@dnd/core/src/engine/mergedFloor'
import type { DungeonLayer } from '@dnd/core/src/store/types'

const rect = (id: string, x0: number, y0: number, x1: number, y1: number, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  childType: 'shape',
  visible: true,
  shapeType: 'rectangle',
  contours: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
  textureScale: 1,
  textureOffsetX: 0,
  textureOffsetY: 0,
  textureFillRotation: 0,
  textureTint: '#ffffff',
  ...extra,
})

/** A hall `width` cells wide, with a +2 cliff mesa at its east end (x 16..20) when it is wide enough. */
const mapOf = (width: number, children: Record<string, unknown>[] = [rect('ground', 0, 0, width, 10), ...(width > 20 ? [rect('mesa', 16, 2, 20, 8, { height: 2, edge: 'none' })] : [])]) => ({
  version: '3.2',
  mapSettings: { name: 'Hall', cellScale: { value: 5, unit: 'ft' }, ambientLight: '#ffffff' },
  grid: { visible: true, snapDivision: 1 },
  layers: [
    {
      id: 'layer-1',
      name: 'Dungeon',
      type: 'dungeon',
      visible: true,
      locked: false,
      opacity: 1,
      children,
      standaloneWalls: [],
      rooms: [{ id: 'hall', name: 'Hall', anchor: [1.5, 1.5] }],
      style: { floorColor: '#F1ECDF', wallWidth: 0.5 },
    },
  ],
  customImages: {},
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

/** A joined socket that keeps every frame it is sent, for `until` to search. */
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

type Tok = { id: string; name: string; x: number; y: number; elevation: number }
const tokensIn = (m: Msg, sceneId: string): Tok[] =>
  Object.values(((m.state as { byScene?: Record<string, Record<string, Tok>> }).byScene ?? {})[sceneId] ?? {})

describe('a live republish', () => {
  it('checks the next move against the new map, and reads the height off it', async () => {
    const server = await startServer({ port: 0, trustedPort: 0, heartbeatMs: 60_000, dbPath: ':memory:' })
    try {
      const base = `http://127.0.0.1:${server.port}`
      const campaign = await api(base, 'POST', '/api/campaigns', createAdminPass(server.stores.passes), JSON.stringify({}))
      const dmToken = campaign.body.token as string
      const campaignId = campaign.body.campaignId as string
      const uploaded = await api(base, 'POST', `/api/campaigns/${campaignId}/maps`, dmToken, JSON.stringify(mapOf(10)))
      const sceneId = uploaded.body.sceneId as string
      await api(base, 'PATCH', `/api/scenes/${sceneId}`, dmToken, JSON.stringify({ visibleToPlayers: true }))
      const started = await api(base, 'POST', '/api/sessions', dmToken, JSON.stringify({ campaignId, sceneId }))
      const joined = await api(base, 'POST', '/api/join', undefined, JSON.stringify({ code: started.body.inviteCode, name: 'Bob' }))

      const dm = await seat(server.port, dmToken)
      const player = await seat(server.port, joined.body.token as string)
      await dm.until((m) => m.type === 'session-state')
      await player.until((m) => m.type === 'session-state')

      dm.command('fog', 'reveal', { roomId: 'hall' })
      dm.command('tokens', 'place', { name: 'Borin', x: 2.5, y: 2.5, disposition: 'friendly' })
      const placed = await dm.until((m) => m.type === 'state-update' && m.module === 'tokens' && tokensIn(m, sceneId).length > 0)
      const borin = tokensIn(placed, sceneId)[0]
      dm.command('tokens', 'assign', { id: borin.id, identityId: joined.body.identityId })
      await player.until((m) => m.type === 'state-update' && m.module === 'tokens' && tokensIn(m, sceneId).some((t) => t.id === borin.id))

      // The new map is twice as long, with a +2 mesa where there used to be nothing.
      const republished = await api(base, 'PUT', `/api/scenes/${sceneId}/publish`, dmToken, JSON.stringify(mapOf(30)))
      expect(republished.status).toBe(200)
      dm.command('fog', 'reveal', { roomId: 'hall' })

      player.frames.length = 0
      player.command('tokens', 'move', { id: borin.id, x: 17.5, y: 4.5 })
      const moved = await player.until(
        (m) =>
          m.type === 'error' ||
          (m.type === 'state-update' && m.module === 'tokens' && tokensIn(m, sceneId).some((t) => t.id === borin.id && t.x === 17.5)),
      )
      expect(moved.type, JSON.stringify(moved)).toBe('state-update')
      expect(tokensIn(moved, sceneId).find((t) => t.id === borin.id)!.elevation).toBe(2)
      dm.socket.close()
      player.socket.close()
    } finally {
      await server.close()
    }
  })
})

/**
 * The acceptance map's shape: a walled hall, a +2 cliff with stairs on its south edge, and two
 * raised walled rooms, one over the hall's east wall and one inside it.
 */
const terraced = () => {
  const map = mapOf(24, [
    rect('ground', 0, 0, 20, 20, { edge: 'wall' }),
    rect('cliff', 4, 2, 16, 12, { height: 2, edge: 'cliff' }),
    { id: 'cliff-stairs', name: 'Stairs', childType: 'opening', visible: true, kind: 'stairs', shapeId: 'cliff', t: 28 / 44, width: 2 },
    rect('east-room', 18, 3, 24, 11, { height: 2, edge: 'wall' }),
    rect('inner-room', 14, 14, 19, 19, { height: 1, edge: 'wall' }),
  ])
  // The editor saves the layer with its merged floor, raised rings and all; the referee keeps it.
  const layer = map.layers[0] as unknown as DungeonLayer
  return { ...map, layers: [{ ...map.layers[0], mergedFloor: computeMergedFloor(layer) }] }
}

describe('a live republish onto plateaus', () => {
  it('lets a player stand beside the stairs, walk up them, and nowhere it could not before', async () => {
    const server = await startServer({ port: 0, trustedPort: 0, heartbeatMs: 60_000, dbPath: ':memory:' })
    try {
      const base = `http://127.0.0.1:${server.port}`
      const campaign = await api(base, 'POST', '/api/campaigns', createAdminPass(server.stores.passes), JSON.stringify({}))
      const dmToken = campaign.body.token as string
      const campaignId = campaign.body.campaignId as string
      const uploaded = await api(base, 'POST', `/api/campaigns/${campaignId}/maps`, dmToken, JSON.stringify(mapOf(10)))
      const sceneId = uploaded.body.sceneId as string
      await api(base, 'PATCH', `/api/scenes/${sceneId}`, dmToken, JSON.stringify({ visibleToPlayers: true }))
      const started = await api(base, 'POST', '/api/sessions', dmToken, JSON.stringify({ campaignId, sceneId }))
      const joined = await api(base, 'POST', '/api/join', undefined, JSON.stringify({ code: started.body.inviteCode, name: 'Bob' }))
      const dm = await seat(server.port, dmToken)
      const player = await seat(server.port, joined.body.token as string)
      await dm.until((m) => m.type === 'session-state')
      await player.until((m) => m.type === 'session-state')
      dm.command('fog', 'reveal', { roomId: 'hall' })
      dm.command('tokens', 'place', { name: 'Borin', x: 2.5, y: 2.5, disposition: 'friendly' })
      const placed = await dm.until((m) => m.type === 'state-update' && m.module === 'tokens' && tokensIn(m, sceneId).length > 0)
      const borin = tokensIn(placed, sceneId)[0]
      dm.command('tokens', 'assign', { id: borin.id, identityId: joined.body.identityId })
      await player.until((m) => m.type === 'state-update' && m.module === 'tokens' && tokensIn(m, sceneId).some((t) => t.id === borin.id))

      expect((await api(base, 'PUT', `/api/scenes/${sceneId}/publish`, dmToken, JSON.stringify(terraced()))).status).toBe(200)

      const step = async (x: number, y: number) => {
        player.frames.length = 0
        player.command('tokens', 'move', { id: borin.id, x, y })
        const got = await player.until(
          (m) =>
            m.type === 'error' ||
            (m.type === 'state-update' && m.module === 'tokens' && tokensIn(m, sceneId).some((t) => t.id === borin.id && t.x === x && t.y === y)),
        )
        return got.type === 'error' ? got : tokensIn(got, sceneId).find((t) => t.id === borin.id)!
      }
      for (const [x, y] of [[6.5, 13.5], [8.5, 12.5], [11.5, 12.5], [3.5, 12.5]]) {
        expect(await step(x, y)).toMatchObject({ elevation: 0 })
      }
      expect(await step(10.5, 12.5)).toMatchObject({ elevation: 1.5 })
      expect(await step(10.5, 10.5)).toMatchObject({ elevation: 2 })
      dm.socket.close()
      player.socket.close()
    } finally {
      await server.close()
    }
  })
})
