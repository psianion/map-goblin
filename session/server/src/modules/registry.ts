// ModuleRegistry (spec §2.5): the table of game modules and the one dispatch path
// into them. Role gating is data — `commands` maps an action to the roles allowed to
// run it — so a module cannot ship an ungated command by forgetting a check.

import type { Role, ServerMessage } from '@dnd/core/src/shared/protocol'

/** Everything a handler is allowed to know about the command it is running. */
export interface ModuleContext {
  sessionId: string
  sender: { identityId: string; role: Role }
  /** Session-wide, redacted per recipient on the way out (D5). */
  broadcast: (msg: ServerMessage) => void
}

/** A typed refusal for the sender only; the connection stays open (§2.5). */
export type CommandError = Omit<Extract<ServerMessage, { type: 'error' }>, 'type'>

export interface GameModule {
  name: string
  /** action → roles permitted to run it. An unlisted action is an unknown action. */
  commands: Record<string, readonly Role[]>
  /**
   * ponytail: carried, not used. S1 keeps `SessionState.modules` empty; this seeds a
   * module's slice once module_state persistence exists (S2, schema §2.4 already has it).
   */
  initialState: unknown
  /** Return a CommandError to reject the payload — wire input is untrusted. */
  handler: (action: string, payload: unknown, ctx: ModuleContext) => CommandError | void
}

export const ANY_ROLE: readonly Role[] = ['dm', 'player']

export class ModuleRegistry {
  private readonly modules = new Map<string, GameModule>()

  register(module: GameModule): void {
    this.modules.set(module.name, module)
  }

  /** null = the command ran. Anything else is a typed error for the sender alone. */
  dispatch(
    module: string,
    action: string,
    payload: unknown,
    ctx: ModuleContext,
  ): CommandError | null {
    const found = this.modules.get(module)
    if (!found) {
      return { code: 'invalid-command', message: `no module '${module}' is registered` }
    }
    const roles = found.commands[action]
    if (!roles) {
      return { code: 'invalid-command', message: `module '${module}' has no action '${action}'` }
    }
    if (!roles.includes(ctx.sender.role)) {
      return {
        code: 'unauthorized',
        message: `role '${ctx.sender.role}' may not run ${module}.${action}`,
      }
    }
    return found.handler(action, payload, ctx) ?? null
  }
}
