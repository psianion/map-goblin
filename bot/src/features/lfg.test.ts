import { describe, expect, it } from 'vitest'
import type { Campaign } from '../db/stores'
import {
  applicationCard,
  applyConfirmation,
  lfgBoardPost,
  lfgCloseConfirmation,
  lfgClosedNotice,
  lfgOpenConfirmation,
  readApplicationDraft,
  readRecruitDraft,
} from './lfg'
import { cardText, componentCount, MAX_COMPONENTS } from '../lib/card'

const campaign: Campaign = {
  goblinCampaignId: 'camp-1',
  name: 'The Sunken Keep',
  channelId: 'chan-1',
  dmChannelId: 'dm-chan-1',
  dmDiscordId: 'dm-1',
  roleId: 'role-1',
  nextSessionAt: null,
  serviceToken: null,
  playerToken: null,
}

describe('lfgBoardPost', () => {
  it('shows the campaign name, the DM and the blurb, without notifying anyone', () => {
    const spec = lfgBoardPost(campaign, 'Looking for a rogue', 'attachment://thumb-campaign.png')
    expect(spec.header).toContain('The Sunken Keep')
    expect(spec.subhead).toBe('**DM** <@dm-1>')
    expect(spec.noPing).toBe(true)
    expect(cardText(spec)).toContain('### About the table\n> Looking for a rogue')
    expect(componentCount(spec)).toBeLessThan(MAX_COMPONENTS)
  })

  it('links the D&D Beyond page only when the campaign has one', () => {
    expect(cardText(lfgBoardPost(campaign, 'Need a rogue'))).not.toContain('dndbeyond')
    const url = 'https://www.dndbeyond.com/campaigns/1234567'
    expect(cardText(lfgBoardPost({ ...campaign, ddbUrl: url }, 'Need a rogue'))).toContain(url)
  })

  it('shows the seat count and the tags the DM ticked, and neither when there are none', () => {
    const spec = lfgBoardPost(campaign, 'Need a rogue', undefined, 3, ['Voice', 'Weekly'])
    expect(spec.subhead).toBe('**DM** <@dm-1>\n**Seats open** · 3')
    expect(cardText(spec)).toContain('-# Voice · Weekly')

    const bare = lfgBoardPost(campaign, 'Need a rogue')
    expect(bare.subhead).toBe('**DM** <@dm-1>')
    expect(cardText(bare)).not.toContain('Seats open')
  })
})

describe('readRecruitDraft', () => {
  const open = { blurb: 'Weekly, homebrew, heavy on exploration.', seats: '3', tags: 'Voice,Weekly' }

  it('takes the blurb, the seat count as a number, and only the tags it offered', () => {
    expect(readRecruitDraft(open)).toEqual({ blurb: open.blurb, seats: 3, tags: ['Voice', 'Weekly'] })
    expect(readRecruitDraft({ ...open, tags: '' }).tags).toEqual([])
    // The client's option list is a suggestion, not a guarantee — anything else is dropped.
    expect(readRecruitDraft({ ...open, tags: 'Voice,Free beer' }).tags).toEqual(['Voice'])
  })

  it('refuses an empty or over-long blurb, and a seat count that was never on offer', () => {
    expect(() => readRecruitDraft({ ...open, blurb: '  ' })).toThrowError(/whole board post/)
    expect(() => readRecruitDraft({ ...open, blurb: 'x'.repeat(1001) })).toThrowError(/1001 characters/)
    expect(() => readRecruitDraft({ ...open, seats: '9' })).toThrowError(/1 to 6/)
  })

  it('reads the blurb back so a refusal can be retyped from the card', () => {
    expect(() => readRecruitDraft({ ...open, seats: '' })).toThrowError(/You put · Weekly, homebrew/)
  })
})

describe('readApplicationDraft', () => {
  const filled = { pitch: 'I love rogues', experience: 'Veteran', availability: 'Weeknights after 8' }

  it('keeps all three, and turns an empty pitch into no pitch at all', () => {
    expect(readApplicationDraft(filled)).toEqual({
      message: 'I love rogues',
      experience: 'Veteran',
      availability: 'Weeknights after 8',
    })
    expect(readApplicationDraft({ ...filled, pitch: '   ' }).message).toBeNull()
  })

  it('refuses an experience it never offered, and availability that is missing or too long', () => {
    expect(() => readApplicationDraft({ ...filled, experience: 'Dungeon god' })).toThrowError(/New to D&D/)
    expect(() => readApplicationDraft({ ...filled, availability: '' })).toThrowError(/when you can play/)
    expect(() => readApplicationDraft({ ...filled, availability: 'x'.repeat(101) })).toThrowError(/101 characters/)
    expect(() => readApplicationDraft({ ...filled, pitch: 'x'.repeat(1001) })).toThrowError(/1001 characters/)
  })
})

describe('applicationCard', () => {
  it('pings the DM and names the applicant, with a message', () => {
    const spec = applicationCard('The Sunken Keep', 'dm-1', 'applicant-1', 'I love rogues', 1_700_000_000_000)
    expect(cardText(spec)).toContain('<@dm-1>')
    expect(cardText(spec)).toContain('<@applicant-1>')
    expect(spec.noPing).toBeUndefined() // the DM has to hear about this one
    expect(cardText(spec)).toContain('-# applied <t:1700000000:R>')
    expect(cardText(spec)).toContain('### Their pitch\n> I love rogues')
  })

  it('omits the pitch when the applicant sent none', () => {
    const spec = applicationCard('The Sunken Keep', 'dm-1', 'applicant-1', null, 1_700_000_000_000)
    expect(cardText(spec)).toContain('<@applicant-1> would like to join.')
    expect(cardText(spec)).not.toContain('Their pitch')
    expect(spec.blocks).toHaveLength(1)
  })

  it('puts experience and availability above the pitch — what the DM sorts by, then what they read', () => {
    const spec = applicationCard(
      'The Sunken Keep',
      'dm-1',
      'applicant-1',
      'I love rogues',
      1_700_000_000_000,
      undefined,
      'Veteran',
      'Weeknights after 8',
    )
    const text = cardText(spec)
    expect(text).toContain('**Experience** · Veteran\n**Availability** · Weeknights after 8')
    expect(text.indexOf('**Experience**')).toBeLessThan(text.indexOf('Their pitch'))
  })
})

describe('confirmations', () => {
  it('name the campaign', () => {
    expect(applyConfirmation('The Sunken Keep')).toContain('The Sunken Keep')
    expect(lfgOpenConfirmation('The Sunken Keep')).toContain('The Sunken Keep')
    expect(lfgOpenConfirmation('The Sunken Keep')).not.toMatch(/LFG/)
    expect(lfgCloseConfirmation('The Sunken Keep')).toContain('The Sunken Keep')
    expect(lfgClosedNotice('The Sunken Keep').header).toContain('The Sunken Keep')
  })
})
