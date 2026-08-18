import { describe, expect, it } from 'vitest'
import {
  durationLabel,
  elapsedLabel,
  joinUrl,
  liveSessionEmbed,
  previouslyOnEmbed,
  sessionRecapEmbed,
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

const text = (spec: { header?: string; blocks?: string[] }): string =>
  `${spec.header ?? ''}\n${(spec.blocks ?? []).join('\n')}`

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

describe('liveSessionEmbed', () => {
  const base = {
    campaignName: 'The Sunken Keep',
    joinUrl: 'https://table.example/join/AB2CD3',
    startedAt: 1_700_000_000_000,
    calendarLine: 'Day 37',
  }

  it('carries the link, the scene, the world date and who is here', () => {
    const spec = liveSessionEmbed({
      ...base,
      live: { players: ['Zed', 'Mira'], sceneName: 'Cragmaw Hideout', dmConnected: true },
    })
    const body = text(spec)
    expect(spec.header).toBe('Live — The Sunken Keep')
    expect(body).toContain('https://table.example/join/AB2CD3')
    expect(body).toContain('Cragmaw Hideout')
    expect(body).toContain('Day 37')
    expect(body).toContain('**At the table** (2)')
    expect(body).toContain('Zed')
  })

  it('says so plainly when the table is empty or the DM has dropped', () => {
    const body = text(
      liveSessionEmbed({ ...base, live: { players: [], sceneName: null, dmConnected: false } }),
    )
    expect(body).toContain('Nobody at the table yet')
    expect(body).toContain('None yet')
    expect(body).toContain('the DM is away')
  })
})

describe('recap embeds', () => {
  it('reports scenes, doors, duration, players and the world date', () => {
    const body = text(sessionRecapEmbed('The Sunken Keep', recap))
    expect(body).toContain('Cragmaw Hideout → The Vault')
    expect(body).toContain('**Doors opened**: 4')
    expect(body).toContain('2h 13m')
    expect(body).toContain('peak 3')
    expect(body).toContain('Day 37 — The Long Winter')
  })

  it('reuses the same body for "Previously on…"', () => {
    const spec = previouslyOnEmbed('The Sunken Keep', recap)
    expect(spec.header).toBe('Previously on…')
    expect(text(spec)).toContain('Cragmaw Hideout → The Vault')
  })

  it('does not pretend an empty table had scenes or players', () => {
    const body = text(
      sessionRecapEmbed('The Sunken Keep', {
        scenes: [],
        doorsOpened: 0,
        durationMs: 0,
        players: [],
        peakPlayers: 0,
        calendarLine: 'Day 1',
      }),
    )
    expect(body).toContain('**Scenes**: None')
    expect(body).toContain('Nobody')
  })
})
