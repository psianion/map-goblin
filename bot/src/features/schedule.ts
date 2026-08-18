// Pure model/vote logic for /schedule (plan §11 M4). No discord.js import —
// command-registry.ts wires this to the schedule_polls store and Discord.

import { userInput } from '../lib/errors'
import type { SchedulePoll } from '../db/stores'
import type { ContainerSpec } from '../lib/ui'

/** Throws BotError(user_input) on anything Date.parse can't read — never on a well-formed date. */
export function parseCandidateDate(raw: string): number {
  const ms = Date.parse(raw)
  if (Number.isNaN(ms)) throw userInput(`Couldn't read "${raw}" as a date. Try something like "2026-08-22 19:00".`)
  return ms
}

/** Clicking your current option removes your vote; clicking a different one switches it. */
export function toggleVote(votes: Record<string, number>, discordId: string, optionIndex: number): Record<string, number> {
  const next = { ...votes }
  if (next[discordId] === optionIndex) delete next[discordId]
  else next[discordId] = optionIndex
  return next
}

export interface Winner {
  index: number
  label: string
  votes: number
}

/** First-index tie-break — deterministic, no runoff (plan doesn't ask for one). */
export function winningOption(poll: SchedulePoll): Winner | undefined {
  const counts = poll.options.map((_, i) => Object.values(poll.votes).filter((v) => v === i).length)
  const max = Math.max(0, ...counts)
  if (max === 0) return undefined
  const index = counts.indexOf(max)
  return { index, label: poll.options[index], votes: max }
}

export function pollAnnouncement(campaignName: string, roleId: string, options: string[]): ContainerSpec {
  return {
    header: `Session poll — ${campaignName}`,
    blocks: [`<@&${roleId}> pick a time:`, options.map((o, i) => `${i + 1}. ${o}`).join('\n')],
  }
}

export function pollResultAnnouncement(winner: Winner | undefined): ContainerSpec {
  if (!winner) return { header: 'Poll closed', blocks: ['No votes were cast.'] }
  return { header: 'Session scheduled!', blocks: [`**${winner.label}** wins with ${winner.votes} vote(s).`] }
}

export function voteConfirmation(poll: SchedulePoll, discordId: string): string {
  const choice = poll.votes[discordId]
  return choice === undefined ? 'Vote removed.' : `Voted for **${poll.options[choice]}**.`
}

export function pollCreatedConfirmation(): string {
  return 'Poll posted to the player channel.'
}
