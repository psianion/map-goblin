import { describe, expect, it } from 'vitest'
import { feedbackCard, feedbackThanks } from './feedback'

describe('feedbackCard', () => {
  it('carries the text but never an author', () => {
    const spec = feedbackCard('The Sunken Keep', 'Loved the ambush')
    expect(spec.header).toContain('The Sunken Keep')
    expect(spec.blocks).toEqual(['Loved the ambush'])
    expect(JSON.stringify(spec)).not.toMatch(/discord/i)
  })
})

describe('feedbackThanks', () => {
  it('says it went anonymously', () => {
    expect(feedbackThanks()).toMatch(/anonymous/i)
  })
})
