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
import { cardText } from '../lib/card'
import { ButtonStyle, Collection, ComponentType, MessageFlags } from 'discord.js'
import { payloadText } from '../lib/ui'

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
    all: () => [],
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
  saveStats: unused,
  stats: () => ({ played: 0, lastStartedAt: null }),
})
const stubGoblin = (): Deps['goblin'] => ({
  mintServiceToken: unused,
  getScenes: unused,
  openSession: unused,
  endSession: unused,
  getMap: unused,
  getAsset: unused,
  ping: unused,
  baseUrl: 'http://goblin.test',
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
  health: () => [],
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
    expect(() => authorize(ctx({ subcommand: 'settings', userId: 'owner-1' }), registered)).not.toThrow()
    expect(() => authorize(ctx({ subcommand: 'settings', userId: 'user-1' }), registered)).toThrowError(/bot operator/)
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

/** A seat shaped the way the game server signs one: base64url claims, then a signature. The
 * label stands in for the HMAC, which nothing in the bot ever checks. */
const seat = (label: string, expiresInMs = 7 * 24 * 60 * 60 * 1000): string =>
  `${Buffer.from(JSON.stringify({ exp: Date.now() + expiresInMs })).toString('base64url')}.${label}`

const DM_SEAT = seat('dm')
const PLAYER_SEAT = seat('player')
/** What a re-mint hands back, so a test can tell the new seat from the one it replaced. */
const FRESH_DM_SEAT = seat('fresh-dm')
const FRESH_PLAYER_SEAT = seat('fresh-player')

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
    user: { id: over.userId ?? 'user-1', username: 'goblin', displayAvatarURL: () => 'https://cdn.example/avatar.png' },
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
    showModal: vi.fn(async (built: { toJSON: () => unknown }) => void calls.push(['modal', built.toJSON()])),
    guildId: 'guild-1',
  }
}

/** One picked id, shaped the way a modal's channel/user/role getter answers. */
const picked = (id?: string) => (id ? new Collection<string, { id: string }>([[id, { id }]]) : null)

/** A modal submit as the registry reads one: every field by its id, and whatever the upload
 * field carries. `values` covers text inputs and pickers alike — one is a typed string, the
 * other the id that was chosen. */
function modalInteraction(over: {
  channelId?: string
  userId?: string
  values?: Record<string, string>
  uploads?: FakeAttachment[]
}) {
  const calls: unknown[][] = []
  const value = (id: string): string => over.values?.[id] ?? ''
  return {
    calls,
    channelId: over.channelId ?? 'player-chan',
    guildId: 'guild-1',
    user: { id: over.userId ?? 'user-1', username: 'goblin', displayAvatarURL: () => 'https://cdn.example/avatar.png' },
    fields: {
      getTextInputValue: value,
      getStringSelectValues: (id: string) => (value(id) ? [value(id)] : []),
      getRadioGroup: (id: string) => value(id) || null,
      // A checkbox group answers with the ticked labels; the seam joins them into a comma list.
      getCheckboxGroup: (id: string) => (value(id) ? value(id).split(',') : []),
      getCheckbox: (id: string) => value(id) === 'true',
      getSelectedChannels: (id: string) => picked(over.values?.[id]),
      getSelectedUsers: (id: string) => picked(over.values?.[id]),
      getSelectedRoles: (id: string) => picked(over.values?.[id]),
      getUploadedFiles: () =>
        over.uploads?.length ? new Collection(over.uploads.map((file, i) => [String(i), file] as const)) : null,
    },
    editReply: vi.fn(async (payload: unknown) => void calls.push(['edit', payload])),
  }
}

/** The parsed custom id the router hands a modal handler. */
const modalId = (action: string, ...extra: string[]) => ({
  namespace: 'x',
  action,
  userId: 'user-1',
  extra,
})

/** `picks` is what a string select carried — given, the fake answers isStringSelectMenu. */
function componentInteraction(customId: string, userId: string, roleIds: string[] = [], picks?: string[]) {
  const calls: unknown[][] = []
  return {
    calls,
    customId,
    channelId: 'player-chan',
    user: {
      id: userId,
      username: 'goblin',
      displayName: 'Goblin',
      displayAvatarURL: () => 'https://cdn.example/avatar.png',
    },
    member: { roles: roleIds },
    values: picks ?? [],
    isStringSelectMenu: () => picks !== undefined,
    reply: vi.fn(async (payload: unknown) => void calls.push(['reply', payload])),
    update: vi.fn(async (payload: unknown) => void calls.push(['update', payload])),
    showModal: vi.fn(async (built: { toJSON: () => unknown }) => void calls.push(['modal', built.toJSON()])),
  }
}

// ── M5: /campaign setup mints the bot's two game-server seats ─────────────────────────────

const setupValues = {
  id: 'camp-9',
  name: 'New Keep',
  channel: 'chan-9',
  dmChannel: 'dmchan-9',
  dm: 'dmuser-9',
}

const submitCampaign = (action: string, values: Record<string, string>, deps: Deps, channelId?: string) =>
  registry.campaign.modal!(modalInteraction({ values, channelId }) as never, modalId(action) as never, deps)

describe('/campaign setup — the form, and the service token mint', () => {
  it('opens a form instead of taking options, and never defers first', async () => {
    const { deps } = seededDeps()
    const interaction = chatInteraction({ subcommand: 'setup' })
    expect(registry.campaign.opensModal!(interaction as never)).toBe(true)
    await registry.campaign.execute(interaction as never, deps)
    expect(interaction.showModal).toHaveBeenCalledOnce()
    expect(parse(String((interaction.calls[0][1] as { custom_id: string }).custom_id))).toMatchObject({
      namespace: 'campaign',
      action: 'setup',
      userId: 'user-1',
    })
  })

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
    await submitCampaign('setup', setupValues, deps)

    expect(asked.sort()).toEqual(['dm', 'player'])
    expect(deps.campaigns.byId('camp-9')).toMatchObject({
      channelId: 'chan-9',
      dmChannelId: 'dmchan-9',
      dmDiscordId: 'dmuser-9',
      serviceToken: 'dm-token',
      playerToken: 'player-token',
    })
  })

  it('starts a new campaign on @everyone, and keeps the role a re-run already set', async () => {
    const { deps } = seededDeps({ goblin: { ...stubGoblin(), mintServiceToken: async () => ({ token: 't', campaignId: 'c', role: 'dm', name: 'Bot' }) } })
    await submitCampaign('setup', setupValues, deps)
    // The guild id *is* the @everyone role id — open to the server until settings narrows it.
    expect(deps.campaigns.byId('camp-9')?.roleId).toBe('guild-1')

    await submitCampaign('settings', { role: 'role-9', dndbeyond: '' }, deps, 'chan-9')
    await submitCampaign('setup', { ...setupValues, name: 'Newer Keep' }, deps)
    expect(deps.campaigns.byId('camp-9')).toMatchObject({ name: 'Newer Keep', roleId: 'role-9' })
  })

  it('refuses a campaign id that could never be one, before anything is written', async () => {
    const { deps } = seededDeps()
    await expect(submitCampaign('setup', { ...setupValues, id: 'not an id' }, deps)).rejects.toThrowError(
      /isn't a game-server campaign id/,
    )
    expect(deps.campaigns.byId('not an id')).toBeUndefined()
  })

  it('keeps the row when the game server is down, and says re-running is the retry', async () => {
    const { deps } = seededDeps({
      goblin: {
        ...stubGoblin(),
        mintServiceToken: () => Promise.reject(new Error('ECONNREFUSED')),
      },
    })
    await expect(submitCampaign('setup', setupValues, deps)).rejects.toThrowError(/campaign setup.*again/i)

    // Saved anyway: the mint is the retryable half, and losing the mapping would make the
    // retry harder rather than safer.
    expect(deps.campaigns.byId('camp-9')).toMatchObject({ name: 'New Keep', serviceToken: null })
  })
})

describe('/campaign settings — the two setup had to leave behind', () => {
  it('sets the role and the D&D Beyond link, and a blank link keeps the stored one', async () => {
    const { deps } = seededDeps()
    await submitCampaign('settings', { role: 'role-2', dndbeyond: 'https://www.dndbeyond.com/campaigns/1' }, deps)
    expect(deps.campaigns.byId('camp-1')).toMatchObject({
      roleId: 'role-2',
      ddbUrl: 'https://www.dndbeyond.com/campaigns/1',
    })

    await submitCampaign('settings', { role: 'role-3', dndbeyond: '' }, deps)
    expect(deps.campaigns.byId('camp-1')).toMatchObject({
      roleId: 'role-3',
      ddbUrl: 'https://www.dndbeyond.com/campaigns/1',
    })
  })

  it('refuses a link that is not a D&D Beyond one, and changes nothing', async () => {
    const { deps } = seededDeps()
    await expect(
      submitCampaign('settings', { role: 'role-2', dndbeyond: 'https://evil.example/campaigns/1' }, deps),
    ).rejects.toThrowError(/dndbeyond\.com/)
    expect(deps.campaigns.byId('camp-1')).toMatchObject({ roleId: 'role-1' })
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
    deps.campaigns.setTokens('camp-1', DM_SEAT, PLAYER_SEAT)
    const interaction = chatInteraction({ focused: 'vault' })
    await registry.session.autocomplete!(interaction as never, deps)
    expect(interaction.calls).toEqual([['respond', [{ name: 'The Vault', value: 's2' }]]])
  })

  it('offers nothing at all outside a registered campaign', async () => {
    const { deps } = seededDeps()
    const interaction = chatInteraction({ focused: '', channelId: 'random-chan' })
    await registry.session.autocomplete!(interaction as never, deps)
    expect(interaction.calls).toEqual([['respond', []]])
  })

  it('mints a seat on the spot when the campaign has none, rather than going quiet', async () => {
    const minted: string[] = []
    const asked: string[] = []
    const { deps } = seededDeps({
      goblin: {
        ...mintingGoblin(minted),
        getScenes: async (token) => {
          asked.push(token)
          return [{ id: 's1', name: 'The Vault', sortIndex: 0, visibleToPlayers: true, mapId: 'm1', updatedAt: 0 }]
        },
      },
    })
    const interaction = chatInteraction({ focused: '' })
    await registry.session.autocomplete!(interaction as never, deps)

    expect(minted.sort()).toEqual(['dm', 'player'])
    expect(asked).toEqual([FRESH_DM_SEAT])
    expect(interaction.calls).toEqual([['respond', [{ name: 'The Vault', value: 's1' }]]])
  })
})

describe('/schedule — poll create, vote toggle/switch, close', () => {
  it('creates a poll, stamps its message ref, and posts to the player channel', async () => {
    const { deps, sent } = seededDeps()
    const interaction = chatInteraction({ strings: { option1: '2026-08-21T20:00:00Z', option2: '2026-08-22T14:00:00Z' } })
    await registry.schedule.execute(interaction as never, deps)
    expect(sent).toHaveLength(1)
    expect(sent[0].channelId).toBe('player-chan')
    expect(cardText(sent[0].spec)).toContain('<@&role-1>')
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
    // Rendered as Discord's own stamp, so each voter reads the winning slot in their zone.
    expect(cardText(sent.at(-1)!.spec)).toContain(`<t:${Math.floor(Date.parse('2026-08-21T20:00:00Z') / 1000)}:F>`)
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

const OPEN_VALUES = { blurb: 'Need a rogue', seats: '3', tags: 'Voice,Weekly' }
const APPLY_VALUES = { pitch: 'Pick me', experience: 'Veteran', availability: 'Weeknights after 8' }

const openRecruiting = (deps: Deps, values: Record<string, string> = OPEN_VALUES) =>
  registry.recruit.modal!(modalInteraction({ userId: 'dm-1', values }) as never, modalId('open') as never, deps)

const submitApply = (deps: Deps, campaignId: string, userId: string, values = APPLY_VALUES) =>
  registry.apply.modal!(modalInteraction({ userId, values }) as never, modalId('submit', campaignId) as never, deps)

describe('/recruit + /apply — open, close, apply flow, autocomplete', () => {
  it('open posts to the recruiting board and records the seats and tags with the post', async () => {
    const { deps, sent } = seededDeps()
    await openRecruiting(deps)
    expect(sent).toHaveLength(1)
    expect(sent[0].channelId).toBe('lfg-chan')
    expect(cardText(sent[0].spec)).toContain('**Seats open** · 3')
    expect(cardText(sent[0].spec)).toContain('-# Voice · Weekly')
    expect(deps.lfgPosts.openForCampaign('camp-1')).toMatchObject({
      blurb: 'Need a rogue',
      seats: 3,
      tags: ['Voice', 'Weekly'],
    })
  })

  it('refuses a seat count that was never on the form, and posts nothing', async () => {
    const { deps, sent } = seededDeps()
    await expect(openRecruiting(deps, { ...OPEN_VALUES, seats: '9' })).rejects.toThrowError(/1 to 6/)
    expect(sent).toHaveLength(0)
    expect(deps.lfgPosts.openForCampaign('camp-1')).toBeUndefined()
  })

  it('/recruit open opens a form rather than taking a blurb option', async () => {
    const { deps } = seededDeps()
    const interaction = chatInteraction({ subcommand: 'open', userId: 'dm-1', channelId: 'dm-chan' })
    expect(registry.recruit.opensModal!(interaction as never)).toBe(true)
    expect(registry.recruit.opensModal!(chatInteraction({ subcommand: 'close' }) as never)).toBe(false)
    await registry.recruit.execute(interaction as never, deps)
    expect(parse(String((interaction.calls[0][1] as { custom_id: string }).custom_id))).toMatchObject({
      namespace: 'recruit',
      action: 'open',
      userId: 'dm-1',
    })
  })

  it('autocomplete only offers campaigns with an open post', async () => {
    const { deps } = seededDeps()
    const interaction = chatInteraction({ focused: '' })
    await registry.apply.autocomplete!(interaction as never, deps)
    expect(interaction.respond).toHaveBeenCalledWith([])

    await openRecruiting(deps)
    await registry.apply.autocomplete!(interaction as never, deps)
    expect(interaction.respond).toHaveBeenLastCalledWith([{ name: 'The Sunken Keep', value: 'camp-1' }])
  })

  it('/apply and the board button open the same form, carrying the campaign in the custom id', async () => {
    const { deps } = seededDeps()
    const slash = chatInteraction({ userId: 'applicant-1', strings: { campaign: 'camp-1' } })
    await registry.apply.execute(slash as never, deps)
    expect(parse(String((slash.calls[0][1] as { custom_id: string }).custom_id))).toMatchObject({
      namespace: 'apply',
      action: 'submit',
      userId: 'applicant-1',
      extra: ['camp-1'],
    })

    const button = componentInteraction('x', 'applicant-2')
    await registry.apply.component!(button as never, parse('apply:apply:*:camp-1')!, deps)
    // The form is stamped to whoever pressed, not to the shared button it came from.
    expect(parse(String((button.calls[0][1] as { custom_id: string }).custom_id))).toMatchObject({
      userId: 'applicant-2',
      extra: ['camp-1'],
    })
  })

  it('the submit delivers to the DM channel with all three answers, and confirms the applicant', async () => {
    const { deps, sent } = seededDeps()
    await openRecruiting(deps)

    const submit = modalInteraction({ userId: 'applicant-1', values: APPLY_VALUES })
    await registry.apply.modal!(submit as never, modalId('submit', 'camp-1') as never, deps)

    expect(sent.at(-1)!.channelId).toBe('dm-chan')
    const text = cardText(sent.at(-1)!.spec)
    expect(text).toContain('**Experience** · Veteran')
    expect(text).toContain('**Availability** · Weeknights after 8')
    expect(text).toContain('Pick me')
    expect(payloadText(submit.calls[0][1])).toContain("Application sent to **The Sunken Keep**'s DM.")
    expect(deps.db.prepare('SELECT experience, availability FROM lfg_applications').all()).toEqual([
      { experience: 'Veteran', availability: 'Weeknights after 8' },
    ])
  })

  it('refuses an application with no availability, writing nothing', async () => {
    const { deps } = seededDeps()
    await openRecruiting(deps)
    await expect(submitApply(deps, 'camp-1', 'applicant-1', { ...APPLY_VALUES, availability: '' })).rejects.toThrowError(
      /when you can play/,
    )
    expect(deps.db.prepare('SELECT * FROM lfg_applications').all()).toEqual([])
  })

  it('closing takes the campaign off the board and further applications are refused', async () => {
    const { deps, sent } = seededDeps()
    await openRecruiting(deps)
    await registry.recruit.execute(chatInteraction({ subcommand: 'close', userId: 'dm-1' }) as never, deps)
    expect(deps.lfgPosts.openForCampaign('camp-1')).toBeUndefined()
    expect(sent.at(-1)!.channelId).toBe('lfg-chan')

    await expect(submitApply(deps, 'camp-1', 'applicant-1')).rejects.toThrowError(/recruiting/)
  })
})

describe('/feedback — anonymous by schema, not just by display', () => {
  it('stores no author at all, keeps the category, and thanks the sender', async () => {
    const { deps, sent } = seededDeps()
    const submit = modalInteraction({ values: { category: 'Praise', text: 'Loved the ambush, dragged in act 2' } })
    await registry.feedback.modal!(submit as never, modalId('send') as never, deps)

    const columns = (deps.db.prepare('PRAGMA table_info(feedback)').all() as { name: string }[]).map((c) => c.name)
    expect(columns).not.toContain('discord_id')
    const rows = deps.db.prepare('SELECT * FROM feedback').all() as { text: string; category: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ text: 'Loved the ambush, dragged in act 2', category: 'Praise' })

    expect(sent.at(-1)!.channelId).toBe('dm-chan')
    expect(sent.at(-1)!.spec.eyebrow).toBe('Anonymous feedback · The Sunken Keep · Praise')
    expect(payloadText(submit.calls[0][1])).toContain('Thanks — sent anonymously to the DM.')
  })

  it('refuses a category the form never offered, storing nothing', async () => {
    const { deps, sent } = seededDeps()
    await expect(
      registry.feedback.modal!(
        modalInteraction({ values: { category: 'Rant', text: 'grr' } }) as never,
        modalId('send') as never,
        deps,
      ),
    ).rejects.toThrowError(/Bug, Idea, Praise/)
    expect(deps.db.prepare('SELECT * FROM feedback').all()).toEqual([])
    expect(sent).toHaveLength(0)
  })
})

/** A game server that will mint on demand — what a seat refresh needs to get anywhere. */
const mintingGoblin = (minted: string[]): Deps['goblin'] => ({
  ...stubGoblin(),
  mintServiceToken: async (_pass, campaignId, role) => {
    minted.push(role)
    return {
      token: role === 'dm' ? FRESH_DM_SEAT : FRESH_PLAYER_SEAT,
      campaignId,
      role,
      name: 'Goblin Bot',
    }
  },
})

describe('/handout â€” the DM pushes to the player channel', () => {
  const submitHandout = (deps: Deps, values: Record<string, string>, uploads: FakeAttachment[] = []) =>
    registry.handout.modal!(
      modalInteraction({ channelId: 'dm-chan', userId: 'dm-1', values, uploads }) as never,
      modalId('send') as never,
      deps,
    )

  it('needs something to send', async () => {
    const { deps, sent } = seededDeps()
    await expect(submitHandout(deps, {})).rejects.toThrowError(/something to hand out/i)
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
    deps.campaigns.setTokens('camp-1', DM_SEAT, PLAYER_SEAT)
    const submit = modalInteraction({
      channelId: 'dm-chan',
      userId: 'dm-1',
      values: { asset: 'asset-7', body: 'The map you found.', title: 'The tomb' },
    })
    await registry.handout.modal!(submit as never, modalId('send') as never, deps)

    expect(asked).toEqual([`${DM_SEAT}/asset-7`])
    // Always the player channel, never the channel it was typed in (plan Â§6).
    expect(sent[0].channelId).toBe('player-chan')
    // The seal the header's thumbnail points at rides along with the asset.
    expect(sent[0].files?.[0]).toEqual({ name: 'asset-7.png', data: Buffer.from('fake-png-bytes') })
    expect(sent[0].files?.map((file) => file.name)).toEqual(['asset-7.png', 'thumb-handout.png'])
    expect(sent[0].spec.thumb).toBe('attachment://thumb-handout.png')
    expect(sent[0].spec.header).toBe('The tomb')
    expect(sent[0].spec.media).toEqual([{ url: 'attachment://asset-7.png', alt: 'Handout image 1 of 1' }])
    expect(cardText(sent[0].spec)).toContain('The map you found.')
    expect(payloadText(submit.calls[0][1])).toContain('**Handout posted** to <#player-chan>.')
  })

  it('sends a note on its own with nothing attached', async () => {
    const { deps, sent } = seededDeps()
    await submitHandout(deps, { body: 'Rest up.' })
    expect(sent[0].files?.map((file) => file.name)).toEqual(['thumb-handout.png'])
    expect(sent[0].spec.media).toBeUndefined()
    expect(sent[0].spec.header).toBe('From the DM')
  })

  it('opens a form and never defers first', async () => {
    const { deps } = seededDeps()
    const interaction = chatInteraction({ channelId: 'dm-chan', userId: 'dm-1' })
    expect(registry.handout.opensModal!(interaction as never)).toBe(true)
    await registry.handout.execute(interaction as never, deps)
    expect(parse(String((interaction.calls[0][1] as { custom_id: string }).custom_id))).toMatchObject({
      namespace: 'handout',
      action: 'send',
    })
  })

  it('takes several uploads at once, splitting images from everything else', async () => {
    const { deps, sent } = seededDeps()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(4),
    } as Response)
    await submitHandout(deps, { spoiler: 'true' }, [
      { url: 'https://cdn.example/a.png', name: 'a.png', contentType: 'image/png' },
      { url: 'https://cdn.example/b.png', name: 'b.png', contentType: 'image/png' },
      { url: 'https://cdn.example/n.pdf', name: 'notes.pdf', contentType: 'application/pdf' },
    ])
    expect(sent[0].spec.media?.map((item) => (typeof item === 'string' ? item : item.url))).toEqual([
      'attachment://a.png',
      'attachment://b.png',
    ])
    expect(sent[0].spec.blocks).toContainEqual({ file: 'attachment://notes.pdf' })
    // The tick blurs the card and each picture on it.
    expect(sent[0].spec.spoiler).toBe(true)
    expect(sent[0].spec.media?.every((item) => typeof item !== 'string' && item.spoiler)).toBe(true)
  })

  it('steps the seal aside rather than let an upload named like it take its place', async () => {
    const { deps, sent } = seededDeps()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(4),
    } as Response)
    await submitHandout(deps, {}, [
      { url: 'https://cdn.example/x.png', name: 'thumb-handout.png', contentType: 'image/png' },
    ])
    expect(sent[0].files?.map((file) => file.name)).toEqual(['thumb-handout.png', '_thumb-handout.png'])
    expect(sent[0].spec.thumb).toBe('attachment://_thumb-handout.png')
    expect(sent[0].spec.media).toEqual([{ url: 'attachment://thumb-handout.png', alt: 'Handout image 1 of 1' }])
  })

  it('renames an upload that scrubs to a name already taken, rather than showing one twice', async () => {
    const { deps, sent } = seededDeps()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(4),
    } as Response)
    await submitHandout(deps, {}, [
      { url: 'https://cdn.example/1.png', name: 'the map.png', contentType: 'image/png' },
      { url: 'https://cdn.example/2.png', name: 'the/map.png', contentType: 'image/png' },
    ])
    expect(sent[0].spec.media?.map((item) => (typeof item === 'string' ? item : item.url))).toEqual([
      'attachment://the_map.png',
      'attachment://_the_map.png',
    ])
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

/** The character form, submitted. `create` has no id; `update` carries the row's in the
 * custom id, since the name field is the new name and cannot also be the lookup. */
const submitCharacter = (
  deps: Deps,
  values: Record<string, string>,
  over: { characterId?: number; portrait?: string; contentType?: string; userId?: string } = {},
) =>
  registry.character.modal!(
    modalInteraction({
      userId: over.userId,
      values,
      uploads: over.portrait ? [portraitAttachment(over.portrait, over.contentType ?? 'image/png').portrait] : [],
    }) as never,
    modalId(over.characterId ? 'update' : 'create', ...(over.characterId ? [String(over.characterId)] : [])) as never,
    deps,
  )

const THALOR = { name: 'Thalor', class: 'Ranger', level: '1' }

// 1x1 transparent PNG — real bytes, since a rendered card's satori pass actually decodes them.
const FIXTURE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

describe('/character create|update — portrait persistence', () => {
  afterEach(() => vi.restoreAllMocks())

  it('downloads and saves the attachment under BOT_DATA, storing the relative path', async () => {
    const { deps } = seededDeps()
    mockImageFetch(Buffer.from([1, 2, 3]))
    await submitCharacter(deps, THALOR, { portrait: 'https://cdn.discordapp.com/att/1.png' })

    const saved = deps.characters.byCampaignAndName('camp-1', 'Thalor')!
    expect(saved.portraitUrl).toBe(`portraits/${saved.id}.png`)
    expect(readFileSync(join(deps.botData, saved.portraitUrl!))).toEqual(Buffer.from([1, 2, 3]))
  })

  it('rejects a non-image attachment before the character row is created', async () => {
    const { deps } = seededDeps()
    mockImageFetch(Buffer.from([1, 2, 3, 4]), 'application/pdf')
    await expect(
      submitCharacter(deps, THALOR, {
        portrait: 'https://cdn.discordapp.com/att/1.pdf',
        contentType: 'application/pdf',
      }),
    ).rejects.toThrow(/image file/)
    expect(deps.characters.byCampaignAndName('camp-1', 'Thalor')).toBeUndefined()
  })

  it('leaves the row unchanged when an update portrait download fails', async () => {
    const { deps } = seededDeps()
    await submitCharacter(deps, THALOR)
    const before = deps.characters.byCampaignAndName('camp-1', 'Thalor')!

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false } as Response)
    await expect(
      submitCharacter(deps, THALOR, { characterId: before.id, portrait: 'https://cdn.discordapp.com/att/bad.png' }),
    ).rejects.toThrow(/download/)
    expect(deps.characters.byCampaignAndName('camp-1', 'Thalor')).toEqual(before)
  })

  it('deletes the old file on a replacement with a different extension', async () => {
    const { deps } = seededDeps()
    mockImageFetch(Buffer.from([1]), 'image/png')
    await submitCharacter(deps, THALOR, { portrait: 'https://cdn.discordapp.com/1.png' })
    const created = deps.characters.byCampaignAndName('camp-1', 'Thalor')!
    const oldPath = join(deps.botData, created.portraitUrl!)
    expect(existsSync(oldPath)).toBe(true)

    mockImageFetch(Buffer.from([2]), 'image/jpeg')
    await submitCharacter(deps, THALOR, {
      characterId: created.id,
      portrait: 'https://cdn.discordapp.com/2.jpg',
      contentType: 'image/jpeg',
    })

    const updated = deps.characters.byCampaignAndName('camp-1', 'Thalor')!
    expect(updated.portraitUrl).toBe(`portraits/${created.id}.jpg`)
    expect(existsSync(oldPath)).toBe(false)
    expect(existsSync(join(deps.botData, updated.portraitUrl!))).toBe(true)
  })

  it('overwrites in place (no delete) on a same-extension replacement', async () => {
    const { deps } = seededDeps()
    mockImageFetch(Buffer.from([1]), 'image/png')
    await submitCharacter(deps, THALOR, { portrait: 'https://cdn.discordapp.com/1.png' })
    const created = deps.characters.byCampaignAndName('camp-1', 'Thalor')!

    mockImageFetch(Buffer.from([2]), 'image/png')
    await submitCharacter(deps, THALOR, { characterId: created.id, portrait: 'https://cdn.discordapp.com/2.png' })

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

describe('/character — the form', () => {
  it('opens prefilled for update, carrying the row id rather than the name', async () => {
    const { deps } = seededDeps()
    await submitCharacter(deps, THALOR)
    const existing = deps.characters.byCampaignAndName('camp-1', 'Thalor')!

    const interaction = chatInteraction({ subcommand: 'update', strings: { name: 'Thalor' } })
    await registry.character.execute(interaction as never, deps)
    const shown = interaction.calls[0][1] as { custom_id: string; components: { component: { value?: string } }[] }
    expect(parse(shown.custom_id)).toMatchObject({ action: 'update', extra: [String(existing.id)] })
    expect(shown.components.map((label) => label.component.value)).toEqual(['Thalor', undefined, '1', undefined])
  })

  it('renames, re-levels and announces the level up from the one form', async () => {
    const { deps, sent } = seededDeps()
    await submitCharacter(deps, THALOR)
    const existing = deps.characters.byCampaignAndName('camp-1', 'Thalor')!

    await submitCharacter(deps, { name: 'Thalor Redgrave', class: 'Druid', level: '4' }, { characterId: existing.id })
    expect(deps.characters.byId(existing.id)).toMatchObject({
      name: 'Thalor Redgrave',
      className: 'Druid',
      level: 4,
    })
    expect(cardText(sent[0].spec)).toContain('Thalor Redgrave reaches level 4')
  })

  it('refuses a level or a class the form could never have produced, and reads back what was typed', async () => {
    const { deps } = seededDeps()
    await expect(submitCharacter(deps, { ...THALOR, level: '99' })).rejects.toThrow(/1 to 20/)
    await expect(submitCharacter(deps, { ...THALOR, class: 'Goblin' })).rejects.toThrow(/class called "Goblin"/)
    await expect(submitCharacter(deps, { ...THALOR, class: 'Goblin' })).rejects.toThrow(/You put · Thalor · Goblin · 1/)
    expect(deps.characters.byCampaign('camp-1')).toEqual([])
  })

  it("refuses a form aimed at someone else's character, and at another campaign's", async () => {
    const { deps } = seededDeps()
    await submitCharacter(deps, THALOR)
    const mine = deps.characters.byCampaignAndName('camp-1', 'Thalor')!
    await expect(
      submitCharacter(deps, THALOR, { characterId: mine.id, userId: 'someone-else' }),
    ).rejects.toThrow(/not your character/)
    await expect(submitCharacter(deps, THALOR, { characterId: mine.id + 999 })).rejects.toThrow(/gone/)
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
    expect(payloadText(interaction.calls[0][1])).toContain('Zed')
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

  it('refuses to guess between two combatants of the same name', async () => {
    const { deps, sentToTable } = tableDeps({ entries: [entry('e1', 'Zed'), entry('e2', 'Zed')] })
    deps.characters.create({ discordId: 'user-1', campaignId: 'camp-1', name: 'Zed', className: 'Fighter', level: 1 })

    await expect(
      registry.initiative.execute(chatInteraction({ integers: { value: 17 } }) as never, deps),
    ).rejects.toThrowError(/2 combatants are named Zed/)
    expect(sentToTable).toEqual([])
  })

  it('sets the entry whose key was picked, without matching any name', async () => {
    const { deps, sentToTable } = tableDeps({ entries: [entry('e1', 'Zed'), entry('e2', 'Zed')] })
    deps.characters.create({ discordId: 'user-1', campaignId: 'camp-1', name: 'Zed', className: 'Fighter', level: 1 })

    await registry.initiative.execute(
      chatInteraction({ integers: { value: 12 }, strings: { character: 'e2' } }) as never,
      deps,
    )
    expect(sentToTable[0].payload).toEqual({ key: 'e2', value: 12 })
  })

  it('offers the running encounter first, and only characters when none runs', async () => {
    const fight = tableDeps({ entries: [entry('e1', 'Zed'), entry('e2', 'Zed'), entry('e3', 'Goblin')] })
    fight.deps.characters.create({ discordId: 'user-1', campaignId: 'camp-1', name: 'Marra', className: 'Cleric', level: 1 })

    const running = chatInteraction({ focused: '' })
    await registry.initiative.autocomplete!(running as never, fight.deps)
    expect(running.calls).toEqual([
      [
        'respond',
        [
          { name: 'Zed (e1)', value: 'e1' },
          { name: 'Zed (e2)', value: 'e2' },
          { name: 'Goblin', value: 'e3' },
          { name: 'Marra', value: 'Marra' },
        ],
      ],
    ])

    const quiet = tableDeps()
    quiet.deps.characters.create({ discordId: 'user-1', campaignId: 'camp-1', name: 'Marra', className: 'Cleric', level: 1 })
    const idle = chatInteraction({ focused: '' })
    await registry.initiative.autocomplete!(idle as never, quiet.deps)
    expect(idle.calls).toEqual([['respond', [{ name: 'Marra', value: 'Marra' }]]])
  })

  it('admits the number never landed when the seat is gone', async () => {
    const { deps } = tableDeps({ entries: [entry('e1', 'Zed')], reachable: false })
    deps.characters.create({ discordId: 'user-1', campaignId: 'camp-1', name: 'Zed', className: 'Fighter', level: 1 })
    await expect(
      registry.initiative.execute(chatInteraction({ integers: { value: 17 } }) as never, deps),
    ).rejects.toThrowError(/couldn't reach the table/)
  })
})

// ── private cards can be shared to the channel by the person who asked for them ───────────

describe('Share to channel — /mycharacters and /campaign status', () => {
  const sharer = (userId = 'user-1') => {
    const calls: unknown[][] = []
    return {
      calls,
      channelId: 'player-chan',
      user: { id: userId, username: 'goblin', displayName: 'Goblin' },
      update: vi.fn(async (payload: unknown) => void calls.push(['update', payload])),
    }
  }

  it('puts an owner-stamped Share button under the private card', async () => {
    const { deps } = seededDeps()
    const interaction = chatInteraction({ subcommand: 'status' })
    await registry.campaign.execute(interaction as never, deps)
    const row = (interaction.calls[0][1] as { components: { toJSON: () => { components: { type: number; components?: { custom_id?: string; label?: string }[] }[] } }[] })
      .components[0].toJSON()
      .components.at(-1)!
    expect(row.components?.[0]).toMatchObject({ custom_id: 'campaign:share:user-1', label: 'Share to channel' })
  })

  it('posts a fresh copy publicly, names the sharer, pings nobody, and retires the button', async () => {
    const { deps, sent } = seededDeps()
    const click = sharer()
    await registry.campaign.component!(click as never, parse('campaign:share:user-1')!, deps)

    expect(sent).toHaveLength(1)
    expect(sent[0].channelId).toBe('player-chan')
    expect(sent[0].spec.header).toBe('The Sunken Keep')
    expect(sent[0].spec.footer).toContain('Shared by <@user-1>')
    expect(sent[0].spec.noPing).toBe(true)
    expect(sent[0].spec.rows).toBeUndefined()

    const [kind, payload] = click.calls[0] as [string, { attachments: unknown[] }]
    expect(kind).toBe('update')
    expect(payloadText(payload)).toContain('Shared to the channel.')
    expect(payload.attachments).toEqual([])
  })

  it('retitles a shared character list, since "your" means nothing to everyone else', async () => {
    const { deps, sent } = seededDeps()
    await registry.mycharacters.component!(sharer() as never, parse('mycharacters:share:user-1')!, deps)
    expect(sent[0].spec.header).toBe("Goblin's characters")
  })

  it('shares the quest log too, thumbnail attached to the public copy', async () => {
    const { deps, sent } = seededDeps()
    deps.quests.add('camp-1', 'Find the key', 'dm-1')

    const interaction = chatInteraction({ subcommand: 'log' })
    await registry.quests.execute(interaction as never, deps)
    const row = (interaction.calls[0][1] as { components: { toJSON: () => { components: { components?: { custom_id?: string }[] }[] } }[] })
      .components[0].toJSON()
      .components.at(-1)!
    expect(row.components?.[0]).toMatchObject({ custom_id: 'quests:share:user-1' })

    await registry.quests.component!(sharer() as never, parse('quests:share:user-1')!, deps)
    expect(sent[0].spec.header).toBe('Quest log')
    expect(sent[0].files?.map((f) => f.name)).toEqual(['thumb-quest.png'])
  })

  it('shares a character card by re-rendering it from the id in the button', async () => {
    const { deps, sent } = seededDeps()
    const thalor = deps.characters.create({
      discordId: 'user-1',
      campaignId: 'camp-1',
      name: 'Thalor',
      className: 'Ranger',
      level: 3,
    })

    const interaction = chatInteraction({ subcommand: 'show', strings: { name: 'Thalor' } })
    await registry.character.execute(interaction as never, deps)
    const payload = interaction.calls[0][1] as {
      components: { toJSON: () => { components: { components?: { custom_id?: string; label?: string }[] }[] } }[]
    }
    expect(payload.components[0].toJSON().components.at(-1)!.components?.[0]).toMatchObject({
      custom_id: `character:share:user-1:${thalor.id}`,
      label: 'Share to channel',
    })

    await registry.character.component!(sharer() as never, parse(`character:share:user-1:${thalor.id}`)!, deps)
    expect(sent[0].spec.header).toBe('Thalor')
    expect(sent[0].spec.subhead).toBe('**Ranger** · Level 3 · <@user-1>')
    expect(sent[0].spec.noPing).toBe(true)
    expect(cardText(sent[0].spec)).toContain('Yet to sit at the table')
    // The picture on the public copy is that message's own attachment, not the private one's.
    expect(sent[0].files?.map((f) => f.name)).toEqual(['character.png'])
    expect(sent[0].spec.media).toEqual([
      { url: 'attachment://character.png', alt: 'Thalor, Ranger level 3' },
    ])
  })

  it('refuses a character button pointing outside this channel\'s campaign', async () => {
    const { deps, sent } = seededDeps()
    await expect(
      registry.character.component!(sharer() as never, parse('character:share:user-1:99')!, deps),
    ).rejects.toThrowError(/gone/)
    expect(sent).toHaveLength(0)
  })

  it('carries the /recall query in the share id, and drops the button when it cannot fit', async () => {
    const { deps, sent } = seededDeps()
    deps.notes.add('camp-1', 'user-1', 'The key is under the flagstone')
    const lastComponent = (interaction: { calls: unknown[][] }) =>
      (interaction.calls[0][1] as { components: { toJSON: () => { components: { components?: { custom_id?: string }[] }[] } }[] })
        .components[0].toJSON()
        .components.at(-1)!

    const found = chatInteraction({ strings: { query: 'key' } })
    await registry.recall.execute(found as never, deps)
    expect(lastComponent(found).components?.[0]).toMatchObject({ custom_id: 'recall:share:user-1:key' })

    // Only the 100-char cap can still cost a query its button.
    const long = chatInteraction({ strings: { query: 'key '.repeat(30) } })
    await registry.recall.execute(long as never, deps)
    expect(lastComponent(long).components).toBeUndefined()

    // The share searches again rather than copying the private card.
    await registry.recall.component!(sharer() as never, parse('recall:share:user-1:key')!, deps)
    expect(cardText(sent[0].spec)).toContain('> The key is under the flagstone')
    expect(sent[0].files?.map((f) => f.name)).toEqual(['thumb-journal.png'])
  })

  it('keeps the button for a query holding the id separator', async () => {
    const { deps, sent } = seededDeps()
    deps.notes.add('camp-1', 'user-1', 'The riddle answer is water')
    const asked = chatInteraction({ strings: { query: 'riddle: water' } })
    await registry.recall.execute(asked as never, deps)

    // encodeURIComponent escapes `:` as %3A, so the separator never reaches the id's splitter.
    const row = (asked.calls[0][1] as { components: { toJSON: () => { components: { components?: { custom_id?: string }[] }[] } }[] })
      .components[0].toJSON()
      .components.at(-1)!
    const id = row.components?.[0]?.custom_id
    expect(id).toBe('recall:share:user-1:riddle%3A%20water')

    await registry.recall.component!(sharer() as never, parse(id!)!, deps)
    expect(sent[0].spec.header).toBe('“riddle: water”')
    expect(cardText(sent[0].spec)).toContain('> The riddle answer is water')
  })
})

// ── the controls on a card: row accessories and selects ──────────────────────────────────

interface Built {
  type: number
  custom_id?: string
  placeholder?: string
  label?: string
  default?: boolean
  accessory?: { custom_id?: string; label?: string }
  options?: { label: string; value: string; description?: string; default?: boolean }[]
  components?: Built[]
}

/** The container a reply carried, and the action rows at the foot of it. */
const built = (interaction: { calls: unknown[][] }): Built =>
  (interaction.calls[0][1] as { components: { toJSON: () => Built }[] }).components[0].toJSON()
const rowsOf = (interaction: { calls: unknown[][] }): Built[] =>
  (built(interaction).components ?? []).filter((c) => c.type === ComponentType.ActionRow)

const seedCharacter = (deps: Deps, name: string, className = 'Fighter', level = 1, discordId = 'user-1') =>
  deps.characters.create({ discordId, campaignId: 'camp-1', name, className, level })

describe('/mycharacters — a Show card button on every row', () => {
  it('spends each row accessory on a button, so the card carries no portrait attachments', async () => {
    const { deps } = seededDeps()
    const zed = seedCharacter(deps, 'Zed')
    const marra = seedCharacter(deps, 'Marra', 'Cleric', 2)

    const interaction = chatInteraction({})
    await registry.mycharacters.execute(interaction as never, deps)
    const payload = interaction.calls[0][1] as { components: { toJSON: () => Built }[]; files: unknown[] }
    const accessories = (payload.components[0].toJSON().components ?? []).filter((c) => c.accessory)
    // One row each, in the order the store lists them — by name, so Marra leads.
    expect(accessories.map((c) => c.accessory)).toEqual([
      { custom_id: `mycharacters:show:user-1:${marra.id}`, label: 'Show card', style: ButtonStyle.Secondary, type: ComponentType.Button, emoji: undefined },
      { custom_id: `mycharacters:show:user-1:${zed.id}`, label: 'Show card', style: ButtonStyle.Secondary, type: ComponentType.Button, emoji: undefined },
    ])
    expect(payload.files).toEqual([])
  })

  it("answers one with that character's full card, still only they can see it", async () => {
    const { deps } = seededDeps()
    const zed = seedCharacter(deps, 'Zed')
    const click = componentInteraction(`mycharacters:show:user-1:${zed.id}`, 'user-1')
    await registry.mycharacters.component!(click as never, parse(click.customId)!, deps)

    const [kind, payload] = click.calls[0] as [string, { flags: number[]; files: { name: string }[] }]
    expect(kind).toBe('reply')
    expect(payload.flags).toContain(MessageFlags.Ephemeral)
    expect(payloadText(payload)).toContain('Zed')
    expect(payload.files.map((file) => file.name)).toEqual(['character.png'])
  })

  it("refuses a row button pointing outside this channel's campaign", async () => {
    const { deps } = seededDeps()
    const click = componentInteraction('mycharacters:show:user-1:99', 'user-1')
    await expect(registry.mycharacters.component!(click as never, parse(click.customId)!, deps)).rejects.toThrowError(/gone/)
  })

  it('keeps the pictures on the copy shared to the channel, where nobody may press', async () => {
    const { deps, sent } = seededDeps()
    seedCharacter(deps, 'Zed')
    await registry.mycharacters.component!(componentInteraction('mycharacters:share:user-1', 'user-1') as never, parse('mycharacters:share:user-1')!, deps)
    expect(sent[0].spec.blocks?.[0]).toMatchObject({ thumb: 'attachment://thumb-character.png' })
  })
})

describe('/quests log — the DM closes a quest from the card', () => {
  it('offers the DM a Mark complete select and a player none', async () => {
    const { deps } = seededDeps()
    const quest = deps.quests.add('camp-1', 'Find the key', 'dm-1')

    const dm = chatInteraction({ subcommand: 'log', userId: 'dm-1' })
    await registry.quests.execute(dm as never, deps)
    const [select, share] = rowsOf(dm)
    expect(select.components?.[0]).toMatchObject({
      type: ComponentType.StringSelect,
      custom_id: 'quests:complete:dm-1',
      placeholder: 'Mark complete',
      options: [{ label: 'Find the key', value: String(quest.id) }],
    })
    expect(share.components?.[0]).toMatchObject({ custom_id: 'quests:share:dm-1' })

    const player = chatInteraction({ subcommand: 'log' })
    await registry.quests.execute(player as never, deps)
    expect(rowsOf(player)).toHaveLength(1)
  })

  it('completes what was picked and redraws the same private card', async () => {
    const { deps } = seededDeps()
    const quest = deps.quests.add('camp-1', 'Find the key', 'dm-1')
    const click = componentInteraction('quests:complete:dm-1', 'dm-1', [], [String(quest.id)])
    await registry.quests.component!(click as never, parse(click.customId)!, deps)

    expect(deps.quests.active('camp-1')).toEqual([])
    const [kind, payload] = click.calls[0] as [string, { attachments: unknown[] }]
    expect(kind).toBe('update')
    expect(payloadText(payload)).toContain('Closed · 1')
    expect(payload.attachments).toEqual([])
  })

  it('turns away anyone but the DM, and a quest already closed', async () => {
    const { deps } = seededDeps()
    const quest = deps.quests.add('camp-1', 'Find the key', 'dm-1')
    await expect(
      registry.quests.component!(
        componentInteraction('quests:complete:dm-1', 'user-1', [], [String(quest.id)]) as never,
        parse('quests:complete:dm-1')!,
        deps,
      ),
    ).rejects.toThrowError(/DM can do that/)

    deps.quests.complete('camp-1', 'Find the key')
    await expect(
      registry.quests.component!(
        componentInteraction('quests:complete:dm-1', 'dm-1', [], [String(quest.id)]) as never,
        parse('quests:complete:dm-1')!,
        deps,
      ),
    ).rejects.toThrowError(/already closed/)
  })
})

describe('/character show — switching between your own', () => {
  it('adds the select only once the asker keeps more than one here', async () => {
    const { deps } = seededDeps()
    const zed = seedCharacter(deps, 'Zed')
    const solo = chatInteraction({ subcommand: 'show', strings: { name: 'Zed' } })
    await registry.character.execute(solo as never, deps)
    expect(rowsOf(solo)).toHaveLength(1)

    const marra = seedCharacter(deps, 'Marra', 'Cleric', 2)
    // Somebody else's character is not theirs to switch to.
    seedCharacter(deps, 'Vex', 'Rogue', 4, 'user-2')
    const both = chatInteraction({ subcommand: 'show', strings: { name: 'Zed' } })
    await registry.character.execute(both as never, deps)
    const [select] = rowsOf(both)
    expect(select.components?.[0]).toMatchObject({
      custom_id: 'character:switch:user-1',
      options: [
        { label: 'Marra', description: 'Cleric · Level 2', value: String(marra.id), default: false },
        { label: 'Zed', description: 'Fighter · Level 1', value: String(zed.id), default: true },
      ],
    })
  })

  it('swaps the same private message to the picked character, picture and all', async () => {
    const { deps } = seededDeps()
    seedCharacter(deps, 'Zed')
    const marra = seedCharacter(deps, 'Marra', 'Cleric', 2)

    const click = componentInteraction('character:switch:user-1', 'user-1', [], [String(marra.id)])
    await registry.character.component!(click as never, parse(click.customId)!, deps)

    const [kind, payload] = click.calls[0] as [string, { attachments: unknown[]; files: { name: string }[] }]
    expect(kind).toBe('update')
    expect(payloadText(payload)).toContain('Marra')
    expect(payload.attachments).toEqual([])
    expect(payload.files.map((file) => file.name)).toEqual(['character.png'])
  })
})
