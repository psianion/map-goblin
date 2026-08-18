// Pure assembly for /campaign status (plan §11 M4) — bot-DB data only. No discord.js
// import — command-registry.ts gathers the store reads and hands them here.

import type { Campaign, CalendarState, Character, Quest, RollStats } from '../db/stores'
import type { ContainerSpec } from '../lib/ui'
import { calendarLine } from './calendar'

export interface CampaignStatusInput {
  campaign: Campaign
  characters: Character[]
  quests: Quest[]
  goldTotal: number
  calendarState: CalendarState | undefined
  rollStats: RollStats[]
  /** Sessions the bot has run on the game server (plan §11 M5). */
  sessionStats?: { played: number; lastStartedAt: number | null }
  /** Injected for deterministic "is the next session in the past" tests. */
  now?: number
}

function rosterBlock(characters: Character[]): string {
  if (characters.length === 0) return 'No characters yet.'
  return characters.map((c) => `**${c.name}** — ${c.className} ${c.level} — <@${c.discordId}>`).join('\n')
}

function questSummary(quests: Quest[]): string {
  const active = quests.filter((q) => q.status === 'active').length
  const done = quests.filter((q) => q.status === 'done').length
  return `${active} active / ${done} done`
}

/** True when there's nothing scheduled, or the scheduled date has already passed. */
export function needsScheduleNudge(nextSessionAt: number | null, now: number): boolean {
  return nextSessionAt === null || nextSessionAt < now
}

function nextSessionLine(nextSessionAt: number | null, now: number): string {
  if (needsScheduleNudge(nextSessionAt, now)) return 'No session scheduled — /schedule one.'
  return `**${new Date(nextSessionAt!).toISOString().replace('T', ' ').slice(0, 16)} UTC**`
}

function leaderboardBlock(characters: Character[], rollStats: RollStats[]): string {
  if (characters.length === 0) return 'No rolls yet.'
  const byCharacter = new Map(rollStats.map((s) => [s.characterId, s]))
  return characters
    .map((c) => {
      const stats = byCharacter.get(c.id)
      return `**${c.name}** — ${stats?.rolls ?? 0} rolls, ${stats?.nat20s ?? 0} nat 20s, ${stats?.nat1s ?? 0} nat 1s`
    })
    .join('\n')
}

/** "7 — last on 2026-08-17", or the honest nothing before a first table. */
function sessionsLine(stats: CampaignStatusInput['sessionStats']): string {
  if (!stats || stats.played === 0 || stats.lastStartedAt === null) return 'None yet.'
  return `**${stats.played}** — last on ${new Date(stats.lastStartedAt).toISOString().slice(0, 10)}`
}

export function campaignStatus(input: CampaignStatusInput): ContainerSpec {
  const now = input.now ?? Date.now()
  return {
    header: `Campaign status — ${input.campaign.name}`,
    blocks: [
      `**Roster**\n${rosterBlock(input.characters)}`,
      `**Quests**: ${questSummary(input.quests)}`,
      `**Party gold**: ${input.goldTotal}`,
      `**Calendar**: ${calendarLine(input.calendarState)}`,
      `**Next session**: ${nextSessionLine(input.campaign.nextSessionAt, now)}`,
      `**Dice leaderboard**\n${leaderboardBlock(input.characters, input.rollStats)}`,
      `**Sessions played**: ${sessionsLine(input.sessionStats)}`,
    ],
  }
}
