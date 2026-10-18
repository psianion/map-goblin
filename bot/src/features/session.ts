// Pure models for the live session board, the recap and "Previously on…" (plan §11 M5).
// No discord.js, no DB, no clock of its own — the runner in src/goblin/live-session.ts
// gathers the state and hands it here.

import type { SessionRecap } from '../db/stores'
import type { LiveView } from '../goblin/session-stats'
import { TONE, type Block, type ContainerSpec } from '../lib/card'

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
 * costs no edits, which is the whole reason the board can be throttled to one every 5s. */
export function elapsedLabel(startedAt: number): string {
  return `<t:${Math.floor(startedAt / 1000)}:R>`
}

export interface LiveSessionInput {
  campaignName: string
  dmDiscordId: string
  joinUrl: string
  startedAt: number
  calendarLine: string
  live: LiveView
  /** Beside the header. Safe on a board that is edited every few seconds: an edit that passes
   * neither files nor attachments leaves the message's own attachment there to point at. */
  thumb?: string
}

export function liveSessionBoard(input: LiveSessionInput): ContainerSpec {
  const seated = input.live.players.length
  const roster =
    seated === 0
      ? '_The benches are empty. First one in picks the good chair._'
      : input.live.players.map((p) => `> ${p}`).join('\n')
  return {
    accent: TONE.live,
    eyebrow: `Live session · ${input.campaignName}`,
    header: 'The table is open',
    subhead: `**DM** <@${input.dmDiscordId}> · opened ${elapsedLabel(input.startedAt)}`,
    ...(input.thumb ? { thumb: input.thumb, thumbAlt: 'Campaign banner' } : {}),
    // The board talks *about* the DM, and re-pings them on every edit if left to itself.
    noPing: true,
    blocks: [
      {
        text: '### Take your seat\nYour map, your token and the dice are waiting.',
        link: { label: 'Join the table', url: input.joinUrl },
      },
      { rule: 'line' },
      `### Now playing\n**Scene** · ${input.live.sceneName ?? '_The DM is still setting the stage._'}\n**World date** · ${input.calendarLine}`,
      { rule: 'line' },
      `### At the table · ${seated}\n${roster}`,
    ],
    footer: `${input.live.dmConnected ? 'DM at the table' : 'The DM has stepped away'} · this board keeps itself current`,
  }
}

/** The closing card. The player-visible map PNG rides in `media` on this same container
 * (plan §7: one message, snapshot inline) — the runner adds it. `endedAt` is the finished
 * row's own stamp, so this file still keeps no clock. */
export function sessionRecapCard(
  campaignName: string,
  recap: SessionRecap,
  endedAt: number,
  thumb?: string,
): ContainerSpec {
  return {
    eyebrow: `Session recap · ${campaignName}`,
    header: 'The table is closed',
    subhead: `Played **${durationLabel(recap.durationMs)}** · closed ${elapsedLabel(endedAt)}`,
    ...(thumb ? { thumb, thumbAlt: 'Campaign banner' } : {}),
    blocks: recapBlocks(recap),
    footer: `World date · ${recap.calendarLine}`,
  }
}

/** Posted before the new session board, so the table opens on a reminder of the last one. */
export function previouslyOnCard(
  campaignName: string,
  recap: SessionRecap,
  endedAt: number | null,
  thumb?: string,
): ContainerSpec {
  return {
    accent: TONE.quiet,
    eyebrow: campaignName,
    header: 'Previously on…',
    ...(endedAt === null ? {} : { subhead: `Last session ${elapsedLabel(endedAt)}` }),
    ...(thumb ? { thumb, thumbAlt: 'Campaign banner' } : {}),
    blocks: recapBlocks(recap),
    footer: `The party left off on ${recap.calendarLine}`,
  }
}

/** What the live board becomes once the evening is over: the recap is its own message right
 * below, so the board only has to stop advertising a table that has closed. */
export function sessionClosedBoard(campaignName: string, recap: SessionRecap, thumb?: string): ContainerSpec {
  return {
    accent: TONE.quiet,
    eyebrow: `Session · ${campaignName}`,
    header: 'The table has closed',
    ...(thumb ? { thumb, thumbAlt: 'Campaign banner' } : {}),
    blocks: [`Played **${durationLabel(recap.durationMs)}**. The recap is posted below.`],
  }
}

function recapBlocks(recap: SessionRecap): Block[] {
  const road = recap.scenes.length === 0 ? '_The party never left the doorstep._' : recap.scenes.join(' → ')
  const players = recap.players.length === 0 ? '_Nobody sat down._' : recap.players.map((p) => `> ${p}`).join('\n')
  return [
    `### The road taken\n${road}`,
    { rule: 'line' },
    `### The evening\n**Time at the table** · ${durationLabel(recap.durationMs)}\n**Doors opened** · ${recap.doorsOpened}\n**Peak table** · ${recap.peakPlayers} player${recap.peakPlayers === 1 ? '' : 's'}`,
    { rule: 'line' },
    `### Who was there\n${players}`,
  ]
}

export function sessionStartedReply(joinLink: string, playerChannelId: string): ContainerSpec {
  return {
    eyebrow: 'Session',
    blocks: [
      {
        text: `**The table is open.**\nThe live board is up in <#${playerChannelId}>.`,
        link: { label: 'Join the table', url: joinLink },
      },
    ],
  }
}

export function sessionEndedReply(recap: SessionRecap, playerChannelId: string): ContainerSpec {
  return {
    eyebrow: 'Session',
    blocks: [
      `**Table closed** after ${durationLabel(recap.durationMs)}.\nThe recap is posted in <#${playerChannelId}>.`,
    ],
  }
}
