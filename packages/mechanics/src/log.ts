// The table log's shared shape (§2.4.3). Doors and fog both write lines to it; nothing
// here is a module of its own.
//
// A line rides the state of the module whose command minted it, and that is the whole
// design: the per-seat cut a log line needs is the cut its module already makes, so
// `redact` filters the lines beside the facts they are about and a line can never outlive —
// or outrun — what it names. A separate log module would need its own copy of "which doors
// has this seat explored", which is a second answer to a question that must only have one.
//
// What travels is an id, never a name. Which name a seat may read is the map redactor's
// decision, so the client resolves the id against the doors and rooms it actually holds and
// says "a door" when it holds nothing — the same rule `doorRefusal` follows.

import type { ModuleContext } from './contract'

export type LogAction =
  // doors
  | 'opened'
  | 'closed'
  | 'locked'
  | 'unlocked'
  | 'revealed-secret'
  // fog
  | 'revealed-room'
  | 'hid-room'
  | 'revealed-all'
  | 'hid-all'
  | 'changed-fog'
  | 'reset-fog'

export interface LogEntry {
  /** Unique inside the log; also the client's render key. */
  id: string
  at: number
  /** Server-stamped roster name of the seat that ran the command — never client-supplied. */
  actor: string
  /** What they did. The client owns the sentence; this is the verb it looks up. */
  action: LogAction
  /** The scene the line belongs to, so a redactor knows which cut to ask for. */
  sceneId: string
  /** Door or room the line is about. Absent for a whole-scene action. */
  targetId?: string
}

/** A state slice that carries log lines. Optional: campaigns predate the log. */
export interface Logged {
  log?: LogEntry[]
}

/** D5, as for rolls: the state carries a recent window, not the campaign's history. */
export const MAX_LOG_ENTRIES = 100

// ponytail: a counter, not a UUID — same reason as `rolls`: this package is dependency-free
// and an id only has to be unique inside a 100-entry window.
let minted = 0

/** The log with one more line on the end, capped. An actorless command adds nothing. */
export function logged(
  log: readonly LogEntry[] | undefined,
  entry: Omit<LogEntry, 'id' | 'at' | 'actor'> & { actor: string | null },
): LogEntry[] | undefined {
  // Nobody at the table means this was setup, not play: the starting room the wizard lights
  // before the invite code exists is stored fog and nothing else, because a log line about
  // it would be attributed to a seat that did not exist yet and dated before the session.
  if (entry.actor === null) return log as LogEntry[] | undefined
  const at = Date.now()
  minted += 1
  const line: LogEntry = {
    ...entry,
    actor: entry.actor,
    id: `l${at.toString(36)}${minted.toString(36)}`,
    at,
  }
  return [...(log ?? []), line].slice(-MAX_LOG_ENTRIES)
}

/** Who ran the command, by the roster's own name for them — null if no roster knows them. */
export function actorOf(ctx: Pick<ModuleContext<unknown>, 'sender' | 'players'>): string | null {
  return ctx.players.find((p) => p.identityId === ctx.sender.identityId)?.name ?? null
}
