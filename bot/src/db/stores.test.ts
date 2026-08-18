import { describe, expect, it } from 'vitest'
import { openDb } from './db'
import { createCampaigns, createCharacters, type CampaignInput } from './stores'

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
