import { describe, expect, it } from 'vitest'
import type { Campaign, Character } from '../db/stores'
import type { TableHealth } from '../goblin/live-session'
import { cardText, TONE } from '../lib/card'
import { campaignStatus, needsScheduleNudge } from './status'

const campaign: Campaign = {
  goblinCampaignId: 'camp-1',
  name: 'The Sunken Keep',
  channelId: 'chan-1',
  dmChannelId: 'dm-1',
  dmDiscordId: 'dm-user',
  roleId: 'role-1',
  nextSessionAt: null,
  serviceToken: null,
  playerToken: null,
}

const zed: Character = {
  id: 1,
  discordId: 'user-1',
  campaignId: 'camp-1',
  name: 'Zed',
  className: 'Fighter',
  level: 3,
  portraitUrl: null,
  lastPlayed: null,
}

const table: TableHealth = {
  campaignId: 'camp-1',
  joinUrl: 'https://table.example/join/AB2CD3',
  campaignName: 'The Sunken Keep',
  sceneName: 'Cragmaw Hideout',
  players: 2,
  dmConnected: true,
  connected: true,
  attempts: 0,
  startedAt: 1_700_000_000_000,
}

const stampOf = (iso: string): number => Math.floor(Date.parse(iso) / 1000)

describe('needsScheduleNudge', () => {
  it('nudges when nothing is scheduled', () => {
    expect(needsScheduleNudge(null, 1000)).toBe(true)
  })

  it('nudges when the scheduled date has passed', () => {
    expect(needsScheduleNudge(500, 1000)).toBe(true)
  })

  it('does not nudge for a future date', () => {
    expect(needsScheduleNudge(1500, 1000)).toBe(false)
  })
})

describe('campaignStatus', () => {
  it('heads the card with the campaign, its DM and the D&D Beyond link when there is one', () => {
    const plain = campaignStatus({ campaign, characters: [], now: 1000 })
    expect(plain.header).toBe('The Sunken Keep')
    expect(plain.subhead).toBe('**DM** <@dm-user>')

    const linked = campaignStatus({
      campaign: { ...campaign, ddbUrl: 'https://www.dndbeyond.com/campaigns/1234567' },
      characters: [],
      thumb: 'attachment://thumb-campaign.png',
      now: 1000,
    })
    expect(linked.subhead).toContain('[D&D Beyond campaign](https://www.dndbeyond.com/campaigns/1234567)')
    expect(linked.thumb).toBe('attachment://thumb-campaign.png')
  })

  it('links to an open table and says who is at it and whether the bot still hears it', () => {
    const spec = campaignStatus({ campaign, characters: [], table, now: 1_700_000_600_000 })
    const text = cardText(spec)
    expect(spec.accent).toBe(TONE.live)
    expect(text).toContain('### Table · Open')
    expect(text).toContain('**Cragmaw Hideout** · 2 players seated · opened <t:1700000000:R>')
    expect(text).toContain('Online · DM at the table')
    expect(text).toContain('[Join the table] https://table.example/join/AB2CD3')

    const shaky = cardText(campaignStatus({ campaign, characters: [], table: { ...table, connected: false, dmConnected: false } }))
    expect(shaky).toContain('Bot is reconnecting to the table · DM away')
  })

  it('says the table is closed, in the resting colour, when no session is running', () => {
    const spec = campaignStatus({ campaign, characters: [], now: 1000 })
    expect(spec.accent).toBe(TONE.ink)
    expect(cardText(spec)).toContain('### Table · Closed')
    expect(cardText(spec)).not.toContain('Join the table')
  })

  it('gives the next session as Discord timestamps, so every reader sees their own timezone', () => {
    const spec = campaignStatus({
      campaign: { ...campaign, nextSessionAt: Date.parse('2030-01-01T19:00:00Z') },
      characters: [],
      now: Date.parse('2026-01-01'),
    })
    const at = stampOf('2030-01-01T19:00:00Z')
    expect(cardText(spec)).toContain(`**Next**  <t:${at}:F> · <t:${at}:R>`)
    expect(cardText(spec)).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('nudges toward /schedule when nothing is booked, or the booked date has passed', () => {
    for (const nextSessionAt of [null, 500])
      expect(cardText(campaignStatus({ campaign: { ...campaign, nextSessionAt }, characters: [], now: 1000 }))).toContain(
        '**Next**  _Nothing scheduled._ `/schedule` puts it to a vote.',
      )
  })

  it('reports sessions played and how long ago the last one was', () => {
    const spec = campaignStatus({
      campaign,
      characters: [],
      sessionStats: { played: 7, lastStartedAt: Date.parse('2026-08-17T19:00:00Z') },
      now: 1000,
    })
    expect(cardText(spec)).toContain(`**Played**  7 · last one <t:${stampOf('2026-08-17T19:00:00Z')}:R>`)
  })

  it('says none rather than zero-with-a-date before a first table', () => {
    expect(cardText(campaignStatus({ campaign, characters: [], now: 1000 }))).toContain('**Played**  None yet')
  })

  it('lists the party, and leaves out the ledger, quests, calendar and dice board', () => {
    const text = cardText(campaignStatus({ campaign, characters: [zed], now: 1000 }))
    expect(text).toContain('### Party · 1')
    expect(text).toContain('**Zed** · Fighter 3 · <@user-1>')
    expect(text).not.toMatch(/gold|quest|leaderboard|world date/i)
  })
})
