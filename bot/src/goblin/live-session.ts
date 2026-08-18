// The one place a live table is orchestrated: open on the server, post the board, keep it
// current from the observer's stream, and finish exactly once however the table ends.
//
// Discord-free by construction — `announce`/`edit` are injected callbacks and the observer
// factory is too, so the whole lifecycle runs in a unit test with no socket and no gateway.

import type { BotSession, Calendar, Campaign, Characters, SessionRecap, Sessions } from '../db/stores'
import { calendarLine } from '../features/calendar'
import {
  joinUrl,
  liveSessionEmbed,
  previouslyOnEmbed,
  sessionRecapEmbed,
} from '../features/session'
import { userInput } from '../lib/errors'
import { log as defaultLog } from '../lib/log'
import type { AttachedFile, ContainerSpec } from '../lib/ui'
import { mapSvg, type MapToken } from '../render/map-svg'
import { rasterize } from '../render/raster'
import type { Observer } from './observer'
import type { GoblinRest } from './rest'
import { createSessionStats, type SessionStats } from './session-stats'

/** Plan §8: at most one edit per five seconds, so a busy table cannot spend the rate limit. */
export const EMBED_EDIT_MS = 5_000

/** How many failed connects a *resumed* session tolerates before it is presumed over. The
 * WS upgrade refuses a token whose session has ended, so this is what "the server closed the
 * table while the bot was down" looks like from here. */
const RESUME_GIVE_UP = 3

export interface SessionRunnerDeps {
  publicTableUrl: string
  rest: GoblinRest
  sessions: Sessions
  calendar: Calendar
  characters: Characters
  announce: (
    channelId: string,
    spec: ContainerSpec,
    files?: AttachedFile[],
  ) => Promise<{ messageId: string } | undefined>
  edit: (channelId: string, messageId: string, spec: ContainerSpec) => Promise<void>
  /** Injected so tests drive a fake socket and index.ts owns the `ws` dependency. */
  createObserver: (token: string) => Observer
  campaignById: (campaignId: string) => Campaign | undefined
  throttleMs?: number
  logger?: Pick<typeof defaultLog, 'warn' | 'info'>
}

export interface SessionRunner {
  start: (campaign: Campaign, sceneId?: string) => Promise<{ session: BotSession; joinLink: string }>
  /** The DM's `/session end`. The observer's `session-ended` reaches the same finalize. */
  end: (campaign: Campaign) => Promise<SessionRecap>
  /** Boot: pick the live rows back up (plan §11 M5). */
  resume: () => void
  stopAll: () => void
  /** What the observer currently knows about a campaign's table — the scene `/map` defaults
   * to, and the tokens it overlays. Undefined when no session is being watched. */
  liveState: (campaignId: string) => { sceneId: string | null; tokens: MapToken[] } | undefined
}

/** The recap's map file name; `media` references it as `attachment://` (plan §7). */
export const SNAPSHOT_FILE = 'map.png'

interface Running {
  campaign: Campaign
  stats: SessionStats
  observer: Observer
  refresh: Throttled
  /** Only set for a resumed session: a live one has a socket that already worked. */
  deadTries: number | null
  /** Flushes a refresh that fired — and found no live message id yet, so did nothing — before
   *  the initial announce() finished. The observer's own snapshot routinely beats that Discord
   *  round-trip, and without this the throttle's one guaranteed leading edge is spent on
   *  nothing, silently, with nothing left to retry it until the next unrelated event. */
  flushIfMissed: () => void
}

export function createSessionRunner(deps: SessionRunnerDeps): SessionRunner {
  const logger = deps.logger ?? defaultLog
  const running = new Map<string, Running>()

  function tokenOf(campaign: Campaign): string {
    if (!campaign.serviceToken)
      throw userInput('This campaign has no game-server token yet — run `/campaign setup` again.')
    return campaign.serviceToken
  }

  function boardFor(campaign: Campaign, row: BotSession, stats: SessionStats): ContainerSpec {
    return liveSessionEmbed({
      campaignName: campaign.name,
      joinUrl: joinUrl(deps.publicTableUrl, row.inviteCode ?? ''),
      startedAt: row.startedAt,
      calendarLine: calendarLine(deps.calendar.get(campaign.goblinCampaignId)),
      live: stats.live(),
    })
  }

  function attach(campaign: Campaign, row: BotSession, resumed: boolean): Running {
    const stats = createSessionStats(row.startedAt)
    let missedBeforeReady = false
    const refresh = throttle(deps.throttleMs ?? EMBED_EDIT_MS, () => {
      const current = deps.sessions.byId(row.goblinSessionId)
      if (!current?.liveMessageId) {
        missedBeforeReady = true
        return
      }
      if (current.endedAt !== null) return
      void deps.edit(campaign.channelId, current.liveMessageId, boardFor(campaign, current, stats)).catch(
        (error: unknown) => logger.warn('live board edit failed', { error: String(error) }),
      )
    })

    const observer = deps.createObserver(tokenOf(campaign))
    const entry: Running = {
      campaign,
      stats,
      observer,
      refresh,
      deadTries: resumed ? 0 : null,
      flushIfMissed: () => {
        if (missedBeforeReady) refresh.call()
      },
    }
    running.set(row.goblinSessionId, entry)

    observer.subscribe((event) => {
      if (event.type === 'closed') {
        if (event.fatal) void finalize(campaign, row.goblinSessionId)
        // A resumed session whose socket never opens is a table the server already closed:
        // the upgrade refuses a token bound to a campaign with no active session.
        else if (entry.deadTries !== null && ++entry.deadTries >= RESUME_GIVE_UP) {
          logger.info('gave up resuming session', { session: row.goblinSessionId, attempts: entry.deadTries })
          void finalize(campaign, row.goblinSessionId)
        }
        return
      }
      // Any frame at all proves the table is still there.
      entry.deadTries = null
      if (event.type === 'session-state') {
        logger.info('session-state snapshot received', {
          session: row.goblinSessionId,
          activeSceneId: event.state.activeSceneId,
          players: event.state.players?.length ?? 0,
        })
      }
      stats.apply(event)
      if (event.type === 'session-ended') void finalize(campaign, row.goblinSessionId)
      else refresh.call()
    })

    return entry
  }

  /**
   * Ends the session exactly once, whoever asked. `/session end`, the observer's
   * `session-ended` and the give-up path all arrive here; the `ended_at IS NULL` guard in the
   * store decides which of them measured the table.
   */
  async function finalize(campaign: Campaign, sessionId: string): Promise<SessionRecap> {
    const entry = running.get(sessionId)
    entry?.refresh.cancel()
    entry?.observer.stop()
    running.delete(sessionId)

    const before = deps.sessions.byId(sessionId)
    if (before?.endedAt !== null && before?.recap) return before.recap

    const stats = entry?.stats ?? createSessionStats(before?.startedAt ?? Date.now())
    const recap: SessionRecap = {
      ...stats.recap(Date.now()),
      calendarLine: calendarLine(deps.calendar.get(campaign.goblinCampaignId)),
    }
    const row = deps.sessions.finish(sessionId, recap)
    logger.info('session finalized', {
      session: sessionId,
      doors: recap.doorsOpened,
      scenes: recap.scenes.length,
      durationMs: recap.durationMs,
    })

    // ponytail: last_played by exact (case-insensitive) name match against the recap's player
    // list — nickname sync (features/nickname.ts) keeps table display names lined up with
    // character names often enough to be useful. Ceiling: a player whose nickname doesn't match
    // their character name is silently skipped. Proper fix is an identity mapping once
    // Discord-auth joins exist and a session player can be tied to a discord_id directly.
    const playerNames = new Set(recap.players.map((name) => name.toLowerCase()))
    const played = deps.characters
      .byCampaign(campaign.goblinCampaignId)
      .filter((c) => playerNames.has(c.name.toLowerCase()))
    if (played.length) deps.characters.touchLastPlayed(played.map((c) => c.id), row.endedAt ?? Date.now())

    // The evening's last map, inside the recap rather than beside it (plan §7). The render
    // reaches the game server, so it is the one part of a recap that can fail — and a lost
    // recap would be a far worse trade than a recap without a picture.
    const snapshot = await snapshotOf(campaign, entry?.stats).catch((error: unknown) => {
      logger.warn('recap map snapshot failed', { error: String(error) })
      return undefined
    })
    const spec = sessionRecapEmbed(campaign.name, recap)
    const sent = await deps.announce(
      campaign.channelId,
      snapshot ? { ...spec, media: [`attachment://${SNAPSHOT_FILE}`] } : spec,
      snapshot ? [snapshot] : undefined,
    )
    if (sent) deps.sessions.setRecapMessageId(sessionId, sent.messageId)
    // The board stops claiming a table that is over.
    if (row.liveMessageId) {
      await deps
        .edit(campaign.channelId, row.liveMessageId, sessionRecapEmbed(campaign.name, recap))
        .catch((error: unknown) => logger.warn('live board close-out failed', { error: String(error) }))
    }
    return recap
  }

  /**
   * The final *player-visible* map: fetched with the campaign's player-role token, so the
   * server's redactor decides what the party is allowed to keep looking at after the table
   * closes (plan §4). Undefined when there is nothing to draw or no seat to draw it from.
   */
  async function snapshotOf(campaign: Campaign, stats: SessionStats | undefined): Promise<AttachedFile | undefined> {
    const sceneId = stats?.live().sceneId
    if (!sceneId || !campaign.playerToken) return undefined
    const doc = await deps.rest.getMap(campaign.playerToken, sceneId)
    return { name: SNAPSHOT_FILE, data: rasterize(mapSvg(doc, { tokens: stats?.tokens(sceneId) })) }
  }

  return {
    start: async (campaign, sceneId) => {
      const opened = await deps.rest.openSession(tokenOf(campaign), campaign.goblinCampaignId, sceneId)
      const row = deps.sessions.start(opened.sessionId, campaign.goblinCampaignId, opened.inviteCode)

      const previous = deps.sessions.lastEnded(campaign.goblinCampaignId)
      if (previous?.recap) await deps.announce(campaign.channelId, previouslyOnEmbed(campaign.name, previous.recap))

      const entry = attach(campaign, row, false)
      const sent = await deps.announce(campaign.channelId, boardFor(campaign, row, entry.stats))
      if (sent) {
        deps.sessions.setLiveMessageId(row.goblinSessionId, sent.messageId)
        entry.flushIfMissed()
      }
      logger.info('session opened', { campaign: campaign.goblinCampaignId, session: row.goblinSessionId })
      return { session: row, joinLink: joinUrl(deps.publicTableUrl, opened.inviteCode) }
    },

    end: async (campaign) => {
      const row = deps.sessions.live().find((s) => s.campaignId === campaign.goblinCampaignId)
      if (!row) throw userInput("There's no session running for this campaign.")
      // Told to the server first: it is the authority, and its `session-ended` broadcast is
      // what tells the players' clients. Finalizing anyway means a server that already
      // closed the table (or never heard) still leaves a recap behind.
      await deps.rest
        .endSession(tokenOf(campaign), row.goblinSessionId)
        .catch((error: unknown) => logger.warn('end session call failed', { error: String(error) }))
      return finalize(campaign, row.goblinSessionId)
    },

    resume: () => {
      for (const row of deps.sessions.live()) {
        const campaign = deps.campaignById(row.campaignId)
        if (!campaign?.serviceToken) continue
        logger.info('resuming session observer', { session: row.goblinSessionId })
        attach(campaign, row, true)
      }
    },

    stopAll: () => {
      for (const entry of running.values()) {
        entry.refresh.cancel()
        entry.observer.stop()
      }
      running.clear()
    },

    liveState: (campaignId) => {
      for (const entry of running.values()) {
        if (entry.campaign.goblinCampaignId !== campaignId) continue
        const sceneId = entry.stats.live().sceneId
        return { sceneId, tokens: sceneId ? entry.stats.tokens(sceneId) : [] }
      }
      return undefined
    },
  }
}

export interface Throttled {
  call: () => void
  cancel: () => void
}

/**
 * Leading edge plus a trailing edge: the first change shows at once, and the last one always
 * lands, with at most one call per window in between. That trailing run is the whole point —
 * dropping it would leave the board frozen on whatever state happened to be mid-window.
 */
export function throttle(ms: number, run: () => void): Throttled {
  let last = -Infinity
  let timer: ReturnType<typeof setTimeout> | null = null

  const fire = (): void => {
    timer = null
    last = Date.now()
    run()
  }

  return {
    call: () => {
      if (timer) return // a trailing run is already booked; it will see the newest state
      const wait = last + ms - Date.now()
      if (wait <= 0) fire()
      else timer = setTimeout(fire, wait)
    },
    cancel: () => {
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
}
