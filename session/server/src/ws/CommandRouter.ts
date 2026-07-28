// 'command' frames: role check → ModuleRegistry dispatch → module handler (§2.5).
// Refusals reach the sender only and never close the socket.

import type { ClientMessage, PlayerInfo } from '@dnd/core/src/shared/protocol'
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
    const error = this.modules.dispatch(msg.module, msg.action, msg.payload, {
      campaignId,
      sessionId,
      activeSceneId: scope.activeSceneId,
      sender: { identityId, role },
      players: scope.players,
      broadcast: (out) => this.broadcaster.broadcast(sessionId, out),
    })
    if (error) this.broadcaster.sendTo(conn, { type: 'error', ...error })
  }
}
