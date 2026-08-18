import { describe, expect, it } from 'vitest'
import { dmOnly, memberOnly, ownerOnly, registry, type AuthContext, type Deps } from './command-registry'
import type { Campaign } from '../db/stores'

const campaign: Campaign = {
  goblinCampaignId: 'camp-1',
  name: 'The Sunken Keep',
  channelId: 'player-chan',
  dmChannelId: 'dm-chan',
  dmDiscordId: 'dm-1',
  roleId: 'role-1',
}

const deps = (byChannel: (id: string) => Campaign | undefined): Deps => ({
  ownerId: 'owner-1',
  campaigns: { byChannel, upsert: (c) => c },
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
  db: {} as Deps['db'],
  announce: async () => {},
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
