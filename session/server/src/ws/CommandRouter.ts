// 'command' frames: role check → ModuleRegistry dispatch → module handler (§2.5).
// Refusals reach the sender only and never close the socket.

import type { ClientMessage } from '@dnd/core/src/shared/protocol'
import type { ModuleRegistry } from '../modules/registry'
import type { Broadcaster } from './Broadcaster'
import type { ClientConnection } from './ClientConnection'

type Command = Extract<ClientMessage, { type: 'command' }>

export class CommandRouter {
  constructor(
    private readonly modules: ModuleRegistry,
    private readonly broadcaster: Broadcaster,
  ) {}

  handle(conn: ClientConnection, msg: Command): void {
    const { identityId, role, sessionId } = conn.identity
    // ponytail: `msg.seq` is the client's own de-dup tag; nothing server-side reads it
    // until commands become persisted state (S2).
    const error = this.modules.dispatch(msg.module, msg.action, msg.payload, {
      sessionId,
      sender: { identityId, role },
      broadcast: (out) => this.broadcaster.broadcast(sessionId, out),
    })
    if (error) this.broadcaster.sendTo(conn, { type: 'error', ...error })
  }
}
