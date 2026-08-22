import { describe, expect, it } from 'vitest'
import { openDb } from './db'
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
  type CampaignInput,
  type SessionRecap,
} from './stores'

const campaignInput: CampaignInput = {
  goblinCampaignId: 'camp-1',
  name: 'The Sunken Keep',
  channelId: 'player-chan',
  dmChannelId: 'dm-chan',
  dmDiscordId: 'dm-1',
  roleId: 'role-1',
}

describe('createCampaigns', () => {
  it('resolves a campaign by either the player or DM channel', () => {
    const campaigns = createCampaigns(openDb(':memory:'))
    campaigns.upsert(campaignInput)
    const stored = { ...campaignInput, nextSessionAt: null, serviceToken: null, playerToken: null }
    expect(campaigns.byChannel('player-chan')).toEqual(stored)
    expect(campaigns.byChannel('dm-chan')).toEqual(stored)
    expect(campaigns.byChannel('random')).toBeUndefined()
  })

  it('upsert on the same goblin id replaces the row instead of inserting a second one', () => {
    const campaigns = createCampaigns(openDb(':memory:'))
    campaigns.upsert(campaignInput)
    campaigns.upsert({ ...campaignInput, name: 'Renamed', channelId: 'new-player-chan' })
    expect(campaigns.byChannel('player-chan')).toBeUndefined()
    expect(campaigns.byChannel('new-player-chan')).toMatchObject({ name: 'Renamed' })
  })

  it('resolves by goblin id, for lookups that are not channel-based', () => {
    const campaigns = createCampaigns(openDb(':memory:'))
    campaigns.upsert(campaignInput)
    expect(campaigns.byId('camp-1')).toMatchObject({ name: 'The Sunken Keep' })
    expect(campaigns.byId('nope')).toBeUndefined()
  })

  it('setNextSession writes the date and re-upserting never touches it', () => {
    const campaigns = createCampaigns(openDb(':memory:'))
    campaigns.upsert(campaignInput)
    const updated = campaigns.setNextSession('camp-1', 12345)
    expect(updated.nextSessionAt).toBe(12345)
    const reupserted = campaigns.upsert({ ...campaignInput, name: 'Renamed' })
    expect(reupserted.nextSessionAt).toBe(12345)
  })

  it('setTokens stores both seats, and a re-run of setup keeps them until the next mint', () => {
    const campaigns = createCampaigns(openDb(':memory:'))
    campaigns.upsert(campaignInput)
    expect(campaigns.byId('camp-1')).toMatchObject({ serviceToken: null, playerToken: null })

    campaigns.setTokens('camp-1', 'dm-token', 'player-token')
    expect(campaigns.upsert({ ...campaignInput, name: 'Renamed' })).toMatchObject({
      serviceToken: 'dm-token',
      playerToken: 'player-token',
    })
    expect(campaigns.setTokens('camp-1', 'fresh-dm', null).playerToken).toBeNull()
  })
})

describe('createSessions', () => {
  function sessionsStore() {
    const db = openDb(':memory:')
    createCampaigns(db).upsert(campaignInput)
    return createSessions(db)
  }

  const recap: SessionRecap = {
    scenes: ['The Vault'],
    doorsOpened: 2,
    durationMs: 60_000,
    players: ['Zed'],
    peakPlayers: 1,
    calendarLine: 'Day 3',
  }

  it('starts live and round-trips the recap JSON', () => {
    const sessions = sessionsStore()
    const started = sessions.start('sess-1', 'camp-1', 'AB2CD3')
    expect(started).toMatchObject({ inviteCode: 'AB2CD3', endedAt: null, recap: null })
    expect(sessions.live().map((s) => s.goblinSessionId)).toEqual(['sess-1'])

    const finished = sessions.finish('sess-1', recap, 5_000)
    expect(finished.endedAt).toBe(5_000)
    expect(finished.recap).toEqual(recap)
    expect(sessions.live()).toEqual([])
  })

  it('refuses to re-measure a table that already ended', () => {
    const sessions = sessionsStore()
    sessions.start('sess-1', 'camp-1', 'AB2CD3')
    sessions.finish('sess-1', recap, 5_000)
    // /session end and the observer's session-ended both land; the first one wins.
    const second = sessions.finish('sess-1', { ...recap, doorsOpened: 99 }, 9_000)
    expect(second.endedAt).toBe(5_000)
    expect(second.recap?.doorsOpened).toBe(2)
  })

  it('starting the same goblin session twice is not a second row', () => {
    const sessions = sessionsStore()
    sessions.start('sess-1', 'camp-1', 'AB2CD3')
    sessions.start('sess-1', 'camp-1', 'AB2CD3')
    expect(sessions.live()).toHaveLength(1)
  })

  it('remembers the two message refs a session leaves behind', () => {
    const sessions = sessionsStore()
    sessions.start('sess-1', 'camp-1', 'AB2CD3')
    expect(sessions.setLiveMessageId('sess-1', 'msg-live').liveMessageId).toBe('msg-live')
    expect(sessions.setRecapMessageId('sess-1', 'msg-recap').recapMessageId).toBe('msg-recap')
  })

  it('remembers the log thread, and starts without one', () => {
    const sessions = sessionsStore()
    expect(sessions.start('sess-1', 'camp-1', 'AB2CD3').logThreadId).toBeNull()
    expect(sessions.setLogThreadId('sess-1', 'thread-1').logThreadId).toBe('thread-1')
    expect(sessions.byId('sess-1')?.logThreadId).toBe('thread-1')
  })

  it('lastEnded is the most recent finished table, never the live one', () => {
    const sessions = sessionsStore()
    sessions.start('sess-1', 'camp-1', 'A')
    sessions.finish('sess-1', recap, 1_000)
    sessions.start('sess-2', 'camp-1', 'B')
    sessions.finish('sess-2', { ...recap, scenes: ['Newer'] }, 2_000)
    sessions.start('sess-3', 'camp-1', 'C')

    expect(sessions.lastEnded('camp-1')?.goblinSessionId).toBe('sess-2')
    expect(sessions.lastEnded('other')).toBeUndefined()
  })

  it('counts sessions played and when the last one started', () => {
    const sessions = sessionsStore()
    expect(sessions.stats('camp-1')).toEqual({ played: 0, lastStartedAt: null })
    sessions.start('sess-1', 'camp-1', 'A')
    sessions.start('sess-2', 'camp-1', 'B')
    const stats = sessions.stats('camp-1')
    expect(stats.played).toBe(2)
    expect(stats.lastStartedAt).toBeGreaterThan(0)
  })
})

/** Characters FK-references campaigns, so every characters test needs camp-1/camp-2 to exist. */
function charactersStore() {
  const db = openDb(':memory:')
  const campaigns = createCampaigns(db)
  campaigns.upsert({ ...campaignInput, goblinCampaignId: 'camp-1', channelId: 'chan-1', dmChannelId: 'dm-1' })
  campaigns.upsert({ ...campaignInput, goblinCampaignId: 'camp-2', channelId: 'chan-2', dmChannelId: 'dm-2' })
  return createCharacters(db)
}

describe('createCharacters', () => {
  it('creates and reads a character back', () => {
    const characters = charactersStore()
    const created = characters.create({
      discordId: 'user-1',
      campaignId: 'camp-1',
      name: 'Thalor',
      className: 'Ranger',
      level: 1,
    })
    expect(created).toMatchObject({ name: 'Thalor', className: 'Ranger', level: 1, portraitUrl: null })
    expect(characters.byCampaignAndName('camp-1', 'thalor')).toMatchObject({ id: created.id }) // case-insensitive
  })

  it('rejects a duplicate name in the same campaign, case-insensitively', () => {
    const characters = charactersStore()
    characters.create({ discordId: 'user-1', campaignId: 'camp-1', name: 'Thalor', className: 'Ranger', level: 1 })
    expect(() =>
      characters.create({ discordId: 'user-2', campaignId: 'camp-1', name: 'THALOR', className: 'Bard', level: 1 }),
    ).toThrowError(/already a character/)
  })

  it('allows the same name in a different campaign', () => {
    const characters = charactersStore()
    characters.create({ discordId: 'user-1', campaignId: 'camp-1', name: 'Thalor', className: 'Ranger', level: 1 })
    expect(() =>
      characters.create({ discordId: 'user-2', campaignId: 'camp-2', name: 'Thalor', className: 'Bard', level: 1 }),
    ).not.toThrow()
  })

  it('updates only the patched fields', () => {
    const characters = charactersStore()
    const created = characters.create({
      discordId: 'user-1',
      campaignId: 'camp-1',
      name: 'Thalor',
      className: 'Ranger',
      level: 1,
    })
    const updated = characters.update(created.id, { level: 2 })
    expect(updated).toMatchObject({ name: 'Thalor', className: 'Ranger', level: 2 })
  })

  it('rejects a rename that collides with another character in the campaign', () => {
    const characters = charactersStore()
    characters.create({ discordId: 'user-1', campaignId: 'camp-1', name: 'Thalor', className: 'Ranger', level: 1 })
    const other = characters.create({
      discordId: 'user-2',
      campaignId: 'camp-1',
      name: 'Bryn',
      className: 'Bard',
      level: 1,
    })
    expect(() => characters.update(other.id, { name: 'Thalor' })).toThrowError(/already a character/)
  })

  it("lists an owner's characters in one campaign, sorted by name", () => {
    const characters = charactersStore()
    characters.create({ discordId: 'user-1', campaignId: 'camp-1', name: 'Zed', className: 'Fighter', level: 1 })
    characters.create({ discordId: 'user-1', campaignId: 'camp-1', name: 'Anna', className: 'Cleric', level: 1 })
    characters.create({ discordId: 'user-2', campaignId: 'camp-1', name: 'Ozzy', className: 'Rogue', level: 1 })
    characters.create({ discordId: 'user-1', campaignId: 'camp-2', name: 'Other Camp', className: 'Wizard', level: 1 })
    expect(characters.byOwner('camp-1', 'user-1').map((c) => c.name)).toEqual(['Anna', 'Zed'])
  })

  it('lists every character in a campaign for autocomplete', () => {
    const characters = charactersStore()
    characters.create({ discordId: 'user-1', campaignId: 'camp-1', name: 'Zed', className: 'Fighter', level: 1 })
    characters.create({ discordId: 'user-2', campaignId: 'camp-1', name: 'Anna', className: 'Cleric', level: 1 })
    expect(characters.byCampaign('camp-1').map((c) => c.name)).toEqual(['Anna', 'Zed'])
  })

  it('touchLastPlayed stamps only the given ids', () => {
    const characters = charactersStore()
    const zed = characters.create({ discordId: 'user-1', campaignId: 'camp-1', name: 'Zed', className: 'Fighter', level: 1 })
    const anna = characters.create({ discordId: 'user-2', campaignId: 'camp-1', name: 'Anna', className: 'Cleric', level: 1 })
    expect(zed.lastPlayed).toBeNull()

    characters.touchLastPlayed([zed.id], 12_345)
    expect(characters.byId(zed.id)?.lastPlayed).toBe(12_345)
    expect(characters.byId(anna.id)?.lastPlayed).toBeNull()
  })
})

/** Every M3 store FK-references campaigns; camp-1 exists in every db these tests open. */
function seededDb() {
  const db = openDb(':memory:')
  createCampaigns(db).upsert({ ...campaignInput, goblinCampaignId: 'camp-1', channelId: 'chan-1', dmChannelId: 'dm-1' })
  return db
}

describe('createQuests', () => {
  it('adds a quest active, then completes it', () => {
    const quests = createQuests(seededDb())
    const added = quests.add('camp-1', 'Find the key', 'dm-1')
    expect(added).toMatchObject({ title: 'Find the key', status: 'active' })
    const completed = quests.complete('camp-1', 'Find the key')
    expect(completed.status).toBe('done')
  })

  it('rejects a duplicate title in the same campaign, case-insensitively', () => {
    const quests = createQuests(seededDb())
    quests.add('camp-1', 'Find the key', 'dm-1')
    expect(() => quests.add('camp-1', 'FIND THE KEY', 'dm-1')).toThrowError(/already on the quest log/)
  })

  it('refuses to complete an unknown or already-done quest', () => {
    const quests = createQuests(seededDb())
    expect(() => quests.complete('camp-1', 'Nope')).toThrowError(/no active quest/i)
    quests.add('camp-1', 'Find the key', 'dm-1')
    quests.complete('camp-1', 'Find the key')
    expect(() => quests.complete('camp-1', 'Find the key')).toThrowError(/no active quest/i)
  })

  it('lists active quests separately from the full campaign list', () => {
    const quests = createQuests(seededDb())
    quests.add('camp-1', 'Find the key', 'dm-1')
    quests.add('camp-1', 'Slay the dragon', 'dm-1')
    quests.complete('camp-1', 'Slay the dragon')
    expect(quests.active('camp-1').map((q) => q.title)).toEqual(['Find the key'])
    expect(quests.byCampaign('camp-1')).toHaveLength(2)
  })
})

describe('createNotes', () => {
  it('saves a note and finds it back by a word inside it', () => {
    const notes = createNotes(seededDb())
    notes.add('camp-1', 'user-1', 'The goblin found a rusty key in the cave')
    const results = notes.search('camp-1', '"goblin"')
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ discordId: 'user-1', text: 'The goblin found a rusty key in the cave' })
  })

  it('only searches within the given campaign', () => {
    const db = seededDb()
    createCampaigns(db).upsert({ ...campaignInput, goblinCampaignId: 'camp-2', channelId: 'chan-2', dmChannelId: 'dm-2' })
    const notes = createNotes(db)
    notes.add('camp-1', 'user-1', 'goblin gold')
    notes.add('camp-2', 'user-1', 'goblin silver')
    expect(notes.search('camp-1', '"goblin"')).toHaveLength(1)
  })

  it('ranks the best match first and respects the limit', () => {
    const notes = createNotes(seededDb())
    notes.add('camp-1', 'user-1', 'weather note, unrelated')
    notes.add('camp-1', 'user-1', 'goblin goblin goblin party')
    notes.add('camp-1', 'user-1', 'a single goblin sighting')
    const results = notes.search('camp-1', '"goblin"', 2)
    expect(results).toHaveLength(2)
    expect(results[0].text).toBe('goblin goblin goblin party')
  })

  it('turns a raw FTS5 syntax error into a BotError instead of crashing', () => {
    const notes = createNotes(seededDb())
    // An unsanitized, unbalanced quote is invalid FTS5 query syntax.
    expect(() => notes.search('camp-1', '"unterminated')).toThrowError()
  })
})

describe('createRolls', () => {
  it('records and reads back a roll, storing crit/fail as booleans', () => {
    const rolls = createRolls(seededDb())
    const recorded = rolls.record({
      campaignId: 'camp-1',
      characterId: null,
      discordId: 'user-1',
      expr: 'd20',
      total: 20,
      faces: '1d20[20]',
      isCrit: true,
      isFail: false,
    })
    expect(recorded).toMatchObject({ total: 20, isCrit: true, isFail: false, characterId: null })
    expect(rolls.byId(recorded.id)).toMatchObject({ expr: 'd20' })
  })
})

describe('rolls.statsByCampaign', () => {
  it('aggregates rolls, nat-20s and nat-1s per character, skipping characterless rolls', () => {
    const db = seededDb()
    const characters = createCharacters(db)
    const zed = characters.create({ discordId: 'user-1', campaignId: 'camp-1', name: 'Zed', className: 'Fighter', level: 1 })
    const rolls = createRolls(db)
    rolls.record({ campaignId: 'camp-1', characterId: zed.id, discordId: 'user-1', expr: 'd20', total: 20, faces: 'd20[20]', isCrit: true, isFail: false })
    rolls.record({ campaignId: 'camp-1', characterId: zed.id, discordId: 'user-1', expr: 'd20', total: 1, faces: 'd20[1]', isCrit: false, isFail: true })
    rolls.record({ campaignId: 'camp-1', characterId: null, discordId: 'user-2', expr: 'd6', total: 4, faces: 'd6[4]', isCrit: false, isFail: false })
    const stats = rolls.statsByCampaign('camp-1')
    expect(stats).toEqual([{ characterId: zed.id, rolls: 2, nat20s: 1, nat1s: 1 }])
  })

  it('returns nothing for a campaign with no attributed rolls', () => {
    const rolls = createRolls(seededDb())
    expect(rolls.statsByCampaign('camp-1')).toEqual([])
  })
})

describe('createSchedulePolls', () => {
  it('creates a poll before it has a message ref, then stamps one on', () => {
    const polls = createSchedulePolls(seededDb())
    const poll = polls.create('camp-1', ['Friday 8pm', 'Saturday 2pm'])
    expect(poll).toMatchObject({ channelId: null, messageId: null, votes: {}, status: 'open' })
    const stamped = polls.setMessageRef(poll.id, 'chan-1', 'msg-1')
    expect(stamped).toMatchObject({ channelId: 'chan-1', messageId: 'msg-1' })
  })

  it('replaces the votes map and closes independently', () => {
    const polls = createSchedulePolls(seededDb())
    const poll = polls.create('camp-1', ['Friday 8pm', 'Saturday 2pm'])
    const voted = polls.setVotes(poll.id, { 'user-1': 0, 'user-2': 1 })
    expect(voted.votes).toEqual({ 'user-1': 0, 'user-2': 1 })
    expect(voted.status).toBe('open')
    const closed = polls.close(poll.id)
    expect(closed.status).toBe('closed')
    expect(closed.votes).toEqual({ 'user-1': 0, 'user-2': 1 })
  })
})

describe('createLfgPosts', () => {
  it('lists only open posts, and finds the open post for one campaign', () => {
    const db = seededDb()
    createCampaigns(db).upsert({ ...campaignInput, goblinCampaignId: 'camp-2', channelId: 'chan-2', dmChannelId: 'dm-2' })
    const posts = createLfgPosts(db)
    posts.create('camp-1', 'Looking for a rogue', 'lfg-chan', 'msg-1')
    const camp2 = posts.create('camp-2', 'Looking for a cleric', 'lfg-chan', 'msg-2')
    expect(posts.open().map((p) => p.campaignId).sort()).toEqual(['camp-1', 'camp-2'])
    posts.close('camp-2')
    expect(posts.open().map((p) => p.campaignId)).toEqual(['camp-1'])
    expect(posts.openForCampaign('camp-2')).toBeUndefined()
    expect(camp2.blurb).toBe('Looking for a cleric')
  })
})

describe('createLfgApplications', () => {
  it('stores an application, message included or not', () => {
    const applications = createLfgApplications(seededDb())
    const withMessage = applications.add('camp-1', 'user-1', 'I love rogues')
    expect(withMessage).toMatchObject({ campaignId: 'camp-1', discordId: 'user-1', message: 'I love rogues' })
    const withoutMessage = applications.add('camp-1', 'user-2', null)
    expect(withoutMessage.message).toBeNull()
  })
})

describe('createFeedback', () => {
  it('stores feedback with no author column at all — the row shape itself is anonymous', () => {
    const feedback = createFeedback(seededDb())
    const entry = feedback.add('camp-1', 'Loved the ambush, pacing dragged in act 2')
    expect(entry).toEqual({ id: entry.id, campaignId: 'camp-1', text: 'Loved the ambush, pacing dragged in act 2', createdAt: entry.createdAt })
    expect(Object.keys(entry)).not.toContain('discordId')
  })
})

describe('createLedger', () => {
  it('sums gold deltas and ignores item entries in the total', () => {
    const ledger = createLedger(seededDb())
    ledger.add({ campaignId: 'camp-1', kind: 'gold', delta: 50, actor: 'user-1' })
    ledger.add({ campaignId: 'camp-1', kind: 'gold', delta: -10, actor: 'user-1', note: 'spent on rope' })
    ledger.add({ campaignId: 'camp-1', kind: 'item', item: 'Ruby', actor: 'user-1' })
    expect(ledger.goldTotal('camp-1')).toBe(40)
  })

  it('returns 0 gold for a campaign with no entries', () => {
    const ledger = createLedger(seededDb())
    expect(ledger.goldTotal('camp-1')).toBe(0)
  })

  it('lists recent entries newest first, capped at the limit', () => {
    const ledger = createLedger(seededDb())
    ledger.add({ campaignId: 'camp-1', kind: 'item', item: 'Sword', actor: 'user-1' })
    ledger.add({ campaignId: 'camp-1', kind: 'item', item: 'Shield', actor: 'user-1' })
    const recent = ledger.recent('camp-1', 1)
    expect(recent).toHaveLength(1)
    expect(recent[0].item).toBe('Shield')
  })
})

describe('createCalendar', () => {
  it('returns undefined before a DM has ever set anything', () => {
    const calendar = createCalendar(seededDb())
    expect(calendar.get('camp-1')).toBeUndefined()
  })

  it('sets an absolute day and epoch', () => {
    const calendar = createCalendar(seededDb())
    const state = calendar.set('camp-1', 37, 'The Long Winter')
    expect(state).toEqual({ campaignId: 'camp-1', day: 37, epochLabel: 'The Long Winter' })
    expect(calendar.get('camp-1')).toEqual(state)
  })

  it('setting the day without an epoch leaves the existing epoch untouched', () => {
    const calendar = createCalendar(seededDb())
    calendar.set('camp-1', 10, 'Autumn')
    const state = calendar.set('camp-1', 11)
    expect(state.epochLabel).toBe('Autumn')
  })

  it('advances from a fresh campaign and accumulates', () => {
    const calendar = createCalendar(seededDb())
    expect(calendar.advance('camp-1', 5).day).toBe(5)
    expect(calendar.advance('camp-1', 3).day).toBe(8)
  })
})
