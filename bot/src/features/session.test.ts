import { describe, expect, it } from 'vitest'
import { cardText, componentCount, MAX_COMPONENTS } from '../lib/card'
import {
  durationLabel,
  elapsedLabel,
  joinUrl,
  liveSessionBoard,
  previouslyOnCard,
  sessionClosedBoard,
  sessionEndedReply,
  sessionRecapCard,
  sessionStartedReply,
} from './session'
import type { SessionRecap } from '../db/stores'

const recap: SessionRecap = {
  scenes: ['Cragmaw Hideout', 'The Vault'],
  doorsOpened: 4,
  durationMs: 2 * 3_600_000 + 13 * 60_000,
  players: ['Zed', 'Mira'],
  peakPlayers: 3,
  calendarLine: 'Day 37 — The Long Winter',
}

const text = cardText

describe('joinUrl', () => {
  it('builds the shared table link and tolerates a trailing slash', () => {
    expect(joinUrl('https://table.example', 'AB2CD3')).toBe('https://table.example/join/AB2CD3')
    expect(joinUrl('https://table.example/', 'AB2CD3')).toBe('https://table.example/join/AB2CD3')
  })
})

describe('durationLabel', () => {
  it('reads like a recap line, not a stopwatch', () => {
    expect(durationLabel(0)).toBe('under a minute')
    expect(durationLabel(59_000)).toBe('under a minute')
    expect(durationLabel(47 * 60_000)).toBe('47m')
    expect(durationLabel(2 * 3_600_000)).toBe('2h')
    expect(durationLabel(2 * 3_600_000 + 13 * 60_000)).toBe('2h 13m')
  })
})

describe('elapsedLabel', () => {
  it('hands Discord a relative timestamp so the clock costs no edits', () => {
    expect(elapsedLabel(1_700_000_000_000)).toBe('<t:1700000000:R>')
  })
})

describe('liveSessionBoard', () => {
  const base = {
    campaignName: 'The Sunken Keep',
    dmDiscordId: 'dm-1',
    joinUrl: 'https://table.example/join/AB2CD3',
    startedAt: 1_700_000_000_000,
    calendarLine: 'Day 37',
  }

  it('carries the link, the scene, the world date and who is here', () => {
    const spec = liveSessionBoard({
      ...base,
      live: { players: ['Zed', 'Mira'], sceneName: 'Cragmaw Hideout', sceneId: 'scene-1', dmConnected: true },
    })
    const body = text(spec)
    expect(spec.eyebrow).toBe('Live session · The Sunken Keep')
    expect(spec.subhead).toBe('**DM** <@dm-1> · opened <t:1700000000:R>')
    expect(body).toContain('https://table.example/join/AB2CD3')
    expect(body).toContain('Cragmaw Hideout')
    expect(body).toContain('Day 37')
    expect(body).toContain('### At the table · 2')
    expect(body).toContain('> Zed')
  })

  it('names the DM without notifying them, every edit for the whole evening', () => {
    expect(
      liveSessionBoard({
        ...base,
        live: { players: [], sceneName: null, sceneId: null, dmConnected: true },
      }).noPing,
    ).toBe(true)
  })

  it('says so plainly when the table is empty or the DM has dropped', () => {
    const body = text(
      liveSessionBoard({ ...base, live: { players: [], sceneName: null, sceneId: null, dmConnected: false } }),
    )
    expect(body).toContain('The benches are empty')
    expect(body).toContain('still setting the stage')
    expect(body).toContain('The DM has stepped away')
  })

  it('stays inside the component budget with a full table', () => {
    const spec = liveSessionBoard({
      ...base,
      thumb: 'attachment://thumb-campaign.png',
      live: {
        players: Array.from({ length: 12 }, (_, i) => `Player ${i + 1}`),
        sceneName: 'Cragmaw Hideout',
        sceneId: 'scene-1',
        dmConnected: true,
      },
    })
    expect(componentCount(spec)).toBeLessThan(MAX_COMPONENTS)
  })
})

describe('recap embeds', () => {
  it('reports scenes, doors, duration, players and the world date', () => {
    const spec = sessionRecapCard('The Sunken Keep', recap, 1_700_000_000_000)
    const body = text(spec)
    expect(spec.subhead).toBe('Played **2h 13m** · closed <t:1700000000:R>')
    expect(body).toContain('Cragmaw Hideout → The Vault')
    expect(body).toContain('**Doors opened** · 4')
    expect(body).toContain('**Peak table** · 3 players')
    expect(body).toContain('**Time at the table** · 2h 13m')
    expect(body).toContain('> Zed')
    expect(body).toContain('Day 37 — The Long Winter')
  })

  it('reuses the same body for "Previously on…", dated only when the row was closed', () => {
    const spec = previouslyOnCard('The Sunken Keep', recap, 1_700_000_000_000)
    expect(spec.header).toBe('Previously on…')
    expect(spec.subhead).toBe('Last session <t:1700000000:R>')
    expect(text(spec)).toContain('Cragmaw Hideout → The Vault')
    expect(previouslyOnCard('The Sunken Keep', recap, null).subhead).toBeUndefined()
  })

  it('leaves the closed board a stub, not a second copy of the recap', () => {
    const spec = sessionClosedBoard('The Sunken Keep', recap)
    expect(spec.header).toBe('The table has closed')
    const body = text(spec)
    expect(body).toContain('Played **2h 13m**. The recap is posted below.')
    expect(body).not.toContain('Cragmaw Hideout')
  })

  it('does not pretend an empty table had scenes or players', () => {
    const body = text(
      sessionRecapCard(
        'The Sunken Keep',
        {
          scenes: [],
          doorsOpened: 0,
          durationMs: 0,
          players: [],
          peakPlayers: 0,
          calendarLine: 'Day 1',
        },
        1_700_000_000_000,
      ),
    )
    expect(body).toContain('never left the doorstep')
    expect(body).toContain('Nobody sat down')
    expect(body).toContain('**Peak table** · 0 players')
  })
})

describe('the DM\'s own replies', () => {
  it('points the DM at the player channel, with the join link on a button', () => {
    const body = text(sessionStartedReply('https://table.example/join/AB2CD3', 'player-chan'))
    expect(body).toContain('**The table is open.**')
    expect(body).toContain('<#player-chan>')
    expect(body).toContain('[Join the table] https://table.example/join/AB2CD3')
    expect(text(sessionEndedReply(recap, 'player-chan'))).toBe(
      'Session\n**Table closed** after 2h 13m.\nThe recap is posted in <#player-chan>.',
    )
  })
})
