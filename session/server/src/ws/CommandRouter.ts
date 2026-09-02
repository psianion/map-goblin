// 'command' frames: role check → ModuleRegistry dispatch → module handler (§2.5).
// Refusals reach the sender only and never close the socket.

import type { ClientMessage, PlayerInfo } from '@dnd/core/src/shared/protocol'
import type { CommandError } from '@dnd/mechanics/contract'
import type { ModuleRegistry } from '../modules/registry'
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
    const { identityId, role, sessionId, campaignId } = conn.identity
    // ponytail: `msg.seq` is the client's own de-dup tag; nothing server-side reads it.
    let error: CommandError | null
    try {
      error = this.modules.dispatch(msg.module, msg.action, msg.payload, {
        campaignId,
        sessionId,
        activeSceneId: scope.activeSceneId,
        sender: { identityId, role },
        players: scope.players,
        broadcast: (out) => this.broadcaster.broadcast(sessionId, out),
      })
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
  }
}
