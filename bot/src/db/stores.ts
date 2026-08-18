// Domain reads over the bot DB. Milestone 1 owns no tables, so the only store here is the
// campaign lookup the RBAC/CBAC seam needs — stubbed, but with its real shape, because
// `authorize` is written against this interface and not against SQL.

import type { Database } from './db'

/** One registered campaign: the goblin campaign plus its Discord furniture. */
export interface Campaign {
  goblinCampaignId: string
  /** Campaign player channel — where members invoke commands. */
  channelId: string
  /** DM-only output goes here and nowhere else (plan §6). */
  dmChannelId: string
  dmDiscordId: string
  /** Discord role id that marks a campaign member. */
  roleId: string
}

export interface Campaigns {
  /** The campaign a channel belongs to — player or DM channel. Undefined outside a campaign. */
  byChannel: (channelId: string) => Campaign | undefined
}

/**
 * ponytail: milestone 1 has no `campaigns` table, so every channel resolves to "not a
 * campaign channel" and dm/member commands correctly refuse. Milestone 2 replaces the body
 * with a prepared SELECT over the table `/campaign setup` writes — the interface is final.
 */
export function createCampaigns(_db: Database): Campaigns {
  return { byChannel: () => undefined }
}
