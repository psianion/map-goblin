// Rooms rebuild, server side (§10/§11): publish carries fog across a split or a merge, faces
// are derived from anchors at scene load, prep is v3 with room keys, and nothing a DM writes
// in a room key reaches a player except through a deliberate share.
//
// Real HTTP, real WebSocket, real SQLite, Clipper booted by `startServer` — the same harness
// as api.test.ts, because the faces only exist once the real geometry engine is loaded.

import { once } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { RoomKey, ScenePrep, TriggerDef } from '@dnd/core/src/shared/prep'
import type { ServerMessage } from '@dnd/core/src/shared/protocol'
import type { AnyChild, DungeonLayer, Room, SerializedMapData, WallSegment } from '@dnd/core/src/store/types'
import type { FogState, RoomFog } from '@dnd/mechanics/fog'
import type { TriggersState } from '@dnd/mechanics/triggers'
import { createAdminPass } from './auth'
import { PROTOCOL_VERSION } from './config'
import { carryFog, takeLineage } from './fog/roomLineage'
import { createVision } from './fog/vision'
import { startServer, type RunningServer } from './index'
import { createTriggerDeps } from './triggers/prepResolver'

beforeAll(() => {
  process.env.GAME_SERVER_DATA = mkdtempSync(join(tmpdir(), 'game-server-rooms-'))
})

// ── An anchored two-room map ────────────────────────────────────────────────
// One floor, 20 x 10, cut down the middle by a wall: the Hall west of it, the Vault east.
// Rooms carry an anchor and no ring at all — the server derives each face.

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

function anchoredMap(rooms: Room[] = [HALL, VAULT], extra: Partial<SerializedMapData> = {}): SerializedMapData {
  const layer = {
    id: 'layer-1',
    name: 'Dungeon',
    type: 'dungeon',
    levelId: 'level-1',
    visible: true,
    locked: false,
    opacity: 1,
    children: [FLOOR],
    standaloneWalls: [DIVIDER],
    mergedFloor: null,
    style: {} as DungeonLayer['style'],
    sublayerVisibility: { floor: true, grid: true, walls: true },
    rooms,
  } as unknown as DungeonLayer
  return {
    version: '3.0',
    mapSettings: { name: 'Two Rooms', roomsVersion: 2 } as SerializedMapData['mapSettings'],
    grid: { visible: true, snapDivision: 1, style: 'clean' } as SerializedMapData['grid'],
    levels: [{ id: 'level-1', name: 'Two Rooms' }],
    layers: [layer],
    customImages: {},
    ...extra,
  } as SerializedMapData
}

const KEY: RoomKey = {
  roomId: HALL.id,
  readAloud: 'Smoke hangs under a low ceiling of the hall.',
  notes: 'The chief hides behind the tapestry.',
  treasure: 'A purse of 40 gold pieces',
  traps: [{ id: 'trap-1', text: 'A tripwire by the hearth', save: { ability: 'dex', dc: 13 }, damage: '1d6' }],
  checks: [{ id: 'check-1', ability: 'wis', dc: 12, text: 'Notice the loose flagstone' }],
  encounter: { name: 'Hearth guards', monsters: [{ id: 'm1', name: 'Goblin', count: 2, hp: '2d6' }] },
}

/** Every DM-only string in `KEY`, none of which may ever reach a player. */
const SECRETS = [KEY.notes, KEY.treasure, KEY.traps[0]!.text, KEY.checks[0]!.text, KEY.encounter!.name]

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

/** A campaign with the anchored map uploaded as its one scene. */
async function published(fx: Fixture, map: SerializedMapData = anchoredMap()) {
  const campaign = await api(fx.base, 'POST', '/api/campaigns', { token: fx.adminPass, body: {} })
  const campaignId = campaign.body.campaignId as string
  const dmToken = campaign.body.token as string
  const uploaded = await api(fx.base, 'POST', `/api/campaigns/${campaignId}/maps`, {
    token: dmToken,
    raw: JSON.stringify(map),
  })
  expect(uploaded.status).toBe(201)
  return { campaignId, dmToken, sceneId: uploaded.body.sceneId as string }
}

const fogOf = (fx: Fixture, campaignId: string, sceneId: string): Record<string, RoomFog> =>
  ((fx.server.stores.moduleState.get(campaignId, 'fog') as FogState | undefined)?.byScene[sceneId]?.rooms ?? {})

function setFog(fx: Fixture, campaignId: string, sceneId: string, rooms: Record<string, RoomFog>): void {
  const fog: FogState = { byScene: { [sceneId]: { rooms, concealBehindDoors: true } } }
  fx.server.stores.moduleState.put(campaignId, 'fog', fog)
}

const LIT: RoomFog = { status: 'revealed', wasEverRevealed: true }
const MEMORY: RoomFog = { status: 're_hidden', wasEverRevealed: true }
const DARK: RoomFog = { status: 'never_revealed', wasEverRevealed: false }

async function joinSocket(port: number, token: string) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`)
  await once(socket, 'open')
  const state = new Promise<Extract<ServerMessage, { type: 'session-state' }>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for session-state')), 2000)
    socket.on('message', (raw: Buffer) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage
      if (msg.type !== 'session-state') return
      clearTimeout(timer)
      resolve(msg)
    })
  })
  socket.send(JSON.stringify({ type: 'join', protocolVersion: PROTOCOL_VERSION }))
  return { socket, state: await state }
}

// ── publish: lineage ───────────────────────────────────────────────────────

describe('publish carries fog across a split or a merge (§10)', () => {
  it('copies the parent fog onto a split half, once, and strips the lineage from the stored map', async () => {
    await withServer(async (fx) => {
      const { campaignId, dmToken, sceneId } = await published(fx)
      setFog(fx, campaignId, sceneId, { [HALL.id]: LIT })

      const EAST: Room = { id: 'room-hall-east', name: 'Hall, east', anchor: [8, 5], derivedFrom: HALL.id }
      const split = JSON.stringify(anchoredMap([HALL, EAST, VAULT]))
      expect((await api(fx.base, 'PUT', `/api/scenes/${sceneId}/publish`, { token: dmToken, raw: split })).status).toBe(200)
      expect(fogOf(fx, campaignId, sceneId)[EAST.id]).toEqual(LIT)

      // Lineage is an instruction to the publish route, not map data: the DM's own copy of the
      // stored map no longer carries it.
      const stored = await api(fx.base, 'GET', `/api/maps/${sceneId}`, { token: dmToken })
      expect(stored.text).not.toContain('derivedFrom')
      expect(stored.text).toContain(EAST.id)

      // The editor keeps lineage on its own document until it next saves, so the same split
      // arrives again — and must not overwrite what the party has since done in that half.
      setFog(fx, campaignId, sceneId, { [HALL.id]: DARK, [EAST.id]: MEMORY })
      await api(fx.base, 'PUT', `/api/scenes/${sceneId}/publish`, { token: dmToken, raw: split })
      expect(fogOf(fx, campaignId, sceneId)[EAST.id]).toEqual(MEMORY)
    })
  })

  it('ORs the folded rooms into the keeper, drops their fog, and strips mergedFrom', async () => {
    await withServer(async (fx) => {
      const { campaignId, dmToken, sceneId } = await published(fx)
      setFog(fx, campaignId, sceneId, { [HALL.id]: MEMORY, [VAULT.id]: DARK })

      const merged = anchoredMap([{ ...VAULT, mergedFrom: [HALL.id] }])
      await api(fx.base, 'PUT', `/api/scenes/${sceneId}/publish`, { token: dmToken, raw: JSON.stringify(merged) })
      const fog = fogOf(fx, campaignId, sceneId)
      expect(fog[VAULT.id]).toEqual(MEMORY)
      expect(fog).not.toHaveProperty(HALL.id)
      expect((await api(fx.base, 'GET', `/api/maps/${sceneId}`, { token: dmToken })).text).not.toContain('mergedFrom')
    })
  })

  it('leaves an untouched republish byte for byte, and its fog alone', async () => {
    await withServer(async (fx) => {
      const { campaignId, dmToken, sceneId } = await published(fx)
      setFog(fx, campaignId, sceneId, { [HALL.id]: LIT })
      const raw = JSON.stringify(anchoredMap())
      await api(fx.base, 'PUT', `/api/scenes/${sceneId}/publish`, { token: dmToken, raw })
      expect((await api(fx.base, 'GET', `/api/maps/${sceneId}`, { token: dmToken })).text).toBe(raw)
      expect(fogOf(fx, campaignId, sceneId)).toEqual({ [HALL.id]: LIT })
    })
  })
})

describe('carryFog', () => {
  const scene = (rooms: Record<string, RoomFog>) => ({ rooms, concealBehindDoors: true })

  it('takes the most revealed status of a merged group', () => {
    const next = carryFog(scene({ a: DARK, b: LIT, c: MEMORY }), { derived: [], merged: [['a', ['b', 'c']]] }, new Set())
    expect(next!.rooms).toEqual({ a: LIT })
  })

  it('changes nothing when the parent was never fogged or the folded rooms are already gone', () => {
    expect(carryFog(scene({}), { derived: [['b', 'a']], merged: [] }, new Set())).toBeNull()
    expect(carryFog(scene({ a: LIT }), { derived: [], merged: [['a', ['gone']]] }, new Set())).toBeNull()
  })

  it('reads nothing off a map without lineage, and keeps its document untouched', () => {
    const map = anchoredMap()
    expect(takeLineage(map)).toBeNull()
    expect(map).toEqual(anchoredMap())
  })
})

// ── faces ───────────────────────────────────────────────────────────────────

describe('faces are derived from anchors at scene load (§10)', () => {
  it("ships each explored room with its derived face as boundary, and never the room's door list", async () => {
    await withServer(async (fx) => {
      const { campaignId, sceneId } = await published(fx)
      setFog(fx, campaignId, sceneId, { [HALL.id]: LIT })

      const scene = createVision(fx.server.stores).sceneMapOf(sceneId)!
      // The divider splits the floor into two faces, one per anchor.
      expect(scene.roomAt(5, 5)).toBe(HALL.id)
      expect(scene.roomAt(15, 5)).toBe(VAULT.id)
      expect(scene.roomAt(50, 50)).toBeNull()

      const player = createVision(fx.server.stores).playerMap(sceneId)!
      const rooms = (player.layers[0] as DungeonLayer).rooms ?? []
      // Redaction is unchanged for explored ids: the party holds the hall and only the hall.
      expect(rooms.map((r) => r.id)).toEqual([HALL.id])
      const hall = rooms[0]!
      expect(hall.boundary!.length).toBeGreaterThanOrEqual(3)
      const xs = hall.boundary!.map((p) => p[0])
      expect(Math.max(...xs)).toBeLessThanOrEqual(10)
      expect(hall).not.toHaveProperty('face')
      expect(hall).not.toHaveProperty('doors')
      expect(hall).toMatchObject({ name: 'Hall', number: 1, anchor: [5, 5] })
    })
  })

  it("hands the DM's table the derived document on request, and the file byte for byte otherwise", async () => {
    await withServer(async (fx) => {
      const map = anchoredMap()
      const { dmToken, sceneId } = await published(fx, map)
      expect((await api(fx.base, 'GET', `/api/maps/${sceneId}`, { token: dmToken })).text).toBe(JSON.stringify(map))

      const derived = await api(fx.base, 'GET', `/api/maps/${sceneId}?rooms=derived&images=external`, { token: dmToken })
      expect(derived.status).toBe(200)
      const rooms = ((derived.body as unknown as SerializedMapData).layers[0] as DungeonLayer).rooms ?? []
      expect(rooms.map((r) => r.id)).toEqual([HALL.id, VAULT.id])
      for (const room of rooms) {
        expect(room.boundary!.length).toBeGreaterThanOrEqual(3)
        expect(room).not.toHaveProperty('doors')
      }
    })
  })

  it('reads a map saved before anchors the way the editor opens it, same room ids', async () => {
    await withServer(async (fx) => {
      // A detected room as the old editor saved it: a hash id, a ring, a name override.
      const legacy = anchoredMap([], { mapSettings: { name: 'Old' } as SerializedMapData['mapSettings'] })
      const layer = legacy.layers[0] as DungeonLayer & { roomNameOverrides?: Record<string, string> }
      layer.rooms = [
        { id: 'room-abc123', name: 'Room 1', boundary: rect(0.25, 0, 9.75, 10), centroid: [5, 5], area: 95, isPathway: false } as unknown as Room,
      ]
      layer.roomNameOverrides = { 'room-abc123': 'Great Hall' }
      const { campaignId, sceneId } = await published(fx, legacy)
      setFog(fx, campaignId, sceneId, { 'room-abc123': LIT })
      const rooms = (createVision(fx.server.stores).playerMap(sceneId)!.layers[0] as DungeonLayer).rooms ?? []
      expect(rooms.map((r) => [r.id, r.name, r.number])).toEqual([['room-abc123', 'Great Hall', 1]])
      expect(rooms[0]!.boundary!.length).toBeGreaterThanOrEqual(3)
    })
  })
})

// ── prep v3 and room keys ───────────────────────────────────────────────────

describe('prep v3 (§2.2)', () => {
  const ROOM_TRIGGER: TriggerDef = {
    id: 'trg-hall',
    name: 'Hall revealed',
    when: { kind: 'room-revealed', roomId: HALL.id },
    actions: [{ kind: 'show-text', text: 'The hearth flares.', toPlayers: true }],
    once: true,
    enabled: true,
  }

  it('stores a v2 prep blob from an uploaded file as v3', async () => {
    await withServer(async (fx) => {
      const v2 = { version: 2, triggers: [], notes: [] }
      const { sceneId } = await published(fx, anchoredMap(undefined, { prep: v2 as unknown as ScenePrep }))
      expect(JSON.parse(fx.server.stores.scenes.get(sceneId)!.prep!)).toEqual({
        version: 3,
        triggers: [],
        notes: [],
        rooms: [],
      })
    })
  })

  it('resolves a roomId trigger, a roomId note and a room key directly against the room, no zone', async () => {
    await withServer(async (fx) => {
      const note = { id: 'n1', zoneId: '', roomId: VAULT.id, title: 'Vault', body: 'Cold.', imageKeys: [], showOnReveal: true }
      const prep: ScenePrep = { version: 3, triggers: [ROOM_TRIGGER], notes: [note], rooms: [KEY, { ...KEY, roomId: 'room-gone' }] }
      const { campaignId, dmToken, sceneId } = await published(fx, anchoredMap(undefined, { prep }))

      const deps = createTriggerDeps(fx.server.stores, createVision(fx.server.stores).sceneMapOf)
      const resolved = deps.prepOf(campaignId, sceneId)!
      expect(resolved.triggers[0]).toMatchObject({ roomId: HALL.id })
      expect(resolved.triggers[0]!.inert).toBeUndefined()
      expect(resolved.notes[0]).toMatchObject({ roomId: VAULT.id })
      const [hall, gone] = resolved.rooms!
      expect(hall).toMatchObject({ label: '1 · Hall', spawnAt: { x: 5, y: 5 } })
      expect(hall!.region!.length).toBeGreaterThanOrEqual(3)
      expect(gone).toMatchObject({ inert: 'room was deleted' })

      const got = await api(fx.base, 'GET', `/api/scenes/${sceneId}/prep`, { token: dmToken })
      expect(got.body.resolved).toEqual([{ id: ROOM_TRIGGER.id }])
      expect(got.body.resolvedRooms).toEqual([
        { roomId: HALL.id, label: '1 · Hall' },
        { roomId: 'room-gone', inert: 'room was deleted' },
      ])
    })
  })

  it('marks a key encounter that cannot spawn, and leaves the rest of the key working', async () => {
    await withServer(async (fx) => {
      const broken = { ...KEY, encounter: { name: 'Bad', monsters: [{ id: 'm', name: 'X', count: 1, hp: 'lots' }] } }
      const prep: ScenePrep = { version: 3, triggers: [], notes: [], rooms: [broken] }
      const { dmToken, sceneId } = await published(fx, anchoredMap(undefined, { prep }))
      const got = await api(fx.base, 'GET', `/api/scenes/${sceneId}/prep`, { token: dmToken })
      expect(got.body.resolvedRooms).toEqual([
        { roomId: HALL.id, label: '1 · Hall', encounterInert: 'malformed monster HP formula' },
      ])
    })
  })
})

describe('the room key is DM-only prep (§2.2, §13)', () => {
  it('never puts read-aloud, notes or encounter text in a player document, prep view or snapshot', async () => {
    await withServer(async (fx) => {
      const prep: ScenePrep = { version: 3, triggers: [], notes: [], rooms: [KEY] }
      const map = anchoredMap(undefined, { prep, mapSettings: { name: 'Two Rooms', roomsVersion: 2, startingRoomId: HALL.id } as SerializedMapData['mapSettings'] })
      const campaign = await api(fx.base, 'POST', '/api/campaigns', { token: fx.adminPass, body: {} })
      const campaignId = campaign.body.campaignId as string
      const dmToken = campaign.body.token as string
      const uploaded = await api(fx.base, 'POST', `/api/campaigns/${campaignId}/maps`, { token: dmToken, raw: JSON.stringify(map) })
      const sceneId = uploaded.body.sceneId as string

      // The table opens on the map's own starting room: revealed before anyone joins, which is
      // also what makes the key pop for the DM.
      const started = await api(fx.base, 'POST', '/api/sessions', {
        token: dmToken,
        body: { campaignId, sceneId, startingRoom: { sceneId, roomId: HALL.id } },
      })
      expect(started.status).toBe(201)
      expect(fogOf(fx, campaignId, sceneId)[HALL.id]).toEqual(LIT)

      const joined = await api(fx.base, 'POST', '/api/join', { body: { code: started.body.inviteCode as string, name: 'Bob' } })
      const playerToken = joined.body.token as string

      // The player's map: the hall is theirs, its key is not.
      const doc = await api(fx.base, 'GET', `/api/maps/${sceneId}`, { token: playerToken })
      expect(doc.status).toBe(200)
      expect(doc.text).toContain(HALL.id)
      for (const text of [KEY.readAloud, ...SECRETS]) expect(doc.text).not.toContain(text)
      expect(doc.text).not.toContain('"prep"')

      // The prep view is the DM's alone.
      expect((await api(fx.base, 'GET', `/api/scenes/${sceneId}/prep`, { token: playerToken })).status).toBe(403)

      // The reveal popped the key on the DM's log, and on nobody else's.
      const dm = await joinSocket(fx.server.port, dmToken)
      const dmLog = (dm.state.state.modules.triggers as TriggersState).byScene[sceneId]!.log
      expect(dmLog.find((e) => e.kind === 'room-key')).toMatchObject({ toPlayers: false, detail: { roomId: HALL.id } })
      const player = await joinSocket(fx.server.port, playerToken)
      const seen = JSON.stringify(player.state.state.modules)
      for (const text of [KEY.readAloud, ...SECRETS]) expect(seen).not.toContain(text)

      // Share is the one way the read-aloud reaches a player: exactly that text, nothing else.
      const shared = new Promise<string>((resolve) => {
        player.socket.on('message', (raw: Buffer) => {
          const msg = JSON.parse(raw.toString()) as ServerMessage
          if (msg.type === 'state-update' && msg.module === 'triggers') resolve(JSON.stringify(msg.state))
        })
      })
      dm.socket.send(
        JSON.stringify({ type: 'command', module: 'triggers', action: 'share-card', payload: { sceneId, roomId: HALL.id }, seq: 1 }),
      )
      const after = await shared
      expect(after).toContain(KEY.readAloud)
      for (const text of SECRETS) expect(after).not.toContain(text)

      dm.socket.close()
      player.socket.close()
    })
  })
})
