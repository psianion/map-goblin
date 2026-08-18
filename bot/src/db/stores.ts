// Domain reads/writes over the bot DB. `authorize` and feature code are written against
// these interfaces, not against SQL, so the shape stays stable while the body evolves.

import type { Database } from './db'
import { userInput } from '../lib/errors'

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
}

export type CampaignInput = Campaign

export interface Campaigns {
  /** The campaign a channel belongs to — player or DM channel. Undefined outside a campaign. */
  byChannel: (channelId: string) => Campaign | undefined
  /** Keyed on goblinCampaignId — re-running `/campaign setup` updates the same row. */
  upsert: (input: CampaignInput) => Campaign
}

interface CampaignRow {
  goblin_campaign_id: string
  name: string
  channel_id: string
  dm_channel_id: string
  dm_discord_id: string
  role_id: string
}

const CAMPAIGN_COLUMNS = 'goblin_campaign_id, name, channel_id, dm_channel_id, dm_discord_id, role_id'

function toCampaign(row: CampaignRow): Campaign {
  return {
    goblinCampaignId: row.goblin_campaign_id,
    name: row.name,
    channelId: row.channel_id,
    dmChannelId: row.dm_channel_id,
    dmDiscordId: row.dm_discord_id,
    roleId: row.role_id,
  }
}

export function createCampaigns(db: Database): Campaigns {
  const byChannelStmt = db.prepare<[string, string], CampaignRow>(
    `SELECT ${CAMPAIGN_COLUMNS} FROM campaigns WHERE channel_id = ? OR dm_channel_id = ?`,
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

  return {
    byChannel: (channelId) => {
      const row = byChannelStmt.get(channelId, channelId)
      return row ? toCampaign(row) : undefined
    },
    upsert: (input) => {
      upsertStmt.run({ ...input, createdAt: Date.now() })
      return { ...input }
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
