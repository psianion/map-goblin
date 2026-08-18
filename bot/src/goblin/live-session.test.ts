import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionRunner, throttle, EMBED_EDIT_MS } from './live-session'
import type { GoblinEvent, Observer } from './observer'
import type { GoblinRest } from './rest'
import { openDb } from '../db/db'
import { createCalendar, createCampaigns, createSessions, type Campaign } from '../db/stores'
import type { ContainerSpec } from '../lib/ui'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const unused = (): never => {
  throw new Error('not used in this test')
}

interface Posted {
  channelId: string
  spec: ContainerSpec
}

interface Edited extends Posted {
  messageId: string
}

function harness(over: { openSession?: GoblinRest['openSession'] } = {}) {
  const db = openDb(':memory:')
  const campaigns = createCampaigns(db)
  campaigns.upsert({
    goblinCampaignId: 'camp-1',
    name: 'The Sunken Keep',
    channelId: 'player-chan',
    dmChannelId: 'dm-chan',
    dmDiscordId: 'dm-1',
    roleId: 'role-1',
  })
  const campaign: Campaign = campaigns.setTokens('camp-1', 'dm-token', 'player-token')
  const sessions = createSessions(db)

  const posted: Posted[] = []
  const edited: Edited[] = []
  const observers: { emit: (event: GoblinEvent) => void; stopped: () => boolean }[] = []
  const endCalls: string[] = []

  const runner = createSessionRunner({
    publicTableUrl: 'https://table.example',
    rest: {
      mintServiceToken: unused,
      getScenes: unused,
      openSession:
        over.openSession ??
        (async (_token, campaignId) => ({ sessionId: 'sess-1', campaignId, inviteCode: 'AB2CD3' })),
      endSession: async (_token, sessionId) => {
        endCalls.push(sessionId)
      },
      getMap: unused,
      getAsset: unused,
    },
    sessions,
    calendar: createCalendar(db),
    announce: async (channelId, spec) => {
      posted.push({ channelId, spec })
      return { messageId: `msg-${posted.length}` }
    },
    edit: async (channelId, messageId, spec) => {
      edited.push({ channelId, messageId, spec })
    },
    createObserver: () => {
      const listeners = new Set<(event: GoblinEvent) => void>()
      let stopped = false
      observers.push({ emit: (event) => listeners.forEach((l) => l(event)), stopped: () => stopped })
      const observer: Observer = {
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        stop: () => {
          stopped = true
          listeners.clear()
        },
      }
      return observer
    },
    campaignById: campaigns.byId,
    logger: { warn: vi.fn(), info: vi.fn() },
  })

  return { runner, campaign, campaigns, sessions, posted, edited, observers, endCalls }
}

const snapshot: GoblinEvent = {
  type: 'session-state',
  state: {
    protocolVersion: 4,
    sessionId: 'sess-1',
    campaignId: 'camp-1',
    activeSceneId: 'scene-1',
    scenes: [{ id: 'scene-1', name: 'Cragmaw Hideout', mapId: 'map-1' }],
    players: [{ identityId: 'p1', name: 'Zed', role: 'player', connected: true }],
  },
}

const text = (spec: ContainerSpec): string => `${spec.header ?? ''}\n${(spec.blocks ?? []).join('\n')}`

/** Finalize is kicked off by a synchronous event; its posts are a promise chain. */
const settle = (): Promise<void> => vi.advanceTimersByTimeAsync(0).then(() => {})

describe('throttle', () => {
  it('runs the first call at once and the last one at the end of the window', () => {
    const run = vi.fn()
    const throttled = throttle(1_000, run)

    throttled.call()
    expect(run).toHaveBeenCalledTimes(1)

    throttled.call()
    throttled.call()
    throttled.call()
    expect(run).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1_000)
    // Three calls in one window collapse into the one trailing run that shows the newest state.
    expect(run).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(10_000)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('drops a pending trailing run when cancelled', () => {
    const run = vi.fn()
    const throttled = throttle(1_000, run)
    throttled.call()
    throttled.call()
    throttled.cancel()
    vi.advanceTimersByTime(10_000)
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('session runner', () => {
  it('opens the table, posts the board and stores the row', async () => {
    const { runner, campaign, sessions, posted } = harness()
    const { session, joinLink } = await runner.start(campaign, 'scene-1')

    expect(joinLink).toBe('https://table.example/join/AB2CD3')
    expect(session.goblinSessionId).toBe('sess-1')
    expect(sessions.byId('sess-1')?.endedAt).toBeNull()
    expect(sessions.byId('sess-1')?.liveMessageId).toBe('msg-1')
    expect(posted).toHaveLength(1)
    expect(posted[0].channelId).toBe('player-chan')
    expect(text(posted[0].spec)).toContain('https://table.example/join/AB2CD3')
  })

  it('leads with "Previously on…" when the last table left a recap', async () => {
    const { runner, campaign, sessions, posted } = harness()
    sessions.start('sess-0', 'camp-1', 'ZZ9ZZ9')
    sessions.finish('sess-0', {
      scenes: ['The Vault'],
      doorsOpened: 3,
      durationMs: 3_600_000,
      players: ['Zed'],
      peakPlayers: 1,
      calendarLine: 'Day 12',
    })
    posted.length = 0

    await runner.start(campaign)
    expect(posted[0].spec.header).toBe('Previously on…')
    expect(text(posted[0].spec)).toContain('The Vault')
    expect(posted[1].spec.header).toContain('Live')
  })

  it('edits the board in place, at most once per window', async () => {
    const { runner, campaign, observers, edited } = harness()
    await runner.start(campaign)

    observers[0].emit(snapshot)
    expect(edited).toHaveLength(1)
    expect(edited[0].messageId).toBe('msg-1')
    expect(text(edited[0].spec)).toContain('Zed')

    observers[0].emit({ type: 'scene-changed', sceneId: 'scene-1' })
    observers[0].emit({ type: 'player-joined', player: { identityId: 'p2', name: 'Mira', role: 'player', connected: true } })
    expect(edited).toHaveLength(1)

    vi.advanceTimersByTime(EMBED_EDIT_MS)
    expect(edited).toHaveLength(2)
    // The trailing edit carries the newest state, not the one that scheduled it.
    expect(text(edited[1].spec)).toContain('Mira')
  })

  it('finishes on the server\'s session-ended: recap stored, posted, observer stopped', async () => {
    const { runner, campaign, sessions, posted, edited, observers } = harness()
    await runner.start(campaign)
    observers[0].emit(snapshot)
    observers[0].emit({
      type: 'doors',
      state: { byScene: { 'scene-1': { d1: { open: false, locked: false, revealed: true } } } },
    })
    observers[0].emit({
      type: 'doors',
      state: { byScene: { 'scene-1': { d1: { open: true, locked: false, revealed: true } } } },
    })
    observers[0].emit({ type: 'session-ended' })
    await settle()

    const row = sessions.byId('sess-1')!
    expect(row.endedAt).not.toBeNull()
    expect(row.recap).toMatchObject({ scenes: ['Cragmaw Hideout'], doorsOpened: 1, players: ['Zed'] })
    expect(row.recapMessageId).toBe('msg-2')
    expect(posted.at(-1)?.spec.header).toContain('Session recap')
    // The board stops advertising a table that is over.
    expect(text(edited.at(-1)!.spec)).toContain('Doors opened')
    expect(observers[0].stopped()).toBe(true)
  })

  it('ends from the DM command and cannot end the same table twice', async () => {
    const { runner, campaign, sessions, posted, observers, endCalls } = harness()
    await runner.start(campaign)
    observers[0].emit(snapshot)

    const recap = await runner.end(campaign)
    // Told to the server first — it is the authority on the table being over.
    expect(endCalls).toEqual(['sess-1'])
    expect(recap.scenes).toEqual(['Cragmaw Hideout'])
    expect(posted.filter((p) => p.spec.header?.includes('Session recap'))).toHaveLength(1)
    expect(sessions.byId('sess-1')?.endedAt).not.toBeNull()
    // The observer is stopped, so the server's own `session-ended` echo lands on nobody, and
    // the row is no longer live for a second command either.
    expect(observers[0].stopped()).toBe(true)
    await expect(runner.end(campaign)).rejects.toThrow(/no session running/i)
  })

  it('refuses to end a campaign with no table running', async () => {
    const { runner, campaign } = harness()
    await expect(runner.end(campaign)).rejects.toThrow(/no session running/i)
  })

  it('resumes a live row on boot and keeps editing the board it already posted', () => {
    const { runner, sessions, observers, edited } = harness()
    sessions.start('sess-old', 'camp-1', 'QQ7QQ7')
    sessions.setLiveMessageId('sess-old', 'msg-old')

    runner.resume()
    expect(observers).toHaveLength(1)
    observers[0].emit(snapshot)
    expect(edited.at(-1)?.messageId).toBe('msg-old')
    expect(sessions.byId('sess-old')?.endedAt).toBeNull()
  })

  it('finalizes a resumed session the server closed while the bot was down', async () => {
    const { runner, sessions, observers, posted } = harness()
    sessions.start('sess-old', 'camp-1', 'QQ7QQ7')
    runner.resume()

    // The upgrade refuses a token whose session has ended, so the socket never opens.
    observers[0].emit({ type: 'closed', fatal: false })
    observers[0].emit({ type: 'closed', fatal: false })
    expect(sessions.byId('sess-old')?.endedAt).toBeNull()
    observers[0].emit({ type: 'closed', fatal: false })
    await settle()

    expect(sessions.byId('sess-old')?.endedAt).not.toBeNull()
    expect(posted.at(-1)?.spec.header).toContain('Session recap')
  })

  it('refuses to start without a game-server token', async () => {
    const { runner, campaigns } = harness()
    const untokened = campaigns.upsert({
      goblinCampaignId: 'camp-2',
      name: 'Untokened',
      channelId: 'chan-2',
      dmChannelId: 'dm-2',
      dmDiscordId: 'dm-2',
      roleId: 'role-2',
    })
    await expect(runner.start(untokened)).rejects.toThrow(/campaign setup/)
  })
})
