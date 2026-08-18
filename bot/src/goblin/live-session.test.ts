import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionRunner, throttle, EMBED_EDIT_MS } from './live-session'
import type { GoblinEvent, Observer } from './observer'
import type { GoblinRest } from './rest'
import { openDb } from '../db/db'
import { createCalendar, createCampaigns, createCharacters, createSessions, type Campaign } from '../db/stores'
import type { AttachedFile, ContainerSpec } from '../lib/ui'
import { playerMap } from '../render/__fixtures__/two-rooms'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const unused = (): never => {
  throw new Error('not used in this test')
}

interface Posted {
  channelId: string
  spec: ContainerSpec
  files?: AttachedFile[]
}

interface Edited extends Posted {
  messageId: string
}

function harness(
  over: {
    openSession?: GoblinRest['openSession']
    getMap?: GoblinRest['getMap']
    /** Fires synchronously while an announce() is "in flight" — before its promise resolves
     *  and before the caller learns the message id — so a test can model an observer event
     *  landing during that Discord round-trip. */
    onAnnounce?: (spec: ContainerSpec) => void
    createThread?: (channelId: string, name: string) => Promise<{ threadId: string } | undefined>
  } = {},
) {
  const warn = vi.fn()
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
  const characters = createCharacters(db)

  const posted: Posted[] = []
  const edited: Edited[] = []
  const observers: { emit: (event: GoblinEvent) => void; stopped: () => boolean }[] = []
  const endCalls: string[] = []
  const threads: { channelId: string; name: string }[] = []
  const archived: string[] = []

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
      getMap: over.getMap ?? unused,
      getAsset: unused,
    },
    sessions,
    calendar: createCalendar(db),
    characters,
    announce: async (channelId, spec, files) => {
      over.onAnnounce?.(spec)
      posted.push({ channelId, spec, files })
      return { messageId: `msg-${posted.length}` }
    },
    edit: async (channelId, messageId, spec) => {
      edited.push({ channelId, messageId, spec })
    },
    createThread:
      over.createThread ??
      (async (channelId, name) => {
        threads.push({ channelId, name })
        return { threadId: `thread-${threads.length}` }
      }),
    archiveThread: async (threadId) => {
      archived.push(threadId)
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
    logger: { warn, info: vi.fn() },
  })

  return { runner, campaign, campaigns, sessions, characters, posted, edited, observers, endCalls, threads, archived, warn }
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

  it('shows the scene from the initial session-state snapshot, with no scene option at start', async () => {
    // The observer's session-state snapshot reliably beats the Discord round-trip that posts
    // the board — a local socket vs. a remote HTTP call. This fires it mid-flight, before the
    // live message id is known, which is exactly the race the fix has to survive.
    const { runner, campaign, edited, observers } = harness({
      onAnnounce: (spec) => {
        if (spec.header?.startsWith('Live')) observers[0]?.emit(snapshot)
      },
    })
    await runner.start(campaign) // no sceneId option passed
    vi.advanceTimersByTime(EMBED_EDIT_MS)

    expect(edited).toHaveLength(1)
    expect(text(edited[0].spec)).toContain('Cragmaw Hideout')

    // A later scene-changed still updates it, even to a scene the snapshot never named.
    observers[0].emit({ type: 'scene-changed', sceneId: 'scene-2' })
    vi.advanceTimersByTime(EMBED_EDIT_MS)
    expect(text(edited.at(-1)!.spec)).toContain('scene-2')
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
    // msg-1 was the board, msg-2 the thread's closing line — the recap is the third send.
    expect(row.recapMessageId).toBe('msg-3')
    expect(posted.at(-1)?.spec.header).toContain('Session recap')
    // The board stops advertising a table that is over.
    expect(text(edited.at(-1)!.spec)).toContain('Doors opened')
    expect(observers[0].stopped()).toBe(true)
  })

  // ── last_played stamping (finalize's name-match heuristic) ─────────────────────────────

  it('stamps last_played for characters whose name matches a session player', async () => {
    const { runner, campaign, characters, observers } = harness()
    const zed = characters.create({ discordId: 'user-1', campaignId: 'camp-1', name: 'Zed', className: 'Fighter', level: 1 })
    const mira = characters.create({ discordId: 'user-2', campaignId: 'camp-1', name: 'Mira', className: 'Cleric', level: 1 })
    await runner.start(campaign)
    observers[0].emit(snapshot) // player 'Zed', per the fixture
    observers[0].emit({ type: 'session-ended' })
    await settle()

    expect(characters.byId(zed.id)?.lastPlayed).not.toBeNull()
    // No player in the recap named Mira — the heuristic never touches an unmatched character.
    expect(characters.byId(mira.id)?.lastPlayed).toBeNull()
  })

  it('matches names case-insensitively', async () => {
    const { runner, campaign, characters, observers } = harness()
    const zed = characters.create({ discordId: 'user-1', campaignId: 'camp-1', name: 'ZED', className: 'Fighter', level: 1 })
    await runner.start(campaign)
    observers[0].emit(snapshot)
    observers[0].emit({ type: 'session-ended' })
    await settle()

    expect(characters.byId(zed.id)?.lastPlayed).not.toBeNull()
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

  // ── M6: the recap carries the evening's last map ──────────────────────────────────────

  it('renders the final player-visible map into the recap, one message', async () => {
    const asked: string[] = []
    const { runner, campaign, posted, observers } = harness({
      getMap: async (token, sceneId) => {
        asked.push(`${token}/${sceneId}`)
        return playerMap
      },
    })
    await runner.start(campaign)
    observers[0].emit(snapshot)
    observers[0].emit({
      type: 'tokens',
      state: {
        byScene: {
          'scene-1': {
            t1: { id: 't1', name: 'Zed', x: 3, y: 3, size: 'medium', disposition: 'friendly', hidden: false },
          },
        },
      },
    })
    await runner.end(campaign)

    // The log's name lookup fetched with the DM seat first; the recap snapshot itself is the
    // *player* seat, so the picture is the party's own map even though the observer watches
    // with the DM's.
    expect(asked).toEqual(['dm-token/scene-1', 'player-token/scene-1'])
    const recap = posted.at(-1)!
    expect(recap.spec.header).toContain('Session recap')
    expect(recap.spec.media).toEqual(['attachment://map.png'])
    expect(recap.files?.[0].name).toBe('map.png')
    expect(recap.files?.[0].data.length).toBeGreaterThan(1000)
  })

  it('still posts the recap when the map render fails', async () => {
    const { runner, campaign, posted, observers, sessions, warn } = harness({
      getMap: () => Promise.reject(new Error('server down')),
    })
    await runner.start(campaign)
    observers[0].emit(snapshot)
    const recap = await runner.end(campaign)

    // The words survive; only the picture is lost, and it is logged rather than swallowed.
    expect(recap.scenes).toEqual(['Cragmaw Hideout'])
    expect(posted.at(-1)!.spec.header).toContain('Session recap')
    expect(posted.at(-1)!.spec.media).toBeUndefined()
    expect(posted.at(-1)!.files).toBeUndefined()
    expect(sessions.byId('sess-1')?.recapMessageId).toBe('msg-3')
    expect(warn).toHaveBeenCalledWith('recap map snapshot failed', expect.anything())
  })

  it('hands /map the scene and tokens the observer is holding', async () => {
    const { runner, campaign, observers } = harness()
    await runner.start(campaign)
    observers[0].emit(snapshot)
    observers[0].emit({
      type: 'tokens',
      state: {
        byScene: {
          'scene-1': {
            t1: { id: 't1', name: 'Zed', x: 1, y: 2, size: 'large', disposition: 'hostile', hidden: true },
          },
        },
      },
    })

    expect(runner.liveState('camp-1')).toEqual({
      sceneId: 'scene-1',
      tokens: [{ id: 't1', name: 'Zed', x: 1, y: 2, cells: 2, disposition: 'hostile', hidden: true }],
    })
    expect(runner.liveState('camp-nope')).toBeUndefined()
  })

  // ── the session log thread ──────────────────────────────────────────────────────────────

  const rollEvent = (id: string, total: number, at = 1_000): GoblinEvent => ({
    type: 'rolls',
    state: { log: [{ id, at, playerName: 'Zed', total, visibility: 'public' }] },
  })

  it('opens a thread under the DM channel and mirrors table log lines into it', async () => {
    const { runner, campaign, sessions, threads, posted, observers } = harness()
    await runner.start(campaign)

    expect(threads).toEqual([{ channelId: 'dm-chan', name: expect.stringContaining('Session AB2CD3') }])
    expect(sessions.byId('sess-1')?.logThreadId).toBe('thread-1')

    observers[0].emit(snapshot)
    observers[0].emit(rollEvent('r1', 17))
    await settle()

    const threadPosts = posted.filter((p) => p.channelId === 'thread-1')
    expect(threadPosts).toHaveLength(1)
    expect(text(threadPosts[0].spec)).toContain('**Zed**')
    expect(text(threadPosts[0].spec)).toContain('**17**')
  })

  it('never replays the campaign tail the join snapshot carries', async () => {
    const { runner, campaign, posted, observers } = harness()
    await runner.start(campaign)
    observers[0].emit({
      ...snapshot,
      state: {
        ...(snapshot as Extract<GoblinEvent, { type: 'session-state' }>).state,
        modules: { rolls: { log: [{ id: 'old-1', at: 5, playerName: 'Zed', total: 20, visibility: 'public' }] } },
      },
    })
    vi.advanceTimersByTime(EMBED_EDIT_MS * 2)
    await settle()
    expect(posted.filter((p) => p.channelId === 'thread-1')).toHaveLength(0)
  })

  it('batches a busy window into one trailing post', async () => {
    const { runner, campaign, posted, observers } = harness()
    await runner.start(campaign)
    observers[0].emit(snapshot)
    observers[0].emit(rollEvent('r1', 17))
    await settle()
    observers[0].emit(rollEvent('r2', 3, 2_000))
    observers[0].emit(rollEvent('r3', 9, 3_000))
    vi.advanceTimersByTime(EMBED_EDIT_MS)
    await settle()

    const threadPosts = posted.filter((p) => p.channelId === 'thread-1')
    expect(threadPosts).toHaveLength(2)
    // The trailing post carries both lines that landed inside the window, in table order.
    expect(text(threadPosts[1].spec)).toContain('**3**')
    expect(text(threadPosts[1].spec)).toContain('**9**')
  })

  it('drains, says the session ended and archives the thread on end', async () => {
    const { runner, campaign, posted, archived, observers } = harness()
    await runner.start(campaign)
    observers[0].emit(snapshot)
    observers[0].emit(rollEvent('r1', 17))
    await settle()
    await runner.end(campaign)

    const threadPosts = posted.filter((p) => p.channelId === 'thread-1')
    expect(text(threadPosts.at(-1)!.spec)).toContain('Session ended')
    expect(archived).toEqual(['thread-1'])
  })

  it('resumes into the thread it already opened, never a new one', async () => {
    const { runner, sessions, threads, posted, observers } = harness()
    sessions.start('sess-old', 'camp-1', 'QQ7QQ7')
    sessions.setLogThreadId('sess-old', 'thread-old')
    runner.resume()

    observers[0].emit(snapshot)
    observers[0].emit(rollEvent('r1', 17))
    await settle()

    expect(threads).toHaveLength(0)
    expect(posted.filter((p) => p.channelId === 'thread-old')).toHaveLength(1)
  })

  it('runs the session without a thread when the channel cannot hold one', async () => {
    const { runner, campaign, posted, edited, observers } = harness({ createThread: async () => undefined })
    await runner.start(campaign)
    observers[0].emit(snapshot)
    observers[0].emit(rollEvent('r1', 17))
    vi.advanceTimersByTime(EMBED_EDIT_MS * 2)
    await settle()

    // No thread, no post — and the board keeps working as if nothing happened.
    expect(posted.filter((p) => p.channelId.startsWith('thread'))).toHaveLength(0)
    expect(edited.length).toBeGreaterThan(0)
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
