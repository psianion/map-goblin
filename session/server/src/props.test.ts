// Props through publish (§10): the server stores the map's raw text and validates only the
// envelope, so the keys a prop gained (opacity, overhead, lock, the behaviour fields) need no
// server change. These pin that over real HTTP: the DM's copy is the file byte for byte, the
// player's redacted copy carries the same keys on every prop it ships, and a republish
// replaces them.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { FogState } from '@dnd/mechanics/fog'
import type { AnyChild, DungeonLayer, Room, SerializedMapData, WallSegment } from '@dnd/core/src/store/types'
import { createAdminPass } from './auth'
import { startServer, type RunningServer } from './index'

beforeAll(() => {
  process.env.GAME_SERVER_DATA = mkdtempSync(join(tmpdir(), 'game-server-props-'))
})

// ── A two-room map with a canopy in each room ───────────────────────────────

const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
]

const FLOOR = {
  id: 'floor-1',
  name: 'Floor',
  childType: 'shape',
  visible: true,
  shapeType: 'rectangle',
  contours: [rect(0, 0, 20, 10)],
  roughnessEnabled: false,
  textureScale: 1,
  textureOffsetX: 0,
  textureOffsetY: 0,
  textureFillRotation: 0,
  textureTint: '#fff',
} as AnyChild

const DIVIDER: WallSegment = {
  id: 'wall-mid',
  points: [
    [10, 0],
    [10, 10],
  ],
  wallType: 'normal',
  direction: 'both',
  color: '#000',
  width: 0.5,
  roughness: 0,
}

const HALL: Room = { id: 'room-hall', name: 'Hall', number: 1, anchor: [5, 5] }
const VAULT: Room = { id: 'room-vault', name: 'Vault', number: 2, anchor: [15, 5] }

/** Every key a prop can carry, the new ones set away from their defaults. */
const canopy = (id: string, x: number, y: number, overhead = true): AnyChild =>
  ({
    id,
    name: 'spider web',
    childType: 'asset',
    visible: true,
    objectType: 'asset',
    assetId: 'gg-demo:spider_web_3x2_object_A',
    position: { x, y },
    rotation: 0.25,
    scale: 1,
    width: 4,
    height: 3,
    tint: '#c04040',
    flipX: true,
    flipY: false,
    opacity: 0.8,
    overhead,
    locked: true,
    castsShadow: false,
    blocksLight: true,
    blocksMovement: true,
    glows: true,
  }) as AnyChild

function propsMap(overhead = true): SerializedMapData {
  const layer = {
    id: 'layer-1',
    name: 'Dungeon',
    type: 'dungeon',
    levelId: 'level-1',
    visible: true,
    locked: false,
    opacity: 1,
    children: [FLOOR, canopy('canopy-hall', 5, 5, overhead), canopy('canopy-vault', 15, 5, overhead)],
    standaloneWalls: [DIVIDER],
    mergedFloor: null,
    style: {} as DungeonLayer['style'],
    sublayerVisibility: { floor: true, grid: true, walls: true },
    rooms: [HALL, VAULT],
  } as unknown as DungeonLayer
  return {
    version: '3.1',
    mapSettings: { name: 'Canopies', roomsVersion: 2 } as SerializedMapData['mapSettings'],
    grid: { visible: true, snapDivision: 1, style: 'clean' } as SerializedMapData['grid'],
    levels: [{ id: 'level-1', name: 'Canopies' }],
    layers: [layer],
    customImages: {},
  } as SerializedMapData
}

// ── harness ─────────────────────────────────────────────────────────────────

interface Fixture {
  server: RunningServer
  base: string
  adminPass: string
}

async function withServer(body: (fixture: Fixture) => Promise<void>): Promise<void> {
  const server = await startServer({ port: 0, heartbeatMs: 60_000, dbPath: ':memory:' })
  try {
    await body({ server, base: `http://127.0.0.1:${server.port}`, adminPass: createAdminPass(server.stores.passes) })
  } finally {
    await server.close()
  }
}

async function api(
  base: string,
  method: string,
  path: string,
  { token, body, raw }: { token?: string; body?: unknown; raw?: string } = {},
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
  return { status: response.status, text, body: text.startsWith('{') ? (JSON.parse(text) as Record<string, unknown>) : {} }
}

/** Upload the map, light the hall, open a session and seat one player. */
async function table(fx: Fixture, raw: string) {
  const campaign = await api(fx.base, 'POST', '/api/campaigns', { token: fx.adminPass, body: {} })
  const campaignId = campaign.body.campaignId as string
  const dmToken = campaign.body.token as string
  const uploaded = await api(fx.base, 'POST', `/api/campaigns/${campaignId}/maps`, { token: dmToken, raw })
  expect(uploaded.status).toBe(201)
  const sceneId = uploaded.body.sceneId as string
  const fog: FogState = {
    byScene: { [sceneId]: { rooms: { [HALL.id]: { status: 'revealed', wasEverRevealed: true } }, concealBehindDoors: true } },
  }
  fx.server.stores.moduleState.put(campaignId, 'fog', fog)
  const started = await api(fx.base, 'POST', '/api/sessions', { token: dmToken, body: { campaignId, sceneId } })
  const joined = await api(fx.base, 'POST', '/api/join', { body: { code: started.body.inviteCode as string, name: 'Bob' } })
  return { dmToken, sceneId, playerToken: joined.body.token as string }
}

async function playerProps(fx: Fixture, sceneId: string, playerToken: string): Promise<AnyChild[]> {
  const fetched = await api(fx.base, 'GET', `/api/maps/${sceneId}`, { token: playerToken })
  expect(fetched.status).toBe(200)
  const layer = (JSON.parse(fetched.text) as SerializedMapData).layers[0] as DungeonLayer
  return layer.children.filter((c) => c.childType === 'asset')
}

describe('prop keys through publish (§10)', () => {
  it('stores them as sent and ships them to a player on every prop they may hold', async () => {
    await withServer(async (fx) => {
      const raw = JSON.stringify(propsMap())
      const { dmToken, sceneId, playerToken } = await table(fx, raw)

      expect((await api(fx.base, 'GET', `/api/maps/${sceneId}`, { token: dmToken })).text).toBe(raw)
      // The hall's canopy, exactly as authored; the vault was never seen, so its canopy is not there.
      expect(await playerProps(fx, sceneId, playerToken)).toEqual([canopy('canopy-hall', 5, 5)])
    })
  })

  it('replaces them on a republish, for the DM and the player alike', async () => {
    await withServer(async (fx) => {
      const { dmToken, sceneId, playerToken } = await table(fx, JSON.stringify(propsMap()))
      const raw = JSON.stringify(propsMap(false))
      expect((await api(fx.base, 'PUT', `/api/scenes/${sceneId}/publish`, { token: dmToken, raw })).status).toBe(200)

      expect((await api(fx.base, 'GET', `/api/maps/${sceneId}`, { token: dmToken })).text).toBe(raw)
      expect(await playerProps(fx, sceneId, playerToken)).toEqual([canopy('canopy-hall', 5, 5, false)])
    })
  })
})
