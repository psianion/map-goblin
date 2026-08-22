import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dmOnly, memberOnly, ownerOnly, registry, type AuthContext, type Deps } from './command-registry'
import { openDb } from '../db/db'
import {
  createCalendar,
  createCampaigns,
  createCharacters,
  createFeedback,
  createLedger,
  createLfgApplications,
  createLfgPosts,
  createNotes,
  createQuests,
  createRolls,
  createSchedulePolls,
  createSessions,
  type Campaign,
} from '../db/stores'
import type { WireInitiativeEntry } from '../goblin/observer'
import { parse } from '../lib/custom-id'
import type { AttachedFile, ContainerSpec } from '../lib/ui'
import { dmMap, playerMap } from '../render/__fixtures__/two-rooms'
import type { MapToken } from '../render/map-svg'

const campaign: Campaign = {
  goblinCampaignId: 'camp-1',
  name: 'The Sunken Keep',
  channelId: 'player-chan',
  dmChannelId: 'dm-chan',
  dmDiscordId: 'dm-1',
  roleId: 'role-1',
  nextSessionAt: null,
  serviceToken: 'dm-token',
  playerToken: 'player-token',
}

const deps = (byChannel: (id: string) => Campaign | undefined): Deps => ({
  ownerId: 'owner-1',
  botData: 'unused-bot-data',
  campaigns: {
    byChannel,
    byId: () => undefined,
    upsert: (c) => ({ ...c, nextSessionAt: null, serviceToken: null, playerToken: null }),
    setNextSession: () => {
      throw new Error('not used in this test')
    },
    setTokens: () => {
      throw new Error('not used in this test')
    },
  },
  characters: {
    create: () => {
      throw new Error('not used in this test')
    },
    update: () => {
      throw new Error('not used in this test')
    },
    byId: () => undefined,
    byCampaignAndName: () => undefined,
    byOwner: () => [],
    byCampaign: () => [],
    touchLastPlayed: () => {
      throw new Error('not used in this test')
    },
  },
  quests: {
    add: () => {
      throw new Error('not used in this test')
    },
    complete: () => {
      throw new Error('not used in this test')
    },
    active: () => [],
    byCampaign: () => [],
  },
  notes: {
    add: () => {
      throw new Error('not used in this test')
    },
    search: () => [],
  },
  rolls: {
    record: () => {
      throw new Error('not used in this test')
    },
    byId: () => undefined,
    statsByCampaign: () => [],
  },
  ledger: {
    add: () => {
      throw new Error('not used in this test')
    },
    recent: () => [],
    goldTotal: () => 0,
  },
  calendar: {
    get: () => undefined,
    set: () => {
      throw new Error('not used in this test')
    },
    advance: () => {
      throw new Error('not used in this test')
    },
  },
  schedulePolls: {
    create: () => {
      throw new Error('not used in this test')
    },
    byId: () => undefined,
    setMessageRef: () => {
      throw new Error('not used in this test')
    },
    setVotes: () => {
      throw new Error('not used in this test')
    },
    close: () => {
      throw new Error('not used in this test')
    },
  },
  lfgPosts: {
    create: () => {
      throw new Error('not used in this test')
    },
    open: () => [],
    openForCampaign: () => undefined,
    close: () => {},
  },
  lfgApplications: {
    add: () => {
      throw new Error('not used in this test')
    },
  },
  feedback: {
    add: () => {
      throw new Error('not used in this test')
    },
  },
  sessions: stubSessions(),
  lfgChannelId: 'lfg-chan',
  goblin: stubGoblin(),
  goblinAdminPass: 'admin-pass',
  sessionRunner: stubRunner(),
  db: {} as Deps['db'],
  announce: async () => undefined,
  edit: async () => {},
})

/** The M5 bridge, inert: these authorize tests never reach an execute body. */
const unused = (): never => {
  throw new Error('not used in this test')
}
const stubSessions = (): Deps['sessions'] => ({
  start: unused,
  byId: () => undefined,
  live: () => [],
  lastEnded: () => undefined,
  finish: unused,
  setLiveMessageId: unused,
  setRecapMessageId: unused,
  setLogThreadId: unused,
  stats: () => ({ played: 0, lastStartedAt: null }),
})
const stubGoblin = (): Deps['goblin'] => ({
  mintServiceToken: unused,
  getScenes: unused,
  openSession: unused,
  endSession: unused,
  getMap: unused,
  getAsset: unused,
})
const stubRunner = (): Deps['sessionRunner'] => ({
  start: unused,
  end: unused,
  liveState: () => undefined,
  encounter: () => undefined,
  // No live table by default — the /roll forward is best-effort, so it must not throw here.
  command: () => false,
  resume: unused,
  stopAll: unused,
})

const ctx = (over: Partial<AuthContext> = {}): AuthContext => ({
  userId: 'user-1',
  channelId: 'player-chan',
  roleIds: [],
  ...over,
})

const registered = deps((id) => (id === 'player-chan' || id === 'dm-chan' ? campaign : undefined))

describe('ownerOnly', () => {
  it('passes the operator and refuses everyone else', () => {
    expect(() => ownerOnly(ctx({ userId: 'owner-1' }), registered)).not.toThrow()
    expect(() => ownerOnly(ctx(), registered)).toThrowError(/bot operator/)
  })
})

describe('channel-resolved roles', () => {
  it('refuses outside a campaign channel before looking at the user', () => {
    expect(() => dmOnly(ctx({ channelId: 'random' }), registered)).toThrowError(/campaign channel/)
    expect(() => memberOnly(ctx({ channelId: 'random' }), registered)).toThrowError(/campaign channel/)
  })

  it('treats the DB, not a Discord role, as the authority on who the DM is', () => {
    expect(() => dmOnly(ctx({ userId: 'dm-1' }), registered)).not.toThrow()
    expect(() => dmOnly(ctx({ userId: 'user-1', roleIds: ['role-1'] }), registered)).toThrowError(/DM/)
  })

  it('requires the campaign role for members', () => {
    expect(() => memberOnly(ctx({ roleIds: ['role-1'] }), registered)).not.toThrow()
    expect(() => memberOnly(ctx({ roleIds: ['other'] }), registered)).toThrowError(/not in this campaign/)
  })
})

describe('mixed-subcommand authorize (memberViews)', () => {
  it('/quests log is member-level, add/complete are DM-only', () => {
    const authorize = registry.quests.authorize
    expect(() => authorize(ctx({ subcommand: 'log', roleIds: ['role-1'] }), registered)).not.toThrow()
    expect(() => authorize(ctx({ subcommand: 'log', roleIds: [] }), registered)).toThrowError(/not in this campaign/)
    expect(() => authorize(ctx({ subcommand: 'add', userId: 'dm-1' }), registered)).not.toThrow()
    expect(() => authorize(ctx({ subcommand: 'add', userId: 'user-1' }), registered)).toThrowError(/DM/)
    expect(() => authorize(ctx({ subcommand: 'complete', userId: 'user-1' }), registered)).toThrowError(/DM/)
  })

  it('/calendar show is member-level, set/advance are DM-only', () => {
    const authorize = registry.calendar.authorize
    expect(() => authorize(ctx({ subcommand: 'show', roleIds: ['role-1'] }), registered)).not.toThrow()
    expect(() => authorize(ctx({ subcommand: 'set', userId: 'user-1' }), registered)).toThrowError(/DM/)
    expect(() => authorize(ctx({ subcommand: 'advance', userId: 'dm-1' }), registered)).not.toThrow()
  })
})

describe('/loot per-subcommand ephemeral', () => {
  it('add is public, list is ephemeral', () => {
    const ephemeral = registry.loot.ephemeral
    expect(typeof ephemeral).toBe('function')
    const asFn = ephemeral as (i: { options: { getSubcommand: () => string } }) => boolean
    expect(asFn({ options: { getSubcommand: () => 'add' } })).toBe(false)
    expect(asFn({ options: { getSubcommand: () => 'list' } })).toBe(true)
  })
})

describe('/campaign subcommand authorize split (setup owner, status member)', () => {
  it('setup stays owner-only, status is member-level', () => {
    const authorize = registry.campaign.authorize
    expect(() => authorize(ctx({ subcommand: 'setup', userId: 'owner-1' }), registered)).not.toThrow()
    expect(() => authorize(ctx({ subcommand: 'setup', userId: 'user-1' }), registered)).toThrowError(/bot operator/)
    expect(() => authorize(ctx({ subcommand: 'status', roleIds: ['role-1'] }), registered)).not.toThrow()
    expect(() => authorize(ctx({ subcommand: 'status', roleIds: [] }), registered)).toThrowError(/not in this campaign/)
  })
})

// ── M4 integration: real (in-memory) stores wired through the actual registry entries, not
// fixtures — vote toggling, DM-writes-the-date and membership checks all live inside the
// component handlers in command-registry.ts, so a pure feature test can't cover them.

interface Sent {
  channelId: string
  spec: ContainerSpec
  files?: AttachedFile[]
}

function seededDeps(over: Partial<Deps> = {}): { deps: Deps; sent: Sent[] } {
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
  const sent: Sent[] = []
  const deps: Deps = {
    ownerId: 'owner-1',
    botData: mkdtempSync(join(tmpdir(), 'map-goblin-bot-')),
    campaigns,
    characters: createCharacters(db),
    quests: createQuests(db),
    notes: createNotes(db),
    rolls: createRolls(db),
    ledger: createLedger(db),
    calendar: createCalendar(db),
    schedulePolls: createSchedulePolls(db),
    lfgPosts: createLfgPosts(db),
    lfgApplications: createLfgApplications(db),
    feedback: createFeedback(db),
    sessions: createSessions(db),
    lfgChannelId: 'lfg-chan',
    goblin: stubGoblin(),
    goblinAdminPass: 'admin-pass',
    sessionRunner: stubRunner(),
    db,
    announce: async (channelId, spec, files) => {
      sent.push({ channelId, spec, files })
      return { messageId: `msg-${sent.length}` }
    },
    edit: async () => {},
    ...over,
  }
  return { deps, sent }
}

interface FakeAttachment {
  url: string
  name: string
  contentType: string | null
}

function chatInteraction(over: {
  channelId?: string
  userId?: string
  subcommand?: string
  strings?: Record<string, string | null>
  integers?: Record<string, number | null>
  focused?: string
  attachments?: Record<string, FakeAttachment>
}) {
  const calls: unknown[][] = []
  return {
    calls,
    channelId: over.channelId ?? 'player-chan',
    user: { id: over.userId ?? 'user-1', username: 'goblin' },
    options: {
      getSubcommand: () => over.subcommand ?? '',
      getString: (name: string, required?: boolean) => {
        const value = over.strings?.[name] ?? null
        if (required && value === null) throw new Error(`missing required option ${name}`)
        return value
      },
      getInteger: (name: string, required?: boolean) => {
        const value = over.integers?.[name] ?? null
        if (required && value === null) throw new Error(`missing required option ${name}`)
        return value
      },
      getFocused: () => over.focused ?? '',
      getAttachment: (name: string) => over.attachments?.[name] ?? null,
      // Channel/role/user options carry only an id here — that is all the registry reads.
      getChannel: (name: string) => ({ id: over.strings?.[name] ?? name }),
      getRole: (name: string) => ({ id: over.strings?.[name] ?? name }),
      getUser: (name: string) => ({ id: over.strings?.[name] ?? name }),
    },
    editReply: vi.fn(async (payload: unknown) => void calls.push(['edit', payload])),
    respond: vi.fn(async (choices: unknown) => void calls.push(['respond', choices])),
  }
}

function componentInteraction(customId: string, userId: string, roleIds: string[] = []) {
  const calls: unknown[][] = []
  return {
    calls,
    customId,
    user: { id: userId, username: 'goblin' },
    member: { roles: roleIds },
    reply: vi.fn(async (payload: unknown) => void calls.push(['reply', payload])),
  }
}

// ── M5: /campaign setup mints the bot's two game-server seats ─────────────────────────────

const setupOptions = {
  id: 'camp-9',
  name: 'New Keep',
  channel: 'chan-9',
  'dm-channel': 'dmchan-9',
  role: 'role-9',
  dm: 'dmuser-9',
}

describe('/campaign setup — service token mint', () => {
  it('stores both seats after registering the row', async () => {
    const asked: string[] = []
    const { deps } = seededDeps({
      goblin: {
        ...stubGoblin(),
        mintServiceToken: async (_pass, campaignId, role) => {
          asked.push(role)
          return { token: `${role}-token`, campaignId, role, name: 'Goblin Bot' }
        },
      },
    })
    await registry.campaign.execute(chatInteraction({ subcommand: 'setup', strings: setupOptions }) as never, deps)

    expect(asked.sort()).toEqual(['dm', 'player'])
    expect(deps.campaigns.byId('camp-9')).toMatchObject({
      serviceToken: 'dm-token',
      playerToken: 'player-token',
    })
  })

  it('keeps the row when the game server is down, and says re-running is the retry', async () => {
    const { deps } = seededDeps({
      goblin: {
        ...stubGoblin(),
        mintServiceToken: () => Promise.reject(new Error('ECONNREFUSED')),
      },
    })
    await expect(
      registry.campaign.execute(chatInteraction({ subcommand: 'setup', strings: setupOptions }) as never, deps),
    ).rejects.toThrowError(/campaign setup.*again/i)

    // Saved anyway: the mint is the retryable half, and losing the mapping would make the
    // retry harder rather than safer.
    expect(deps.campaigns.byId('camp-9')).toMatchObject({ name: 'New Keep', serviceToken: null })
  })
})

describe('/session — scene autocomplete', () => {
  it('offers the game server\'s scenes by name and answers with their ids', async () => {
    const { deps } = seededDeps({
      goblin: {
        ...stubGoblin(),
        getScenes: async () => [
          { id: 's1', name: 'Cragmaw Hideout', sortIndex: 0, visibleToPlayers: true, mapId: 'm1', updatedAt: 0 },
          { id: 's2', name: 'The Vault', sortIndex: 1, visibleToPlayers: true, mapId: 'm2', updatedAt: 0 },
        ],
      },
    })
    deps.campaigns.setTokens('camp-1', 'dm-token', 'player-token')
    const interaction = chatInteraction({ focused: 'vault' })
    await registry.session.autocomplete!(interaction as never, deps)
    expect(interaction.calls).toEqual([['respond', [{ name: 'The Vault', value: 's2' }]]])
  })

  it('offers nothing at all before the campaign has a token', async () => {
    const { deps } = seededDeps()
    const interaction = chatInteraction({ focused: '' })
    await registry.session.autocomplete!(interaction as never, deps)
    expect(interaction.calls).toEqual([['respond', []]])
  })
})

describe('/schedule — poll create, vote toggle/switch, close', () => {
  it('creates a poll, stamps its message ref, and posts to the player channel', async () => {
    const { deps, sent } = seededDeps()
    const interaction = chatInteraction({ strings: { option1: '2026-08-21T20:00:00Z', option2: '2026-08-22T14:00:00Z' } })
    await registry.schedule.execute(interaction as never, deps)
    expect(sent).toHaveLength(1)
    expect(sent[0].channelId).toBe('player-chan')
    expect(sent[0].spec.blocks?.[0]).toContain('<@&role-1>')
    const poll = deps.schedulePolls.byId(1)
    expect(poll).toMatchObject({ channelId: 'player-chan', messageId: 'msg-1', status: 'open' })
  })

  it('rejects an unparseable candidate date before creating anything', async () => {
    const { deps } = seededDeps()
    const interaction = chatInteraction({ strings: { option1: 'whenever', option2: '2026-08-22T14:00:00Z' } })
    await expect(registry.schedule.execute(interaction as never, deps)).rejects.toThrowError(/couldn't read/i)
    expect(deps.schedulePolls.byId(1)).toBeUndefined()
  })

  it('a member voting toggles their vote, and switching options moves it', async () => {
    const { deps } = seededDeps()
    await registry.schedule.execute(
      chatInteraction({ strings: { option1: '2026-08-21T20:00:00Z', option2: '2026-08-22T14:00:00Z' } }) as never,
      deps,
    )
    const voteId = (i: number) => parse(`schedule:vote:*:1:${i}`)!

    await registry.schedule.component!(componentInteraction('x', 'user-1', ['role-1']) as never, voteId(0), deps)
    expect(deps.schedulePolls.byId(1)!.votes).toEqual({ 'user-1': 0 })

    await registry.schedule.component!(componentInteraction('x', 'user-1', ['role-1']) as never, voteId(0), deps)
    expect(deps.schedulePolls.byId(1)!.votes).toEqual({}) // same option again = removed

    await registry.schedule.component!(componentInteraction('x', 'user-1', ['role-1']) as never, voteId(1), deps)
    expect(deps.schedulePolls.byId(1)!.votes).toEqual({ 'user-1': 1 }) // different option = switched
  })

  it('rejects a vote from someone with no campaign role', async () => {
    const { deps } = seededDeps()
    await registry.schedule.execute(
      chatInteraction({ strings: { option1: '2026-08-21T20:00:00Z', option2: '2026-08-22T14:00:00Z' } }) as never,
      deps,
    )
    const voteId = parse('schedule:vote:*:1:0')!
    await expect(
      registry.schedule.component!(componentInteraction('x', 'outsider', []) as never, voteId, deps),
    ).rejects.toThrowError(/not in this campaign/)
  })

  it('close picks the winner, writes it to the campaign row, and announces the result', async () => {
    const { deps, sent } = seededDeps()
    await registry.schedule.execute(
      chatInteraction({ strings: { option1: '2026-08-21T20:00:00Z', option2: '2026-08-22T14:00:00Z' } }) as never,
      deps,
    )
    const vote0 = parse('schedule:vote:*:1:0')!
    await registry.schedule.component!(componentInteraction('x', 'user-1', ['role-1']) as never, vote0, deps)
    await registry.schedule.component!(componentInteraction('x', 'user-2', ['role-1']) as never, vote0, deps)

    const closeId = parse('schedule:close:dm-1:1')!
    await registry.schedule.component!(componentInteraction('x', 'dm-1', []) as never, closeId, deps)

    const poll = deps.schedulePolls.byId(1)!
    expect(poll.status).toBe('closed')
    expect(deps.campaigns.byId('camp-1')!.nextSessionAt).toBe(Date.parse('2026-08-21T20:00:00Z'))
    expect(sent.at(-1)!.spec.blocks?.[0]).toContain('2026-08-21T20:00:00Z')
  })

  it('rejects closing from anyone but the DM, even with a forged owner-stamp bypass', async () => {
    const { deps } = seededDeps()
    await registry.schedule.execute(
      chatInteraction({ strings: { option1: '2026-08-21T20:00:00Z', option2: '2026-08-22T14:00:00Z' } }) as never,
      deps,
    )
    const closeId = parse('schedule:close:dm-1:1')!
    await expect(
      registry.schedule.component!(componentInteraction('x', 'user-1', []) as never, closeId, deps),
    ).rejects.toThrowError(/DM/)
    expect(deps.schedulePolls.byId(1)!.status).toBe('open')
  })
})

describe('/lfg + /apply — open, close, apply flow, autocomplete', () => {
  it('open posts to the LFG channel and records the post', async () => {
    const { deps, sent } = seededDeps()
    await registry.lfg.execute(chatInteraction({ subcommand: 'open', strings: { blurb: 'Need a rogue' } }) as never, deps)
    expect(sent).toHaveLength(1)
    expect(sent[0].channelId).toBe('lfg-chan')
    expect(deps.lfgPosts.openForCampaign('camp-1')).toMatchObject({ blurb: 'Need a rogue' })
  })

  it('autocomplete only offers campaigns with an open post', async () => {
    const { deps } = seededDeps()
    const interaction = chatInteraction({ focused: '' })
    await registry.apply.autocomplete!(interaction as never, deps)
    expect(interaction.respond).toHaveBeenCalledWith([])

    await registry.lfg.execute(chatInteraction({ subcommand: 'open', strings: { blurb: 'Need a rogue' } }) as never, deps)
    await registry.apply.autocomplete!(interaction as never, deps)
    expect(interaction.respond).toHaveBeenLastCalledWith([{ name: 'The Sunken Keep', value: 'camp-1' }])
  })

  it('/apply and the board button both deliver to the DM channel and confirm the applicant', async () => {
    const { deps, sent } = seededDeps()
    await registry.lfg.execute(chatInteraction({ subcommand: 'open', strings: { blurb: 'Need a rogue' } }) as never, deps)

    const applyInteraction = chatInteraction({ userId: 'applicant-1', strings: { campaign: 'camp-1', message: 'Pick me' } })
    await registry.apply.execute(applyInteraction as never, deps)
    expect(sent.at(-1)!.channelId).toBe('dm-chan')
    expect(sent.at(-1)!.spec.blocks?.join('\n')).toContain('Pick me')
    expect(applyInteraction.calls[0]).toEqual(['edit', "Application sent to **The Sunken Keep**'s DM."])

    const buttonId = parse('apply:apply:*:camp-1')!
    const button = componentInteraction('x', 'applicant-2')
    await registry.apply.component!(button as never, buttonId, deps)
    expect(button.calls[0]).toEqual([
      'reply',
      { content: "Application sent to **The Sunken Keep**'s DM.", flags: expect.anything() },
    ])
  })

  it('closing takes the campaign off the board and further applications are refused', async () => {
    const { deps, sent } = seededDeps()
    await registry.lfg.execute(chatInteraction({ subcommand: 'open', strings: { blurb: 'Need a rogue' } }) as never, deps)
    await registry.lfg.execute(chatInteraction({ subcommand: 'close' }) as never, deps)
    expect(deps.lfgPosts.openForCampaign('camp-1')).toBeUndefined()
    expect(sent.at(-1)!.channelId).toBe('lfg-chan')

    const applyInteraction = chatInteraction({ strings: { campaign: 'camp-1', message: null } })
    await expect(registry.apply.execute(applyInteraction as never, deps)).rejects.toThrowError(/recruiting/)
  })
})

describe('/feedback — anonymous by schema, not just by display', () => {
  it('stores no author at all and thanks the sender', async () => {
    const { deps, sent } = seededDeps()
    const interaction = chatInteraction({ strings: { text: 'Loved the ambush, dragged in act 2' } })
    await registry.feedback.execute(interaction as never, deps)

    const columns = (deps.db.prepare('PRAGMA table_info(feedback)').all() as { name: string }[]).map((c) => c.name)
    expect(columns).not.toContain('discord_id')
    const rows = deps.db.prepare('SELECT * FROM feedback').all() as { text: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].text).toBe('Loved the ambush, dragged in act 2')

    expect(sent.at(-1)!.channelId).toBe('dm-chan')
    expect(interaction.calls[0]).toEqual(['edit', 'Thanks — sent anonymously to the DM.'])
  })
})

// â”€â”€ M6: the map pipeline â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** A campaign with both seats, and a table the observer may or may not be watching. */
function mapDeps(over: { liveScene?: string | null; tokens?: MapToken[]; maps?: Record<string, unknown> } = {}) {
  const asked: { token: string; sceneId: string }[] = []
  const { deps, sent } = seededDeps({
    goblin: {
      ...stubGoblin(),
      getMap: async (token, sceneId) => {
        asked.push({ token, sceneId })
        return over.maps?.[sceneId] ?? playerMap
      },
    },
    sessionRunner: {
      ...stubRunner(),
      liveState: () =>
        over.liveScene === undefined ? undefined : { sceneId: over.liveScene, tokens: over.tokens ?? [] },
    },
  })
  deps.campaigns.setTokens('camp-1', 'dm-token', 'player-token')
  return { deps, sent, asked }
}

describe('/map â€” channel-switched authorize', () => {
  it('is the DM view only in the DM channel, and member-level everywhere else in the campaign', () => {
    const authorize = registry.map.authorize
    // The DM in their own channel: allowed without the campaign role â€” the DB is the authority.
    expect(() => authorize(ctx({ channelId: 'dm-chan', userId: 'dm-1' }), registered)).not.toThrow()
    // The DM channel does not make anyone else a DM; they are a member, and need the role.
    expect(() => authorize(ctx({ channelId: 'dm-chan', userId: 'user-1' }), registered)).toThrowError(
      /not in this campaign/,
    )
    expect(() =>
      authorize(ctx({ channelId: 'dm-chan', userId: 'user-1', roleIds: ['role-1'] }), registered),
    ).not.toThrow()
    // Player channel: the role is the whole test, DM or not.
    expect(() => authorize(ctx({ roleIds: ['role-1'] }), registered)).not.toThrow()
    expect(() => authorize(ctx({ roleIds: [] }), registered)).toThrowError(/not in this campaign/)
    // Outside the campaign nothing resolves, and it says so before looking at the user.
    expect(() => authorize(ctx({ channelId: 'random', userId: 'dm-1' }), registered)).toThrowError(
      /campaign channel/,
    )
  })
})

describe('/map â€” which seat renders, and where the picture lands', () => {
  it('uses the player seat and posts in the invoking channel', async () => {
    const { deps, sent, asked } = mapDeps({ liveScene: 'scene-1' })
    await registry.map.execute(chatInteraction({}) as never, deps)

    expect(asked).toEqual([{ token: 'player-token', sceneId: 'scene-1' }])
    expect(sent).toHaveLength(1)
    expect(sent[0].channelId).toBe('player-chan')
    expect(sent[0].spec.header).toContain('Party map')
    expect(sent[0].spec.media).toEqual(['attachment://map.png'])
    expect(sent[0].files?.[0].name).toBe('map.png')
    expect(sent[0].files?.[0].data.length).toBeGreaterThan(1000)
  })

  it('uses the DM seat in the DM channel, and posts there and nowhere else', async () => {
    const { deps, sent, asked } = mapDeps({ liveScene: 'scene-1', maps: { 'scene-1': dmMap } })
    await registry.map.execute(chatInteraction({ channelId: 'dm-chan', userId: 'dm-1' }) as never, deps)
    expect(asked).toEqual([{ token: 'dm-token', sceneId: 'scene-1' }])
    expect(sent[0].channelId).toBe('dm-chan')
    expect(sent[0].spec.header).toContain('DM map')
  })

  it('refuses a campaign registered before the seats existed', async () => {
    const { deps } = mapDeps({ liveScene: 'scene-1' })
    deps.campaigns.setTokens('camp-1', 'dm-token', null)
    await expect(registry.map.execute(chatInteraction({}) as never, deps)).rejects.toThrowError(/campaign setup/)
  })
})

describe('/map â€” scene resolution', () => {
  it('prefers the option over the live scene', async () => {
    const { deps, asked } = mapDeps({ liveScene: 'scene-1' })
    await registry.map.execute(chatInteraction({ strings: { scene: 'scene-9' } }) as never, deps)
    expect(asked[0].sceneId).toBe('scene-9')
  })

  it('says so plainly when there is neither an option nor a live scene', async () => {
    const { deps: noSession } = mapDeps()
    await expect(registry.map.execute(chatInteraction({}) as never, noSession)).rejects.toThrowError(
      /no current scene/i,
    )
    const { deps: idle } = mapDeps({ liveScene: null })
    await expect(registry.map.execute(chatInteraction({}) as never, idle)).rejects.toThrowError(/no current scene/i)
  })

  it('overlays tokens only for the scene the observer is actually watching', async () => {
    const size = async (sceneOption: string | null): Promise<number> => {
      const { deps, sent } = mapDeps({
        liveScene: 'scene-1',
        tokens: [{ id: 't', name: 'Zed', x: 3, y: 3, cells: 1, disposition: 'friendly', hidden: false }],
        maps: { 'scene-1': playerMap, 'scene-2': playerMap },
      })
      await registry.map.execute(chatInteraction({ strings: { scene: sceneOption } }) as never, deps)
      return sent[0].files![0].data.length
    }
    // Same document either way, so the token dot is the only thing that can differ.
    expect(await size(null)).toBeGreaterThan(await size('scene-2'))
  })
})

describe('/handout â€” the DM pushes to the player channel', () => {
  it('needs something to send', async () => {
    const { deps, sent } = seededDeps()
    await expect(
      registry.handout.execute(chatInteraction({ channelId: 'dm-chan', userId: 'dm-1' }) as never, deps),
    ).rejects.toThrowError(/something to hand out/i)
    expect(sent).toHaveLength(0)
  })

  it('reposts a game-server asset as a real attachment, fetched with the DM seat', async () => {
    const asked: string[] = []
    const { deps, sent } = seededDeps({
      goblin: {
        ...stubGoblin(),
        getAsset: async (token, assetId) => {
          asked.push(`${token}/${assetId}`)
          return { bytes: Buffer.from('fake-png-bytes'), mime: 'image/png' }
        },
      },
    })
    deps.campaigns.setTokens('camp-1', 'dm-token', 'player-token')
    const interaction = chatInteraction({
      channelId: 'dm-chan',
      userId: 'dm-1',
      strings: { asset: 'asset-7', note: 'The map you found.' },
    })
    await registry.handout.execute(interaction as never, deps)

    expect(asked).toEqual(['dm-token/asset-7'])
    // Always the player channel, never the channel it was typed in (plan Â§6).
    expect(sent[0].channelId).toBe('player-chan')
    expect(sent[0].files).toEqual([{ name: 'asset-7.png', data: Buffer.from('fake-png-bytes') }])
    expect(sent[0].spec.media).toEqual(['attachment://asset-7.png'])
    expect(sent[0].spec.blocks?.join('\n')).toContain('The map you found.')
    expect(interaction.calls[0]).toEqual(['edit', "Handout posted to The Sunken Keep's player channel."])
  })

  it('sends a note on its own with nothing attached', async () => {
    const { deps, sent } = seededDeps()
    await registry.handout.execute(
      chatInteraction({ channelId: 'dm-chan', userId: 'dm-1', strings: { note: 'Rest up.' } }) as never,
      deps,
    )
    expect(sent[0].files).toEqual([])
    expect(sent[0].spec.media).toBeUndefined()
  })
})

// ── portrait persistence (create/update download+save, legacy fallback, replacement cleanup) ──

function mockImageFetch(bytes: Buffer, contentType = 'image/png'): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: true,
    headers: new Headers({ 'content-type': contentType }),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as Response)
}

const portraitAttachment = (url: string, contentType: string) => ({
  portrait: { url, name: url.split('/').pop()!, contentType },
})

// 1x1 transparent PNG — real bytes, since a rendered card's satori pass actually decodes them.
const FIXTURE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

describe('/character create|update — portrait persistence', () => {
  afterEach(() => vi.restoreAllMocks())

  it('downloads and saves the attachment under BOT_DATA, storing the relative path', async () => {
    const { deps } = seededDeps()
    mockImageFetch(Buffer.from([1, 2, 3]))
    await registry.character.execute(
      chatInteraction({
        subcommand: 'create',
        strings: { name: 'Thalor', class: 'Ranger' },
        integers: { level: 1 },
        attachments: portraitAttachment('https://cdn.discordapp.com/att/1.png', 'image/png'),
      }) as never,
      deps,
    )

    const saved = deps.characters.byCampaignAndName('camp-1', 'Thalor')!
    expect(saved.portraitUrl).toBe(`portraits/${saved.id}.png`)
    expect(readFileSync(join(deps.botData, saved.portraitUrl!))).toEqual(Buffer.from([1, 2, 3]))
  })

  it('rejects a non-image attachment before the character row is created', async () => {
    const { deps } = seededDeps()
    mockImageFetch(Buffer.from([1, 2, 3, 4]), 'application/pdf')
    await expect(
      registry.character.execute(
        chatInteraction({
          subcommand: 'create',
          strings: { name: 'Thalor', class: 'Ranger' },
          integers: { level: 1 },
          attachments: portraitAttachment('https://cdn.discordapp.com/att/1.pdf', 'application/pdf'),
        }) as never,
        deps,
      ),
    ).rejects.toThrow(/image file/)
    expect(deps.characters.byCampaignAndName('camp-1', 'Thalor')).toBeUndefined()
  })

  it('leaves the row unchanged when an update portrait download fails', async () => {
    const { deps } = seededDeps()
    await registry.character.execute(
      chatInteraction({
        subcommand: 'create',
        strings: { name: 'Thalor', class: 'Ranger' },
        integers: { level: 1 },
      }) as never,
      deps,
    )
    const before = deps.characters.byCampaignAndName('camp-1', 'Thalor')!

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false } as Response)
    await expect(
      registry.character.execute(
        chatInteraction({
          subcommand: 'update',
          strings: { name: 'Thalor' },
          attachments: portraitAttachment('https://cdn.discordapp.com/att/bad.png', 'image/png'),
        }) as never,
        deps,
      ),
    ).rejects.toThrow(/download/)
    expect(deps.characters.byCampaignAndName('camp-1', 'Thalor')).toEqual(before)
  })

  it('deletes the old file on a replacement with a different extension', async () => {
    const { deps } = seededDeps()
    mockImageFetch(Buffer.from([1]), 'image/png')
    await registry.character.execute(
      chatInteraction({
        subcommand: 'create',
        strings: { name: 'Thalor', class: 'Ranger' },
        integers: { level: 1 },
        attachments: portraitAttachment('https://cdn.discordapp.com/1.png', 'image/png'),
      }) as never,
      deps,
    )
    const created = deps.characters.byCampaignAndName('camp-1', 'Thalor')!
    const oldPath = join(deps.botData, created.portraitUrl!)
    expect(existsSync(oldPath)).toBe(true)

    mockImageFetch(Buffer.from([2]), 'image/jpeg')
    await registry.character.execute(
      chatInteraction({
        subcommand: 'update',
        strings: { name: 'Thalor' },
        attachments: portraitAttachment('https://cdn.discordapp.com/2.jpg', 'image/jpeg'),
      }) as never,
      deps,
    )

    const updated = deps.characters.byCampaignAndName('camp-1', 'Thalor')!
    expect(updated.portraitUrl).toBe(`portraits/${created.id}.jpg`)
    expect(existsSync(oldPath)).toBe(false)
    expect(existsSync(join(deps.botData, updated.portraitUrl!))).toBe(true)
  })

  it('overwrites in place (no delete) on a same-extension replacement', async () => {
    const { deps } = seededDeps()
    mockImageFetch(Buffer.from([1]), 'image/png')
    await registry.character.execute(
      chatInteraction({
        subcommand: 'create',
        strings: { name: 'Thalor', class: 'Ranger' },
        integers: { level: 1 },
        attachments: portraitAttachment('https://cdn.discordapp.com/1.png', 'image/png'),
      }) as never,
      deps,
    )
    const created = deps.characters.byCampaignAndName('camp-1', 'Thalor')!

    mockImageFetch(Buffer.from([2]), 'image/png')
    await registry.character.execute(
      chatInteraction({
        subcommand: 'update',
        strings: { name: 'Thalor' },
        attachments: portraitAttachment('https://cdn.discordapp.com/2.png', 'image/png'),
      }) as never,
      deps,
    )

    const updated = deps.characters.byCampaignAndName('camp-1', 'Thalor')!
    expect(updated.portraitUrl).toBe(created.portraitUrl)
    expect(readFileSync(join(deps.botData, updated.portraitUrl!))).toEqual(Buffer.from([2]))
  })

  it('/character show still fetches a legacy http(s) portrait_url', async () => {
    const { deps } = seededDeps()
    deps.characters.create({
      discordId: 'user-1',
      campaignId: 'camp-1',
      name: 'Legacy',
      className: 'Bard',
      level: 1,
      portraitUrl: 'https://cdn.discordapp.com/legacy.png',
    })
    const pngBytes = Buffer.from(FIXTURE_PNG_BASE64, 'base64')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'image/png' }),
      arrayBuffer: async () => pngBytes.buffer.slice(pngBytes.byteOffset, pngBytes.byteOffset + pngBytes.byteLength),
    } as Response)

    await registry.character.execute(chatInteraction({ subcommand: 'show', strings: { name: 'Legacy' } }) as never, deps)
    expect(fetchSpy).toHaveBeenCalledWith('https://cdn.discordapp.com/legacy.png', expect.anything())
  })
})

// ── last_played stamping ────────────────────────────────────────────────────────────────────

describe('/roll — stamps last_played on the attributed character', () => {
  it("stamps the roller's own single character", async () => {
    const { deps } = seededDeps()
    const zed = deps.characters.create({ discordId: 'user-1', campaignId: 'camp-1', name: 'Zed', className: 'Fighter', level: 1 })
    expect(zed.lastPlayed).toBeNull()

    await registry.roll.execute(chatInteraction({ strings: { expr: '1d20' } }) as never, deps)

    expect(deps.characters.byId(zed.id)?.lastPlayed).not.toBeNull()
  })

  it('stamps nothing when no character can be resolved for the roller', async () => {
    const { deps } = seededDeps()
    const zed = deps.characters.create({ discordId: 'user-2', campaignId: 'camp-1', name: 'Zed', className: 'Fighter', level: 1 })
    await registry.roll.execute(chatInteraction({ strings: { expr: '1d20' } }) as never, deps) // user-1 owns none here
    expect(deps.characters.byId(zed.id)?.lastPlayed).toBeNull()
  })
})

// ── the table bridge: /roll forwarding and /initiative ──────────────────────────────────────

interface TableCall {
  campaignId: string
  module: string
  action: string
  payload: unknown
}

/** Deps whose runner is watching a table: `sent` is what the bot ran on it. */
function tableDeps(over: { entries?: WireInitiativeEntry[]; reachable?: boolean } = {}) {
  const sentToTable: TableCall[] = []
  const { deps } = seededDeps({
    sessionRunner: {
      ...stubRunner(),
      encounter: () => (over.entries ? { status: 'gathering', entries: over.entries } : undefined),
      command: (campaignId, module, action, payload) => {
        sentToTable.push({ campaignId, module, action, payload })
        return over.reachable ?? true
      },
    },
  })
  return { deps, sentToTable }
}

const entry = (key: string, name: string): WireInitiativeEntry => ({ key, name, initiative: null })

describe('/roll — mirrored onto the table', () => {
  it("forwards the roll as the character, tagged as Discord's", async () => {
    const { deps, sentToTable } = tableDeps()
    deps.characters.create({ discordId: 'user-1', campaignId: 'camp-1', name: 'Zed', className: 'Fighter', level: 1 })

    await registry.roll.execute(chatInteraction({ strings: { expr: '2d6+3' } }) as never, deps)

    expect(sentToTable).toHaveLength(1)
    expect(sentToTable[0]).toMatchObject({ campaignId: 'camp-1', module: 'rolls', action: 'post' })
    expect(sentToTable[0].payload).toMatchObject({
      source: 'discord',
      characterName: 'Zed',
      formula: '2d6+3',
      visibility: 'public',
    })
  })

  it('still rolls dice when no table is listening', async () => {
    const { deps } = seededDeps() // stubRunner's command answers false
    const interaction = chatInteraction({ strings: { expr: '1d20' } })
    await expect(registry.roll.execute(interaction as never, deps)).resolves.toBeUndefined()
    expect(interaction.calls).toHaveLength(1)
  })
})

describe('/initiative — a Discord roll into the live encounter', () => {
  it("matches the roller's one character by name and sets its key", async () => {
    const { deps, sentToTable } = tableDeps({ entries: [entry('e1', 'Goblin'), entry('e2', 'Zed')] })
    deps.characters.create({ discordId: 'user-1', campaignId: 'camp-1', name: 'Zed', className: 'Fighter', level: 1 })

    const interaction = chatInteraction({ integers: { value: 17 } })
    await registry.initiative.execute(interaction as never, deps)

    expect(sentToTable).toEqual([
      { campaignId: 'camp-1', module: 'initiative', action: 'set', payload: { key: 'e2', value: 17 } },
    ])
    expect(String(interaction.calls[0][1])).toContain('Zed')
  })

  it('takes the character option when the member owns several', async () => {
    const { deps, sentToTable } = tableDeps({ entries: [entry('e1', 'Marra')] })
    deps.characters.create({ discordId: 'user-1', campaignId: 'camp-1', name: 'Zed', className: 'Fighter', level: 1 })
    deps.characters.create({ discordId: 'user-1', campaignId: 'camp-1', name: 'Marra', className: 'Cleric', level: 1 })

    await registry.initiative.execute(
      chatInteraction({ integers: { value: 8 }, strings: { character: 'Marra' } }) as never,
      deps,
    )
    expect(sentToTable[0].payload).toEqual({ key: 'e1', value: 8 })
  })

  it('names the actual problem rather than failing generically', async () => {
    const noFight = tableDeps()
    noFight.deps.characters.create({ discordId: 'user-1', campaignId: 'camp-1', name: 'Zed', className: 'Fighter', level: 1 })
    await expect(
      registry.initiative.execute(chatInteraction({ integers: { value: 17 } }) as never, noFight.deps),
    ).rejects.toThrowError(/no encounter running/i)

    const ambiguous = tableDeps({ entries: [entry('e1', 'Zed')] })
    ambiguous.deps.characters.create({ discordId: 'user-1', campaignId: 'camp-1', name: 'Zed', className: 'Fighter', level: 1 })
    ambiguous.deps.characters.create({ discordId: 'user-1', campaignId: 'camp-1', name: 'Marra', className: 'Cleric', level: 1 })
    await expect(
      registry.initiative.execute(chatInteraction({ integers: { value: 17 } }) as never, ambiguous.deps),
    ).rejects.toThrowError(/character:/)

    const bystander = tableDeps({ entries: [entry('e1', 'Goblin')] })
    bystander.deps.characters.create({ discordId: 'user-1', campaignId: 'camp-1', name: 'Zed', className: 'Fighter', level: 1 })
    await expect(
      registry.initiative.execute(chatInteraction({ integers: { value: 17 } }) as never, bystander.deps),
    ).rejects.toThrowError(/isn't in this encounter/)

    const noCharacter = tableDeps({ entries: [entry('e1', 'Goblin')] })
    await expect(
      registry.initiative.execute(chatInteraction({ integers: { value: 17 } }) as never, noCharacter.deps),
    ).rejects.toThrowError(/character create/)
  })

  it('admits the number never landed when the seat is gone', async () => {
    const { deps } = tableDeps({ entries: [entry('e1', 'Zed')], reachable: false })
    deps.characters.create({ discordId: 'user-1', campaignId: 'camp-1', name: 'Zed', className: 'Fighter', level: 1 })
    await expect(
      registry.initiative.execute(chatInteraction({ integers: { value: 17 } }) as never, deps),
    ).rejects.toThrowError(/couldn't reach the table/)
  })
})
