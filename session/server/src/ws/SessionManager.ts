// Sessions, presence, heartbeat — the behaviour contracts in spec §2.5.

import type { ClientMessage, PlayerInfo, SessionState } from '@dnd/core/src/shared/protocol'
import type { Viewer } from '@dnd/mechanics/contract'
import { PROTOCOL_VERSION } from '../config'
import type { Vision } from '../fog/vision'
import type { ModuleRegistry } from '../modules/registry'
import { Broadcaster, buildRedactor, type Redactor } from './Broadcaster'
import type { ClientConnection } from './ClientConnection'
import { CommandRouter } from './CommandRouter'

interface Session {
  id: string
  campaignId: string
  /** Survives disconnects — identity is retained with `connected: false` (§2.5). */
  players: Map<string, PlayerInfo>
  clients: Set<ClientConnection>
  /** A DM has joined at least once, so a later DM join is a *re*connect. */
  dmSeen: boolean
}

/** Where a snapshot's scene list comes from — boot backs it with MapStore/SessionStore. */
export type SceneSource = (session: {
  id: string
  campaignId: string
}) => Pick<SessionState, 'scenes' | 'activeSceneId'>

export interface SessionManagerOptions {
  /** Ping period. Default 15s (§2.5). */
  heartbeatMs?: number
  /** Unanswered pings tolerated before the socket is dropped. Default 2 (§2.5). */
  missedPongLimit?: number
  /** Test seam only — the D5 no-bypass test passes a spy. Defaults to `buildRedactor`. */
  redact?: Redactor
  /** S3 — what the fog answers; without it a fog reveal carries no map delta (D5). */
  vision?: Vision
  /** Defaults to no scenes: a SessionManager without a database has nothing to list. */
  scenes?: SceneSource
  /**
   * Is this session still open? Defaults to yes — a SessionManager without a database has
   * nothing that could have ended behind its back.
   */
  sessionActive?: (sessionId: string) => boolean
  /** Has this identity been banned since it connected? Defaults to no, for the same reason. */
  isBanned?: (identityId: string) => boolean
}

export class SessionManager {
  private readonly sessions = new Map<string, Session>()
  private readonly connections = new Set<ClientConnection>()
  private readonly missedPongLimit: number
  private readonly timer: NodeJS.Timeout
  private readonly broadcaster: Broadcaster
  private readonly router: CommandRouter
  private readonly scenes: SceneSource
  private readonly sessionActive: (sessionId: string) => boolean
  private readonly isBanned: (identityId: string) => boolean

  constructor(
    /** Already populated — boot owns which modules exist (§2.3.8). */
    private readonly modules: ModuleRegistry,
    {
      heartbeatMs = 15_000,
      missedPongLimit = 2,
      redact,
      vision,
      scenes = () => ({ scenes: [], activeSceneId: null }),
      sessionActive = () => true,
      isBanned = () => false,
    }: SessionManagerOptions = {},
  ) {
    this.missedPongLimit = missedPongLimit
    this.scenes = scenes
    this.sessionActive = sessionActive
    this.isBanned = isBanned
    this.timer = setInterval(() => this.heartbeat(), heartbeatMs)
    this.timer.unref()

    this.broadcaster = new Broadcaster(
      (id) => this.sessions.get(id)?.clients ?? [],
      redact ?? buildRedactor(modules, vision),
    )
    this.router = new CommandRouter(modules, this.broadcaster)
  }

  /** Takes ownership of a freshly upgraded socket. The client is not in a session until it joins. */
  accept(conn: ClientConnection): void {
    this.connections.add(conn)
    conn.onMessage(
      (msg) => this.handleMessage(conn, msg),
      (reason) => this.broadcaster.sendTo(conn, { type: 'error', code: 'invalid-command', message: reason }),
    )
    conn.onClose(() => {
      this.connections.delete(conn)
      this.leave(conn)
    })
  }

  close(): void {
    clearInterval(this.timer)
    for (const conn of this.connections) conn.terminate()
    this.connections.clear()
    this.sessions.clear()
  }

  /**
   * HTTP ended the session (§2.3). Tell the table before dropping it — the sockets close
   * next, and `leave()` finds nothing left to announce, which is the point: a session that
   * ended is not a table full of people who all disconnected.
   */
  endSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.broadcaster.broadcast(sessionId, { type: 'session-ended' })
    this.sessions.delete(sessionId)
    for (const client of session.clients) client.close()
  }

  /**
   * The DM banned someone (§2.3). Their token stays signed and their socket stays open
   * until told otherwise, so say otherwise — the upgrade refuses the next one.
   */
  disconnectIdentity(identityId: string): void {
    for (const conn of this.connections) {
      if (conn.identity.identityId === identityId) conn.close()
    }
  }

  private handleMessage(conn: ClientConnection, msg: ClientMessage): void {
    // Checked per frame rather than at upgrade only: a ban has to reach the socket someone
    // is already holding, not just the one they open next.
    if (this.isBanned(conn.identity.identityId)) {
      this.broadcaster.sendTo(conn, { type: 'error', code: 'banned', message: 'you have been removed from this table' })
      conn.close()
      return
    }

    if (msg.type === 'join') return this.join(conn, msg.protocolVersion)

    // Nothing before the handshake: a socket that skipped `join` skipped the protocol
    // gate (D8) with it, and must not be able to broadcast into a session it never
    // entered. Membership *is* the handshake — `join` is what puts a conn in `clients`.
    const session = this.sessions.get(conn.identity.sessionId)
    if (!session?.clients.has(conn)) {
      this.broadcaster.sendTo(conn, {
        type: 'error',
        code: 'unauthorized',
        message: 'join before sending anything else',
      })
      conn.close()
      return
    }


    switch (msg.type) {
      case 'ping':
        return this.broadcaster.sendTo(conn, { type: 'pong', t: msg.t })
      case 'command':
        // ponytail: `scenes()` is two prepared statements and runs per command, including
        // 10 Hz token drags. Cache it on the Session if a profile ever says to.
        return this.router.handle(conn, msg, {
          activeSceneId: this.scenes(session).activeSceneId,
          players: [...session.players.values()],
        })
    }
  }

  private join(conn: ClientConnection, protocolVersion: number): void {
    if (protocolVersion !== PROTOCOL_VERSION) {
      // D8 — reject rather than guess at an unknown wire shape.
      this.broadcaster.sendTo(conn, {
        type: 'error',
        code: 'protocol-mismatch',
        message: `server speaks protocol ${PROTOCOL_VERSION}, client sent ${protocolVersion}`,
      })
      conn.close()
      return
    }

    const { identityId, name, role, sessionId, campaignId } = conn.identity
    // A socket that upgraded while the table was open, then sat there through the DM
    // ending it, must not be able to `join` it back into existence: `sessionFor` creates
    // on miss, so without this the first frame after `endSession` resurrects the session.
    if (!this.sessionActive(sessionId)) {
      this.broadcaster.sendTo(conn, { type: 'session-ended' })
      conn.close()
      return
    }

    const session = this.sessionFor(sessionId, campaignId)
    // Read before the supersede below, so a DM opening a second tab is not a *re*connect.
    const dmReturning = role === 'dm' && session.dmSeen && !hasConnectedDm(session)

    // One identity, one live socket. A second tab — or a reconnect that raced the old
    // socket's close — supersedes the previous one, which leaves the roster *before* it is
    // closed so `leave()` finds nothing to announce: the identity never went anywhere.
    // Re-joining on the same socket is a snapshot refresh (§2.4.3) and skips all of this.
    for (const other of session.clients) {
      if (other !== conn && other.identity.identityId === identityId) {
        session.clients.delete(other)
        other.close()
      }
    }

    const player: PlayerInfo = { identityId, name, role, connected: true }
    session.players.set(identityId, player)
    session.clients.add(conn)
    if (role === 'dm') session.dmSeen = true

    this.broadcaster.sendTo(conn, {
      type: 'session-state',
      state: this.snapshot(session, conn.identity),
      you: player,
    })
    this.broadcaster.broadcast(session.id, { type: 'player-joined', player }, conn)
    if (dmReturning) this.broadcaster.broadcast(session.id, { type: 'dm-reconnected' })
  }

  private leave(conn: ClientConnection): void {
    const session = this.sessions.get(conn.identity.sessionId)
    // Never joined, or already reaped: nothing to announce.
    if (!session?.clients.delete(conn)) return

    const player = session.players.get(conn.identity.identityId)
    if (player) {
      player.connected = false
      this.broadcaster.broadcast(session.id, { type: 'player-left', player })
    }
    // Session stays alive read-only; players just see the banner (§2.5).
    if (conn.identity.role === 'dm' && !hasConnectedDm(session)) {
      this.broadcaster.broadcast(session.id, { type: 'dm-disconnected' })
    }
    // ponytail: in-memory only, so an empty session is dropped. A3 persists sessions
    // and identities to SQLite, at which point this becomes a state transition instead.
    if (session.clients.size === 0) this.sessions.delete(session.id)
  }

  private heartbeat(): void {
    for (const conn of this.connections) {
      if (conn.missedPongs >= this.missedPongLimit) conn.terminate()
      else conn.ping()
    }
  }

  private sessionFor(id: string, campaignId: string): Session {
    let session = this.sessions.get(id)
    if (!session) {
      session = { id, campaignId, players: new Map(), clients: new Set(), dmSeen: false }
      this.sessions.set(id, session)
    }
    return session
  }

  /** Scenes and the active one are read fresh: an upload between joins must show up. */
  private snapshot(session: Session, viewer: Viewer): SessionState {
    return {
      protocolVersion: PROTOCOL_VERSION,
      sessionId: session.id,
      campaignId: session.campaignId,
      ...this.scenes(session),
      players: [...session.players.values()],
      modules: this.modules.snapshotModules(session.campaignId, viewer),
    }
  }
}

function hasConnectedDm(session: Session): boolean {
  for (const client of session.clients) if (client.identity.role === 'dm') return true
  return false
}
