// §2.2 / D7 — "ingest, don't compute". A RollEvent is a *result* somebody else already
// rolled (D&D Beyond's dice, or a human typing "stealth 17"). Nothing here is ever
// recomputed or verified: `total` and `breakdown` are display data the server accepts as
// untrusted strings and numbers, length-capped and nothing more.

export interface RollEvent {
  /** Server-minted. Unique inside the log, which is all a render key needs. */
  id: string
  /** Server timestamp (`Date.now()`), never the client's clock. */
  at: number
  /** Server-stamped from the sender's identity and the session roster. */
  identityId: string
  playerName: string
  /** `discord` is the bot forwarding a `/roll` over its own seat — same untrusted display
   *  data, arriving from the other room. */
  source: 'dndbeyond' | 'manual' | 'discord'
  /** ≤ 60 chars, display only. */
  characterName?: string
  /** e.g. "Longsword: Attack", ≤ 100. */
  title?: string
  /** e.g. "1d20+7 (adv)", ≤ 100. */
  formula?: string
  /** e.g. "17 + 7", ≤ 200 — display only, never recomputed. */
  breakdown?: string
  /** Finite number. */
  total?: number
  /** Manual entries, ≤ 200. */
  text?: string
  /** `private` ⇒ visible to the roller and the DM only (D4). */
  visibility: 'public' | 'private'
}

export interface RollsState {
  /** Newest last, capped at the most recent 200 (D5). */
  log: RollEvent[]
}

/** What a client is allowed to send with `rolls:post`; the rest is minted server-side. */
export type RollPost = Omit<RollEvent, 'id' | 'at' | 'identityId' | 'playerName'>
