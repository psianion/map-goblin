// The table log, re-derived for the session thread (plan §4's stream, GameLog's wording).
// The client never sends "the log" as a message: rolls, door and fog lines and trigger text
// all ride their modules' state, so this rebuilds the same feed the Log panel shows — from
// the DM seat, which receives it unredacted.
//
// Pure and Discord-free, like session-stats: events in, formatted lines out. What makes it
// more than a formatter is the seeding — module state persists per *campaign*, so the join
// snapshot arrives carrying the tail of every previous session, and a thread that replayed
// it would open with last week's dice. The first snapshot is recorded, never spoken.

import type { GoblinEvent, SessionState, WireLogEntry, WireRollEvent, WireTriggerEntry } from './observer'

export interface LogLine {
  at: number
  text: string
}

/** targetId → display name, from whatever map the caller has managed to fetch. Undefined is
 * fine — the line degrades to "a door", exactly as a player without the name would read it. */
export type NameOf = (targetId: string) => string | undefined

export interface SessionLog {
  /** Lines this event added, oldest first. Empty for anything already seen or unspeakable. */
  apply: (event: GoblinEvent) => LogLine[]
}

/** Discord's own short-time render, so every reader sees the table's clock in their zone. */
const stamp = (at: number): string => `<t:${Math.floor(at / 1000)}:t>`

const quiet = (at: number, text: string): LogLine => ({ at, text: `${stamp(at)} *${text}*` })

/** GameLog's lead-in: the player, with the character riding along when it adds anything. */
const withCharacter = (player: string, character: string | undefined): string =>
  character && character !== player ? `${player} (${character})` : player

function rollLine(event: WireRollEvent): LogLine {
  const who = withCharacter(event.playerName ?? 'Someone', event.characterName)
  const parts = [`${stamp(event.at)} 🎲 **${who}**`]
  if (event.title) parts.push(event.title)
  if (event.text) parts.push(event.text)
  if (event.total !== undefined) parts.push(`— **${event.total}**`)
  const math = [event.formula, event.breakdown].filter(Boolean).join(' = ')
  if (math) parts.push(`\`${math}\``)
  if (event.visibility === 'private') parts.push('🔒')
  return { at: event.at, text: parts.join(' ') }
}

/** tableLog.ts's sentences, word for word — the thread and the Log panel must read alike. */
function logSentence(action: string, name: string | undefined): string {
  switch (action) {
    case 'opened':
      return name ? `opened ${name}` : 'opened a door'
    case 'closed':
      return name ? `closed ${name}` : 'closed a door'
    case 'locked':
      return name ? `locked ${name}` : 'locked a door'
    case 'unlocked':
      return name ? `unlocked ${name}` : 'unlocked a door'
    case 'revealed-secret':
      return name ? `revealed the secret door ${name}` : 'revealed a secret door'
    case 'revealed-room':
      return name ? `revealed ${name}` : 'revealed a room'
    case 'hid-room':
      return name ? `hid ${name}` : 'hid a room'
    case 'revealed-all':
      return 'revealed the whole map'
    case 'hid-all':
      return 'hid the whole map'
    case 'changed-fog':
      return 'changed what the map shows'
    case 'reset-fog':
      return 'reset the fog'
    default:
      // Wire data — an action this build has no words for is dropped, not half-printed.
      return ''
  }
}

/** Untrusted wire arrays, read defensively the way GameLog reads them. */
const listOf = <T extends { id?: unknown }>(value: unknown): T[] =>
  (Array.isArray(value) ? value : []).filter(
    (e): e is T => typeof e === 'object' && e !== null && typeof (e as { id?: unknown }).id === 'string',
  )

const triggerLogsOf = (state: { byScene?: Record<string, { log?: unknown }> }): WireTriggerEntry[] =>
  Object.values(state.byScene ?? {}).flatMap((scene) => listOf<WireTriggerEntry>(scene?.log))

export function createSessionLog(nameOf: NameOf): SessionLog {
  const seen = new Set<string>()
  let seeded = false
  const sceneNames = new Map<string, string>()

  /** Emit the entries not yet seen — or swallow them all, which is what seeding is. */
  function diff<T extends { id: string; at: number }>(
    entries: T[],
    speak: ((entry: T) => LogLine | null) | null,
  ): LogLine[] {
    const lines: LogLine[] = []
    for (const entry of entries) {
      if (seen.has(entry.id)) continue
      seen.add(entry.id)
      const line = speak?.(entry)
      if (line) lines.push(line)
    }
    return lines
  }

  /** A line whose sentence was written server-side; the mirror only decides where it goes. */
  const writtenLine = (entry: WireTriggerEntry): LogLine | null =>
    entry.text ? quiet(entry.at, entry.text) : null

  const doorFogLine = (entry: WireLogEntry): LogLine | null => {
    const sentence = logSentence(entry.action, entry.targetId ? nameOf(entry.targetId) : undefined)
    return sentence ? quiet(entry.at, `${entry.actor || 'Someone'} ${sentence}`) : null
  }

  function fromModules(modules: Record<string, unknown> | undefined, speak: boolean): LogLine[] {
    const of = (module: string): unknown => (modules?.[module] as { log?: unknown } | undefined)?.log
    return [
      ...diff(listOf<WireRollEvent>(of('rolls')), speak ? rollLine : null),
      ...diff(listOf<WireLogEntry>(of('doors')), speak ? doorFogLine : null),
      ...diff(listOf<WireLogEntry>(of('fog')), speak ? doorFogLine : null),
      ...diff(
        triggerLogsOf((modules?.triggers as { byScene?: Record<string, { log?: unknown }> }) ?? {}),
        speak ? (e) => (e.text ? quiet(e.at, e.text) : null) : null,
      ),
      ...diff(
        listOf<WireTriggerEntry>((modules?.initiative as { log?: unknown })?.log),
        speak ? writtenLine : null,
      ),
    ].sort((a, b) => a.at - b.at)
  }

  function fromSnapshot(state: SessionState): LogLine[] {
    for (const scene of state.scenes ?? []) sceneNames.set(scene.id, scene.name)
    // The first snapshot is the campaign's history, not this session's news. Later snapshots
    // are resyncs, and their unseen tail is what a brief disconnect would otherwise have eaten.
    const speak = seeded
    seeded = true
    return fromModules(state.modules, speak)
  }

  return {
    apply: (event) => {
      switch (event.type) {
        case 'session-state':
          return fromSnapshot(event.state)
        case 'player-joined':
          return [quiet(Date.now(), `${event.player.name} joined the table`)]
        case 'player-left':
          return [quiet(Date.now(), `${event.player.name} left the table`)]
        case 'scene-changed':
          return [quiet(Date.now(), `Scene: ${sceneNames.get(event.sceneId) ?? event.sceneId}`)]
        case 'rolls':
          return diff(listOf<WireRollEvent>(event.state.log), rollLine)
        case 'doors':
          return diff(listOf<WireLogEntry>(event.state.log), doorFogLine)
        case 'fog':
          return diff(listOf<WireLogEntry>(event.state.log), doorFogLine)
        case 'triggers':
          return diff(triggerLogsOf(event.state), (e) => (e.text ? quiet(e.at, e.text) : null))
        case 'initiative':
          return diff(listOf<WireTriggerEntry>(event.state.log), writtenLine)
        default:
          return []
      }
    },
  }
}

/** Discord caps a Components-v2 message at 4000 characters; one flush can hold a busy
 * window's worth of dice. Lines never split — a chunk break lands between them. */
export const CHUNK_MAX = 3_500

/** Every named door and room in a map document, keyed by id — the lookup behind {@link NameOf}.
 * Fetched with the DM token, so secret doors resolve too; the thread lives in the DM channel. */
export function mapNames(doc: unknown): Map<string, string> {
  const names = new Map<string, string>()
  const rec = (v: unknown): Record<string, unknown> =>
    typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
  const put = (id: unknown, name: unknown): void => {
    if (typeof id === 'string' && typeof name === 'string' && name.trim()) names.set(id, name.trim())
  }
  for (const raw of arr(rec(doc).layers)) {
    const layer = rec(raw)
    if (layer.type !== 'dungeon') continue
    // The DM's room-name override wins over the detected name, same as the editor and the
    // table client's own lookup.
    const overrides = rec(layer.roomNameOverrides)
    for (const raw2 of arr(layer.rooms)) {
      const room = rec(raw2)
      put(room.id, overrides[String(room.id)] ?? room.name)
    }
    for (const raw2 of arr(layer.children)) {
      const child = rec(raw2)
      if (child.childType === 'door') put(child.id, child.name)
    }
  }
  return names
}

export function chunkLines(lines: string[], max = CHUNK_MAX): string[] {
  const chunks: string[] = []
  let current = ''
  for (const line of lines) {
    if (current && current.length + 1 + line.length > max) {
      chunks.push(current)
      current = ''
    }
    current = current ? `${current}\n${line}` : line
  }
  if (current) chunks.push(current)
  return chunks
}
