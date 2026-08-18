import { describe, expect, it } from 'vitest'
import { campaignSetupConfirmation } from './campaign'
import type { CampaignInput } from '../db/stores'

const input: CampaignInput = {
  goblinCampaignId: 'camp-1',
  name: 'The Sunken Keep',
  channelId: 'chan-1',
  dmChannelId: 'dm-1',
  roleId: 'role-1',
  dmDiscordId: 'dm-user-1',
}

describe('campaignSetupConfirmation', () => {
  it('mentions every registered channel, role and DM', () => {
    const text = campaignSetupConfirmation(input)
    expect(text).toContain('The Sunken Keep')
    expect(text).toContain('camp-1')
    expect(text).toContain('<#chan-1>')
    expect(text).toContain('<#dm-1>')
    expect(text).toContain('<@&role-1>')
    expect(text).toContain('<@dm-user-1>')
  })
})
