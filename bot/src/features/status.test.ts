import { describe, expect, it } from 'vitest'
import type { Campaign, Character, Quest, RollStats } from '../db/stores'
import { campaignStatus, needsScheduleNudge } from './status'

const campaign: Campaign = {
  goblinCampaignId: 'camp-1',
  name: 'The Sunken Keep',
  channelId: 'chan-1',
  dmChannelId: 'dm-1',
  dmDiscordId: 'dm-user',
  roleId: 'role-1',
  nextSessionAt: null,
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

const quests: Quest[] = [
  { id: 1, campaignId: 'camp-1', title: 'Find the key', status: 'active', addedBy: 'dm-user', createdAt: 0 },
  { id: 2, campaignId: 'camp-1', title: 'Slay the dragon', status: 'done', addedBy: 'dm-user', createdAt: 0 },
]

const rollStats: RollStats[] = [{ characterId: 1, rolls: 12, nat20s: 2, nat1s: 1 }]

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
  it('assembles roster, quests, gold, calendar, schedule and leaderboard', () => {
    const spec = campaignStatus({
      campaign: { ...campaign, nextSessionAt: Date.parse('2030-01-01') },
      characters: [zed],
      quests,
      goldTotal: 150,
      calendarState: { campaignId: 'camp-1', day: 12, epochLabel: null },
      rollStats,
      now: Date.parse('2026-01-01'),
    })
    const text = spec.blocks?.join('\n') ?? ''
    expect(text).toContain('**Zed** — Fighter 3 — <@user-1>')
    expect(text).toContain('1 active / 1 done')
    expect(text).toContain('150')
    expect(text).toContain('Day 12')
    expect(text).toContain('2030-01-01')
    expect(text).toContain('12 rolls, 2 nat 20s, 1 nat 1s')
  })

  it('shows the /schedule nudge when nothing is booked', () => {
    const spec = campaignStatus({
      campaign,
      characters: [],
      quests: [],
      goldTotal: 0,
      calendarState: undefined,
      rollStats: [],
      now: 1000,
    })
    expect(spec.blocks?.join('\n')).toContain('No session scheduled — /schedule one.')
  })

  it('still nudges when the scheduled date has already passed', () => {
    const spec = campaignStatus({
      campaign: { ...campaign, nextSessionAt: 500 },
      characters: [],
      quests: [],
      goldTotal: 0,
      calendarState: undefined,
      rollStats: [],
      now: 1000,
    })
    expect(spec.blocks?.join('\n')).toContain('No session scheduled — /schedule one.')
  })

  it('does not mention sessions-played or last-session (M5 seam, not built yet)', () => {
    const spec = campaignStatus({
      campaign,
      characters: [],
      quests: [],
      goldTotal: 0,
      calendarState: undefined,
      rollStats: [],
      now: 1000,
    })
    const text = spec.blocks?.join('\n') ?? ''
    expect(text).not.toMatch(/sessions played/i)
    expect(text).not.toMatch(/last session/i)
  })
})
