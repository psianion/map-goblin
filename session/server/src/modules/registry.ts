// ModuleRegistry: the table of game modules and the one dispatch path into them.
// Role gating is data — `commands` maps an action to the roles allowed to run it — so a
// module cannot ship an ungated command by forgetting a check.
//
// The contract itself lives in @dnd/mechanics/contract (D2/D3): modules are written
// against a package with no server in it, so a new module is a mechanics folder and a
// `register` call, never an edit here.

import type { ServerMessage } from '@dnd/core/src/shared/protocol'
import type {
  CommandError,
  GameModule,
  ModuleContext,
  Viewer,
} from '@dnd/mechanics/contract'
import type { ModuleStateStore } from '../db/stores'
import type { SceneTagged } from '../ws/Broadcaster'

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

/**
 * M4 — the writes a trigger may be conditioned on. After one of these succeeds, the registry
 * tells the triggers module so it can re-evaluate against the post-write truth (a token that
 * just moved, a room that just got revealed). Keying off `tokens.*`/`fog.*` only is also what
 * keeps this from ever cascading into itself: `triggers.event` (dispatched internally, below)
 * is not in this table, so its own successful run never queues a second cascade.
 */
const CASCADES: Record<string, readonly string[]> = {
  tokens: ['move', 'place', 'update', 'delete', 'claim', 'hide'],
  fog: ['reveal', 'set-bulk', 'hide', 'reset'],
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
    return this.run(found, action, payload, ctx)
  }

  /**
   * The one door into an action that is not in a module's `commands` map — skipping both
   * the role gate and the existence check `dispatch` makes against `commands`. Only this
   * registry calls it, and only for `triggers.event` (see the cascade below): the wire's
   * `CommandRouter` calls `dispatch` exclusively, so an action left out of `commands` — the
   * way `event` deliberately is — stays permanently unreachable from a socket no matter what
   * a client sends. That absence *is* the access control; this method is the one place
   * allowed to step around it.
   */
  dispatchInternal(
    module: string,
    action: string,
    payload: unknown,
    ctx: DispatchContext,
  ): CommandError | null {
    const found = this.modules.get(module)
    if (!found) {
      return { code: 'invalid-command', message: `no module '${module}' is registered` }
    }
    return this.run(found, action, payload, ctx)
  }

  private run(
    found: GameModule<unknown>,
    action: string,
    payload: unknown,
    ctx: DispatchContext,
  ): CommandError | null {
    // Lazy on purpose: a command that never reads its state (ping, scenes) never touches
    // the row, so dispatch stays one prepared statement for the modules that do.
    let loaded: { value: unknown } | undefined
    const read = () => (loaded ??= { value: this.load(ctx.campaignId, found) }).value

    // The scene this command names, read the way every scene-scoped module reads its own
    // payload, and tagged onto every `state-update` the dispatch sends — the module's own
    // and the retract re-sends. Module state names every scene the table has ever touched,
    // so a frame is the only thing that can say which one a change was about, and the
    // geometry a reveal carries has to be keyed off the scene that was written (D5).
    const sceneId = sceneOf(payload, ctx.activeSceneId)
    const say = (msg: ServerMessage): void => {
      if (msg.type !== 'state-update' || !sceneId) return ctx.broadcast(msg)
      const tagged: SceneTagged = { ...msg, sceneId }
      ctx.broadcast(tagged)
    }

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
        say({ type: 'state-update', module: found.name, state: next })
        for (const name of RETRACTS[found.name] ?? []) this.resend(name, ctx.campaignId, say)
      },
    }
    const result = found.handler(action, payload, full) ?? null
    if (result === null) this.cascade(found.name, action, sceneId, ctx)
    return result
  }

  /**
   * M4 — after a `tokens`/`fog` write actually lands, ask triggers whether anything just
   * fired. Swallowed on error: a bad cascade is a server-side bug to notice, never something
   * the player who moved a token should see instead of their move succeeding.
   */
  private cascade(module: string, action: string, sceneId: string | null, ctx: DispatchContext): void {
    if (!CASCADES[module]?.includes(action)) return
    if (!sceneId || !this.modules.has('triggers')) return
    try {
      const error = this.dispatchInternal('triggers', 'event', { sceneId, source: { module, action } }, ctx)
      if (error) console.warn(`[triggers] cascade from ${module}.${action} refused: ${error.message}`)
    } catch (err) {
      console.warn(`[triggers] cascade from ${module}.${action} threw`, err)
    }
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
  private resend(name: string, campaignId: string, say: (msg: ServerMessage) => void): void {
    const module = this.modules.get(name)
    if (!module) return
    say({ type: 'state-update', module: module.name, state: this.load(campaignId, module) })
  }

  private load(campaignId: string, module: GameModule<unknown>): unknown {
    return this.store.get(campaignId, module.name) ?? module.initialState
  }
}

/**
 * The scene a command names: its payload's `sceneId`, else the table's active scene. Fog,
 * doors and tokens each apply exactly this rule to their own payload; it is here as well
 * because the frames leaving this file all need the same answer and none of them can ask a
 * module for it.
 */
function sceneOf(payload: unknown, activeSceneId: string | null): string | null {
  const named = (payload as { sceneId?: unknown } | null | undefined)?.sceneId
  return typeof named === 'string' ? named : activeSceneId
}
