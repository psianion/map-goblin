// The only outbound path for session-scoped messages (D5, spec §2.5).
// Every frame is redacted for its recipient's role on the way out; the raw socket
// write lives in ClientConnection#deliver and this file is its only caller.

import type { Role, ServerMessage } from '@dnd/core/src/shared/protocol'
import type { ClientConnection } from './ClientConnection'

export type Redactor = (msg: ServerMessage, role: Role) => ServerMessage

/**
 * Strips whatever the recipient's role must not see.
 *
 * S1 strips nothing: no ServerMessage carries per-role secrets yet — the snapshot's
 * PlayerInfo is public roster data and identityIds are how the client keys players.
 * The choke point is the deliverable, not the body. Sprint 3's fog redaction (hidden
 * tokens, unlit regions, DM-only notes) lands *here*, as a change to this function,
 * because Broadcaster leaves no way around it.
 */
export const redactForRole: Redactor = (msg, _role) => msg

/** How Broadcaster finds a session's live clients without owning the session table. */
export type ClientLookup = (sessionId: string) => Iterable<ClientConnection>

export class Broadcaster {
  constructor(
    private readonly clientsOf: ClientLookup,
    /** Seam for the no-bypass test (D5). Production leaves it at redactForRole. */
    private readonly redact: Redactor = redactForRole,
  ) {}

  broadcast(sessionId: string, msg: ServerMessage, except?: ClientConnection): void {
    for (const client of this.clientsOf(sessionId)) {
      if (client !== except) this.sendTo(client, msg)
    }
  }

  sendTo(conn: ClientConnection, msg: ServerMessage): void {
    conn.deliver(JSON.stringify(this.redact(msg, conn.identity.role)))
  }
}
