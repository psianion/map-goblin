// ModuleRegistry: the table of game modules and the one dispatch path into them.
// Role gating is data — `commands` maps an action to the roles allowed to run it — so a
// module cannot ship an ungated command by forgetting a check.
//
// The contract itself lives in @dnd/mechanics/contract (D2/D3): modules are written
// against a package with no server in it, so a new module is a mechanics folder and a
// `register` call, never an edit here.

import type {
  CommandError,
  GameModule,
  ModuleContext,
  Viewer,
} from '@dnd/mechanics/contract'
import type { ModuleStateStore } from '../db/stores'

/** What the caller supplies; the registry adds `state` and `setState` on top. */
export type DispatchContext = Omit<ModuleContext<unknown>, 'state' | 'setState'>

export class ModuleRegistry {
  private readonly modules = new Map<string, GameModule<unknown>>()

  constructor(private readonly store: ModuleStateStore) {}

  register<S>(module: GameModule<S>): void {
    this.modules.set(module.name, module)
  }

  /** null = the command ran. Anything else is a typed error for the sender alone. */
  dispatch(
    module: string,
    action: string,
    payload: unknown,
    ctx: DispatchContext,
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

    // Lazy on purpose: a command that never reads its state (ping, scenes) never touches
    // the row, so dispatch stays one prepared statement for the modules that do.
    let loaded: { value: unknown } | undefined
    const read = () => (loaded ??= { value: this.load(ctx.campaignId, found) }).value

    const full: ModuleContext<unknown> = {
      ...ctx,
      get state() {
        return read()
      },
      // D3 — one call persists and tells the table. The broadcast carries the *raw* state;
      // per-viewer redaction happens once, at the Broadcaster choke point (D4).
      setState: (next) => {
        loaded = { value: next }
        this.store.put(ctx.campaignId, found.name, next)
        ctx.broadcast({ type: 'state-update', module: found.name, state: next })
      },
    }
    return found.handler(action, payload, full) ?? null
  }

  /** Join snapshots (§2.3.4): every module's slice, redacted for the viewer receiving it. */
  snapshotModules(campaignId: string, viewer: Viewer): Record<string, unknown> {
    const slices: Record<string, unknown> = {}
    for (const module of this.modules.values()) {
      slices[module.name] = this.redactModule(module.name, this.load(campaignId, module), viewer)
    }
    return slices
  }

  /** How the Broadcaster's redactor reaches a module's `redact` (D4). */
  redactModule(name: string, state: unknown, viewer: Viewer): unknown {
    const module = this.modules.get(name)
    return module?.redact ? module.redact(state, viewer) : state
  }

  private load(campaignId: string, module: GameModule<unknown>): unknown {
    return this.store.get(campaignId, module.name) ?? module.initialState
  }
}
