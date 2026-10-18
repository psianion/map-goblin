// Pure assembly for /campaign status (plan §11 M4): who runs the campaign, whether its table
// is open right now, when the party next meets, and who is in it. No discord.js import —
// command-registry.ts gathers the store reads and hands them here.

import type { Campaign, Character } from '../db/stores'
import { TONE, type Block, type ContainerSpec } from '../lib/card'
import type { TableHealth } from '../goblin/live-session'

export interface CampaignStatusInput {
  campaign: Campaign
  characters: Character[]
  /** Sessions the bot has run on the game server (plan §11 M5). */
  sessionStats?: { played: number; lastStartedAt: number | null }
  /** The live table's row from the session runner, when one is running. */
  table?: TableHealth
  /** Shown beside the header. */
  thumb?: string
  /** Injected for deterministic "is the next session in the past" tests. */
  now?: number
}

/** Discord draws these in each reader's own timezone and keeps the relative one counting. */
const stamp = (ms: number, style: 'F' | 'R' | 'D'): string => `<t:${Math.floor(ms / 1000)}:${style}>`

/** True when there's nothing scheduled, or the scheduled date has already passed. */
export function needsScheduleNudge(nextSessionAt: number | null, now: number): boolean {
  return nextSessionAt === null || nextSessionAt < now
}

function tableBlocks(table: TableHealth | undefined): Block[] {
  if (!table) return ['### Table · Closed\n_No session running._ The DM opens one with `/session start`.']
  const seats = `${table.players} player${table.players === 1 ? '' : 's'} seated`
  const lines = [
    '### Table · Open',
    `**${table.sceneName ?? 'Scene not set yet'}** · ${seats} · opened ${stamp(table.startedAt, 'R')}`,
    `-# ${table.connected ? 'Online' : 'Bot is reconnecting to the table'} · ${table.dmConnected ? 'DM at the table' : 'DM away'}`,
  ].join('\n')
  return [{ text: lines, link: { label: 'Join the table', url: table.joinUrl } }]
}

function sessionsBlock(input: CampaignStatusInput, now: number): string {
  const next = input.campaign.nextSessionAt
  const stats = input.sessionStats
  const played = !stats || stats.played === 0 || stats.lastStartedAt === null
  return [
    '### Sessions',
    needsScheduleNudge(next, now)
      ? '**Next**  _Nothing scheduled._ `/schedule` puts it to a vote.'
      : `**Next**  ${stamp(next!, 'F')} · ${stamp(next!, 'R')}`,
    played ? '**Played**  None yet' : `**Played**  ${stats.played} · last one ${stamp(stats.lastStartedAt!, 'R')}`,
  ].join('\n')
}

function partyBlock(characters: Character[]): string {
  if (characters.length === 0) return '### Party\n_No characters yet._ `/character create` adds the first.'
  const rows = characters.map((c) => `**${c.name}** · ${c.className} ${c.level} · <@${c.discordId}>`)
  return [`### Party · ${characters.length}`, ...rows].join('\n')
}

export function campaignStatus(input: CampaignStatusInput): ContainerSpec {
  const now = input.now ?? Date.now()
  const { campaign } = input
  const dm = `**DM** <@${campaign.dmDiscordId}>`
  return {
    accent: input.table ? TONE.live : TONE.ink,
    eyebrow: 'Campaign',
    header: campaign.name,
    subhead: campaign.ddbUrl ? `${dm} · [D&D Beyond campaign](${campaign.ddbUrl})` : dm,
    ...(input.thumb ? { thumb: input.thumb, thumbAlt: 'Campaign banner' } : {}),
    blocks: [...tableBlocks(input.table), { rule: 'line' }, sessionsBlock(input, now), { rule: 'line' }, partyBlock(input.characters)],
  }
}
