// 'command' frames: role check → ModuleRegistry dispatch → module handler (§2.5).
// Refusals reach the sender only and never close the socket.

import type { ClientMessage, PlayerInfo } from '@dnd/core/src/shared/protocol'
import type { CommandError } from '@dnd/mechanics/contract'
import type { DispatchContext, ModuleRegistry } from '../modules/registry'
import type { Broadcaster } from './Broadcaster'
import type { ClientConnection } from './ClientConnection'

type Command = Extract<ClientMessage, { type: 'command' }>

/** The live-session bits a handler may read; SessionManager owns them, this file does not. */
export interface CommandScope {
  activeSceneId: string | null
  players: readonly PlayerInfo[]
}

export class CommandRouter {
  constructor(
    private readonly modules: ModuleRegistry,
    private readonly broadcaster: Broadcaster,
  ) {}

  handle(conn: ClientConnection, msg: Command, scope: CommandScope): void {
    // ponytail: `msg.seq` is the client's own de-dup tag; nothing server-side reads it.
    let error: CommandError | null
    const ctx = this.contextOf(conn, scope)
    // Only a DM's command from the wire is recorded for undo; a player's, and anything the
    // server dispatches itself, never comes through here as one.
    const dm = conn.identity.role === 'dm'
    const was = dm ? this.modules.historyOf(ctx.sessionId) : null
    try {
      error = dm
        ? this.modules.dispatchRecorded(msg.module, msg.action, msg.payload, ctx, typeof msg.group === 'string' ? msg.group : undefined)
        : this.modules.dispatch(msg.module, msg.action, msg.payload, ctx)
    } catch (err) {
      // A module refuses by *returning* a CommandError; anything that throws past that is a
      // server-side bug. This is a `ws` 'message' listener, so an escaping throw is an
      // uncaught exception — the table's whole process, not one bad command. And the sender
      // is left with a gesture that was answered by silence, which is the invisible-refusal
      // shape all over again. Logged for whoever is on call, answered for whoever is playing.
      console.error(`[command] ${msg.module}.${msg.action} threw`, err)
      error = { code: 'invalid-command', message: 'that command could not be run' }
    }
    if (error) this.broadcaster.sendTo(conn, { type: 'error', ...error })
    if (was && !sameNames(was, this.modules.historyOf(ctx.sessionId))) this.sayHistory(conn)
  }

  /** A DM's undo or redo of the session's last recorded step. */
  history(conn: ClientConnection, op: 'undo' | 'redo', scope: CommandScope): void {
    try {
      this.modules.stepHistory(op, this.contextOf(conn, scope))
    } catch (err) {
      console.error(`[history] ${op} threw`, err)
      this.broadcaster.sendTo(conn, { type: 'error', code: 'invalid-command', message: `that ${op} could not be run` })
    }
    this.sayHistory(conn)
  }

  /** Tells a DM seat what its undo and redo buttons would do. */
  sayHistory(conn: ClientConnection): void {
    this.broadcaster.sendTo(conn, { type: 'history', ...this.modules.historyOf(conn.identity.sessionId) })
  }

  private contextOf(conn: ClientConnection, scope: CommandScope): DispatchContext {
    const { identityId, role, sessionId, campaignId } = conn.identity
    return {
      campaignId,
      sessionId,
      activeSceneId: scope.activeSceneId,
      sender: { identityId, role },
      players: scope.players,
      broadcast: (out) => this.broadcaster.broadcast(sessionId, out),
    }
  }
}

const sameNames = (a: ReturnType<ModuleRegistry['historyOf']>, b: ReturnType<ModuleRegistry['historyOf']>): boolean =>
  a.undo?.module === b.undo?.module &&
  a.undo?.action === b.undo?.action &&
  a.redo?.module === b.redo?.module &&
  a.redo?.action === b.redo?.action
