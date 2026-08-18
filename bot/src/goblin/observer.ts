// The bot as a persistent table-watcher (plan §4). One socket per live session, holding the
// campaign's own service token, consuming the same stream a player's client does.
//
// No discord.js and no `ws` type in the signatures: the socket constructor is injected, so
// every reconnect, heartbeat and resync path in here is exercised against a fake in tests.
// The wire types are re-declared rather than imported from the game server — the bot depends
// on the protocol, not on the server package.

import { log as defaultLog } from '../lib/log'

/** Must match the server's PROTOCOL_VERSION, or the join frame is refused outright. */
export const PROTOCOL_VERSION = 4

export interface PlayerInfo {
  identityId: string
  name: string
  role: 'dm' | 'player'
  connected: boolean
}

export interface SceneRef {
  id: string
  name: string
  mapId: string | null
}

export interface SessionState {
  protocolVersion: number
  sessionId: string
  campaignId: string
  activeSceneId: string | null
  scenes: SceneRef[]
  players: PlayerInfo[]
  modules?: Record<string, unknown>
}

export interface DoorFlags {
  open: boolean
  locked: boolean
  revealed: boolean
}

/** The `doors` module's whole state, as it arrives on every state-update. */
export interface DoorsState {
  byScene: Record<string, Record<string, DoorFlags>>
}

export type GoblinEvent =
  | { type: 'session-state'; state: SessionState }
  | { type: 'player-joined'; player: PlayerInfo }
  | { type: 'player-left'; player: PlayerInfo }
  | { type: 'scene-changed'; sceneId: string }
  | { type: 'session-ended' }
  | { type: 'dm-disconnected' }
  | { type: 'dm-reconnected' }
  | { type: 'doors'; state: DoorsState }
  /** The socket went away. `fatal` means it is not coming back — a version the bot cannot
   *  speak — so the caller should surface it rather than wait for a reconnect. */
  | { type: 'closed'; fatal: boolean }

export interface SocketLike {
  on: (event: string, listener: (...args: unknown[]) => void) => unknown
  send: (data: string) => void
  close: () => void
}

export type SocketFactory = (url: string) => SocketLike

export interface ObserverOptions {
  /** GOBLIN_SERVER_URL — the http(s) origin; the ws scheme is derived from it. */
  baseUrl: string
  token: string
  createSocket: SocketFactory
  /** Ping interval; a heartbeat that finds the previous pong still missing hangs up. */
  heartbeatMs?: number
  maxBackoffMs?: number
  logger?: Pick<typeof defaultLog, 'warn'>
}

export interface Observer {
  /** Returns the unsubscribe. */
  subscribe: (listener: (event: GoblinEvent) => void) => () => void
  stop: () => void
}

const HEARTBEAT_MS = 30_000
const MAX_BACKOFF_MS = 30_000
const FIRST_BACKOFF_MS = 1_000

/** `http://host` → `ws://host/ws?token=…`. The server reads only the query param, but the
 * path is the one the client uses and a proxy in front of it may care. */
export function socketUrl(baseUrl: string, token: string): string {
  const url = new URL(baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/ws'
  url.search = `?token=${encodeURIComponent(token)}`
  return url.toString()
}

export function createObserver(options: ObserverOptions): Observer {
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS
  const maxBackoffMs = options.maxBackoffMs ?? MAX_BACKOFF_MS
  const logger = options.logger ?? defaultLog

  const listeners = new Set<(event: GoblinEvent) => void>()
  let socket: SocketLike | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let retry: ReturnType<typeof setTimeout> | null = null
  let attempts = 0
  let stopped = false
  /** A ping is outstanding. A second heartbeat finding it still true means nobody is home. */
  let awaitingPong = false

  function emit(event: GoblinEvent): void {
    for (const listener of listeners) listener(event)
  }

  function teardown(): void {
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = null
    socket = null
    awaitingPong = false
  }

  function reconnect(fatal: boolean): void {
    teardown()
    emit({ type: 'closed', fatal })
    if (stopped || fatal) return
    attempts += 1
    const delay = Math.min(maxBackoffMs, FIRST_BACKOFF_MS * 2 ** (attempts - 1))
    retry = setTimeout(connect, delay)
  }

  function connect(): void {
    if (stopped) return
    retry = null
    // One `settled` per socket: a failing connection fires 'error' *and* 'close', and two
    // reconnects from one death is how a backoff turns into a storm.
    let settled = false
    const die = (fatal: boolean): void => {
      if (settled) return
      settled = true
      reconnect(fatal)
    }

    const current = options.createSocket(socketUrl(options.baseUrl, options.token))
    socket = current

    current.on('open', () => {
      // The join frame has to be first or the server refuses everything after it.
      current.send(JSON.stringify({ type: 'join', protocolVersion: PROTOCOL_VERSION }))
      awaitingPong = false
      heartbeat = setInterval(() => {
        if (awaitingPong) {
          logger.warn('goblin observer heartbeat missed', {})
          // die() first: closing the socket fires its own 'close', and whichever call gets
          // there first is the one whose `fatal` flag the subscribers see.
          die(false)
          current.close()
          return
        }
        awaitingPong = true
        current.send(JSON.stringify({ type: 'ping', t: Date.now() }))
      }, heartbeatMs)
    })

    current.on('message', (raw: unknown) => {
      const message = parse(raw)
      if (!message) return
      if (message.type === 'pong') {
        awaitingPong = false
        return
      }
      if (message.type === 'error') {
        // A protocol mismatch is a build problem, not a network one — retrying it forever
        // just hides the fact that the bot and the server disagree.
        const fatal = (message as { code?: unknown }).code === 'protocol-mismatch'
        if (fatal) logger.warn('goblin observer refused', { code: 'protocol-mismatch' })
        die(fatal)
        current.close()
        return
      }
      const event = toEvent(message)
      if (!event) return
      // A snapshot means the socket is healthy — the next drop starts its backoff over.
      if (event.type === 'session-state') attempts = 0
      emit(event)
    })

    current.on('close', () => die(false))
    current.on('error', () => die(false))
  }

  connect()

  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    stop: () => {
      stopped = true
      if (retry) clearTimeout(retry)
      retry = null
      const current = socket
      teardown()
      current?.close()
      listeners.clear()
    },
  }
}

function parse(raw: unknown): Record<string, unknown> | null {
  try {
    const text = typeof raw === 'string' ? raw : String(raw)
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/** The subset of the server's messages the bot acts on. Everything else is somebody's
 * business, not the bot's, and is dropped rather than typed. */
function toEvent(message: Record<string, unknown>): GoblinEvent | null {
  switch (message.type) {
    case 'session-state':
      return { type: 'session-state', state: message.state as SessionState }
    case 'player-joined':
      return { type: 'player-joined', player: message.player as PlayerInfo }
    case 'player-left':
      return { type: 'player-left', player: message.player as PlayerInfo }
    case 'scene-changed':
      return { type: 'scene-changed', sceneId: String(message.sceneId) }
    case 'session-ended':
      return { type: 'session-ended' }
    case 'dm-disconnected':
      return { type: 'dm-disconnected' }
    case 'dm-reconnected':
      return { type: 'dm-reconnected' }
    case 'state-update':
      if (message.module !== 'doors') return null
      return { type: 'doors', state: message.state as DoorsState }
    default:
      return null
  }
}
