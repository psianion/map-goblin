import { describe, expect, it } from 'vitest'
import { calendarAdvanceAnnouncement, calendarLine } from './calendar'

describe('calendarLine', () => {
  it('defaults to Day 1 before a DM has set anything', () => {
    expect(calendarLine(undefined)).toBe('Day 1')
  })

  it('shows the day alone with no epoch', () => {
    expect(calendarLine({ campaignId: 'c', day: 37, epochLabel: null })).toBe('Day 37')
  })

  it('appends the epoch label when set', () => {
    expect(calendarLine({ campaignId: 'c', day: 37, epochLabel: 'The Long Winter' })).toBe(
      'Day 37 — The Long Winter',
    )
  })
})

describe('calendarAdvanceAnnouncement', () => {
  it('pluralizes days correctly', () => {
    const state = { campaignId: 'c', day: 5, epochLabel: null }
    expect(calendarAdvanceAnnouncement(state, 1).header).toBe('1 day passes')
    expect(calendarAdvanceAnnouncement(state, 3).header).toBe('3 days pass')
  })
})
