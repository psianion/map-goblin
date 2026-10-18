import { describe, expect, it } from 'vitest'
import { noteSavedReply, recallResults, sanitizeFtsQuery } from './journal'
import type { Note } from '../db/stores'
import { cardText, componentCount, MAX_COMPONENTS } from '../lib/card'

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

describe('noteSavedReply', () => {
  it('quotes every line of the note back, so nothing reads as the bot talking', () => {
    const text = noteSavedReply('The door was locked.\nThe key was not.')
    expect(cardText(text)).toContain('> The door was locked.\n> The key was not.')
    expect(cardText(text)).toContain('/recall')
  })
})

describe('recallResults', () => {
  const at = Date.parse('2026-08-18T12:00:00Z')
  const note: Note = { id: 1, campaignId: 'camp-1', discordId: 'user-1', text: 'Found a key', createdAt: at }

  it('lists matches with author and a timestamp Discord keeps counting', () => {
    const spec = recallResults('The Sunken Keep', 'key', [note])
    expect(cardText(spec)).toContain('> Found a key')
    expect(cardText(spec)).toContain(`<@user-1> · <t:${at / 1000}:R>`)
    expect(cardText(spec)).toContain('**1** note found')
  })

  it('says nothing found for an empty result set', () => {
    const spec = recallResults('The Sunken Keep', 'nothing', [])
    expect(cardText(spec)).toMatch(/nothing found/i)
  })

  it('shows a window of notes, counts the rest, and stays well inside the component budget', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...note, id: i + 1, text: `Note ${i + 1}` }))
    const spec = recallResults('The Sunken Keep', 'note', many, 'attachment://thumb-journal.png')
    expect(cardText(spec)).toContain('Note 8')
    expect(cardText(spec)).not.toContain('Note 9')
    expect(cardText(spec)).toContain('-# and 22 more — narrow the search')
    // 24 at the cap, so the Share button and a longer footer still fit under Discord's 40.
    expect(componentCount(spec)).toBeLessThan(MAX_COMPONENTS - 10)
  })
})
