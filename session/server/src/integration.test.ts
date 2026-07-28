// Sprint 2 and 3 acceptance (§2.6), the rows that are provable at the wire: token-move
// fan-out latency across 6 clients, forged-client authorization, whisper privacy inspected
// frame by frame on the socket that must never see it — and S3's fog, which is the same
// question asked of the map itself: what a player's socket is allowed to have carried.
//
// Raw sockets, no browser — same reasoning as the S1 6-client test in ws/session.test.ts:
// the metric is the server's fan-out, and six Chromium event loops sharing one CPU would
// measure the browsers instead. The browser-level halves (drag latency, roll sync in the
// DOM, scene-switch timing) live in session/client/e2e.

import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { once } from 'node:events'
import type { Role, ServerMessage } from '@dnd/core/src/shared/protocol'
import type { AssetChild, DoorChild, Room } from '@dnd/core/src/shared/types'
import type { DungeonLayer, SerializedMapData } from '@dnd/core/src/store/types'
import type { Token, TokensState } from '@dnd/mechanics/tokens'
import { issueToken, startSession } from './auth'
import type { SessionRow } from './db/stores'
import { startServer, type RunningServer, type StartOptions } from './index'

beforeAll(() => {
  process.env.GAME_SERVER_DATA = mkdtempSync(join(tmpdir(), 'game-server-s2-'))
})

// ── Harness ─────────────────────────────────────────────────────────────────
// ponytail: a trimmed copy of ws/session.test.ts's harness. Importing that file would
// re-run its whole suite inside this one — a shared helper module is the fix if a third
// caller ever appears.

async function withServer(
  options: StartOptions,
  body: (server: RunningServer) => Promise<void>,
): Promise<void> {
  const server = await startServer({ port: 0, heartbeatMs: 60_000, dbPath: ':memory:', ...options })
  try {
    await body(server)
  } finally {
    await server.close()
  }
}

const tables = new WeakMap<RunningServer, Map<string, SessionRow>>()

/**
 * One campaign with one active session (and one map, so `activeSceneId` is real) per name.
 * `data` is only read on the first touch of a name — S3's rows seat their table on the
 * dressed gate map, everything before them on a map with nothing in it.
 */
function table(server: RunningServer, name: string, data = '{}'): SessionRow {
  let byName = tables.get(server)
  if (!byName) tables.set(server, (byName = new Map()))

  let row = byName.get(name)
  if (!row) {
    const campaign = server.stores.campaigns.create(name)
    // Tokens are scene-scoped and `sceneId` defaults to the active scene (§2.2), so every
    // table here needs a scene for the commands to land the way a real client sends them.
    server.stores.maps.insert(`${name}-map`, campaign.id, `${name} Map`, data)
    row = startSession(server.stores.sessions, campaign.id)
    byName.set(name, row)
  }
  return row
}

interface Seat {
  name: string
  session?: string
  role?: Role
  identity?: string
}

function ticket(
  server: RunningServer,
  { name, session = 'default', role = 'player', identity }: Seat,
): string {
  const row = table(server, session)
  const id = identity ?? `${session}-${name}`
  if (!server.stores.identities.get(id)) server.stores.identities.mint(id, row.campaign_id, name, role)
  return issueToken(server.config.secrets.hmacSecret, id, row.campaign_id, role)
}

async function connect(server: RunningServer, seat: Seat): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/?token=${ticket(server, seat)}`)
  await once(socket, 'open')
  return socket
}

type MessageOf<T extends ServerMessage['type']> =
  ServerMessage extends infer M
    ? M extends { type: ServerMessage['type'] }
      ? T extends M['type']
        ? M
        : never
      : never
    : never

/** Resolves on the next message of `type`, ignoring any that arrive before it. */
function next<T extends ServerMessage['type']>(socket: WebSocket, type: T): Promise<MessageOf<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage)
      reject(new Error(`timed out waiting for '${type}'`))
    }, 2000)
    const onMessage = (raw: Buffer | ArrayBuffer | Buffer[]) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage
      if (msg.type !== type) return
      clearTimeout(timer)
      socket.off('message', onMessage)
      resolve(msg as MessageOf<T>)
    }
    socket.on('message', onMessage)
  })
}

/**
 * The next `state-update` for one module — other modules' updates are stepped over, and so
 * is any that `where` rejects. The predicate matters here: a redacted broadcast still
 * *arrives* for a viewer it carries nothing for (that is the whisper test's whole subject),
 * so "the next tokens/rolls frame" and "the frame carrying my command's result" differ.
 */
function nextState<S>(socket: WebSocket, module: string, where: (state: S) => boolean = () => true): Promise<S> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage)
      reject(new Error(`timed out waiting for a '${module}' state-update`))
    }, 2000)
    const onMessage = (raw: Buffer | ArrayBuffer | Buffer[]) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage
      if (msg.type !== 'state-update' || msg.module !== module) return
      if (!where(msg.state as S)) return
      clearTimeout(timer)
      socket.off('message', onMessage)
      resolve(msg.state as S)
    }
    socket.on('message', onMessage)
  })
}

function sendJoin(socket: WebSocket, protocolVersion = 3): void {
  socket.send(JSON.stringify({ type: 'join', protocolVersion }))
}

function sendCommand(socket: WebSocket, module: string, action: string, payload: unknown): void {
  socket.send(JSON.stringify({ type: 'command', module, action, payload, seq: 1 }))
}

/**
 * The next frame matching `where`, parsed but untyped: a fog `state-update` carries a
 * `mapDelta` the wire union in @dnd/core does not declare (§2.1/§2.5).
 */
function nextRaw(
  socket: WebSocket,
  where: (msg: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage)
      reject(new Error('timed out waiting for a frame'))
    }, 2000)
    const onMessage = (raw: Buffer) => {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>
      if (!where(msg)) return
      clearTimeout(timer)
      socket.off('message', onMessage)
      resolve(msg)
    }
    socket.on('message', onMessage)
  })
}

/** Every frame this socket receives, verbatim — what a packet capture would show. */
function rawFrames(socket: WebSocket): string[] {
  const seen: string[] = []
  socket.on('message', (raw: Buffer) => seen.push(raw.toString()))
  return seen
}

/** A DM plus `players` players, all joined, in one session. */
async function seatTable(
  server: RunningServer,
  session: string,
  players: number,
): Promise<{ dm: WebSocket; players: WebSocket[]; all: WebSocket[] }> {
  const dm = await connect(server, { role: 'dm', name: 'Ann', session })
  sendJoin(dm)
  await next(dm, 'session-state')

  const seated: WebSocket[] = []
  for (let i = 0; i < players; i++) {
    const socket = await connect(server, { identity: `${session}-p${i}`, name: `P${i}`, session })
    sendJoin(socket)
    await next(socket, 'session-state')
    await next(dm, 'player-joined')
    seated.push(socket)
  }
  return { dm, players: seated, all: [dm, ...seated] }
}

const only = (state: TokensState, sceneId: string): Token => {
  const tokens = Object.values(state.byScene[sceneId] ?? {})
  expect(tokens).toHaveLength(1)
  return tokens[0]
}

// ── §2.6: token move < 100ms across 6 clients ───────────────────────────────

describe('token move fan-out (§2.6 metric)', () => {
  it('reaches all 6 clients in under 100ms and lands on the snapped cell', async () => {
    await withServer({}, async (server) => {
      const sceneId = 'TM-map'
      const { dm, players, all } = await seatTable(server, 'TM', 5)
      expect(all).toHaveLength(6)

      // The DM places it; a player claims it, so the move below travels the ownership path
      // a real player's drag takes (D10) rather than the DM's blanket permission.
      const placed = nextState<TokensState>(dm, 'tokens')
      sendCommand(dm, 'tokens', 'place', { name: 'Goblin', x: 1.2, y: 1.7 })
      const token = only(await placed, sceneId)

      const claimed = nextState<TokensState>(dm, 'tokens')
      sendCommand(players[0], 'tokens', 'claim', { id: token.id })
      expect(only(await claimed, sceneId).ownerId).toBe('TM-p0')

      const rounds: number[][] = []
      let last: TokensState | undefined
      for (let round = 0; round < 5; round++) {
        // Each socket's own arrival, not one "all done" wait: the metric is per-client
        // latency and averaging the slowest away would hide exactly the failure it names.
        const arrivals = all.map(
          (socket) =>
            new Promise<number>((resolve) => {
              const onMessage = (raw: Buffer) => {
                const at = performance.now()
                const msg = JSON.parse(raw.toString()) as ServerMessage
                if (msg.type !== 'state-update' || msg.module !== 'tokens') return
                socket.off('message', onMessage)
                last = msg.state as TokensState
                resolve(at)
              }
              socket.on('message', onMessage)
            }),
        )
        const sentAt = performance.now()
        sendCommand(players[0], 'tokens', 'move', { id: token.id, x: 4.2 + round, y: 6.9 })
        rounds.push((await Promise.all(arrivals)).map((at) => at - sentAt))
      }

      const worstPerRound = rounds.map((round) => Math.max(...round))
      const worst = Math.max(...worstPerRound)
      console.log(
        `[metric] token move → 6 clients: worst ${worst.toFixed(1)}ms, ` +
          `per-round worst [${worstPerRound.map((ms) => ms.toFixed(1)).join(', ')}]ms ` +
          `(target < 100ms)`,
      )
      expect(worst).toBeLessThan(100)

      // D13: a medium token snaps to the cell centre, so what everyone received is the
      // authoritative position, not the raw pointer coordinates.
      expect(only(last!, sceneId)).toMatchObject({ id: token.id, x: 8.5, y: 6.5 })

      // And it is in the database, not only on the wire — every setState persists (D5).
      const persisted = server.stores.moduleState.get(
        table(server, 'TM').campaign_id,
        'tokens',
      ) as TokensState
      expect(persisted.byScene[sceneId][token.id]).toMatchObject({ x: 8.5, y: 6.5 })
    })
  })
})

// ── §2.6: ownership enforcement (forged client) ─────────────────────────────

describe('forged clients (§2.6 ownership enforcement)', () => {
  it('refuses a move of someone else’s token and changes nothing', async () => {
    await withServer({}, async (server) => {
      const sceneId = 'FM-map'
      const { dm, players } = await seatTable(server, 'FM', 2)
      const [mine, theirs] = players

      const placed = nextState<TokensState>(dm, 'tokens')
      sendCommand(dm, 'tokens', 'place', { name: 'Borin', x: 2.4, y: 2.4 })
      const token = only(await placed, sceneId)

      const claimed = nextState<TokensState>(dm, 'tokens')
      sendCommand(mine, 'tokens', 'claim', { id: token.id })
      await claimed

      // A hand-rolled frame: the real client would never send this, which is the point.
      sendCommand(theirs, 'tokens', 'move', { id: token.id, x: 40, y: 40 })
      const refusal = await next(theirs, 'error')
      expect(refusal.code).toBe('unauthorized')

      // Nobody was told anything moved…
      await expect(nextState(dm, 'tokens')).rejects.toThrow(/timed out/)
      // …and the table's own snapshot still has it where the claim left it.
      sendJoin(dm)
      const snapshot = await next(dm, 'session-state')
      expect(only(snapshot.state.modules.tokens as TokensState, sceneId)).toMatchObject({
        x: 2.5,
        y: 2.5,
        ownerId: 'FM-p0',
      })
      expect(theirs.readyState).toBe(WebSocket.OPEN) // a refusal, not a disconnect
    })
  })

  it('refuses a player’s hide, and a claim on a hidden token it should not know exists', async () => {
    await withServer({}, async (server) => {
      const sceneId = 'FH-map'
      const { dm, players } = await seatTable(server, 'FH', 1)
      const [player] = players
      const seen = rawFrames(player)

      const placed = nextState<TokensState>(dm, 'tokens')
      sendCommand(dm, 'tokens', 'place', { name: 'Visible', x: 1.1, y: 1.1 })
      const visible = only(await placed, sceneId)

      // `hide` is DM-only in `commands`, so this never reaches the handler at all.
      sendCommand(player, 'tokens', 'hide', { id: visible.id })
      expect((await next(player, 'error')).code).toBe('unauthorized')

      const hiddenPlaced = nextState<TokensState>(dm, 'tokens')
      sendCommand(dm, 'tokens', 'place', { name: 'Ambusher', x: 9.1, y: 9.1, hidden: true })
      const ambusher = Object.values((await hiddenPlaced).byScene[sceneId]).find((t) => t.hidden)!
      expect(ambusher.name).toBe('Ambusher')

      // The player never received it (D4 drops hidden tokens whole), but a forged client
      // can still guess an id — the handler answers as if the token does not exist, so the
      // guess is not even confirmed (the belt to redaction's braces).
      sendCommand(player, 'tokens', 'claim', { id: ambusher.id })
      expect((await next(player, 'error')).code).toBe('invalid-command')

      sendJoin(player)
      const snapshot = await next(player, 'session-state')
      const forPlayer = snapshot.state.modules.tokens as TokensState
      expect(Object.keys(forPlayer.byScene[sceneId])).toEqual([visible.id])
      expect(Object.values(forPlayer.byScene[sceneId])[0].ownerId).toBeNull()

      // Nothing about the ambusher — not its id, not its name, not its position — was ever
      // on this socket, in any frame, redacted or otherwise.
      for (const frame of seen) {
        expect(frame).not.toContain(ambusher.id)
        expect(frame).not.toContain('Ambusher')
      }
    })
  })
})

// ── §2.6: whisper privacy, at the wire ──────────────────────────────────────

describe('whisper privacy (§2.6 anti-Owlbear check)', () => {
  it('never puts a private roll on the other player’s socket', async () => {
    await withServer({}, async (server) => {
      const { dm, players } = await seatTable(server, 'W', 2)
      const [alice, bob] = players
      const dmFrames = rawFrames(dm)
      const bobFrames = rawFrames(bob)
      const CANARY = 'whisper-canary-9f3'

      const heardByDm = nextState<{ log: { text?: string }[] }>(dm, 'rolls')
      const heardByAlice = nextState<{ log: { text?: string }[] }>(alice, 'rolls')
      sendCommand(alice, 'rolls', 'post', {
        source: 'manual',
        text: CANARY,
        visibility: 'private',
      })
      expect((await heardByDm).log.map((e) => e.text)).toEqual([CANARY])
      expect((await heardByAlice).log.map((e) => e.text)).toEqual([CANARY])

      // Bob's socket is FIFO: once his own public roll has come back, anything the server
      // would have sent him about Alice's whisper has already arrived (or never will).
      const heardByBob = nextState<{ log: { text?: string }[] }>(
        bob,
        'rolls',
        (state) => state.log.length > 0,
      )
      sendCommand(bob, 'rolls', 'post', {
        source: 'manual',
        text: 'I check the door',
        visibility: 'public',
      })
      expect((await heardByBob).log.map((e) => e.text)).toEqual(['I check the door'])

      // Bob *was* broadcast to for Alice's whisper — with an empty log. That frame is why
      // this test reads bytes instead of trusting "the update never went out".
      const emptied = bobFrames.some(
        (frame) => frame.includes('"module":"rolls"') && frame.includes('"log":[]'),
      )
      expect(emptied).toBe(true)

      // The whole point of the row: not "the UI hides it" but "it was never sent".
      expect(bobFrames.length).toBeGreaterThan(0)
      for (const frame of bobFrames) expect(frame).not.toContain(CANARY)
      expect(dmFrames.filter((frame) => frame.includes(CANARY)).length).toBeGreaterThan(0)
    })
  })
})

// ── §2.6 (S3): fog is server-enforced ───────────────────────────────────────
// On the dressed gate map, because a redactor is only honest against real content: the
// rooms, corridors, secret door and stranded props here are the ones the browser gate
// walks. Ids are looked up by shape, never spelled out, so re-authoring the map cannot
// quietly turn these into assertions about nothing.

const GATE_MAP = readFileSync(join(import.meta.dirname, '../../testdata/emberhold-crypt.mapbuilder'), 'utf8')
const crypt = JSON.parse(GATE_MAP) as SerializedMapData
const cryptLayer = crypt.layers.find((l): l is DungeonLayer => l.type === 'dungeon')!
const cryptRooms = cryptLayer.rooms ?? []
const cryptDoors = cryptLayer.children.filter((c): c is DoorChild => c.childType === 'door')
const SECRET = cryptDoors.find((d) => d.isSecret)!
/** An ordinary door the map authors open: the two rooms either side of it test D3 layer 2. */
const AJAR = cryptDoors.find((d) => d.state === 'open' && !d.isSecret)!
const roomOf = (id: string | null | undefined): Room => cryptRooms.find((r) => r.id === id)!

/** Props the map leaves outside every room's bounding box are unzoned beyond argument (D6). */
const STRANDED = cryptLayer.children.filter((child): child is AssetChild => {
  if (child.childType !== 'asset') return false
  const { x, y } = child.position
  return cryptRooms.every((room) => {
    const xs = room.boundary.map((p) => p[0])
    const ys = room.boundary.map((p) => p[1])
    return x < Math.min(...xs) || x > Math.max(...xs) || y < Math.min(...ys) || y > Math.max(...ys)
  })
})

const dungeonOf = (map: SerializedMapData): DungeonLayer =>
  map.layers.find((l): l is DungeonLayer => l.type === 'dungeon')!

async function fetchMap(server: RunningServer, seat: Seat, sceneId: string): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${server.port}/api/maps/${sceneId}`, {
    headers: { Authorization: `Bearer ${ticket(server, seat)}` },
  })
  expect(res.status).toBe(200)
  return res.text()
}

/** A DM and `players` players seated on the gate map. */
async function crypts(server: RunningServer, name: string, players = 1) {
  table(server, name, GATE_MAP)
  return { sceneId: `${name}-map`, ...(await seatTable(server, name, players)) }
}

describe('fog redaction on the map payload (§2.6, D4)', () => {
  it('gives a player the rooms the party has been in and no trace of the rest', async () => {
    await withServer({}, async (server) => {
      const { sceneId, dm } = await crypts(server, 'FGA', 1)
      const seen = roomOf(AJAR.roomA)

      const revealed = nextState(dm, 'fog')
      sendCommand(dm, 'fog', 'reveal', { roomId: seen.id })
      await revealed

      const wire = await fetchMap(server, { name: 'P0', session: 'FGA', identity: 'FGA-p0' }, sceneId)
      const layer = dungeonOf(JSON.parse(wire) as SerializedMapData)

      expect(layer.rooms?.map((r) => r.id)).toEqual([seen.id])
      // Not the geometry, not the id, not the DM's name for it.
      for (const room of cryptRooms) {
        if (room.id === seen.id) continue
        expect(wire, `${room.name} survived redaction`).not.toContain(room.id)
        expect(wire).not.toContain(room.name)
      }
      expect(wire).not.toContain(SECRET.id)
      expect(STRANDED.length).toBeGreaterThan(0)
      for (const prop of STRANDED) expect(wire).not.toContain(prop.id)
      // Something did survive — a payload that is empty proves nothing.
      expect(layer.children.length).toBeGreaterThan(0)
      expect(layer.standaloneWalls.length).toBeGreaterThan(0)
      expect(layer.standaloneWalls.length).toBeLessThan(cryptLayer.standaloneWalls.length)
    })
  })

  it('gives the DM the file exactly as it was uploaded', async () => {
    await withServer({}, async (server) => {
      const { sceneId, dm } = await crypts(server, 'FGB', 1)
      const revealed = nextState(dm, 'fog')
      sendCommand(dm, 'fog', 'reveal', { roomId: cryptRooms[0].id })
      await revealed
      expect(await fetchMap(server, { role: 'dm', name: 'Ann', session: 'FGB' }, sceneId)).toBe(GATE_MAP)
    })
  })

  it('leaves a re-hidden room drawable — explored memory survives a reload (D4)', async () => {
    await withServer({}, async (server) => {
      const { sceneId, dm } = await crypts(server, 'FGC', 1)
      const seen = roomOf(AJAR.roomA)

      for (const action of ['reveal', 'hide']) {
        const done = nextState(dm, 'fog')
        sendCommand(dm, 'fog', action, { roomId: seen.id })
        await done
      }

      // The reload: a fresh GET on the same session, after the room went dark again.
      const layer = dungeonOf(
        JSON.parse(
          await fetchMap(server, { name: 'P0', session: 'FGC', identity: 'FGC-p0' }, sceneId),
        ) as SerializedMapData,
      )
      expect(layer.rooms?.map((r) => r.id)).toEqual([seen.id])
      expect(layer.children.length).toBeGreaterThan(0)
    })
  })
})

describe('fog redaction on snapshots (§2.6, D4a)', () => {
  it('redacts the join snapshot, and the reconnect snapshot the same way', async () => {
    await withServer({}, async (server) => {
      const { sceneId, dm } = await crypts(server, 'FGD', 1)
      const seen = roomOf(AJAR.roomA)

      const revealed = nextState(dm, 'fog')
      sendCommand(dm, 'fog', 'reveal', { roomId: seen.id })
      await revealed
      // Seeds the whole scene's door state, secret door included — so its absence below
      // is redaction and not an empty record.
      const doorsSeeded = nextState<Record<string, unknown>>(dm, 'doors')
      sendCommand(dm, 'doors', 'toggle', { id: AJAR.id })
      await doorsSeeded

      const check = async (socket: WebSocket) => {
        sendJoin(socket)
        const snapshot = await next(socket, 'session-state')
        const fog = snapshot.state.modules.fog as { byScene: Record<string, { rooms: object }> }
        expect(Object.keys(fog.byScene[sceneId].rooms)).toEqual([seen.id])
        expect(JSON.stringify(snapshot)).not.toContain(SECRET.id)
        for (const room of cryptRooms) {
          if (room.id !== seen.id) expect(JSON.stringify(snapshot)).not.toContain(room.id)
        }
      }

      // The DM's own view is whole: every room, and the secret door among them.
      sendJoin(dm)
      const dmSnapshot = await next(dm, 'session-state')
      expect(JSON.stringify(dmSnapshot)).toContain(SECRET.id)

      const player = await connect(server, { identity: 'FGD-p0', name: 'P0', session: 'FGD' })
      await check(player)

      // …and a mid-session reload is the same socket story told again (§2.6 added row).
      player.close()
      await once(player, 'close')
      await check(await connect(server, { identity: 'FGD-p0', name: 'P0', session: 'FGD' }))
    })
  })
})

describe('reveal and retraction broadcasts (§2.6, D4c/D5)', () => {
  it('carries the revealed room’s geometry in the same frame as the reveal', async () => {
    await withServer({}, async (server) => {
      const { dm, players } = await crypts(server, 'FGE', 1)
      const [player] = players
      const seen = roomOf(AJAR.roomA)

      const frame = nextRaw(player, (m) => m.type === 'state-update' && m.module === 'fog')
      sendCommand(dm, 'fog', 'reveal', { roomId: seen.id })

      const delta = (await frame).mapDelta as {
        sceneId: string
        layers: { rooms: { id: string }[]; children: { id: string }[] }[]
      }
      // Atomic: the state that says "revealed" and the geometry to draw it, one message.
      expect(delta.layers[0].rooms.map((r) => r.id)).toEqual([seen.id])
      expect(delta.layers[0].children.length).toBeGreaterThan(0)

      // The DM is sent no delta — they were never missing any of it.
      const dmFrame = nextRaw(dm, (m) => m.type === 'state-update' && m.module === 'fog')
      sendCommand(dm, 'fog', 'reveal', { roomId: roomOf(AJAR.roomB).id })
      expect((await dmFrame).mapDelta).toBeUndefined()
    })
  })

  it('retracts what a hide takes away, rather than leaving it in client memory', async () => {
    await withServer({}, async (server) => {
      const { sceneId, dm, players } = await crypts(server, 'FGF', 1)
      const [player] = players
      const seen = roomOf(AJAR.roomA)

      const revealed = nextState(dm, 'fog')
      sendCommand(dm, 'fog', 'reveal', { roomId: seen.id })
      await revealed

      const arrived = nextState<TokensState>(player, 'tokens', (s) =>
        Object.keys(s.byScene[sceneId] ?? {}).length > 0,
      )
      sendCommand(dm, 'tokens', 'place', {
        name: 'Ghoul',
        x: seen.centroid[0],
        y: seen.centroid[1],
      })
      expect(Object.values((await arrived).byScene[sceneId]).map((t) => t.name)).toEqual(['Ghoul'])

      // The hide is a fog command, yet the tokens slice has to come back out: without it
      // the ghoul's last position simply stays on the player's screen (D4c).
      const dropped = nextState<TokensState>(player, 'tokens')
      sendCommand(dm, 'fog', 'hide', { roomId: seen.id })
      expect(Object.keys((await dropped).byScene[sceneId] ?? {})).toEqual([])
    })
  })

  it('retracts when a door closes under concealment, and never your own token (D7)', async () => {
    await withServer({}, async (server) => {
      const { sceneId, dm, players } = await crypts(server, 'FGG', 1)
      const [player] = players
      const here = roomOf(AJAR.roomA)
      const beyond = roomOf(AJAR.roomB)

      for (const room of [here, beyond]) {
        const done = nextState(dm, 'fog')
        sendCommand(dm, 'fog', 'reveal', { roomId: room.id })
        await done
      }

      const placed = nextState<TokensState>(dm, 'tokens')
      sendCommand(dm, 'tokens', 'place', { name: 'Bran', x: here.centroid[0], y: here.centroid[1] })
      const mine = Object.values((await placed).byScene[sceneId])[0]

      const claimed = nextState<TokensState>(dm, 'tokens')
      sendCommand(player, 'tokens', 'claim', { id: mine.id })
      await claimed

      // A monster through the open door: the party can see it from where they stand.
      const seen = nextState<TokensState>(player, 'tokens', (s) =>
        Object.keys(s.byScene[sceneId] ?? {}).length === 2,
      )
      sendCommand(dm, 'tokens', 'place', {
        name: 'Wight',
        x: beyond.centroid[0],
        y: beyond.centroid[1],
      })
      await seen

      // Shutting it costs them the sight of it — and nothing else.
      const shut = nextState<TokensState>(player, 'tokens', (s) =>
        Object.keys(s.byScene[sceneId] ?? {}).length === 1,
      )
      sendCommand(dm, 'doors', 'toggle', { id: AJAR.id })
      expect(Object.values((await shut).byScene[sceneId]).map((t) => t.name)).toEqual(['Bran'])

      sendJoin(player)
      const snapshot = await next(player, 'session-state')
      const tokens = snapshot.state.modules.tokens as TokensState
      expect(Object.values(tokens.byScene[sceneId]).map((t) => t.name)).toEqual(['Bran'])
    })
  })
})

describe('canOccupy at the wire (§2.6, D8)', () => {
  it('fences a player out of the dark and the unzoned, and the DM out of nothing', async () => {
    await withServer({}, async (server) => {
      const { sceneId, dm, players } = await crypts(server, 'FGH', 1)
      const [player] = players
      const here = roomOf(AJAR.roomA)
      const unseen = cryptRooms.find((r) => r.id !== here.id && r.id !== AJAR.roomB)!

      const revealed = nextState(dm, 'fog')
      sendCommand(dm, 'fog', 'reveal', { roomId: here.id })
      await revealed

      const placed = nextState<TokensState>(dm, 'tokens')
      sendCommand(dm, 'tokens', 'place', { name: 'Bran', x: here.centroid[0], y: here.centroid[1] })
      const mine = Object.values((await placed).byScene[sceneId])[0]
      const claimed = nextState<TokensState>(dm, 'tokens')
      sendCommand(player, 'tokens', 'claim', { id: mine.id })
      await claimed

      // Their own room: a step is a step.
      const moved = nextState<TokensState>(dm, 'tokens')
      sendCommand(player, 'tokens', 'move', { id: mine.id, x: here.centroid[0] + 1, y: here.centroid[1] })
      await moved

      for (const target of [
        { name: 'a room nobody has entered', x: unseen.centroid[0], y: unseen.centroid[1] },
        { name: 'unzoned map', x: 9999, y: 9999 },
      ]) {
        sendCommand(player, 'tokens', 'move', { id: mine.id, x: target.x, y: target.y })
        expect((await next(player, 'error')).code, target.name).toBe('invalid-command')
      }

      // The DM answers to none of it.
      const dmMoved = nextState<TokensState>(dm, 'tokens')
      sendCommand(dm, 'tokens', 'move', { id: mine.id, x: unseen.centroid[0], y: unseen.centroid[1] })
      expect(Object.values((await dmMoved).byScene[sceneId])[0].x).toBeCloseTo(
        Math.floor(unseen.centroid[0]) + 0.5,
      )
    })
  })
})
