import { describe, expect, it, vi } from 'vitest'
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
import { parse } from '../lib/custom-id'
import type { ContainerSpec } from '../lib/ui'

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

function seededDeps(over: Partial<Deps> = {}): { deps: Deps; sent: { channelId: string; spec: ContainerSpec }[] } {
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
  const sent: { channelId: string; spec: ContainerSpec }[] = []
  const deps: Deps = {
    ownerId: 'owner-1',
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
    announce: async (channelId, spec) => {
      sent.push({ channelId, spec })
      return { messageId: `msg-${sent.length}` }
    },
    edit: async () => {},
    ...over,
  }
  return { deps, sent }
}

function chatInteraction(over: {
  channelId?: string
  userId?: string
  subcommand?: string
  strings?: Record<string, string | null>
  focused?: string
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
      getFocused: () => over.focused ?? '',
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
