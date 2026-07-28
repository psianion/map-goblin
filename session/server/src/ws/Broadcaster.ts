// The only outbound path for session-scoped messages (D5, spec §2.5).
// Every frame is redacted for its recipient on the way out; the raw socket write lives in
// ClientConnection#deliver and this file is its only caller.

import type { ServerMessage } from '@dnd/core/src/shared/protocol'
import type { Viewer } from '@dnd/mechanics/contract'
import type { ModuleRegistry } from '../modules/registry'
import type { ClientConnection } from './ClientConnection'

/** D4 — per viewer, not per role: "my own private rolls" needs the identityId too. */
export type Redactor = (msg: ServerMessage, viewer: Viewer) => ServerMessage

/**
 * The production redactor: module state is the only thing on the wire with per-viewer
 * secrets in it, so this consults each module's `redact` for its own slice and leaves
 * everything else alone. Roster data (PlayerInfo, identityIds) is public — the client
 * keys players by it.
 *
 * One function, injected once, so Broadcaster still has exactly one place to call it.
 */
export function buildRedactor(registry: ModuleRegistry): Redactor {
  return (msg, viewer) => {
    if (msg.type === 'state-update') {
      return { ...msg, state: registry.redactModule(msg.module, msg.state, viewer) }
    }
    if (msg.type === 'session-state') {
      const modules: Record<string, unknown> = {}
      for (const [name, state] of Object.entries(msg.state.modules)) {
        modules[name] = registry.redactModule(name, state, viewer)
      }
      return { ...msg, state: { ...msg.state, modules } }
    }
    return msg
  }
}

/** How Broadcaster finds a session's live clients without owning the session table. */
export type ClientLookup = (sessionId: string) => Iterable<ClientConnection>

export class Broadcaster {
  constructor(
    private readonly clientsOf: ClientLookup,
    /** Seam for the no-bypass test (D5). Production passes buildRedactor(registry). */
    private readonly redact: Redactor,
  ) {}

  broadcast(sessionId: string, msg: ServerMessage, except?: ClientConnection): void {
    for (const client of this.clientsOf(sessionId)) {
      if (client !== except) this.sendTo(client, msg)
    }
  }

  sendTo(conn: ClientConnection, msg: ServerMessage): void {
    conn.deliver(JSON.stringify(this.redact(msg, conn.identity)))
  }
}
