// The only outbound path for session-scoped messages (D5, spec §2.5).
// Every frame is redacted for its recipient on the way out; the raw socket write lives in
// ClientConnection#deliver and this file is its only caller.

import type { ServerMessage } from '@dnd/core/src/shared/protocol'
import type { Viewer } from '@dnd/mechanics/contract'
import type { MapDelta } from '../fog/redactMap'
import type { Vision } from '../fog/vision'
import type { ModuleRegistry } from '../modules/registry'
import type { ClientConnection } from './ClientConnection'

type StateUpdate = Extract<ServerMessage, { type: 'state-update' }>

/**
 * §2.1 — a fog `state-update` may carry the map slices the change just made available
 * (D5). The wire type in @dnd/core is left as it is: S3's only change there is the version
 * constant (§2.5), so the extra field is declared here, where it is written.
 */
export type OutboundMessage = ServerMessage | (StateUpdate & { mapDelta: MapDelta })

/** D4 — per viewer, not per role: "my own private rolls" needs the identityId too. */
export type Redactor = (msg: ServerMessage, viewer: Viewer) => OutboundMessage

/**
 * The production redactor: module state is the only thing on the wire with per-viewer
 * secrets in it, so this consults each module's `redact` for its own slice and leaves
 * everything else alone. Roster data (PlayerInfo, identityIds) is public — the client
 * keys players by it.
 *
 * One function, injected once, so Broadcaster still has exactly one place to call it.
 */
export function buildRedactor(registry: ModuleRegistry, vision?: Vision): Redactor {
  return (msg, viewer) => {
    if (msg.type === 'state-update') {
      const out = { ...msg, state: registry.redactModule(msg.module, msg.state, viewer) }
      // D5 — atomic: the rooms this change just opened travel in the same frame as the fog
      // state that names them, so there is no window where a client knows a room is
      // revealed and has nothing to draw. The DM already holds the whole map.
      if (msg.module === 'fog' && viewer.role !== 'dm' && vision) {
        const mapDelta = revealed(msg, vision)
        if (mapDelta) return { ...out, mapDelta }
      }
      return out
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

/**
 * One command writes one scene, so the first scene with anything newly explored is the one
 * that changed. `vision` recomputes per mutation and caches, so asking every touched scene
 * costs a map lookup each.
 */
function revealed(msg: StateUpdate, vision: Vision): MapDelta | null {
  const byScene = (msg.state as { byScene?: Record<string, unknown> }).byScene ?? {}
  for (const sceneId of Object.keys(byScene)) {
    const delta = vision.revealDelta(sceneId)
    if (delta) return delta
  }
  return null
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
