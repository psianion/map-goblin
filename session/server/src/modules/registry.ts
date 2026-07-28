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

/**
 * S3 D4c — writer module → the slices its write silently re-redacts. Fog going dark, or a
 * door closing under concealment, does not change one token, yet it changes which ones a
 * player may hold: the tokens slice is re-sent so redaction on the way out drops them.
 * Retraction has to be active — redacting future frames leaves the last known positions
 * sitting in client memory, which is the leak D4c names.
 *
 * Fog moves the doors slice the same way, in the other direction: a player is only told
 * about the doors of rooms they have explored, so without this re-send the door state of
 * the room they just walked into never arrives at all.
 *
 * Doors move the *fog* slice for the same reason a reveal moves it: `reveal-secret` hands a
 * player geometry they did not hold a moment ago (D2), and the fog frame is the one that
 * carries geometry (`mapDelta`, D5). The fog state itself is unchanged — what changed is
 * what this viewer may draw — so the re-send is the only way the door child travels without
 * waiting for a reload.
 */
const RETRACTS: Record<string, readonly string[]> = {
  fog: ['tokens', 'doors'],
  doors: ['tokens', 'fog'],
}

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
        for (const name of RETRACTS[found.name] ?? []) this.resend(name, ctx)
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

  /** Unchanged state, said again — for viewers a *different* module just redacted it for. */
  private resend(name: string, ctx: DispatchContext): void {
    const module = this.modules.get(name)
    if (!module) return
    ctx.broadcast({
      type: 'state-update',
      module: module.name,
      state: this.load(ctx.campaignId, module),
    })
  }

  private load(campaignId: string, module: GameModule<unknown>): unknown {
    return this.store.get(campaignId, module.name) ?? module.initialState
  }
}
