// The bot as a persistent table-watcher (plan §4). One socket per live session, holding the
// campaign's own service token, consuming the same stream a player's client does.
//
// No discord.js and no `ws` type in the signatures: the socket constructor is injected, so
// every reconnect, heartbeat and resync path in here is exercised against a fake in tests.
// The wire types are re-declared rather than imported from the game server — the bot depends
// on the protocol, not on the server package.

import { log as defaultLog } from '../lib/log'

/** Must match the server's PROTOCOL_VERSION, or the join frame is refused outright. */
export const PROTOCOL_VERSION = 5

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

/** One table-log line, as doors and fog carry them: an id, a verb and a target id — the
 * words are the reader's side (session-log.ts, same split as the table client). */
export interface WireLogEntry {
  id: string
  at: number
  /** Server-stamped roster name of the seat that acted. */
  actor: string
  action: string
  sceneId: string
  targetId?: string
}

/** The `doors` module's whole state, as it arrives on every state-update. */
export interface DoorsState {
  byScene: Record<string, Record<string, DoorFlags>>
  log?: WireLogEntry[]
}

/** One dice roll (or typed post) off the `rolls` module's log. Every string was capped and
 * stamped server-side; the bot only prints them. */
export interface WireRollEvent {
  id: string
  at: number
  playerName?: string
  characterName?: string
  title?: string
  formula?: string
  breakdown?: string
  text?: string
  total?: number
  visibility?: string
}

export interface RollsState {
  log?: WireRollEvent[]
}

/** Fog carries the same log shape as doors; its per-scene fog facts are nobody's here. */
export interface FogState {
  log?: WireLogEntry[]
}

/** A trigger's log line arrives with its sentence already written server-side. */
export interface WireTriggerEntry {
  id: string
  at: number
  text: string
}

export interface TriggersState {
  byScene?: Record<string, { log?: WireTriggerEntry[] }>
}

/** A combatant, narrowed to what `/initiative` needs to find the right one. */
export interface WireInitiativeEntry {
  key: string
  name: string
  /** The table seat that owns it, when a linked player claimed the token. */
  identityId?: string
  initiative: number | null
}

/**
 * The initiative tracker, narrowed to what the bot reads: the sentences it mirrors into the
 * thread, and the roster `/initiative` resolves a Discord member against. The sentences are
 * composed server-side for exactly this reason — the table's log and this thread say the same
 * words because neither of them writes any.
 */
export interface InitiativeState {
  status?: 'idle' | 'gathering' | 'running'
  entries?: WireInitiativeEntry[]
  log?: WireTriggerEntry[]
}

/** A placed token, narrowed to the fields the map snapshot draws (plan §5). */
export interface WireToken {
  id: string
  name: string
  /** Centre, in grid cells. */
  x: number
  y: number
  size: string
  disposition: string
  /** DM-only. The bot's observer holds the DM's seat, so these do arrive here. */
  hidden: boolean
}

/** The `tokens` module's whole state, keyed scene → token id. */
export interface TokensState {
  byScene: Record<string, Record<string, WireToken>>
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
  /** Where everyone is standing — the overlay `/map` and the recap snapshot draw (§5). */
  | { type: 'tokens'; state: TokensState }
  /** The session thread's feed (session-log.ts): dice, fog lines, trigger text. */
  | { type: 'rolls'; state: RollsState }
  | { type: 'fog'; state: FogState }
  | { type: 'triggers'; state: TriggersState }
  | { type: 'initiative'; state: InitiativeState }
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
  logger?: Pick<typeof defaultLog, 'warn' | 'info'>
}

export interface Observer {
  /** Returns the unsubscribe. */
  subscribe: (listener: (event: GoblinEvent) => void) => () => void
  /**
   * Run a command on the table over the seat this observer already holds.
   *
   * The bot was receive-only until initiative gave it something to say. It does not need a
   * second credential or an HTTP route to say it: the socket is open, authenticated with the
   * campaign's service token, and its seat carries the DM role — so a Discord player's
   * initiative arrives by exactly the frame the DM's own client would have sent.
   *
   * False means there was no live seat to say it through (mid-reconnect, or the table closed);
   * the caller should tell the person in Discord rather than assume it landed. Delivery past
   * that point is the socket's business — the server answers a refusal with an `error` frame,
   * which nothing here is waiting on.
   */
  command: (module: string, action: string, payload: unknown) => boolean
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
  /** The server has answered the join frame; only then will it accept a command. */
  let joined = false
  let seq = 0

  function emit(event: GoblinEvent): void {
    for (const listener of listeners) listener(event)
  }

  function teardown(): void {
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = null
    socket = null
    awaitingPong = false
    joined = false
  }

  function reconnect(fatal: boolean): void {
    teardown()
    emit({ type: 'closed', fatal })
    if (stopped || fatal) return
    attempts += 1
    const delay = Math.min(maxBackoffMs, FIRST_BACKOFF_MS * 2 ** (attempts - 1))
    logger.info('goblin observer reconnect attempt', { attempt: attempts, delayMs: delay })
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
      logger.info('goblin observer connected', { attempt: attempts })
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
      if (event.type === 'session-state') {
        attempts = 0
        joined = true
      }
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
    command: (module, action, payload) => {
      // `joined`, not merely "the socket object exists": the server refuses everything sent
      // before the join frame is answered, so a command posted into that window is dropped
      // silently — worse than reporting it never went.
      const live = socket
      if (!live || !joined) return false
      seq += 1
      try {
        live.send(JSON.stringify({ type: 'command', module, action, payload, seq }))
        return true
      } catch {
        return false
      }
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
      if (message.module === 'doors') return { type: 'doors', state: message.state as DoorsState }
      if (message.module === 'tokens') return { type: 'tokens', state: message.state as TokensState }
      if (message.module === 'rolls') return { type: 'rolls', state: message.state as RollsState }
      if (message.module === 'fog') return { type: 'fog', state: message.state as FogState }
      if (message.module === 'triggers')
        return { type: 'triggers', state: message.state as TriggersState }
      if (message.module === 'initiative')
        return { type: 'initiative', state: message.state as InitiativeState }
      return null
    default:
      return null
  }
}
