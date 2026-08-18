import { describe, expect, it } from 'vitest'
import { openDb } from './db'
import {
  createCalendar,
  createCampaigns,
  createCharacters,
  createLedger,
  createNotes,
  createQuests,
  createRolls,
  type CampaignInput,
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
    expect(campaigns.byChannel('player-chan')).toEqual(campaignInput)
    expect(campaigns.byChannel('dm-chan')).toEqual(campaignInput)
    expect(campaigns.byChannel('random')).toBeUndefined()
  })

  it('upsert on the same goblin id replaces the row instead of inserting a second one', () => {
    const campaigns = createCampaigns(openDb(':memory:'))
    campaigns.upsert(campaignInput)
    campaigns.upsert({ ...campaignInput, name: 'Renamed', channelId: 'new-player-chan' })
    expect(campaigns.byChannel('player-chan')).toBeUndefined()
    expect(campaigns.byChannel('new-player-chan')).toMatchObject({ name: 'Renamed' })
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
