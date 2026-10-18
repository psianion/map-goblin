// Pure assembly for /ping — the owner's health board. command-registry.ts gathers the
// numbers and hands them here; nothing in this file talks to Discord or the server.

import { TONE, type ContainerSpec } from '../lib/card'
import { SEAT_REFRESH_MARGIN_MS } from '../goblin/seat'
import type { TableHealth } from '../goblin/live-session'
import { durationLabel } from './session'

export const HEALTH_ACCENT_OK = TONE.live
export const HEALTH_ACCENT_BAD = TONE.alert

export interface HealthInput {
  botTag: string
  commit: string
  bootAt: number
  gatewayMs: number
  commandCount: number
  guildName: string | null
  /** Round-trip to the game server, null when it did not answer. */
  serverMs: number | null
  serverUrl: string
  /** Seat expiry per campaign; 0 = unreadable, counts as expired. */
  seats: { campaignName: string; expiresAt: number }[]
  tables: TableHealth[]
  dbOk: boolean
  rssBytes: number
  nodeVersion: string
  now?: number
}

const DAY = 24 * 60 * 60 * 1000

function seatLine(seats: HealthInput['seats'], now: number): { text: string; ok: boolean } {
  if (seats.length === 0) return { text: 'no campaigns registered', ok: true }
  const soonest = Math.min(...seats.map((s) => s.expiresAt))
  const left = soonest - now
  if (left <= 0) {
    const dead = seats.filter((s) => s.expiresAt <= now).map((s) => s.campaignName)
    return { text: `seats EXPIRED: ${dead.join(', ')}`, ok: false }
  }
  const label = left < DAY ? durationLabel(left) : `${Math.floor(left / DAY)}d`
  // Under the refresh margin the next server call re-mints — flag it, it is not yet a failure.
  return {
    text: left < SEAT_REFRESH_MARGIN_MS ? `seats renew on next use (${label})` : `seats fresh (${label})`,
    ok: true,
  }
}

function tableLine(t: TableHealth, now: number): { text: string; ok: boolean } {
  const obs = t.connected ? 'observer ok' : `observer reconnecting, attempt ${t.attempts}`
  const parts = [
    t.campaignName,
    t.sceneName ?? 'no scene',
    `${t.players} player${t.players === 1 ? '' : 's'}${t.dmConnected ? '' : ', DM away'}`,
    obs,
    durationLabel(now - t.startedAt),
  ]
  return { text: parts.join(' · '), ok: t.connected }
}

export function healthBoard(input: HealthInput): ContainerSpec {
  const now = input.now ?? Date.now()
  const seats = seatLine(input.seats, now)
  const tables = input.tables.map((t) => tableLine(t, now))
  const server =
    input.serverMs === null
      ? { text: `${input.serverUrl} UNREACHABLE`, ok: false }
      : { text: `${input.serverUrl} reachable ${input.serverMs}ms`, ok: true }
  const gateway = input.gatewayMs < 0 ? 'gateway n/a' : `gateway ${input.gatewayMs}ms`
  const ok = input.dbOk && seats.ok && server.ok && tables.every((t) => t.ok)

  return {
    accent: ok ? HEALTH_ACCENT_OK : HEALTH_ACCENT_BAD,
    eyebrow: `Health · ${input.botTag}`,
    header: ok ? 'All systems steady' : 'Something needs a look',
    blocks: [
      `**Discord**  ${gateway} · ${input.commandCount} commands · ${input.guildName ?? 'no guild'}\n**Server**  ${server.text} · ${seats.text}`,
      { rule: 'line' },
      tables.length ? tables.map((t) => `**Table**  ${t.text}`).join('\n') : '**Tables**  none running',
      { rule: 'line' },
      `**Storage**  db ${input.dbOk ? 'ok' : 'UNREACHABLE'} · ${Math.round(input.rssBytes / 1048576)} MB rss · node ${input.nodeVersion}`,
    ],
    footer: `Up ${durationLabel(now - input.bootAt)} · build ${input.commit}`,
  }
}
