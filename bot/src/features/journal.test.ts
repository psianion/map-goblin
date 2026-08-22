import { describe, expect, it } from 'vitest'
import { recallEmbed, relativeTime, sanitizeFtsQuery } from './journal'
import type { Note } from '../db/stores'

describe('sanitizeFtsQuery', () => {
  it('quotes each token so it is a literal phrase, not an operator', () => {
    expect(sanitizeFtsQuery('goblin cave')).toBe('"goblin" "cave"')
  })

  it('escapes embedded double quotes', () => {
    expect(sanitizeFtsQuery('the "sunken" keep')).toBe('"the" """sunken""" "keep"')
  })

  it('rejects an empty or whitespace-only query', () => {
    expect(() => sanitizeFtsQuery('')).toThrowError(/something to search/)
    expect(() => sanitizeFtsQuery('   ')).toThrowError(/something to search/)
  })

  it.each(['AND', 'OR', 'NOT', '-word', '*', '((()', '"unterminated'])(
    'neutralizes hostile fts5 syntax %j into a plain phrase',
    (raw) => {
      expect(() => sanitizeFtsQuery(raw)).not.toThrow()
    },
  )
})

describe('relativeTime', () => {
  const now = Date.parse('2026-08-18T12:00:00Z')

  it('buckets by minutes, hours, days', () => {
    expect(relativeTime(now - 10_000, now)).toBe('just now')
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5m ago')
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h ago')
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2d ago')
  })

  it('falls back to a calendar date beyond 30 days', () => {
    expect(relativeTime(now - 40 * 86_400_000, now)).toBe('2026-07-09')
  })
})

describe('recallEmbed', () => {
  const note: Note = { id: 1, campaignId: 'camp-1', discordId: 'user-1', text: 'Found a key', createdAt: Date.now() }

  it('lists matches with author and relative date', () => {
    const spec = recallEmbed('key', [note])
    expect(spec.blocks?.[0]).toContain('Found a key')
    expect(spec.blocks?.[0]).toContain('<@user-1>')
  })

  it('says nothing found for an empty result set', () => {
    const spec = recallEmbed('nothing', [])
    expect(spec.blocks?.[0]).toMatch(/nothing found/i)
  })
})
