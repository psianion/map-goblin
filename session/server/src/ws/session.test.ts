// Real ws server on an ephemeral port, real client sockets, no mocks (D10).

import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { Role, ServerMessage } from '@dnd/core/src/shared/protocol'
import { ANY_ROLE, type GameModule } from '@dnd/mechanics/contract'
import { issueToken, startSession } from '../auth'
import type { SessionRow } from '../db/stores'
import { startServer, type RunningServer, type StartOptions } from '../index'
import type { Redactor } from './Broadcaster'

beforeAll(() => {
  // Keep the generated secrets file out of the package directory.
  process.env.GAME_SERVER_DATA = mkdtempSync(join(tmpdir(), 'game-server-test-'))
})

/** Boots a server and guarantees it is closed even when the body throws. */
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

/** One campaign with one active session per logical table name, seeded on first use. */
function table(server: RunningServer, name: string): SessionRow {
  let byName = tables.get(server)
  if (!byName) tables.set(server, (byName = new Map()))

  let row = byName.get(name)
  if (!row) {
    row = startSession(server.stores.sessions, server.stores.campaigns.create(name).id)
    byName.set(name, row)
  }
  return row
}

interface Seat {
  name: string
  /** Logical table name; the session id is whatever {@link table} minted for it. */
  session?: string
  role?: Role
  /** Defaults to `<session>-<name>`, so the same person reconnects as the same identity. */
  identity?: string
}

/**
 * A signed session token for a seeded identity — since A4 the upgrade accepts nothing else,
 * so every socket here is authenticated exactly the way a real client is.
 */
function ticket(server: RunningServer, { name, session = 'default', role = 'player', identity }: Seat): string {
  const row = table(server, session)
  const id = identity ?? `${session}-${name}`
  if (!server.stores.identities.get(id)) server.stores.identities.mint(id, row.campaign_id, name, role)
  return issueToken(server.config.secrets.hmacSecret, id, row.campaign_id, role)
}

async function connect(
  server: RunningServer,
  seat: Seat,
  options?: { autoPong?: boolean },
): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/?token=${ticket(server, seat)}`, options)
  await once(socket, 'open')
  return socket
}

/**
 * The ServerMessage member whose `type` covers T. Plain `Extract` would return `never`
 * for player-joined/player-left, since the protocol folds both into one member.
 */
type MessageOf<T extends ServerMessage['type']> =
  ServerMessage extends infer M
    ? M extends { type: ServerMessage['type'] }
      ? T extends M['type']
        ? M
        : never
      : never
    : never

/** Resolves on the next message of `type`, ignoring any that arrive before it. */
function next<T extends ServerMessage['type']>(
  socket: WebSocket,
  type: T,
): Promise<MessageOf<T>> {
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

function sendJoin(socket: WebSocket, protocolVersion = 2): void {
  socket.send(JSON.stringify({ type: 'join', protocolVersion }))
}

function sendCommand(socket: WebSocket, module: string, action: string, payload: unknown): void {
  socket.send(JSON.stringify({ type: 'command', module, action, payload, seq: 1 }))
}

/** Records the `type` of every frame a socket receives, alongside any `next()` waits. */
function record(socket: WebSocket, into: string[]): void {
  socket.on('message', (raw) => into.push((JSON.parse(raw.toString()) as ServerMessage).type))
}

/** A DM and a player, both joined, in one session. */
async function joinedPair(server: RunningServer, session: string): Promise<[WebSocket, WebSocket]> {
  const dm = await connect(server, { role: 'dm', name: 'Ann', session })
  sendJoin(dm)
  await next(dm, 'session-state')

  const player = await connect(server, { identity: 'id-bob', name: 'Bob', session })
  sendJoin(player)
  await next(player, 'session-state')
  await next(dm, 'player-joined')
  return [dm, player]
}

describe('session lifecycle', () => {
  it('answers join with a snapshot and tells everyone else who arrived', async () => {
    await withServer({}, async (server) => {
      const dm = await connect(server, { role: 'dm', name: 'Ann', session: 'S' })
      sendJoin(dm)
      const first = await next(dm, 'session-state')
      expect(first.you).toMatchObject({ name: 'Ann', role: 'dm', connected: true })
      expect(first.state.sessionId).toBe(table(server, 'S').id)
      expect(first.state.players).toHaveLength(1)

      const player = await connect(server, { name: 'Bob', session: 'S' })
      const announced = next(dm, 'player-joined')
      sendJoin(player)

      const second = await next(player, 'session-state')
      expect(second.state.players.map((p) => p.name)).toEqual(['Ann', 'Bob'])
      expect(second.you.role).toBe('player')
      expect((await announced).player).toMatchObject({ name: 'Bob', connected: true })
    })
  })

  it('keeps sessions apart', async () => {
    await withServer({}, async (server) => {
      const a = await connect(server, { name: 'A', session: 'one' })
      sendJoin(a)
      await next(a, 'session-state')

      const b = await connect(server, { name: 'B', session: 'two' })
      sendJoin(b)
      const state = await next(b, 'session-state')
      expect(state.state.players.map((p) => p.name)).toEqual(['B'])
      await expect(next(a, 'player-joined')).rejects.toThrow(/timed out/)
    })
  })

  it('rejects a protocol version it does not speak and closes the socket', async () => {
    await withServer({}, async (server) => {
      const client = await connect(server, { name: 'Old' })
      sendJoin(client, 999)
      const error = await next(client, 'error')
      expect(error.code).toBe('protocol-mismatch')
      await once(client, 'close')
    })
  })

  it('survives garbage without dropping the connection', async () => {
    await withServer({}, async (server) => {
      const client = await connect(server, { name: 'Noisy' })

      client.send('{not json')
      expect((await next(client, 'error')).code).toBe('invalid-command')

      client.send(JSON.stringify({ type: 'nonsense' }))
      expect((await next(client, 'error')).code).toBe('invalid-command')

      client.send(JSON.stringify({ type: 'join' })) // right type, missing field
      expect((await next(client, 'error')).code).toBe('invalid-command')

      // Still usable afterwards.
      client.send(JSON.stringify({ type: 'ping', t: 42 }))
      expect((await next(client, 'pong')).t).toBe(42)
      expect(client.readyState).toBe(WebSocket.OPEN)
    })
  })

  it('drops a client that stops answering pings and reports it as disconnected', async () => {
    await withServer({ heartbeatMs: 25, missedPongLimit: 2 }, async (server) => {
      const watcher = await connect(server, { name: 'Watcher', session: 'H' })
      sendJoin(watcher)
      await next(watcher, 'session-state')

      const zombie = await connect(server, { name: 'Zombie', session: 'H' }, { autoPong: false })
      sendJoin(zombie)
      await next(watcher, 'player-joined')

      const left = await next(watcher, 'player-left')
      expect(left.player).toMatchObject({ name: 'Zombie', connected: false })
      expect(watcher.readyState).toBe(WebSocket.OPEN) // the one that pongs is untouched
    })
  })

  it('announces dm-disconnected when the DM socket drops', async () => {
    await withServer({}, async (server) => {
      const dm = await connect(server, { role: 'dm', name: 'Ann', session: 'D' })
      sendJoin(dm)
      await next(dm, 'session-state')

      const player = await connect(server, { name: 'Bob', session: 'D' })
      sendJoin(player)
      await next(player, 'session-state')

      dm.close()
      await next(player, 'dm-disconnected')

      const back = await connect(server, { role: 'dm', name: 'Ann', session: 'D' })
      sendJoin(back)
      await next(player, 'dm-reconnected')
    })
  })
})

describe('commands', () => {
  it('runs the ping module and shows the echo to the whole session', async () => {
    await withServer({}, async (server) => {
      const [dm, player] = await joinedPair(server, 'P')

      const onDm = next(dm, 'state-update')
      const onPlayer = next(player, 'state-update')
      sendCommand(player, 'ping', 'echo', { t: 7 })

      for (const update of [await onDm, await onPlayer]) {
        expect(update.module).toBe('ping')
        expect(update.state).toEqual({ lastEcho: { t: 7, from: 'id-bob' } })
      }
    })
  })

  it('refuses unknown modules and actions to the sender alone', async () => {
    await withServer({}, async (server) => {
      const [dm, player] = await joinedPair(server, 'U')
      const dmHeard: string[] = []
      record(dm, dmHeard)

      sendCommand(player, 'nope', 'echo', {})
      expect((await next(player, 'error')).code).toBe('invalid-command')

      sendCommand(player, 'ping', 'nope', {})
      expect((await next(player, 'error')).code).toBe('invalid-command')

      sendCommand(player, 'ping', 'echo', { t: 'not a number' })
      expect((await next(player, 'error')).code).toBe('invalid-command')

      // Nothing at all leaked to the rest of the table during that exchange.
      await expect(next(dm, 'state-update')).rejects.toThrow(/timed out/)
      expect(dmHeard).toEqual([])

      // The sender's socket survived all three refusals.
      expect(player.readyState).toBe(WebSocket.OPEN)
      sendCommand(player, 'ping', 'echo', { t: 1 })
      expect((await next(player, 'state-update')).module).toBe('ping')
    })
  })
})

/**
 * A third-party module (D2's test): state, setState and redact, defined entirely outside
 * the platform and registered through the boot seam. Nothing in session/server knows it
 * exists — which is the property the whole of §2.2 is for.
 */
interface Note {
  by: string
  text: string
  secret: boolean
}

const notesModule: GameModule<{ notes: Note[] }> = {
  name: 'notes',
  commands: { add: ANY_ROLE },
  initialState: { notes: [] },
  handler(_action, payload, ctx) {
    const { text, secret } = (payload ?? {}) as { text?: unknown; secret?: unknown }
    if (typeof text !== 'string') return { code: 'invalid-command', message: 'notes.add needs text' }
    ctx.setState({ notes: [...ctx.state.notes, { by: ctx.sender.identityId, text, secret: secret === true }] })
  },
  redact: (state, viewer) =>
    viewer.role === 'dm'
      ? state
      : { notes: state.notes.filter((note) => !note.secret || note.by === viewer.identityId) },
}

const notesOf = (msg: { state: unknown }): Note[] => (msg.state as { notes: Note[] }).notes

describe('module contract v2 (§2.2)', () => {
  it('persists setState and broadcasts it redacted per viewer', async () => {
    await withServer({ modules: [notesModule] }, async (server) => {
      const [dm, bob] = await joinedPair(server, 'N')
      const carol = await connect(server, { identity: 'id-carol', name: 'Carol', session: 'N' })
      sendJoin(carol)
      await next(carol, 'session-state')

      const onDm = next(dm, 'state-update')
      const onBob = next(bob, 'state-update')
      const onCarol = next(carol, 'state-update')
      sendCommand(bob, 'notes', 'add', { text: 'the goblin is bluffing', secret: true })

      // The DM sees everything; the author sees their own; the third seat sees nothing.
      expect(notesOf(await onDm)).toEqual([{ by: 'id-bob', text: 'the goblin is bluffing', secret: true }])
      expect(notesOf(await onBob).map((n) => n.text)).toEqual(['the goblin is bluffing'])
      expect(notesOf(await onCarol)).toEqual([])

      // And it is in the database, not just on the wire.
      expect(server.stores.moduleState.get(table(server, 'N').campaign_id, 'notes')).toEqual({
        notes: [{ by: 'id-bob', text: 'the goblin is bluffing', secret: true }],
      })
    })
  })

  it('seeds state from initialState and hands joiners a redacted snapshot', async () => {
    await withServer({ modules: [notesModule] }, async (server) => {
      const [dm, bob] = await joinedPair(server, 'J')
      // The very first read seeded `initialState` — the handler appended to it, it did not
      // crash on undefined.
      const first = next(dm, 'state-update')
      sendCommand(bob, 'notes', 'add', { text: 'public plan', secret: false })
      await first
      const second = next(dm, 'state-update')
      sendCommand(bob, 'notes', 'add', { text: 'private plan', secret: true })
      await second

      const late = await connect(server, { identity: 'id-dave', name: 'Dave', session: 'J' })
      sendJoin(late)
      const forDave = await next(late, 'session-state')
      expect((forDave.state.modules.notes as { notes: Note[] }).notes.map((n) => n.text)).toEqual([
        'public plan',
      ])

      const lateDm = await connect(server, { role: 'dm', name: 'Ann', session: 'J' })
      sendJoin(lateDm)
      const forDm = await next(lateDm, 'session-state')
      expect((forDm.state.modules.notes as { notes: Note[] }).notes.map((n) => n.text)).toEqual([
        'public plan',
        'private plan',
      ])
    })
  })
})

describe('scenes module (D6)', () => {
  /** A campaign needs maps before it has scenes to switch between. */
  function seedMaps(server: RunningServer, session: string, count: number): string[] {
    const campaignId = table(server, session).campaign_id
    return Array.from({ length: count }, (_, i) => {
      const id = `${session}-map-${i}`
      server.stores.maps.insert(id, campaignId, `Map ${i}`, '{}')
      return id
    })
  }

  it('moves the active scene for the whole table and remembers it', async () => {
    await withServer({}, async (server) => {
      const [first, second] = seedMaps(server, 'SC', 2)
      const [dm, player] = await joinedPair(server, 'SC')

      const onDm = next(dm, 'scene-changed')
      const onPlayer = next(player, 'scene-changed')
      sendCommand(dm, 'scenes', 'activate', { sceneId: second })

      expect((await onDm).sceneId).toBe(second)
      expect((await onPlayer).sceneId).toBe(second)
      expect(server.stores.sessions.get(table(server, 'SC').id)?.active_scene_id).toBe(second)

      // A joiner arriving now is told where the table already is, not where it started.
      const late = await connect(server, { name: 'Late', session: 'SC' })
      sendJoin(late)
      const snapshot = await next(late, 'session-state')
      expect(snapshot.state.activeSceneId).toBe(second)
      expect(snapshot.state.scenes.map((s) => s.id)).toEqual([first, second])
    })
  })

  it('refuses a scene that is not this campaign’s, and a player asking at all', async () => {
    await withServer({}, async (server) => {
      const [mine] = seedMaps(server, 'SR', 1)
      const elsewhere = server.stores.campaigns.create('Someone else')
      server.stores.maps.insert('their-map', elsewhere.id, 'Theirs', '{}')
      const [dm, player] = await joinedPair(server, 'SR')

      sendCommand(dm, 'scenes', 'activate', { sceneId: 'their-map' })
      expect((await next(dm, 'error')).code).toBe('invalid-command')

      sendCommand(dm, 'scenes', 'activate', { sceneId: 42 })
      expect((await next(dm, 'error')).code).toBe('invalid-command')

      sendCommand(player, 'scenes', 'activate', { sceneId: mine })
      expect((await next(player, 'error')).code).toBe('unauthorized')

      // Nothing moved, and nobody was told anything had.
      expect(server.stores.sessions.get(table(server, 'SR').id)?.active_scene_id).toBeNull()
      await expect(next(player, 'scene-changed')).rejects.toThrow(/timed out/)
    })
  })
})

/**
 * Sprint 1 success metric — "6 clients, state update < 100ms".
 *
 * Server-side on purpose: the metric is the broadcast fan-out, and six browsers would
 * measure six Chromium event loops sharing one CPU instead. Real sockets over real TCP on
 * a real ephemeral port, so nothing here is a stand-in for the wire.
 */
describe('multi-client sync (Sprint 1 metric)', () => {
  it('fans a state update out to 6 clients in under 100ms, worst of 5 rounds', async () => {
    await withServer({}, async (server) => {
      const dm = await connect(server, { role: 'dm', name: 'Ann', session: 'M' })
      sendJoin(dm)
      await next(dm, 'session-state')

      const players: WebSocket[] = []
      for (let i = 0; i < 6; i++) {
        const socket = await connect(server, { name: `P${i}`, session: 'M' })
        sendJoin(socket)
        await next(socket, 'session-state')
        await next(dm, 'player-joined')
        players.push(socket)
      }
      expect(players).toHaveLength(6)

      const rounds: number[][] = []
      for (let round = 0; round < 5; round++) {
        // Every socket's own arrival time, not a single "all done" wait: the metric is
        // per-client latency, and averaging away the slowest client would hide the failure.
        const arrivals = players.map(
          (socket) =>
            new Promise<number>((resolve) => {
              socket.once('message', () => resolve(performance.now()))
            }),
        )
        const sentAt = performance.now()
        sendCommand(dm, 'ping', 'echo', { t: round })
        rounds.push((await Promise.all(arrivals)).map((at) => at - sentAt))
      }

      const worstPerRound = rounds.map((round) => Math.max(...round))
      const worst = Math.max(...worstPerRound)
      console.log(
        `[metric] 6-client broadcast fan-out: worst ${worst.toFixed(1)}ms, ` +
          `per-round worst [${worstPerRound.map((ms) => ms.toFixed(1)).join(', ')}]ms ` +
          `(target < 100ms)`,
      )
      expect(worst).toBeLessThan(100)
    })
  })
})

describe('no outbound path bypasses the redactor (D4/D5)', () => {
  it('routes every kind of outbound frame through it', async () => {
    const redacted: string[] = []
    const redact: Redactor = (msg) => {
      redacted.push(msg.type)
      return msg
    }

    await withServer({ redact }, async (server) => {
      const received: string[] = []
      const [dm, player] = await joinedPair(server, 'R')
      record(dm, received)
      record(player, received)
      // joinedPair's frames are already spent by `next`, so count them here.
      received.push('session-state', 'session-state', 'player-joined')

      const echoed = next(player, 'state-update')
      sendCommand(player, 'ping', 'echo', { t: 1 })
      await echoed

      dm.close()
      await next(player, 'dm-disconnected')

      expect(redacted).toEqual(
        expect.arrayContaining([
          'session-state',
          'player-joined',
          'state-update',
          'player-left',
          'dm-disconnected',
        ]),
      )
      // Nothing reached a client that the redactor had not seen first.
      for (const type of received) expect(redacted).toContain(type)
      expect(received.length).toBeLessThanOrEqual(redacted.length)
    })
  })

  it('leaves the raw socket write reachable from Broadcaster only', () => {
    const src = fileURLToPath(new URL('..', import.meta.url))
    const files = readdirSync(src, { recursive: true, encoding: 'utf8' })
      .map((file) => file.replaceAll('\\', '/'))
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    const callers = (call: RegExp) =>
      files.filter((file) => call.test(readFileSync(join(src, file), 'utf8')))

    // One socket write in the whole server, and one caller of it.
    expect(callers(/\.send\(/)).toEqual(['ws/ClientConnection.ts'])
    expect(callers(/\.deliver\(/)).toEqual(['ws/Broadcaster.ts'])
  })
})
