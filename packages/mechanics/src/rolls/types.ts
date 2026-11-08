// §2.2 / D7 — "ingest, don't compute". A RollEvent is a *result* somebody else already
// rolled (D&D Beyond's dice, or a human typing "stealth 17"). Nothing here is ever
// recomputed or verified: `total` and `breakdown` are display data the server accepts as
// untrusted strings and numbers, length-capped and nothing more.
//
// Table v2 adds the one exception: `rolls.roll` and `rolls.roll-table` roll on the server,
// because a blind roll the roller's own client computed is not blind.

/**
 * Who a roll's result reaches (board 20). `public`: everyone. `dm` ("To DM"): the roller and
 * the DM. `gmonly`: the DM alone. `blind`: the DM sees it; the roller sees that they rolled,
 * never the result; nobody else sees anything.
 */
export type RollMode = 'public' | 'dm' | 'gmonly' | 'blind'

export interface RollEvent {
  /** Server-minted. Unique inside the log, which is all a render key needs. */
  id: string
  /** Server timestamp (`Date.now()`), never the client's clock. */
  at: number
  /** Server-stamped from the sender's identity and the session roster. */
  identityId: string
  playerName: string
  /** `discord` is the bot forwarding a `/roll` over its own seat — same untrusted display
   *  data, arriving from the other room. `server` is a roll the server rolled itself. */
  source: 'dndbeyond' | 'manual' | 'discord' | 'server'
  /** ≤ 60 chars, display only. */
  characterName?: string
  /** e.g. "Longsword: Attack", ≤ 100. */
  title?: string
  /** e.g. "1d20+7 (adv)", ≤ 100. */
  formula?: string
  /** e.g. "17 + 7", ≤ 200 — display only, never recomputed. */
  breakdown?: string
  /** Spell/item/trait card text from Beyond20 (source line, attributes, description),
   *  ≤ 2000 — display only, rendered as a plain block under the roll line. */
  description?: string
  /** Finite number. */
  total?: number
  /** Manual entries, ≤ 200. */
  text?: string
  /**
   * `private` ⇒ visible to the roller and the DM only (D4). Kept beside `mode` for readers
   * that predate it (the bot): `public` exactly when `mode` is.
   */
  visibility: 'public' | 'private'
  /** Table v2. Absent on rows written before it: read as `visibility` says. */
  mode?: RollMode
  /** Set on the roller's copy of a blind roll: the result was cut, not missing. */
  blind?: true
  /** The roll request this answers, when it answers one. */
  requestId?: string
}

/** One player's answer to a request. */
export interface RollRequestResult {
  identityId: string
  playerName: string
  total: number
  formula?: string
  breakdown?: string
  at: number
}

/** "Perception check, DC 14" — asked by the DM, answered by the seats it names (board 20). */
export interface RollRequest {
  id: string
  at: number
  /** "Perception check", ≤ 60. */
  label: string
  /** Ability or skill id, e.g. `perception`, ≤ 40. */
  ability?: string
  dc?: number
  /** identityIds; null = every player at the table. */
  targets: string[] | null
  results: RollRequestResult[]
  /** The DM posted the summary to the log. */
  shared: boolean
}

/** A rollable table: roll `die`, read the row whose range holds the total. */
export interface RollTable {
  id: string
  /** ≤ 60. */
  name: string
  /** A dice formula, e.g. `1d20`. */
  die: string
  /** Inclusive `[min, max]` ranges; ≤ 100 rows, text ≤ 200. */
  rows: { range: [number, number]; text: string }[]
}

/** A named formula the DM rolls often. */
export interface SavedRoll {
  id: string
  name: string
  formula: string
}

export interface RollsState {
  /** Newest last, capped at the most recent 200 (D5). */
  log: RollEvent[]
  /** Open requests, newest last, capped. Absent on rows written before table v2. */
  requests?: RollRequest[]
  /** Campaign-level, DM only. */
  tables?: RollTable[]
  /** Campaign-level, DM only. */
  saved?: SavedRoll[]
}

/** What a client is allowed to send with `rolls:post`; the rest is minted server-side. */
export type RollPost = Omit<RollEvent, 'id' | 'at' | 'identityId' | 'playerName' | 'visibility' | 'blind'> & {
  visibility?: RollEvent['visibility']
}
