import { describe, expect, it } from 'vitest'
import { feedbackCard, feedbackThanks, readFeedbackDraft } from './feedback'
import { cardText } from '../lib/card'

describe('feedbackCard', () => {
  it('carries the text but never an author', () => {
    const spec = feedbackCard('The Sunken Keep', 'Loved the ambush', 1_700_000_000_000)
    expect(spec.eyebrow).toContain('The Sunken Keep')
    expect(spec.blocks?.[0]).toBe('> Loved the ambush')
    expect(JSON.stringify(spec)).not.toMatch(/discord/i)
  })

  it('dates it with a Discord stamp, never an ISO string', () => {
    const spec = feedbackCard('The Sunken Keep', 'Loved the ambush', 1_700_000_000_000)
    expect(cardText(spec)).toContain('-# sent <t:1700000000:R>')
    expect(cardText(spec)).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('carries the category on the eyebrow, and reads the same without one', () => {
    expect(feedbackCard('The Sunken Keep', 'It crashed', 1_700_000_000_000, undefined, 'Bug').eyebrow).toBe(
      'Anonymous feedback · The Sunken Keep · Bug',
    )
    expect(feedbackCard('The Sunken Keep', 'It crashed', 1_700_000_000_000).eyebrow).toBe(
      'Anonymous feedback · The Sunken Keep',
    )
  })
})

describe('readFeedbackDraft', () => {
  it('keeps the text and the category it offered', () => {
    expect(readFeedbackDraft({ category: 'Bug', text: ' It crashed ' })).toEqual({ text: 'It crashed', category: 'Bug' })
  })

  it('refuses a category it never offered, and empty or over-long text', () => {
    expect(() => readFeedbackDraft({ category: 'Rant', text: 'x' })).toThrowError(/Bug, Idea, Praise/)
    expect(() => readFeedbackDraft({ category: 'Idea', text: '  ' })).toThrowError(/nothing in there/)
    expect(() => readFeedbackDraft({ category: 'Idea', text: 'x'.repeat(1001) })).toThrowError(/1001 characters/)
  })
})

describe('feedbackThanks', () => {
  it('says it went anonymously', () => {
    expect(feedbackThanks()).toMatch(/anonymous/i)
  })
})
