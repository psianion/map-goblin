// Domain reads/writes over the bot DB. `authorize` and feature code are written against
// these interfaces, not against SQL, so the shape stays stable while the body evolves.

import type { Database } from './db'
import { notFound, userInput } from '../lib/errors'

// ── campaigns ────────────────────────────────────────────────────────────────────────────

/** One registered campaign: the goblin campaign plus its Discord furniture. */
export interface Campaign {
  goblinCampaignId: string
  name: string
  /** Campaign player channel — where members invoke commands. */
  channelId: string
  /** DM-only output goes here and nowhere else (plan §6). */
  dmChannelId: string
  dmDiscordId: string
  /** Discord role id that marks a campaign member. */
  roleId: string
  /** Set by /schedule's poll close (plan §11 M4). Null until a poll has ever closed. */
  nextSessionAt: number | null
}

/** `/campaign setup` never touches the schedule — nextSessionAt is upsert-preserved, not input. */
export type CampaignInput = Omit<Campaign, 'nextSessionAt'>

export interface Campaigns {
  /** The campaign a channel belongs to — player or DM channel. Undefined outside a campaign. */
  byChannel: (channelId: string) => Campaign | undefined
  /** Keyed on goblinCampaignId — for lookups that aren't channel-resolved (/apply, LFG). */
  byId: (goblinCampaignId: string) => Campaign | undefined
  /** Keyed on goblinCampaignId — re-running `/campaign setup` updates the same row and
   * leaves nextSessionAt untouched. */
  upsert: (input: CampaignInput) => Campaign
  /** Writes the winning poll date (plan §11 M4's /schedule close). */
  setNextSession: (goblinCampaignId: string, at: number) => Campaign
}

interface CampaignRow {
  goblin_campaign_id: string
  name: string
  channel_id: string
  dm_channel_id: string
  dm_discord_id: string
  role_id: string
  next_session_at: number | null
}

const CAMPAIGN_COLUMNS =
  'goblin_campaign_id, name, channel_id, dm_channel_id, dm_discord_id, role_id, next_session_at'

function toCampaign(row: CampaignRow): Campaign {
  return {
    goblinCampaignId: row.goblin_campaign_id,
    name: row.name,
    channelId: row.channel_id,
    dmChannelId: row.dm_channel_id,
    dmDiscordId: row.dm_discord_id,
    roleId: row.role_id,
    nextSessionAt: row.next_session_at,
  }
}

export function createCampaigns(db: Database): Campaigns {
  const byChannelStmt = db.prepare<[string, string], CampaignRow>(
    `SELECT ${CAMPAIGN_COLUMNS} FROM campaigns WHERE channel_id = ? OR dm_channel_id = ?`,
  )
  const byIdStmt = db.prepare<[string], CampaignRow>(
    `SELECT ${CAMPAIGN_COLUMNS} FROM campaigns WHERE goblin_campaign_id = ?`,
  )
  const upsertStmt = db.prepare<{
    goblinCampaignId: string
    name: string
    channelId: string
    dmChannelId: string
    dmDiscordId: string
    roleId: string
    createdAt: number
  }>(`
    INSERT INTO campaigns (goblin_campaign_id, name, channel_id, dm_channel_id, dm_discord_id, role_id, created_at)
    VALUES (@goblinCampaignId, @name, @channelId, @dmChannelId, @dmDiscordId, @roleId, @createdAt)
    ON CONFLICT (goblin_campaign_id) DO UPDATE SET
      name = excluded.name,
      channel_id = excluded.channel_id,
      dm_channel_id = excluded.dm_channel_id,
      dm_discord_id = excluded.dm_discord_id,
      role_id = excluded.role_id
  `)
  const setNextSessionStmt = db.prepare<[number, string]>(
    'UPDATE campaigns SET next_session_at = ? WHERE goblin_campaign_id = ?',
  )

  return {
    byChannel: (channelId) => {
      const row = byChannelStmt.get(channelId, channelId)
      return row ? toCampaign(row) : undefined
    },
    byId: (goblinCampaignId) => {
      const row = byIdStmt.get(goblinCampaignId)
      return row ? toCampaign(row) : undefined
    },
    upsert: (input) => {
      upsertStmt.run({ ...input, createdAt: Date.now() })
      return toCampaign(byIdStmt.get(input.goblinCampaignId)!)
    },
    setNextSession: (goblinCampaignId, at) => {
      setNextSessionStmt.run(at, goblinCampaignId)
      return toCampaign(byIdStmt.get(goblinCampaignId)!)
    },
  }
}

// ── characters ───────────────────────────────────────────────────────────────────────────

export interface Character {
  id: number
  discordId: string
  campaignId: string
  name: string
  className: string
  level: number
  portraitUrl: string | null
  lastPlayed: number | null
}

export interface CharacterInput {
  discordId: string
  campaignId: string
  name: string
  className: string
  level: number
  portraitUrl?: string | null
}

/** Only the fields present are changed. */
export interface CharacterPatch {
  name?: string
  className?: string
  level?: number
  portraitUrl?: string | null
}

export interface Characters {
  /** Throws a BotError (user_input) if the name is already taken in this campaign. */
  create: (input: CharacterInput) => Character
  /** Throws a BotError (user_input) if a rename collides with an existing name. */
  update: (id: number, patch: CharacterPatch) => Character
  byId: (id: number) => Character | undefined
  byCampaignAndName: (campaignId: string, name: string) => Character | undefined
  /** A player's own characters in one campaign, name-sorted. */
  byOwner: (campaignId: string, discordId: string) => Character[]
  /** Every character in a campaign, name-sorted — autocomplete's pool for `/character show`. */
  byCampaign: (campaignId: string) => Character[]
}

interface CharacterRow {
  id: number
  discord_id: string
  campaign_id: string
  name: string
  class: string
  level: number
  portrait_url: string | null
  last_played: number | null
}

const CHARACTER_COLUMNS = 'id, discord_id, campaign_id, name, class, level, portrait_url, last_played'

function toCharacter(row: CharacterRow): Character {
  return {
    id: row.id,
    discordId: row.discord_id,
    campaignId: row.campaign_id,
    name: row.name,
    className: row.class,
    level: row.level,
    portraitUrl: row.portrait_url,
    lastPlayed: row.last_played,
  }
}

/** SQLite's own message for the UNIQUE(campaign_id, name) hit, translated here once so every
 * caller of create/update gets the same friendly message instead of a raw SQL error. */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/.test(err.message)
}

export function createCharacters(db: Database): Characters {
  const insertStmt = db.prepare<{
    discordId: string
    campaignId: string
    name: string
    className: string
    level: number
    portraitUrl: string | null
    createdAt: number
  }>(`
    INSERT INTO characters (discord_id, campaign_id, name, class, level, portrait_url, created_at)
    VALUES (@discordId, @campaignId, @name, @className, @level, @portraitUrl, @createdAt)
  `)
  const byIdStmt = db.prepare<[number], CharacterRow>(`SELECT ${CHARACTER_COLUMNS} FROM characters WHERE id = ?`)
  const byCampaignAndNameStmt = db.prepare<[string, string], CharacterRow>(
    `SELECT ${CHARACTER_COLUMNS} FROM characters WHERE campaign_id = ? AND name = ?`,
  )
  const byOwnerStmt = db.prepare<[string, string], CharacterRow>(
    `SELECT ${CHARACTER_COLUMNS} FROM characters WHERE campaign_id = ? AND discord_id = ? ORDER BY name`,
  )
  const byCampaignStmt = db.prepare<[string], CharacterRow>(
    `SELECT ${CHARACTER_COLUMNS} FROM characters WHERE campaign_id = ? ORDER BY name`,
  )

  function applyPatch(id: number, patch: CharacterPatch): void {
    const sets: string[] = []
    const params: Record<string, unknown> = { id }
    if (patch.name !== undefined) {
      sets.push('name = @name')
      params.name = patch.name
    }
    if (patch.className !== undefined) {
      sets.push('class = @className')
      params.className = patch.className
    }
    if (patch.level !== undefined) {
      sets.push('level = @level')
      params.level = patch.level
    }
    if (patch.portraitUrl !== undefined) {
      sets.push('portrait_url = @portraitUrl')
      params.portraitUrl = patch.portraitUrl
    }
    if (sets.length === 0) return
    db.prepare(`UPDATE characters SET ${sets.join(', ')} WHERE id = @id`).run(params)
  }

  return {
    create: (input) => {
      try {
        const info = insertStmt.run({ ...input, portraitUrl: input.portraitUrl ?? null, createdAt: Date.now() })
        return toCharacter(byIdStmt.get(Number(info.lastInsertRowid))!)
      } catch (err) {
        if (isUniqueViolation(err)) throw userInput(`"${input.name}" is already a character in this campaign.`)
        throw err
      }
    },
    update: (id, patch) => {
      try {
        applyPatch(id, patch)
      } catch (err) {
        if (isUniqueViolation(err)) throw userInput(`"${patch.name}" is already a character in this campaign.`)
        throw err
      }
      return toCharacter(byIdStmt.get(id)!)
    },
    byId: (id) => {
      const row = byIdStmt.get(id)
      return row ? toCharacter(row) : undefined
    },
    byCampaignAndName: (campaignId, name) => {
      const row = byCampaignAndNameStmt.get(campaignId, name)
      return row ? toCharacter(row) : undefined
    },
    byOwner: (campaignId, discordId) => byOwnerStmt.all(campaignId, discordId).map(toCharacter),
    byCampaign: (campaignId) => byCampaignStmt.all(campaignId).map(toCharacter),
  }
}

// ── quests ───────────────────────────────────────────────────────────────────────────────

export type QuestStatus = 'active' | 'done'

export interface Quest {
  id: number
  campaignId: string
  title: string
  status: QuestStatus
  addedBy: string
  createdAt: number
}

export interface Quests {
  /** Throws a BotError (user_input) if the title is already logged (case-insensitive). */
  add: (campaignId: string, title: string, addedBy: string) => Quest
  /** Throws a BotError (not_found) if no active quest matches that title. */
  complete: (campaignId: string, title: string) => Quest
  /** Active quests only — the autocomplete pool for `/quests complete`. */
  active: (campaignId: string) => Quest[]
  /** Every quest, active first — the `/quests log` view. */
  byCampaign: (campaignId: string) => Quest[]
}

interface QuestRow {
  id: number
  campaign_id: string
  title: string
  status: QuestStatus
  added_by: string
  created_at: number
}

const QUEST_COLUMNS = 'id, campaign_id, title, status, added_by, created_at'

function toQuest(row: QuestRow): Quest {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    title: row.title,
    status: row.status,
    addedBy: row.added_by,
    createdAt: row.created_at,
  }
}

export function createQuests(db: Database): Quests {
  const insertStmt = db.prepare<{ campaignId: string; title: string; addedBy: string; createdAt: number }>(`
    INSERT INTO quests (campaign_id, title, status, added_by, created_at)
    VALUES (@campaignId, @title, 'active', @addedBy, @createdAt)
  `)
  const byIdStmt = db.prepare<[number], QuestRow>(`SELECT ${QUEST_COLUMNS} FROM quests WHERE id = ?`)
  const byTitleStmt = db.prepare<[string, string], QuestRow>(
    `SELECT ${QUEST_COLUMNS} FROM quests WHERE campaign_id = ? AND title = ?`,
  )
  const completeStmt = db.prepare<[string, string]>(
    `UPDATE quests SET status = 'done' WHERE campaign_id = ? AND title = ? AND status = 'active'`,
  )
  const activeStmt = db.prepare<[string], QuestRow>(
    `SELECT ${QUEST_COLUMNS} FROM quests WHERE campaign_id = ? AND status = 'active' ORDER BY created_at`,
  )
  const byCampaignStmt = db.prepare<[string], QuestRow>(
    `SELECT ${QUEST_COLUMNS} FROM quests WHERE campaign_id = ? ORDER BY status, created_at`,
  )

  return {
    add: (campaignId, title, addedBy) => {
      try {
        const info = insertStmt.run({ campaignId, title, addedBy, createdAt: Date.now() })
        return toQuest(byIdStmt.get(Number(info.lastInsertRowid))!)
      } catch (err) {
        if (isUniqueViolation(err)) throw userInput(`"${title}" is already on the quest log.`)
        throw err
      }
    },
    complete: (campaignId, title) => {
      const existing = byTitleStmt.get(campaignId, title)
      if (!existing || existing.status !== 'active') throw notFound(`No active quest named "${title}".`)
      completeStmt.run(campaignId, title)
      return toQuest(byIdStmt.get(existing.id)!)
    },
    active: (campaignId) => activeStmt.all(campaignId).map(toQuest),
    byCampaign: (campaignId) => byCampaignStmt.all(campaignId).map(toQuest),
  }
}

// ── notes (party journal) ───────────────────────────────────────────────────────────────

export interface Note {
  id: number
  campaignId: string
  discordId: string
  text: string
  createdAt: number
}

export interface Notes {
  add: (campaignId: string, discordId: string, text: string) => Note
  /** `query` is already FTS5-safe (see journal.ts's sanitizeFtsQuery) — this never crashes
   * on user input, but still translates any residual SQLite error into a BotError. */
  search: (campaignId: string, query: string, limit?: number) => Note[]
}

interface NoteRow {
  id: number
  campaign_id: string
  discord_id: string
  text: string
  created_at: number
}

function toNote(row: NoteRow): Note {
  return { id: row.id, campaignId: row.campaign_id, discordId: row.discord_id, text: row.text, createdAt: row.created_at }
}

export function createNotes(db: Database): Notes {
  const insertStmt = db.prepare<{ campaignId: string; discordId: string; text: string; createdAt: number }>(`
    INSERT INTO notes (campaign_id, discord_id, text, created_at)
    VALUES (@campaignId, @discordId, @text, @createdAt)
  `)
  const indexStmt = db.prepare<{ noteId: number; text: string; campaignId: string }>(`
    INSERT INTO notes_fts (rowid, text, campaign_id, note_id) VALUES (@noteId, @text, @campaignId, @noteId)
  `)
  const byIdStmt = db.prepare<[number], NoteRow>(
    'SELECT id, campaign_id, discord_id, text, created_at FROM notes WHERE id = ?',
  )
  const searchStmt = db.prepare<[string, string, number], { note_id: number }>(`
    SELECT note_id FROM notes_fts WHERE notes_fts MATCH ? AND campaign_id = ? ORDER BY rank LIMIT ?
  `)

  return {
    add: (campaignId, discordId, text) => {
      const insert = db.transaction((input: { campaignId: string; discordId: string; text: string }) => {
        const createdAt = Date.now()
        const info = insertStmt.run({ ...input, createdAt })
        const noteId = Number(info.lastInsertRowid)
        indexStmt.run({ noteId, text: input.text, campaignId: input.campaignId })
        return noteId
      })
      return toNote(byIdStmt.get(insert({ campaignId, discordId, text }))!)
    },
    search: (campaignId, query, limit = 5) => {
      try {
        return searchStmt.all(query, campaignId, limit).map((row) => toNote(byIdStmt.get(row.note_id)!))
      } catch (err) {
        throw userInput(`Couldn't search for that: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
  }
}

// ── rolls ────────────────────────────────────────────────────────────────────────────────

export interface RollRecord {
  id: number
  campaignId: string
  characterId: number | null
  discordId: string
  expr: string
  total: number
  faces: string
  isCrit: boolean
  isFail: boolean
  createdAt: number
}

export interface RollInput {
  campaignId: string
  characterId: number | null
  discordId: string
  expr: string
  total: number
  faces: string
  isCrit: boolean
  isFail: boolean
}

/** Per-character dice leaderboard row (plan §11 M4's /campaign status). */
export interface RollStats {
  characterId: number
  rolls: number
  nat20s: number
  nat1s: number
}

export interface Rolls {
  /** Every /roll is persisted (plan §11 M3) — this never rejects a well-formed input. */
  record: (input: RollInput) => RollRecord
  byId: (id: number) => RollRecord | undefined
  /** One row per character that has rolled — rolls with no character attached are excluded
   * (there's no one to attribute them to on the leaderboard). */
  statsByCampaign: (campaignId: string) => RollStats[]
}

interface RollRow {
  id: number
  campaign_id: string
  character_id: number | null
  discord_id: string
  expr: string
  total: number
  faces: string
  is_crit: number
  is_fail: number
  created_at: number
}

const ROLL_COLUMNS = 'id, campaign_id, character_id, discord_id, expr, total, faces, is_crit, is_fail, created_at'

function toRoll(row: RollRow): RollRecord {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    characterId: row.character_id,
    discordId: row.discord_id,
    expr: row.expr,
    total: row.total,
    faces: row.faces,
    isCrit: row.is_crit === 1,
    isFail: row.is_fail === 1,
    createdAt: row.created_at,
  }
}

export function createRolls(db: Database): Rolls {
  const insertStmt = db.prepare<{
    campaignId: string
    characterId: number | null
    discordId: string
    expr: string
    total: number
    faces: string
    isCrit: number
    isFail: number
    createdAt: number
  }>(`
    INSERT INTO rolls (campaign_id, character_id, discord_id, expr, total, faces, is_crit, is_fail, created_at)
    VALUES (@campaignId, @characterId, @discordId, @expr, @total, @faces, @isCrit, @isFail, @createdAt)
  `)
  const byIdStmt = db.prepare<[number], RollRow>(`SELECT ${ROLL_COLUMNS} FROM rolls WHERE id = ?`)
  const statsStmt = db.prepare<[string], { character_id: number; rolls: number; nat20s: number; nat1s: number }>(`
    SELECT character_id, COUNT(*) AS rolls, SUM(is_crit) AS nat20s, SUM(is_fail) AS nat1s
    FROM rolls
    WHERE campaign_id = ? AND character_id IS NOT NULL
    GROUP BY character_id
  `)

  return {
    record: (input) => {
      const info = insertStmt.run({
        ...input,
        isCrit: input.isCrit ? 1 : 0,
        isFail: input.isFail ? 1 : 0,
        createdAt: Date.now(),
      })
      return toRoll(byIdStmt.get(Number(info.lastInsertRowid))!)
    },
    byId: (id) => {
      const row = byIdStmt.get(id)
      return row ? toRoll(row) : undefined
    },
    statsByCampaign: (campaignId) =>
      statsStmt.all(campaignId).map((r) => ({ characterId: r.character_id, rolls: r.rolls, nat20s: r.nat20s, nat1s: r.nat1s })),
  }
}

// ── ledger (loot + gold) ────────────────────────────────────────────────────────────────

export type LedgerKind = 'gold' | 'item'

export interface LedgerEntry {
  id: number
  campaignId: string
  kind: LedgerKind
  delta: number | null
  item: string | null
  actor: string
  note: string | null
  createdAt: number
}

export interface LedgerInput {
  campaignId: string
  kind: LedgerKind
  delta?: number | null
  item?: string | null
  actor: string
  note?: string | null
}

export interface Ledger {
  add: (input: LedgerInput) => LedgerEntry
  /** Most recent entries first. */
  recent: (campaignId: string, limit?: number) => LedgerEntry[]
  /** Sum of every gold delta ever recorded for the campaign. */
  goldTotal: (campaignId: string) => number
}

interface LedgerRow {
  id: number
  campaign_id: string
  kind: LedgerKind
  delta: number | null
  item: string | null
  actor: string
  note: string | null
  created_at: number
}

const LEDGER_COLUMNS = 'id, campaign_id, kind, delta, item, actor, note, created_at'

function toLedgerEntry(row: LedgerRow): LedgerEntry {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    kind: row.kind,
    delta: row.delta,
    item: row.item,
    actor: row.actor,
    note: row.note,
    createdAt: row.created_at,
  }
}

export function createLedger(db: Database): Ledger {
  const insertStmt = db.prepare<{
    campaignId: string
    kind: LedgerKind
    delta: number | null
    item: string | null
    actor: string
    note: string | null
    createdAt: number
  }>(`
    INSERT INTO ledger (campaign_id, kind, delta, item, actor, note, created_at)
    VALUES (@campaignId, @kind, @delta, @item, @actor, @note, @createdAt)
  `)
  const byIdStmt = db.prepare<[number], LedgerRow>(`SELECT ${LEDGER_COLUMNS} FROM ledger WHERE id = ?`)
  const recentStmt = db.prepare<[string, number], LedgerRow>(
    `SELECT ${LEDGER_COLUMNS} FROM ledger WHERE campaign_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
  )
  const goldTotalStmt = db.prepare<[string], { total: number | null }>(
    `SELECT SUM(delta) AS total FROM ledger WHERE campaign_id = ? AND kind = 'gold'`,
  )

  return {
    add: (input) => {
      const info = insertStmt.run({
        campaignId: input.campaignId,
        kind: input.kind,
        delta: input.delta ?? null,
        item: input.item ?? null,
        actor: input.actor,
        note: input.note ?? null,
        createdAt: Date.now(),
      })
      return toLedgerEntry(byIdStmt.get(Number(info.lastInsertRowid))!)
    },
    recent: (campaignId, limit = 10) => recentStmt.all(campaignId, limit).map(toLedgerEntry),
    goldTotal: (campaignId) => goldTotalStmt.get(campaignId)?.total ?? 0,
  }
}

// ── calendar ─────────────────────────────────────────────────────────────────────────────

export interface CalendarState {
  campaignId: string
  day: number
  epochLabel: string | null
}

export interface Calendar {
  get: (campaignId: string) => CalendarState | undefined
  /** Sets an absolute day. Omitting `epochLabel` leaves the existing label untouched. */
  set: (campaignId: string, day: number, epochLabel?: string | null) => CalendarState
  /** Adds `days` to the current counter — 0 (no row yet) if the DM has never set one. */
  advance: (campaignId: string, days: number) => CalendarState
}

interface CalendarRow {
  campaign_id: string
  day: number
  epoch_label: string | null
}

function toCalendarState(row: CalendarRow): CalendarState {
  return { campaignId: row.campaign_id, day: row.day, epochLabel: row.epoch_label }
}

export function createCalendar(db: Database): Calendar {
  const getStmt = db.prepare<[string], CalendarRow>(
    'SELECT campaign_id, day, epoch_label FROM calendar WHERE campaign_id = ?',
  )
  const upsertStmt = db.prepare<{ campaignId: string; day: number; epochLabel: string | null; updatedAt: number }>(`
    INSERT INTO calendar (campaign_id, day, epoch_label, updated_at)
    VALUES (@campaignId, @day, @epochLabel, @updatedAt)
    ON CONFLICT (campaign_id) DO UPDATE SET day = excluded.day, epoch_label = excluded.epoch_label, updated_at = excluded.updated_at
  `)

  function write(campaignId: string, day: number, epochLabel: string | null): CalendarState {
    upsertStmt.run({ campaignId, day, epochLabel, updatedAt: Date.now() })
    return { campaignId, day, epochLabel }
  }

  return {
    get: (campaignId) => {
      const row = getStmt.get(campaignId)
      return row ? toCalendarState(row) : undefined
    },
    set: (campaignId, day, epochLabel) => {
      const current = getStmt.get(campaignId)
      const finalEpoch = epochLabel !== undefined ? epochLabel : (current?.epoch_label ?? null)
      return write(campaignId, day, finalEpoch)
    },
    advance: (campaignId, days) => {
      const current = getStmt.get(campaignId)
      return write(campaignId, (current?.day ?? 0) + days, current?.epoch_label ?? null)
    },
  }
}

// ── schedule polls ──────────────────────────────────────────────────────────────────────

export type PollStatus = 'open' | 'closed'

export interface SchedulePoll {
  id: number
  campaignId: string
  /** Null until setMessageRef runs — the row exists before the poll message is sent, so its
   * id can be baked into the vote/close buttons. */
  channelId: string | null
  messageId: string | null
  options: string[]
  /** discord_id -> option index. One vote per user; features/schedule.ts owns the toggle logic. */
  votes: Record<string, number>
  status: PollStatus
  createdAt: number
}

export interface SchedulePolls {
  create: (campaignId: string, options: string[]) => SchedulePoll
  byId: (id: number) => SchedulePoll | undefined
  setMessageRef: (id: number, channelId: string, messageId: string) => SchedulePoll
  /** Replaces the whole votes map — the caller (features/schedule.ts's toggleVote) computes it. */
  setVotes: (id: number, votes: Record<string, number>) => SchedulePoll
  close: (id: number) => SchedulePoll
}

interface SchedulePollRow {
  id: number
  campaign_id: string
  channel_id: string | null
  message_id: string | null
  options: string
  votes: string
  status: PollStatus
  created_at: number
}

const SCHEDULE_POLL_COLUMNS = 'id, campaign_id, channel_id, message_id, options, votes, status, created_at'

function toSchedulePoll(row: SchedulePollRow): SchedulePoll {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    options: JSON.parse(row.options) as string[],
    votes: JSON.parse(row.votes) as Record<string, number>,
    status: row.status,
    createdAt: row.created_at,
  }
}

export function createSchedulePolls(db: Database): SchedulePolls {
  const insertStmt = db.prepare<{ campaignId: string; options: string; createdAt: number }>(`
    INSERT INTO schedule_polls (campaign_id, options, created_at) VALUES (@campaignId, @options, @createdAt)
  `)
  const byIdStmt = db.prepare<[number], SchedulePollRow>(
    `SELECT ${SCHEDULE_POLL_COLUMNS} FROM schedule_polls WHERE id = ?`,
  )
  const setMessageRefStmt = db.prepare<[string, string, number]>(
    'UPDATE schedule_polls SET channel_id = ?, message_id = ? WHERE id = ?',
  )
  const setVotesStmt = db.prepare<[string, number]>('UPDATE schedule_polls SET votes = ? WHERE id = ?')
  const closeStmt = db.prepare<[number]>(`UPDATE schedule_polls SET status = 'closed' WHERE id = ?`)

  return {
    create: (campaignId, options) => {
      const info = insertStmt.run({ campaignId, options: JSON.stringify(options), createdAt: Date.now() })
      return toSchedulePoll(byIdStmt.get(Number(info.lastInsertRowid))!)
    },
    byId: (id) => {
      const row = byIdStmt.get(id)
      return row ? toSchedulePoll(row) : undefined
    },
    setMessageRef: (id, channelId, messageId) => {
      setMessageRefStmt.run(channelId, messageId, id)
      return toSchedulePoll(byIdStmt.get(id)!)
    },
    setVotes: (id, votes) => {
      setVotesStmt.run(JSON.stringify(votes), id)
      return toSchedulePoll(byIdStmt.get(id)!)
    },
    close: (id) => {
      closeStmt.run(id)
      return toSchedulePoll(byIdStmt.get(id)!)
    },
  }
}

// ── LFG board ────────────────────────────────────────────────────────────────────────────

export interface LfgPost {
  id: number
  campaignId: string
  blurb: string
  channelId: string
  messageId: string
  status: PollStatus
  createdAt: number
}

export interface LfgPosts {
  create: (campaignId: string, blurb: string, channelId: string, messageId: string) => LfgPost
  /** Every currently-open post — the pool /apply's autocomplete filters. */
  open: () => LfgPost[]
  openForCampaign: (campaignId: string) => LfgPost | undefined
  close: (campaignId: string) => void
}

interface LfgPostRow {
  id: number
  campaign_id: string
  blurb: string
  channel_id: string
  message_id: string
  status: PollStatus
  created_at: number
}

const LFG_POST_COLUMNS = 'id, campaign_id, blurb, channel_id, message_id, status, created_at'

function toLfgPost(row: LfgPostRow): LfgPost {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    blurb: row.blurb,
    channelId: row.channel_id,
    messageId: row.message_id,
    status: row.status,
    createdAt: row.created_at,
  }
}

export function createLfgPosts(db: Database): LfgPosts {
  const insertStmt = db.prepare<{ campaignId: string; blurb: string; channelId: string; messageId: string; createdAt: number }>(`
    INSERT INTO lfg_posts (campaign_id, blurb, channel_id, message_id, created_at)
    VALUES (@campaignId, @blurb, @channelId, @messageId, @createdAt)
  `)
  const byIdStmt = db.prepare<[number], LfgPostRow>(`SELECT ${LFG_POST_COLUMNS} FROM lfg_posts WHERE id = ?`)
  const openStmt = db.prepare<[], LfgPostRow>(`SELECT ${LFG_POST_COLUMNS} FROM lfg_posts WHERE status = 'open'`)
  const openForCampaignStmt = db.prepare<[string], LfgPostRow>(
    `SELECT ${LFG_POST_COLUMNS} FROM lfg_posts WHERE campaign_id = ? AND status = 'open'`,
  )
  const closeStmt = db.prepare<[string]>(`UPDATE lfg_posts SET status = 'closed' WHERE campaign_id = ? AND status = 'open'`)

  return {
    create: (campaignId, blurb, channelId, messageId) => {
      const info = insertStmt.run({ campaignId, blurb, channelId, messageId, createdAt: Date.now() })
      return toLfgPost(byIdStmt.get(Number(info.lastInsertRowid))!)
    },
    open: () => openStmt.all().map(toLfgPost),
    openForCampaign: (campaignId) => {
      const row = openForCampaignStmt.get(campaignId)
      return row ? toLfgPost(row) : undefined
    },
    close: (campaignId) => {
      closeStmt.run(campaignId)
    },
  }
}

// ── LFG applications ────────────────────────────────────────────────────────────────────

export interface LfgApplication {
  id: number
  campaignId: string
  discordId: string
  message: string | null
  createdAt: number
}

export interface LfgApplications {
  add: (campaignId: string, discordId: string, message: string | null) => LfgApplication
}

interface LfgApplicationRow {
  id: number
  campaign_id: string
  discord_id: string
  message: string | null
  created_at: number
}

export function createLfgApplications(db: Database): LfgApplications {
  const insertStmt = db.prepare<{ campaignId: string; discordId: string; message: string | null; createdAt: number }>(`
    INSERT INTO lfg_applications (campaign_id, discord_id, message, created_at)
    VALUES (@campaignId, @discordId, @message, @createdAt)
  `)
  const byIdStmt = db.prepare<[number], LfgApplicationRow>(
    'SELECT id, campaign_id, discord_id, message, created_at FROM lfg_applications WHERE id = ?',
  )

  return {
    add: (campaignId, discordId, message) => {
      const info = insertStmt.run({ campaignId, discordId, message, createdAt: Date.now() })
      const row = byIdStmt.get(Number(info.lastInsertRowid))!
      return { id: row.id, campaignId: row.campaign_id, discordId: row.discord_id, message: row.message, createdAt: row.created_at }
    },
  }
}

// ── feedback ─────────────────────────────────────────────────────────────────────────────
// No discord_id anywhere in this store or its row — anonymous is a schema property, not a
// display filter (plan §7).

export interface FeedbackEntry {
  id: number
  campaignId: string
  text: string
  createdAt: number
}

export interface Feedback {
  add: (campaignId: string, text: string) => FeedbackEntry
}

export function createFeedback(db: Database): Feedback {
  const insertStmt = db.prepare<{ campaignId: string; text: string; createdAt: number }>(`
    INSERT INTO feedback (campaign_id, text, created_at) VALUES (@campaignId, @text, @createdAt)
  `)
  const byIdStmt = db.prepare<[number], { id: number; campaign_id: string; text: string; created_at: number }>(
    'SELECT id, campaign_id, text, created_at FROM feedback WHERE id = ?',
  )

  return {
    add: (campaignId, text) => {
      const info = insertStmt.run({ campaignId, text, createdAt: Date.now() })
      const row = byIdStmt.get(Number(info.lastInsertRowid))!
      return { id: row.id, campaignId: row.campaign_id, text: row.text, createdAt: row.created_at }
    },
  }
}
