// Pure models for the live session embed, the recap and "Previously on…" (plan §11 M5).
// No discord.js, no DB, no clock of its own — the runner in src/goblin/live-session.ts
// gathers the state and hands it here.

import type { SessionRecap } from '../db/stores'
import type { LiveView } from '../goblin/session-stats'
import type { ContainerSpec } from '../lib/ui'

/** The shared table link (plan §4): the server has no per-user join route, so the invite
 * code *is* the link, and it goes to the campaign's player channel. */
export function joinUrl(publicTableUrl: string, inviteCode: string): string {
  return `${publicTableUrl.replace(/\/+$/, '')}/join/${inviteCode}`
}

/** "2h 13m", "47m", "under a minute" — a recap line, not a stopwatch. */
export function durationLabel(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'under a minute'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${minutes}m`
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/** Discord renders this client-side and keeps counting on its own — an elapsed timer that
 * costs no edits, which is the whole reason the embed can be throttled to one every 5s. */
export function elapsedLabel(startedAt: number): string {
  return `<t:${Math.floor(startedAt / 1000)}:R>`
}

export interface LiveSessionInput {
  campaignName: string
  joinUrl: string
  startedAt: number
  calendarLine: string
  live: LiveView
}

export function liveSessionEmbed(input: LiveSessionInput): ContainerSpec {
  const roster =
    input.live.players.length === 0 ? '_Nobody at the table yet._' : input.live.players.map((p) => `· ${p}`).join('\n')
  return {
    header: `Live — ${input.campaignName}`,
    blocks: [
      `**Join the table**: ${input.joinUrl}`,
      `**Scene**: ${input.live.sceneName ?? 'None yet'}\n**World date**: ${input.calendarLine}`,
      `**At the table** (${input.live.players.length})\n${roster}`,
      `Started ${elapsedLabel(input.startedAt)}${input.live.dmConnected ? '' : ' · _the DM is away_'}`,
    ],
  }
}

/**
 * Text-only this milestone. Milestone 6 slots the player-visible map PNG in here as a media
 * gallery on this same container (plan §7: one message, snapshot inline) — pass the
 * attachment url through `media` and post the buffer alongside it.
 */
export function sessionRecapEmbed(campaignName: string, recap: SessionRecap): ContainerSpec {
  return {
    header: `Session recap — ${campaignName}`,
    blocks: [recapBody(recap), `**World date**: ${recap.calendarLine}`],
  }
}

/** Posted before the new session embed, so the table opens on a reminder of the last one. */
export function previouslyOnEmbed(campaignName: string, recap: SessionRecap): ContainerSpec {
  return { header: 'Previously on…', blocks: [`**${campaignName}**`, recapBody(recap)] }
}

function recapBody(recap: SessionRecap): string {
  const scenes = recap.scenes.length === 0 ? 'None' : recap.scenes.join(' → ')
  const players = recap.players.length === 0 ? 'Nobody' : recap.players.join(', ')
  return [
    `**Scenes**: ${scenes}`,
    `**Doors opened**: ${recap.doorsOpened}`,
    `**Duration**: ${durationLabel(recap.durationMs)}`,
    `**Players** (peak ${recap.peakPlayers}): ${players}`,
  ].join('\n')
}

export function sessionStartedReply(joinLink: string): string {
  return `Table's open. The live board is up in the player channel — join link: ${joinLink}`
}

export function sessionEndedReply(recap: SessionRecap): string {
  return `Table closed after ${durationLabel(recap.durationMs)}. Recap posted to the player channel.`
}
