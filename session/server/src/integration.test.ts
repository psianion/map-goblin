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
import type { AnyChild, AssetChild, DoorChild, Room } from '@dnd/core/src/shared/types'
import type { DungeonLayer, SerializedMapData } from '@dnd/core/src/store/types'
import type { Token, TokensState } from '@dnd/mechanics/tokens'
import type { DoorLiveState, DoorsState } from '@dnd/mechanics/doors'
import type { FogState, RoomFog } from '@dnd/mechanics/fog'
import { defaultRoom } from '@dnd/mechanics/fog'
import { issueToken, startSession } from './auth'
import { centreOf } from './fog/sceneMap'
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
    // #47 — a scene is its own row now; the map's own id doubles as the scene's, same as
    // the auto-published path http.ts's `uploadMap` takes.
    const map = server.stores.maps.insert(`${name}-map`, campaign.id, `${name} Map`, data)
    server.stores.scenes.create(map.id, campaign.id, map.id, map.name)
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

function sendJoin(socket: WebSocket, protocolVersion = 4): void {
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

/**
 * The same wait, with a stopwatch and a byte count: the first frame `where` accepts, the
 * instant it landed, and how big it was. The clock is read before `JSON.parse` — the metric
 * is when the bytes arrived, not when a test finished reading them.
 */
function timedFrame(
  socket: WebSocket,
  where: (msg: Record<string, unknown>) => boolean,
): Promise<{ at: number; bytes: number; msg: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage)
      reject(new Error('timed out waiting for a frame'))
    }, 5000)
    const onMessage = (raw: Buffer) => {
      const at = performance.now()
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>
      if (!where(msg)) return
      clearTimeout(timer)
      socket.off('message', onMessage)
      resolve({ at, bytes: raw.length, msg })
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
/**
 * The ordinary door the concealment rows swing: not secret (players may know of it) and not
 * an archway (archways have no leaf to swing — `toggle` rejects them, and a test that opened
 * one would hang waiting for a broadcast that is never sent). Authored closed, so the rows
 * that need it open say so.
 */
const AJAR = cryptDoors.find((d) => !d.isSecret && d.style !== 'archway')!
const roomOf = (id: string | null | undefined): Room => cryptRooms.find((r) => r.id === id)!

/**
 * The map's largest non-pathway room — on this map, the Torchlit Chamber, which is also the
 * brightest thing on it. The default-room fallback used to lend it to a player who had been
 * told nothing (amendment 2026-07-28) and the fourth browser gate read it at full brightness
 * on a scene the DM's panel called Unrevealed, so the rows below are how that stays fixed.
 * Taken from the mechanics helper rather than spelled out, so a re-authored map moves them
 * with it instead of quietly passing.
 */
const BIGGEST_ROOM = defaultRoom(cryptRooms)!

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
      // The explored room and nothing beside it: taking the last reveal back leaves a
      // memory, never a fresh loan of the biggest room on the map.
      expect(layer.rooms?.map((r) => r.id)).toEqual([seen.id])
      expect(layer.children.length).toBeGreaterThan(0)
    })
  })
})

describe('an unrevealed room on the wire', () => {
  it('is not a player’s at join, is theirs once revealed, and is taken back on reset', async () => {
    await withServer({}, async (server) => {
      const { sceneId, dm } = await crypts(server, 'FGJ', 1)
      const seat = { name: 'P0', session: 'FGJ', identity: 'FGJ-p0' }
      const wire = async () => await fetchMap(server, seat, sceneId)
      const roomsHeld = async () =>
        dungeonOf(JSON.parse(await wire()) as SerializedMapData)
          .rooms?.map((r) => r.id)
          .sort()

      // No command has been run at all, so the player is handed no room whatsoever — and
      // above all not the brightest one on the map, whose light is baked into geometry a
      // canvas cannot dim once it holds it.
      expect(await roomsHeld()).toEqual([])
      expect(await wire()).not.toContain(BIGGEST_ROOM.id)
      expect(BIGGEST_ROOM.id).not.toBe(roomOf(AJAR.roomA).id)

      const revealed = nextState(dm, 'fog')
      sendCommand(dm, 'fog', 'reveal', { roomId: roomOf(AJAR.roomA).id })
      await revealed
      expect(await roomsHeld()).toEqual([roomOf(AJAR.roomA).id])

      const cleared = nextState(dm, 'fog')
      sendCommand(dm, 'fog', 'reset', {})
      await cleared
      expect(await roomsHeld()).toEqual([])
    })
  })

  it('retracts what stood in it the moment the DM takes the room back (D4c)', async () => {
    await withServer({}, async (server) => {
      const { sceneId, dm, players } = await crypts(server, 'FGK', 1)
      const [player] = players

      const lit = nextState(dm, 'fog')
      sendCommand(dm, 'fog', 'reveal', { roomId: BIGGEST_ROOM.id })
      await lit

      // Revealed, so a monster standing in it is a monster the player can see.
      const arrived = nextState<TokensState>(player, 'tokens', (s) =>
        Object.keys(s.byScene[sceneId] ?? {}).length > 0,
      )
      sendCommand(dm, 'tokens', 'place', {
        name: 'Ghast',
        x: BIGGEST_ROOM.centroid[0],
        y: BIGGEST_ROOM.centroid[1],
      })
      expect(Object.values((await arrived).byScene[sceneId]).map((t) => t.name)).toEqual(['Ghast'])

      // Hiding the room takes the ghast with it, actively, rather than leaving its last
      // position on the player's screen.
      const dropped = nextState<TokensState>(player, 'tokens')
      sendCommand(dm, 'fog', 'hide', { roomId: BIGGEST_ROOM.id })
      expect(Object.keys((await dropped).byScene[sceneId] ?? {})).toEqual([])
    })
  })

  it('stays unrevealed when a Hide All puts every explored room back under (D9)', async () => {
    await withServer({}, async (server) => {
      const { sceneId, dm } = await crypts(server, 'FGL', 1)
      const seat = { name: 'P0', session: 'FGL', identity: 'FGL-p0' }
      const here = roomOf(AJAR.roomA)

      const revealed = nextState(dm, 'fog')
      sendCommand(dm, 'fog', 'reveal', { roomId: here.id })
      await revealed

      // What the DM's Hide All sends: everything seen, nothing lit.
      const hidden = nextState(dm, 'fog')
      sendCommand(dm, 'fog', 'set-bulk', {
        rooms: { [here.id]: { status: 're_hidden', wasEverRevealed: true } },
      })
      await hidden

      // The memory they earned, and not one room more: nothing lit is nothing lent.
      const layer = dungeonOf(JSON.parse(await fetchMap(server, seat, sceneId)) as SerializedMapData)
      expect(layer.rooms?.map((r) => r.id)).toEqual([here.id])
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

  it('retracts the room the party is standing in, and leaves them their own token (D7)', async () => {
    await withServer({}, async (server) => {
      const { sceneId, dm, players } = await crypts(server, 'FGI', 1)
      const [player] = players
      const here = roomOf(AJAR.roomA)

      const revealed = nextState(dm, 'fog')
      sendCommand(dm, 'fog', 'reveal', { roomId: here.id })
      await revealed

      // Bran is the party, and the party is *inside* the room about to go dark. D7 allows
      // it — a DM plunging the table into darkness is drama, not an error — so what the
      // row is really about is which of the two tokens survives the retraction.
      const placed = nextState<TokensState>(dm, 'tokens')
      sendCommand(dm, 'tokens', 'place', { name: 'Bran', x: here.centroid[0], y: here.centroid[1] })
      const mine = Object.values((await placed).byScene[sceneId])[0]
      const claimed = nextState<TokensState>(dm, 'tokens')
      sendCommand(player, 'tokens', 'claim', { id: mine.id })
      await claimed

      const bothSeen = nextState<TokensState>(player, 'tokens', (s) =>
        Object.keys(s.byScene[sceneId] ?? {}).length === 2,
      )
      sendCommand(dm, 'tokens', 'place', {
        name: 'Ghoul',
        x: here.centroid[0] + 1,
        y: here.centroid[1],
      })
      await bothSeen

      // The lights go out with everyone still in the room: the ghoul's last position is
      // actively taken back (D4c), and the player keeps the one thing they always keep.
      const dropped = nextState<TokensState>(player, 'tokens', (s) =>
        Object.keys(s.byScene[sceneId] ?? {}).length < 2,
      )
      sendCommand(dm, 'fog', 'hide', { roomId: here.id })
      expect(Object.values((await dropped).byScene[sceneId] ?? {}).map((t) => t.name)).toEqual([
        'Bran',
      ])

      // And the DM still has both — retraction is a redaction, not a deletion.
      sendJoin(dm)
      const dmSnapshot = await next(dm, 'session-state')
      const dmTokens = (dmSnapshot.state.modules.tokens as TokensState).byScene[sceneId]
      expect(Object.values(dmTokens).map((t) => t.name).sort()).toEqual(['Bran', 'Ghoul'])
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

      // The door is authored shut, so the sight this row takes away has to be given first.
      const opened = nextState(dm, 'doors')
      sendCommand(dm, 'doors', 'toggle', { id: AJAR.id })
      await opened

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

  it('hands the rest of the map over the moment concealment is switched off (D3 layer 2)', async () => {
    // The second browser gate read this as a bug: every room revealed, and a player still
    // holding nothing but the tokens in the room they stand in. That half is D3 working —
    // every door on the gate map is authored shut, so nothing is reachable. What has to be
    // true is the other half: the toggle that turns the rule off is felt without a reload,
    // by a slice no command in it touched.
    await withServer({}, async (server) => {
      const { sceneId, dm, players } = await crypts(server, 'FGH', 1)
      const [player] = players
      const here = roomOf(AJAR.roomA)
      const beyond = roomOf(AJAR.roomB)

      // Reveal All, exactly as the fog tool sends it — and every door still shut.
      const revealedAll = nextState(dm, 'fog')
      sendCommand(dm, 'fog', 'set-bulk', {
        rooms: Object.fromEntries(
          cryptRooms.map((room) => [room.id, { status: 'revealed', wasEverRevealed: true }]),
        ),
      })
      await revealedAll

      const placed = nextState<TokensState>(dm, 'tokens')
      sendCommand(dm, 'tokens', 'place', { name: 'Bran', x: here.centroid[0], y: here.centroid[1] })
      const mine = Object.values((await placed).byScene[sceneId])[0]
      const claimed = nextState<TokensState>(dm, 'tokens')
      sendCommand(player, 'tokens', 'claim', { id: mine.id })
      await claimed

      const alone = nextState<TokensState>(player, 'tokens')
      sendCommand(dm, 'tokens', 'place', {
        name: 'Wight',
        x: beyond.centroid[0],
        y: beyond.centroid[1],
      })
      expect(Object.values((await alone).byScene[sceneId]).map((t) => t.name)).toEqual(['Bran'])

      // Both listeners before the command: the fog frame lands first and the tokens resend
      // rides behind it (D4c), so waiting for one after the other would miss it.
      const conceal = nextState<FogState>(
        player,
        'fog',
        (s) => s.byScene[sceneId]?.concealBehindDoors === false,
      )
      const both = nextState<TokensState>(
        player,
        'tokens',
        (s) => Object.keys(s.byScene[sceneId] ?? {}).length === 2,
      )
      sendCommand(dm, 'fog', 'set-conceal', { concealBehindDoors: false })

      // The flag the player's own renderer classifies by, and the tokens it was withholding.
      await conceal
      expect(
        Object.values((await both).byScene[sceneId])
          .map((t) => t.name)
          .sort(),
      ).toEqual(['Bran', 'Wight'])
    })
  })
})

// ── D9: the undo window, replayed at the wire ───────────────────────────────

describe('Reveal All / Hide All / undo (D9)', () => {
  it('restores the exact record the DM held before the bulk op', async () => {
    await withServer({}, async (server) => {
      const { sceneId, dm } = await crypts(server, 'FGU', 0)
      const roomsOf = (state: unknown): Record<string, RoomFog> =>
        (state as FogState).byScene[sceneId].rooms

      // Reveal All, as the tool builds it: every room in the scene, latch set.
      const revealedAll = nextState(dm, 'fog')
      sendCommand(dm, 'fog', 'set-bulk', {
        rooms: Object.fromEntries(
          cryptRooms.map((room) => [room.id, { status: 'revealed', wasEverRevealed: true }]),
        ),
      })
      // This is the record the undo toast captures — the value, not a re-read.
      const captured = roomsOf(await revealedAll)
      expect(Object.keys(captured)).toHaveLength(cryptRooms.length)

      // Hide All, as the tool builds it: everything the party has seen goes back under,
      // rooms nobody has seen left out of the record entirely.
      const hidden = nextState(dm, 'fog')
      sendCommand(dm, 'fog', 'set-bulk', {
        rooms: Object.fromEntries(
          Object.entries(captured)
            .filter(([, fog]) => fog.wasEverRevealed)
            .map(([id]) => [id, { status: 're_hidden', wasEverRevealed: true }]),
        ),
      })
      expect(new Set(Object.values(roomsOf(await hidden)).map((f) => f.status))).toEqual(
        new Set(['re_hidden']),
      )

      // Undo: the captured record, replayed verbatim. A `set-bulk` the latch validation
      // refuses is silent by design (§2.2), so a rejection would look exactly like this
      // doing nothing — which is why the error frame is asserted too.
      const restored = nextState(dm, 'fog')
      const refused = next(dm, 'error').then((e) => e.message)
      sendCommand(dm, 'fog', 'set-bulk', { rooms: captured })
      expect(roomsOf(await restored)).toEqual(captured)
      await expect(refused).rejects.toThrow(/timed out/)
    })
  })
})

// ── D2/D4: a secret door the DM reveals ─────────────────────────────────────

describe('revealed secret doors reach the player (D2/D4)', () => {
  const secretRooms = [roomOf(SECRET.roomA), roomOf(SECRET.roomB)]

  /** Every door child a `mapDelta` frame carries, whatever layer it arrived on. */
  const deltaDoors = (msg: Record<string, unknown>): string[] =>
    ((msg.mapDelta as { layers?: { children?: { id: string }[] }[] } | undefined)?.layers ?? [])
      .flatMap((layer) => layer.children ?? [])
      .map((child) => child.id)

  const doorsOf = (state: unknown, sceneId: string): Record<string, DoorLiveState> =>
    (state as DoorsState).byScene[sceneId] ?? {}

  it('hands over the live state and the geometry, then keeps both across a fresh join', async () => {
    await withServer({}, async (server) => {
      const { sceneId, dm, players } = await crypts(server, 'FGS', 1)
      const [player] = players

      for (const room of secretRooms) {
        const done = nextState(dm, 'fog')
        sendCommand(dm, 'fog', 'reveal', { roomId: room.id })
        await done
      }
      // A door command seeds the whole scene's live state, secret door included — so the
      // door's absence below is redaction and not an empty record.
      const seeded = nextState(dm, 'doors')
      sendCommand(dm, 'doors', 'toggle', { id: AJAR.id })
      expect(Object.keys(doorsOf(await seeded, sceneId))).toContain(SECRET.id)

      sendJoin(player)
      const before = await next(player, 'session-state')
      expect(doorsOf(before.state.modules.doors, sceneId)).not.toHaveProperty(SECRET.id)
      expect(JSON.stringify(before)).not.toContain(SECRET.id)

      // The reveal: the live state on the doors frame, the door child on the fog frame that
      // follows it (D5 — nothing is named that cannot be drawn).
      const live = nextState(player, 'doors', (s) => SECRET.id in doorsOf(s, sceneId))
      const geometry = nextRaw(
        player,
        (m) => m.type === 'state-update' && deltaDoors(m).includes(SECRET.id),
      )
      sendCommand(dm, 'doors', 'reveal-secret', { id: SECRET.id })
      expect(doorsOf(await live, sceneId)[SECRET.id]).toMatchObject({ revealed: true })
      await geometry

      // …and a seat that arrives afterwards is told the same thing without being asked.
      const fresh = await connect(server, { identity: 'FGS-p1', name: 'P1', session: 'FGS' })
      sendJoin(fresh)
      const after = await next(fresh, 'session-state')
      expect(doorsOf(after.state.modules.doors, sceneId)[SECRET.id]).toMatchObject({
        revealed: true,
      })
      const map = await fetchMap(server, { name: 'P1', session: 'FGS', identity: 'FGS-p1' }, sceneId)
      expect(map).toContain(SECRET.id)
    })
  })

  it('stays a secret while the DM has not revealed it, explored rooms or not', async () => {
    await withServer({}, async (server) => {
      const { sceneId, dm, players } = await crypts(server, 'FGT', 1)
      const [player] = players

      for (const room of secretRooms) {
        const done = nextState(dm, 'fog')
        sendCommand(dm, 'fog', 'reveal', { roomId: room.id })
        await done
      }
      const seeded = nextState(dm, 'doors')
      sendCommand(dm, 'doors', 'toggle', { id: AJAR.id })
      await seeded

      sendJoin(player)
      const snapshot = await next(player, 'session-state')
      expect(doorsOf(snapshot.state.modules.doors, sceneId)).not.toHaveProperty(SECRET.id)
      const map = await fetchMap(server, { name: 'P0', session: 'FGT', identity: 'FGT-p0' }, sceneId)
      expect(map).not.toContain(SECRET.id)
    })
  })

  it('stays absent while it is bound only to rooms nobody has explored', async () => {
    await withServer({}, async (server) => {
      const { sceneId, dm, players } = await crypts(server, 'FGV', 1)
      const [player] = players
      // A room the party has been in, on the far side of the map from the secret door, so
      // the scene has explored geometry and the door is still bound to none of it.
      const elsewhere = roomOf(AJAR.roomA)
      expect(secretRooms.map((r) => r.id)).not.toContain(elsewhere.id)

      const done = nextState(dm, 'fog')
      sendCommand(dm, 'fog', 'reveal', { roomId: elsewhere.id })
      await done

      const revealed = nextState(dm, 'doors', (s) => doorsOf(s, sceneId)[SECRET.id]?.revealed)
      sendCommand(dm, 'doors', 'reveal-secret', { id: SECRET.id })
      await revealed

      sendJoin(player)
      const snapshot = await next(player, 'session-state')
      // Revealed is not the same as earned: the geometry gate is the room, and the party
      // has not been to either side of this door.
      expect(doorsOf(snapshot.state.modules.doors, sceneId)).not.toHaveProperty(SECRET.id)
      const map = await fetchMap(server, { name: 'P0', session: 'FGV', identity: 'FGV-p0' }, sceneId)
      expect(map).not.toContain(SECRET.id)
    })
  })
})

// ── §2.6 (S3): reveal propagation < 200ms ───────────────────────────────────

describe('reveal propagation (§2.6 metric, D5)', () => {
  it('lands a room on a player socket with its geometry in under 200ms', async () => {
    await withServer({}, async (server) => {
      const { dm, players } = await crypts(server, 'FGR', 1)
      const [player] = players

      // Largest room first, on a cold vision cache: the biggest slice the map has, cut at
      // the moment nothing is parsed, indexed or memoised yet. Every later reveal is
      // cheaper, so the headline number is the first one and the row is the worst one.
      const order = [...cryptRooms].sort((a, b) => b.area - a.area)
      const measured: { room: Room; ms: number; bytes: number; children: number }[] = []

      for (const room of order) {
        const arrival = timedFrame(
          player,
          (m) => m.type === 'state-update' && m.module === 'fog' && m.mapDelta !== undefined,
        )
        const sentAt = performance.now()
        sendCommand(dm, 'fog', 'reveal', { roomId: room.id })
        const { at, bytes, msg } = await arrival

        // The whole point of D5: the frame that says "revealed" is the frame that carries
        // the geometry, so the number above is latency-to-drawable and not latency-to-know.
        const delta = msg.mapDelta as {
          layers: { rooms: { id: string }[]; children: unknown[]; standaloneWalls: unknown[] }[]
        }
        expect(delta.layers.flatMap((l) => l.rooms.map((r) => r.id))).toEqual([room.id])
        measured.push({
          room,
          ms: at - sentAt,
          bytes,
          children: delta.layers.reduce((n, l) => n + l.children.length, 0),
        })
      }

      const biggest = measured[0]
      // Not an empty envelope: the largest room ships props, lights and its own walls.
      expect(biggest.children).toBeGreaterThan(0)
      expect(
        biggest.room.area,
        'the largest room is not the one this row is named after',
      ).toBeGreaterThanOrEqual(180)

      const worst = measured.reduce((a, b) => (a.ms > b.ms ? a : b))
      console.log(
        `[metric] fog reveal → player, dressed map: ` +
          `${biggest.room.name} (area ${biggest.room.area}, cold cache) ` +
          `${biggest.ms.toFixed(1)}ms / ${(biggest.bytes / 1024).toFixed(1)}KB / ` +
          `${biggest.children} children; worst of ${measured.length} rooms ` +
          `${worst.room.name} ${worst.ms.toFixed(1)}ms (target < 200ms)`,
      )
      expect(worst.ms).toBeLessThan(200)
    })
  })
})

// ── §2.6 (S3): zero unrevealed data client-side, all session long ───────────
// The row asks a question about bytes, so this asks it of bytes: every frame the player's
// socket carried across a scripted session, plus both of its join snapshots, searched for
// anything the party has not earned. Ids and names come off the fixture, so re-authoring
// the map cannot quietly turn this into an assertion about nothing.

/**
 * Ray casting, spelled out here because D3 forbids the server runtime-importing @dnd/core
 * (it pulls in pixi.js) and the redactor's own copy is a private helper. It is the geometry
 * primitive, not the policy — the policy is `centreOf` plus "which room is that in", and
 * that composition is exactly what this re-derives independently.
 */
function inside(room: Room, x: number, y: number): boolean {
  const poly = room.boundary
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

/** The child ids the map plants inside `rooms` — the same centre rule the redactor uses. */
function childrenIn(rooms: readonly Room[]): string[] {
  const ids: string[] = []
  for (const child of cryptLayer.children as AnyChild[]) {
    if (child.childType === 'door') continue // doors answer through roomA/roomB, not a centre
    const [x, y] = centreOf(child)
    if (rooms.some((room) => inside(room, x, y))) ids.push(child.id)
  }
  return ids
}

describe('nothing unrevealed reaches a player socket (§2.6, D4a/D4b + reconnect)', () => {
  it('holds across a whole scripted session and on the reconnect snapshot', async () => {
    await withServer({}, async (server) => {
      const { sceneId, dm, players } = await crypts(server, 'FGZ', 1)
      const [player] = players
      const here = roomOf(AJAR.roomA)
      const beyond = roomOf(AJAR.roomB)
      const explored = [here, beyond]

      // Armed before anything happens, and the snapshot re-requested so the capture holds
      // a join payload too — the row names the snapshot and the broadcasts, not one of them.
      const seen = rawFrames(player)
      sendJoin(player)
      await next(player, 'session-state')

      // ── the script ─────────────────────────────────────────────────────────
      for (const room of explored) {
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

      const moved = nextState<TokensState>(dm, 'tokens')
      sendCommand(player, 'tokens', 'move', {
        id: mine.id,
        x: here.centroid[0] + 1,
        y: here.centroid[1],
      })
      await moved

      // An ambusher waiting in a room nobody has entered: hidden *and* in the dark, so both
      // rules have to hold at once for its name never to appear below.
      const dark = cryptRooms.find((r) => !explored.some((e) => e.id === r.id))!
      const ambushed = nextState<TokensState>(dm, 'tokens')
      sendCommand(dm, 'tokens', 'place', {
        name: 'Ambusher',
        x: dark.centroid[0],
        y: dark.centroid[1],
        hidden: true,
      })
      const ambusher = Object.values((await ambushed).byScene[sceneId]).find((t) => t.hidden)!

      // Open, then shut again: a door that moves twice and settles where it started, so a
      // frame that leaked something only says so about the toggling and not about the state.
      for (let swing = 0; swing < 2; swing++) {
        const swung = nextState(dm, 'doors')
        sendCommand(dm, 'doors', 'toggle', { id: AJAR.id })
        await swung
      }

      // ── the reconnect, captured the same way ───────────────────────────────
      player.close()
      await once(player, 'close')
      const back = await connect(server, { identity: 'FGZ-p0', name: 'P0', session: 'FGZ' })
      const resumed = rawFrames(back)
      sendJoin(back)
      await next(back, 'session-state')

      // ── what may never have been on either socket ──────────────────────────
      const unexplored = cryptRooms.filter((r) => !explored.some((e) => e.id === r.id))
      expect(unexplored.length).toBe(cryptRooms.length - 2)

      // Walls are the one set this does not re-derive: the redactor probes perpendicularly
      // off a wall's midpoint to find the rooms it borders, and a second copy of that rule
      // here would drift. The player's own map GET answers it instead — a different code
      // path from the broadcasts and the snapshot, so the two still have to agree.
      const playerMap = dungeonOf(
        JSON.parse(
          await fetchMap(server, { name: 'P0', session: 'FGZ', identity: 'FGZ-p0' }, sceneId),
        ) as SerializedMapData,
      )
      const heldWalls = new Set(playerMap.standaloneWalls.map((w) => w.id))
      expect(heldWalls.size).toBeLessThan(cryptLayer.standaloneWalls.length)

      // The default room stays in this list on purpose. It is legitimately the player's in
      // the fresh-scene window this capture opens on (amendment 2026-07-28), but geometry
      // only ever rides a `mapDelta` or the map GET — and neither happens while the fallback
      // is in play here, because the first fog command in the script is a real reveal. Add a
      // fog command *before* that reveal and this row will start naming the default room:
      // that is the rule working, not a leak, and the exclusion belongs here then.
      const forbidden = [
        ...unexplored.map((r) => r.id),
        ...unexplored.map((r) => r.name),
        ...childrenIn(unexplored),
        ...cryptLayer.standaloneWalls.filter((w) => !heldWalls.has(w.id)).map((w) => w.id),
        // …the secret door, which is not geometry the party can earn by walking (D4),
        SECRET.id,
        // …the props on unzoned map, which no command can ever reveal (D6),
        ...STRANDED.map((p) => p.id),
        // …and the thing waiting in the dark.
        ambusher.id,
        'Ambusher',
      ]
      expect(forbidden.length).toBeGreaterThan(50)

      const frames = [...seen, ...resumed]
      expect(frames.length).toBeGreaterThan(5)
      for (const needle of forbidden) {
        const leaked = frames.find((frame) => frame.includes(needle))
        expect(leaked?.slice(0, 200), `'${needle}' was on a player socket`).toBeUndefined()
      }

      // The other half of the row: something *did* arrive, or the assertions above are
      // about an empty capture. Both explored rooms, the token, and the door they share.
      const whole = frames.join('')
      for (const needle of [here.id, beyond.id, mine.id, 'Bran', AJAR.id]) {
        expect(whole, `'${needle}' should have reached the player`).toContain(needle)
      }
    })
  })

  it('ships the whole-map terrain bitmaps to players — the second documented leak (§4)', () => {
    // D4 documents one deliberate leak (explored geometry is permanently client-side); this
    // is the other one, and it is here so it is a decision on the record rather than a
    // surprise in a frame capture. `customImages` is the terrain splat: one bitmap per
    // painted layer, over the whole map, with no per-room slice to cut it along. It is
    // 53% of this map's bytes and it goes to every player at join.
    //
    // Change this assertion the day the splat is sliced per room — do not delete it.
    const images = crypt.customImages as Record<string, unknown> | undefined
    expect(Object.keys(images ?? {}).length).toBeGreaterThan(0)
    const bytes = JSON.stringify(images).length
    console.log(
      `[leak] terrain splat bitmaps ship whole-map to players: ` +
        `${Object.keys(images!).length} image(s), ${(bytes / 1024).toFixed(0)}KB of the ` +
        `map's ${(GATE_MAP.length / 1024).toFixed(0)}KB (documented, not a failure)`,
    )
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

// ── §2.6 (S3 P1): token vision is server-enforced, at the wire ──────────────
// The same question the fog rows ask of the map, asked of the *tokens*: a token the party
// has not earned the sight of must not be in a single byte a player's socket receives. The
// fixture is two rooms either side of one wall with a door in it, so "earned" is a fact
// about geometry and not about a room being switched on.

const VISION_MAP = readFileSync(
  join(import.meta.dirname, '../../testdata/vision-two-rooms.mapbuilder'),
  'utf8',
)

/** A DM and one player seated on the two-room sight fixture. */
async function twoRooms(server: RunningServer, name: string) {
  table(server, name, VISION_MAP)
  const seats = await seatTable(server, name, 1)
  return { sceneId: `${name}-map`, ...seats, player: seats.players[0] }
}

describe('token redaction by vision on the wire (§2.6, S3 P1)', () => {
  it('never carries a token the party cannot see, and carries it the moment they can', async () => {
    await withServer({}, async (server) => {
      const { sceneId, dm, player } = await twoRooms(server, 'TV')
      // Every byte this socket is handed, from before the ambusher exists.
      const frames = rawFrames(player)

      const mode = nextState(dm, 'fog')
      sendCommand(dm, 'fog', 'set-mode', { sceneId, mode: 'vision' })
      await mode

      // A scout in the middle of the west room, looking only three cells…
      const placed = nextState<TokensState>(dm, 'tokens')
      sendCommand(dm, 'tokens', 'place', {
        sceneId,
        name: 'Scout',
        x: 5.5,
        y: 5.5,
        sight: { range: 3, angle: 360, visionMode: 'normal' },
      })
      const scout = Object.values((await placed).byScene[sceneId])[0]

      // …and an ambusher in the far corner of the *same* room. The room is about to be
      // explored and visible, so the room-granular rule would hand this token straight over;
      // the only thing withholding it is that nobody is looking at that corner.
      const ambushed = nextState<TokensState>(dm, 'tokens', (s) =>
        Object.keys(s.byScene[sceneId]).length === 2,
      )
      sendCommand(dm, 'tokens', 'place', { sceneId, name: 'Ambusher', x: 1.5, y: 1.5 })
      const ambusher = Object.values((await ambushed).byScene[sceneId]).find(
        (t) => t.id !== scout.id,
      )!

      const claimed = nextState<TokensState>(dm, 'tokens')
      sendCommand(player, 'tokens', 'claim', { id: scout.id })
      await claimed

      // The move that makes the party look: the west room auto-explores off the sweep, which
      // latches it (`re_hidden` + the latch) rather than lighting it — the geometry travels
      // and the swept cells are what the player can see of it. `revealed` is the DM's word.
      const swept = nextState<FogState>(player, 'fog', (s) => s.byScene[sceneId]?.rooms.west !== undefined)
      sendCommand(dm, 'tokens', 'move', { sceneId, id: scout.id, x: 5.5, y: 5.5 })
      expect((await swept).byScene[sceneId].rooms.west).toMatchObject({
        status: 're_hidden',
        wasEverRevealed: true,
      })

      // Not the id, not the name, in any frame this socket has ever been handed.
      expect(frames.length).toBeGreaterThan(0)
      for (const frame of frames) {
        expect(frame, 'an unseen token reached a player socket').not.toContain(ambusher.id)
        expect(frame).not.toContain('Ambusher')
      }
      // …while their own claimed token has been there all along, and the room they are
      // standing in did reach them — an empty payload would prove nothing.
      expect(frames.some((frame) => frame.includes(scout.id))).toBe(true)
      expect(frames.some((frame) => frame.includes('west'))).toBe(true)

      // A step across the room and the corner comes into sight.
      const arrived = nextState<TokensState>(player, 'tokens', (s) => ambusher.id in s.byScene[sceneId])
      sendCommand(dm, 'tokens', 'move', { sceneId, id: scout.id, x: 2.5, y: 2.5 })
      const seen = await arrived
      expect(Object.keys(seen.byScene[sceneId]).sort()).toEqual([ambusher.id, scout.id].sort())

      // …and a step back takes it away again: the slice is retracted, and nothing after
      // this point names it either (D4c — a redacted future is not enough on its own).
      const mark = frames.length
      const gone = nextState<TokensState>(player, 'tokens', (s) => !(ambusher.id in s.byScene[sceneId]))
      sendCommand(dm, 'tokens', 'move', { sceneId, id: scout.id, x: 8.5, y: 8.5 })
      const after = await gone
      expect(Object.keys(after.byScene[sceneId])).toEqual([scout.id])
      for (const frame of frames.slice(mark)) expect(frame).not.toContain('Ambusher')
    })
  })

  it('keeps a shut door between the party and a token in a room the DM has lit', async () => {
    await withServer({}, async (server) => {
      const { sceneId, dm, player } = await twoRooms(server, 'TW')
      const frames = rawFrames(player)

      for (const [action, payload] of [
        ['set-mode', { mode: 'vision' }],
        // Both of the room rule's escape hatches, deliberately left open: the east room is
        // lit by hand and concealment is off, so `visible` holds it with the door shut.
        ['reveal', { roomId: 'east' }],
        ['set-conceal', { concealBehindDoors: false }],
      ] as const) {
        const done = nextState(dm, 'fog')
        sendCommand(dm, 'fog', action, { sceneId, ...payload })
        await done
      }

      const placed = nextState<TokensState>(dm, 'tokens')
      sendCommand(dm, 'tokens', 'place', {
        sceneId,
        name: 'Scout',
        x: 5.5,
        y: 5.5,
        sight: { range: 8, angle: 360, visionMode: 'normal' },
      })
      const scout = Object.values((await placed).byScene[sceneId])[0]

      const ambushed = nextState<TokensState>(dm, 'tokens', (s) =>
        Object.keys(s.byScene[sceneId]).length === 2,
      )
      sendCommand(dm, 'tokens', 'place', { sceneId, name: 'Ambusher', x: 12.5, y: 5.5 })
      const ambusher = Object.values((await ambushed).byScene[sceneId]).find(
        (t) => t.id !== scout.id,
      )!

      const claimed = nextState<TokensState>(dm, 'tokens')
      sendCommand(player, 'tokens', 'claim', { id: scout.id })
      await claimed

      const swept = nextState<FogState>(player, 'fog', (s) => s.byScene[sceneId]?.rooms.west !== undefined)
      sendCommand(dm, 'tokens', 'move', { sceneId, id: scout.id, x: 5.5, y: 5.5 })
      await swept

      // The player holds the east room's geometry and its fog record — and still not the
      // token standing in it, because a wall is between them.
      expect(frames.some((frame) => frame.includes('east'))).toBe(true)
      for (const frame of frames) expect(frame).not.toContain(ambusher.id)

      // The door opens and sight reaches through the gap.
      const arrived = nextState<TokensState>(player, 'tokens', (s) => ambusher.id in s.byScene[sceneId])
      sendCommand(dm, 'doors', 'toggle', { sceneId, id: 'door-mid' })
      await arrived

      // …and shuts again: the retract re-sends the tokens slice without it.
      const mark = frames.length
      const gone = nextState<TokensState>(player, 'tokens', (s) => !(ambusher.id in s.byScene[sceneId]))
      sendCommand(dm, 'doors', 'toggle', { sceneId, id: 'door-mid' })
      expect(Object.keys((await gone).byScene[sceneId])).toEqual([scout.id])
      for (const frame of frames.slice(mark)) expect(frame).not.toContain('Ambusher')

      // The DM's own view was never fogged by any of it (PRODUCT principle 3).
      const dmView = nextState<TokensState>(dm, 'tokens')
      sendCommand(dm, 'tokens', 'update', { sceneId, id: ambusher.id, name: 'Ambusher' })
      expect(Object.keys((await dmView).byScene[sceneId]).sort()).toEqual(
        [ambusher.id, scout.id].sort(),
      )
    })
  })
})
