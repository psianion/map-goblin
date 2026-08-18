import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createObserver, socketUrl, PROTOCOL_VERSION, type GoblinEvent, type SocketLike } from './observer'

/** A socket that does nothing until the test says so. Every connect pushes a new one, so a
 * reconnect test can drive the second socket independently of the first. */
class FakeSocket implements SocketLike {
  readonly sent: string[] = []
  closed = false
  readonly #listeners = new Map<string, ((...args: unknown[]) => void)[]>()

  constructor(readonly url: string) {}

  on(event: string, listener: (...args: unknown[]) => void): this {
    const list = this.#listeners.get(event) ?? []
    list.push(listener)
    this.#listeners.set(event, list)
    return this
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.closed = true
    this.fire('close')
  }

  fire(event: string, ...args: unknown[]): void {
    for (const listener of [...(this.#listeners.get(event) ?? [])]) listener(...args)
  }

  /** What the server sends. */
  deliver(message: unknown): void {
    this.fire('message', JSON.stringify(message))
  }

  open(): void {
    this.fire('open')
  }
}

function harness(options: { heartbeatMs?: number } = {}) {
  const sockets: FakeSocket[] = []
  const events: GoblinEvent[] = []
  const observer = createObserver({
    baseUrl: 'http://localhost:5600',
    token: 'tok',
    createSocket: (url) => {
      const socket = new FakeSocket(url)
      sockets.push(socket)
      return socket
    },
    heartbeatMs: options.heartbeatMs ?? 30_000,
    logger: { warn: vi.fn() },
  })
  observer.subscribe((event) => events.push(event))
  return { sockets, events, observer, latest: () => sockets[sockets.length - 1] }
}

const snapshot = (over: Record<string, unknown> = {}) => ({
  type: 'session-state',
  state: {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: 'sess-1',
    campaignId: 'camp-1',
    activeSceneId: 'scene-1',
    scenes: [{ id: 'scene-1', name: 'Hideout', mapId: 'map-1' }],
    players: [],
    ...over,
  },
})

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('socketUrl', () => {
  it('follows the origin scheme and carries the token in the query', () => {
    expect(socketUrl('http://localhost:5600', 'a b')).toBe('ws://localhost:5600/ws?token=a%20b')
    expect(socketUrl('https://table.example', 'tok')).toBe('wss://table.example/ws?token=tok')
  })
})

describe('observer', () => {
  it('sends the join frame first, and nothing before it', () => {
    const { sockets, latest } = harness()
    expect(sockets).toHaveLength(1)
    expect(latest().sent).toEqual([])
    latest().open()
    expect(JSON.parse(latest().sent[0])).toEqual({ type: 'join', protocolVersion: PROTOCOL_VERSION })
  })

  it('forwards only the messages the bot acts on', () => {
    const { events, latest } = harness()
    latest().open()
    latest().deliver(snapshot())
    latest().deliver({ type: 'player-joined', player: { identityId: 'p', name: 'Zed', role: 'player', connected: true } })
    latest().deliver({ type: 'state-update', module: 'doors', state: { byScene: {} } })
    latest().deliver({ type: 'state-update', module: 'tokens', state: { byScene: {} } })
    // A module the bot has no use for, and a message type that does not exist yet.
    latest().deliver({ type: 'state-update', module: 'initiative', state: {} })
    latest().deliver({ type: 'some-future-thing' })
    expect(events.map((e) => e.type)).toEqual(['session-state', 'player-joined', 'doors', 'tokens'])
  })

  it('reconnects with a capped exponential backoff', () => {
    const { sockets, latest } = harness()
    latest().open()
    latest().fire('close')
    expect(sockets).toHaveLength(1)
    vi.advanceTimersByTime(999)
    expect(sockets).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(sockets).toHaveLength(2)

    // Second failure waits twice as long.
    latest().fire('close')
    vi.advanceTimersByTime(1999)
    expect(sockets).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(sockets).toHaveLength(3)
  })

  it('counts one death per socket, not one per event it fires', () => {
    const { sockets, latest } = harness()
    latest().fire('error', new Error('refused'))
    latest().fire('close')
    vi.advanceTimersByTime(60_000)
    // One reconnect from one dead socket — 'error' followed by 'close' is the normal pair.
    expect(sockets).toHaveLength(2)
  })

  it('starts the backoff over once a snapshot proves the socket works', () => {
    const { sockets, latest } = harness()
    latest().open()
    latest().fire('close')
    vi.advanceTimersByTime(1_000)
    sockets[1].open()
    sockets[1].deliver(snapshot())
    sockets[1].fire('close')
    // Back to the first delay, not the second — the reconnect that landed reset the count.
    vi.advanceTimersByTime(1_000)
    expect(sockets).toHaveLength(3)
  })

  it('hangs up when a heartbeat finds the last pong still missing', () => {
    const { sockets, latest } = harness({ heartbeatMs: 1_000 })
    latest().open()
    vi.advanceTimersByTime(1_000)
    expect(JSON.parse(latest().sent[1]).type).toBe('ping')
    latest().deliver({ type: 'pong', t: 1 })

    // Answered, so the next ping goes out normally...
    vi.advanceTimersByTime(1_000)
    expect(sockets[0].closed).toBe(false)
    // ...and the one after that finds it unanswered.
    vi.advanceTimersByTime(1_000)
    expect(sockets[0].closed).toBe(true)
    vi.advanceTimersByTime(1_000)
    expect(sockets).toHaveLength(2)
  })

  it('gives up on a protocol mismatch instead of retrying a build disagreement forever', () => {
    const { sockets, events, latest } = harness()
    latest().open()
    latest().deliver({ type: 'error', code: 'protocol-mismatch' })
    expect(events.at(-1)).toEqual({ type: 'closed', fatal: true })
    vi.advanceTimersByTime(120_000)
    expect(sockets).toHaveLength(1)
  })

  it('stops for good when told to', () => {
    const { sockets, latest, observer } = harness()
    latest().open()
    observer.stop()
    expect(sockets[0].closed).toBe(true)
    vi.advanceTimersByTime(120_000)
    expect(sockets).toHaveLength(1)
  })
})
