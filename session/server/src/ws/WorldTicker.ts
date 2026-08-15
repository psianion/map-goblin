// P4 — the world clock ticks itself while a session is open and `timeSpeed` says to.
//
// One `triggers.set-world` dispatch per whole game-minute, through registry.dispatch — the
// exact path a DM's own clock command takes — so a tick and a manual scrub persist, broadcast
// and narrate band crossings alike (S3's "one rule both sides run" doctrine, applied to time
// instead of light).
//
// Drift-free: each session keeps a `Base` (the wall-clock moment its accumulator last agreed
// with the stored clock) rather than counting interval firings. A tick only ever consumes the
// wall-clock ms the committed minutes actually cost, so a fractional remainder survives to the
// next tick instead of being rounded away.

import type { PlayerInfo } from '@dnd/core/src/shared/protocol'
import { advanceClock } from '@dnd/core/src/shared/world'
import type { Viewer } from '@dnd/mechanics/contract'
import { worldOf, type TriggersState } from '@dnd/mechanics/triggers'
import type { DispatchContext, ModuleRegistry } from '../modules/registry'

/** Default check period. Ticking is drift-free against wall time, so this only bounds how
 *  stale a committed game-minute can be before it broadcasts — not correctness. */
export const DEFAULT_TICK_MS = 2_000

/** No real identity sent this — `set-world`'s handler never reads `sender.identityId`, and
 *  the role gate is all that matters (P4 rides the DM-only command a DM's own dial uses). */
const TICKER: Viewer = { role: 'dm', identityId: 'world-clock' }

const EMPTY_TRIGGERS: TriggersState = { byScene: {} }

interface Base {
  at: number
  clock: number
  speed: string
}

/** The live bits of a session a tick needs, read fresh every call — a session's active scene
 *  and roster both change under it while it keeps ticking. */
export interface TickSession {
  sessionId: string
  campaignId: string
  activeSceneId(): string | null
  players(): readonly PlayerInfo[]
  broadcast: DispatchContext['broadcast']
}

export class WorldTicker {
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly bases = new Map<string, Base>()

  constructor(
    private readonly registry: ModuleRegistry,
    private readonly intervalMs = DEFAULT_TICK_MS,
  ) {}

  /** Starts the session's own interval. A second `start` for the same id is a no-op — a
   *  session opens once (`SessionManager.sessionFor`). */
  start(session: TickSession): void {
    if (this.timers.has(session.sessionId)) return
    const timer = setInterval(() => this.tick(session), this.intervalMs)
    timer.unref()
    this.timers.set(session.sessionId, timer)
  }

  /** A session closed — no session, no ticking (campaign-global clock or not). */
  stop(sessionId: string): void {
    const timer = this.timers.get(sessionId)
    if (timer) clearInterval(timer)
    this.timers.delete(sessionId)
    this.bases.delete(sessionId)
  }

  close(): void {
    for (const timer of this.timers.values()) clearInterval(timer)
    this.timers.clear()
    this.bases.clear()
  }

  private tick(session: TickSession): void {
    const raw = this.registry.readState(session.campaignId, 'triggers') as TriggersState | undefined
    const world = worldOf(raw ?? EMPTY_TRIGGERS)
    const base = this.bases.get(session.sessionId)

    // First sight of this session, or the clock/speed moved without us — a DM's own scrub or
    // dial turn. Either way the accumulator restarts from now: a manual set must not leave a
    // stale fractional jump to leak into the next auto-advance (P4 semantics).
    if (!base || base.clock !== world.clock || base.speed !== world.timeSpeed) {
      this.bases.set(session.sessionId, { at: Date.now(), clock: world.clock, speed: world.timeSpeed })
      return
    }
    if (world.timeSpeed === 'paused') return // no tick work while paused

    const advance = advanceClock(world.clock, world.timeSpeed, Date.now() - base.at)
    if (!advance) return

    const ctx: DispatchContext = {
      campaignId: session.campaignId,
      sessionId: session.sessionId,
      activeSceneId: session.activeSceneId(),
      sender: TICKER,
      players: session.players(),
      broadcast: session.broadcast,
    }
    // This fires unattended every tick forever — a throw here would take the whole server
    // down with it, so it gets the same containment as afterWrite/cascade.
    try {
      this.registry.dispatch('triggers', 'set-world', { clock: advance.clock }, ctx)
    } catch (err) {
      console.warn('world ticker dispatch failed', err)
      return
    }
    // Consume exactly the ms the committed minutes cost, not "now" — the leftover remainder
    // keeps accumulating toward the next one.
    this.bases.set(session.sessionId, { at: base.at + advance.consumedMs, clock: advance.clock, speed: world.timeSpeed })
  }
}
