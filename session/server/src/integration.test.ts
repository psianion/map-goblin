// Sprint 2 acceptance (§2.6), the rows that are provable at the wire: token-move fan-out
// latency across 6 clients, forged-client authorization, and whisper privacy inspected
// frame by frame on the socket that must never see it.
//
// Raw sockets, no browser — same reasoning as the S1 6-client test in ws/session.test.ts:
// the metric is the server's fan-out, and six Chromium event loops sharing one CPU would
// measure the browsers instead. The browser-level halves (drag latency, roll sync in the
// DOM, scene-switch timing) live in session/client/e2e.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { once } from 'node:events'
import type { Role, ServerMessage } from '@dnd/core/src/shared/protocol'
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

/** One campaign with one active session (and one map, so `activeSceneId` is real) per name. */
function table(server: RunningServer, name: string): SessionRow {
  let byName = tables.get(server)
  if (!byName) tables.set(server, (byName = new Map()))

  let row = byName.get(name)
  if (!row) {
    const campaign = server.stores.campaigns.create(name)
    // Tokens are scene-scoped and `sceneId` defaults to the active scene (§2.2), so every
    // table here needs a scene for the commands to land the way a real client sends them.
    server.stores.maps.insert(`${name}-map`, campaign.id, `${name} Map`, '{}')
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

function sendJoin(socket: WebSocket, protocolVersion = 2): void {
  socket.send(JSON.stringify({ type: 'join', protocolVersion }))
}

function sendCommand(socket: WebSocket, module: string, action: string, payload: unknown): void {
  socket.send(JSON.stringify({ type: 'command', module, action, payload, seq: 1 }))
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
