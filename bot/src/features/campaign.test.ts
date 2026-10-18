import { describe, expect, it } from 'vitest'
import { campaignSetupConfirmation, readCampaignDraft } from './campaign'
import { cardText } from '../lib/card'
import type { CampaignInput } from '../db/stores'

const input: CampaignInput = {
  goblinCampaignId: 'camp-1',
  name: 'The Sunken Keep',
  channelId: 'chan-1',
  dmChannelId: 'dm-1',
  roleId: 'role-1',
  dmDiscordId: 'dm-user-1',
}

describe('readCampaignDraft', () => {
  const typed = { name: ' The Sunken Keep ', id: '18358431-cfeb-46c8-b72b-9a9ac33f0eb8' }

  it('trims the name and keeps the id as the server spells it', () => {
    expect(readCampaignDraft(typed)).toEqual({
      name: 'The Sunken Keep',
      goblinCampaignId: '18358431-cfeb-46c8-b72b-9a9ac33f0eb8',
    })
  })

  it('refuses a name that would not fit and an id a custom id could not carry', () => {
    expect(() => readCampaignDraft({ ...typed, name: '' })).toThrow(/needs a name/)
    expect(() => readCampaignDraft({ ...typed, name: 'a'.repeat(61) })).toThrow(/61 characters/)
    // `:` is the custom-id separator, and a space is never part of one.
    for (const id of ['', 'camp:9', 'not an id', 'x'.repeat(61)])
      expect(() => readCampaignDraft({ ...typed, id })).toThrow(/game-server campaign id/)
  })
})

describe('campaignSetupConfirmation', () => {
  it('mentions every registered channel, role and DM', () => {
    const text = cardText(campaignSetupConfirmation(input))
    expect(text).toContain('The Sunken Keep')
    expect(text).toContain('camp-1')
    expect(text).toContain('<#chan-1>')
    expect(text).toContain('<#dm-1>')
    expect(text).toContain('<@&role-1>')
    expect(text).toContain('<@dm-user-1>')
  })

  it('links the D&D Beyond page only when setup was given one', () => {
    expect(cardText(campaignSetupConfirmation(input))).not.toContain('D&D Beyond')
    const linked = campaignSetupConfirmation({ ...input, ddbUrl: 'https://www.dndbeyond.com/campaigns/1' })
    expect(cardText(linked)).toContain('https://www.dndbeyond.com/campaigns/1')
  })
})
