// One encounter at a time, per campaign. Not `byScene` like triggers: a table runs one
// fight, so the scene it started on is a field, not a dictionary key. The table hides the
// panel when the DM walks to another scene by comparing `sceneId` to the active one, and
// picks it back up on the way back — which is the whole behaviour a per-scene map would
// have bought, without a map.

export type InitiativeStatus = 'idle' | 'gathering' | 'running'

/** Who is in the fight. `pc` entries belong to a seat; `npc` entries belong to the DM. */
export interface InitiativeEntry {
  /** Stable for the life of the encounter; how every command names an entry. */
  key: string
  name: string
  kind: 'pc' | 'npc'
  /** The table token to draw the turn ring on. Absent for an off-board combatant. */
  tokenId?: string
  /** The seat whose player may set this entry themselves. DM sets any. */
  identityId?: string
  /** null until someone rolls. Nulls sink to the bottom when the order locks. */
  initiative: number | null
  /** Absent until the DM sets a pool. `current` is clamped to `0..max`; 0 is down, not gone. */
  hp?: { current: number; max: number }
  /** Absent means none. Members of {@link CONDITIONS}, each at most once. */
  conditions?: Condition[]
}

/** The SRD list. A fixed set is one `oneOf` and a `<select>`; free text is a parser and a typo. */
export const CONDITIONS = [
  'blinded',
  'charmed',
  'deafened',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
  'exhaustion',
] as const
export type Condition = (typeof CONDITIONS)[number]

/** "Prone", for a log line or a chip. */
export const conditionLabel = (c: string): string => c.charAt(0).toUpperCase() + c.slice(1)

/** A pool wide enough for any monster in print, and a damage number that cannot overflow it. */
export const HP_MAX = 9999

/**
 * A finished sentence, composed on the server. Both readers print it verbatim — the table's
 * GameLog and the bot's Discord thread mirror — which is the only way the two stay worded
 * identically. The alternative, each client composing from a diff of the state, loses every
 * line across a reload and would have to be written twice.
 */
export interface InitiativeLogEntry {
  id: string
  at: number
  text: string
}

export interface InitiativeState {
  status: InitiativeStatus
  /** The scene the encounter started on. null while idle. */
  sceneId: string | null
  /** 0 while gathering; 1 on the first locked round. */
  round: number
  /** Index into `entries`, which *is* the turn order once running. */
  turn: number
  entries: InitiativeEntry[]
  /** Newest last, capped. Survives `end` so the closing line still reaches the thread. */
  log: InitiativeLogEntry[]
}

export const INITIAL_STATE: InitiativeState = {
  status: 'idle',
  sceneId: null,
  round: 0,
  turn: 0,
  entries: [],
  log: [],
}

/** D5, as for rolls and the table log: a recent window, not the campaign's history. */
export const MAX_LOG = 100

/** A fight, not a war. Caps the row the way every other module caps its own. */
export const MAX_ENTRIES = 50

/** Wide enough for a natural 20 plus any modifier a table will really roll. */
export const INITIATIVE_MIN = -99
export const INITIATIVE_MAX = 999

/**
 * The one place that decides a roll was an initiative roll. Exported because three senders
 * ask the question — the table's Beyond20 bridge, the table's manual roll box, and the bot's
 * `/roll` — and three copies of the rule would drift.
 *
 * Beyond20 titles the roll `Initiative` already, so the common path costs nothing.
 *
 * ponytail: substring match, not a parser. A roll a player *titles* "initiative" counts,
 * which is the point — the alternative is a per-integration allow-list. Upgrade path if a
 * table trips on it: match only the title, never the free text.
 */
export function isInitiativeRoll(fields: { title?: string; text?: string }): boolean {
  return /initiative/i.test(`${fields.title ?? ''} ${fields.text ?? ''}`)
}

/**
 * The turn order: highest first, unrolled last, insertion order breaking ties.
 *
 * Stable sort is load-bearing — `Array.prototype.sort` has been stable since ES2019, and a
 * tie keeping the order the DM added the combatants in is the tie-break rule v1 ships (the
 * DM nudges a number to reorder rather than being asked to adjudicate in a dialog).
 */
export function ordered(entries: readonly InitiativeEntry[]): InitiativeEntry[] {
  return [...entries].sort((a, b) => {
    if (a.initiative === b.initiative) return 0
    if (a.initiative === null) return 1
    if (b.initiative === null) return -1
    return b.initiative - a.initiative
  })
}
