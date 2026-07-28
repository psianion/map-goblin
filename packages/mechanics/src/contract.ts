// The GameModule contract (spec §2.2, D2/D3). Source of truth for both sides: the game
// server's ModuleRegistry dispatches against these types, and every module (rolls, tokens,
// scenes) implements them.
//
// This package is pure — zero runtime dependencies — which is what lets the Node server
// runtime-import it while D3 still forbids runtime-importing @dnd/core. The imports below
// are all `import type`, so nothing from core survives to runtime.

import type { PlayerInfo, Role, ServerMessage } from '@dnd/core/src/shared/protocol'

/** Who a message is being prepared for, or who sent a command. */
export interface Viewer {
  role: Role
  identityId: string
}

/** A typed refusal delivered to the sender alone; the connection stays open. */
export type CommandError = Omit<Extract<ServerMessage, { type: 'error' }>, 'type'>

/** Everything a handler is allowed to know about the command it is running. */
export interface ModuleContext<S> {
  campaignId: string
  sessionId: string
  activeSceneId: string | null
  sender: Viewer
  players: readonly PlayerInfo[]
  /** The module's persisted state, seeded from `initialState` on first touch (D3/D5). */
  state: S
  /** Persist to `module_state` *and* broadcast a redacted `state-update`, in one call. */
  setState(next: S): void
  /** Ephemeral messages only — anything that is state goes through {@link setState}. */
  broadcast(msg: ServerMessage): void
}

export interface GameModule<S = unknown> {
  name: string
  /** action → roles permitted to run it. An unlisted action is an unknown action. */
  commands: Record<string, readonly Role[]>
  /** Seeds `module_state` the first time this module's state is read for a campaign. */
  initialState: S
  /** Return a CommandError to reject the payload — wire input is untrusted. */
  handler(action: string, payload: unknown, ctx: ModuleContext<S>): CommandError | void
  /**
   * Drops whatever `viewer` must not see (D4). Pure; default = identity. Must be
   * idempotent: a join snapshot is redacted when it is built and again on the way out,
   * because the Broadcaster is the one choke point and it redacts everything.
   */
  redact?(state: S, viewer: Viewer): S
}

export const ANY_ROLE: readonly Role[] = ['dm', 'player']
