import { describe, expect, it } from 'vitest'
import type { SchedulePoll } from '../db/stores'
import { parseCandidateDate, pollAnnouncement, pollResultAnnouncement, slotStamp, slotSuggestions, toggleVote, voteConfirmation, winningOption } from './schedule'
import { cardText, componentCount, MAX_COMPONENTS } from '../lib/card'

describe('parseCandidateDate', () => {
  it('parses a well-formed date', () => {
    expect(parseCandidateDate('2026-08-22 19:00')).toBe(Date.parse('2026-08-22 19:00'))
  })

  it('throws user_input on garbage', () => {
    expect(() => parseCandidateDate('whenever works')).toThrowError(/couldn't read/i)
  })
})

describe('toggleVote', () => {
  it('records a first vote', () => {
    expect(toggleVote({}, 'user-1', 0)).toEqual({ 'user-1': 0 })
  })

  it('clicking the same option again removes the vote', () => {
    expect(toggleVote({ 'user-1': 0 }, 'user-1', 0)).toEqual({})
  })

  it('clicking a different option switches it', () => {
    expect(toggleVote({ 'user-1': 0 }, 'user-1', 1)).toEqual({ 'user-1': 1 })
  })

  it("never touches another user's vote", () => {
    expect(toggleVote({ 'user-1': 0, 'user-2': 1 }, 'user-1', 1)).toEqual({ 'user-1': 1, 'user-2': 1 })
  })
})

const poll = (votes: Record<string, number>): SchedulePoll => ({
  id: 1,
  campaignId: 'camp-1',
  channelId: 'chan-1',
  messageId: 'msg-1',
  options: ['Friday 8pm', 'Saturday 2pm', 'Sunday noon'],
  votes,
  status: 'open',
  createdAt: 0,
})

describe('winningOption', () => {
  it('picks the option with the most votes', () => {
    expect(winningOption(poll({ a: 1, b: 1, c: 0 }))).toEqual({ index: 1, label: 'Saturday 2pm', votes: 2 })
  })

  it('breaks a tie by the first option', () => {
    expect(winningOption(poll({ a: 0, b: 1 }))).toEqual({ index: 0, label: 'Friday 8pm', votes: 1 })
  })

  it('returns undefined when nobody voted', () => {
    expect(winningOption(poll({}))).toBeUndefined()
  })
})

describe('pollAnnouncement', () => {
  it('pings the campaign role and numbers the options', () => {
    const spec = pollAnnouncement('The Sunken Keep', 'role-1', ['Friday 8pm', 'Saturday 2pm'])
    expect(cardText(spec)).toContain('<@&role-1>')
    expect(spec.noPing).toBeUndefined() // the role line is the point of the card
    expect(cardText(spec)).toContain('**1.** Friday 8pm\n**2.** Saturday 2pm')
  })

  it('stamps a dated slot long and counts it down underneath', () => {
    const sec = Math.floor(Date.parse('2026-09-19 19:00') / 1000)
    const spec = pollAnnouncement('The Sunken Keep', 'role-1', ['2026-09-19 19:00'])
    expect(cardText(spec)).toContain(`**1.** <t:${sec}:F>\n-# <t:${sec}:R>`)
  })

  it('stays inside the component budget at its widest', () => {
    const spec = pollAnnouncement('The Sunken Keep', 'role-1', ['2026-09-19 19:00', '2026-09-20 19:00', '2026-09-21 19:00', '2026-09-22 19:00'], 'attachment://thumb-schedule.png')
    expect(componentCount(spec)).toBeLessThan(MAX_COMPONENTS)
  })
})

describe('pollResultAnnouncement', () => {
  it('announces the winner', () => {
    expect(cardText(pollResultAnnouncement({ index: 0, label: 'Friday 8pm', votes: 3 }))).toContain('Friday 8pm')
  })

  it('leads a dated winner with the long stamp and the countdown', () => {
    const sec = Math.floor(Date.parse('2026-09-19 19:00') / 1000)
    const spec = pollResultAnnouncement({ index: 0, label: '2026-09-19 19:00', votes: 3 })
    expect(cardText(spec)).toContain(`### <t:${sec}:F>\n<t:${sec}:R>`)
    expect(spec.footer).toBe('Won with 3 votes')
  })

  it('handles a poll nobody voted in', () => {
    expect(cardText(pollResultAnnouncement(undefined, 'attachment://thumb-schedule.png'))).toMatch(/no votes/i)
    expect(pollResultAnnouncement(undefined, 'attachment://thumb-schedule.png').thumb).toBe('attachment://thumb-schedule.png')
  })
})

describe('voteConfirmation', () => {
  it('confirms the pick', () => {
    expect(voteConfirmation(poll({ 'user-1': 1 }), 'user-1')).toBe('Voted for **Saturday 2pm**.')
  })

  it('confirms a removal', () => {
    expect(voteConfirmation(poll({}), 'user-1')).toBe('Vote removed.')
  })
})

describe('slotSuggestions', () => {
  // Wed 16 Sep 2026, 10:00 local — every slot below is relative to this.
  const now = new Date(2026, 8, 16, 10, 0, 0).getTime()

  it('offers the next fortnight of evenings when nothing is typed', () => {
    const slots = slotSuggestions('', now)
    expect(slots).toHaveLength(14)
    expect(slots[0]).toEqual({ name: 'Wed 16 Sep, 7:00 pm', value: '2026-09-16 19:00' })
    expect(slots[13]?.value).toBe('2026-09-29 19:00')
    expect(Date.parse(slots[0]!.value)).toBe(new Date(2026, 8, 16, 19, 0).getTime())
  })

  it('narrows by weekday, and moves the hour when one is typed', () => {
    expect(slotSuggestions('sat', now).map((s) => s.name)).toEqual(['Sat 19 Sep, 7:00 pm', 'Sat 26 Sep, 7:00 pm'])
    expect(slotSuggestions('sat 8pm', now)[0]).toEqual({ name: 'Sat 19 Sep, 8:00 pm', value: '2026-09-19 20:00' })
    expect(slotSuggestions('20:30 fri', now)[0]?.value).toBe('2026-09-18 20:30')
    expect(slotSuggestions('7:30 pm sun', now)[0]?.value).toBe('2026-09-20 19:30')
  })

  it('reads a bare small number as an evening hour and a large one as a day of the month', () => {
    expect(slotSuggestions('8', now)[0]?.value).toBe('2026-09-16 20:00')
    expect(slotSuggestions('19', now).map((s) => s.value)).toEqual(['2026-09-19 19:00'])
  })

  it('never offers a slot already in the past', () => {
    const evening = new Date(2026, 8, 16, 21, 0).getTime()
    expect(slotSuggestions('', evening)[0]?.value).toBe('2026-09-17 19:00')
  })

  it('puts a fully typed date first, exactly as typed, and stays within Discord\'s 25', () => {
    const slots = slotSuggestions('2026-10-31 18:00', now)
    expect(slots[0]).toEqual({ name: 'As typed — Sat 31 Oct, 6:00 pm', value: '2026-10-31 18:00' })
    expect(slots.length).toBeLessThanOrEqual(25)
  })

  it('answers nothing for a word no slot matches', () => {
    expect(slotSuggestions('whenever', now)).toEqual([])
  })

  it('understands today, tomorrow, full day names and filler words', () => {
    expect(slotSuggestions('today at 11', now)).toEqual([{ name: 'Wed 16 Sep, 11:00 pm', value: '2026-09-16 23:00' }])
    expect(slotSuggestions('tomorrow', now).map((s) => s.value)).toEqual(['2026-09-17 19:00'])
    expect(slotSuggestions('next saturday at 8pm', now)[0]?.value).toBe('2026-09-19 20:00')
    expect(slotSuggestions('tonight 9', now)[0]?.value).toBe('2026-09-16 21:00')
  })

  it('never lets the lenient date parser turn loose words into a date', () => {
    // V8 reads "today at 11" as the first of November; that must not become an "as typed" slot.
    expect(slotSuggestions('today at 11', now).some((s) => s.name.startsWith('As typed'))).toBe(false)
    expect(() => parseCandidateDate('today at 11')).toThrowError(/couldn't read/i)
    expect(parseCandidateDate('2026-08-21T20:00:00Z')).toBe(Date.parse('2026-08-21T20:00:00Z'))
  })
})

describe('slotStamp', () => {
  it('renders a parseable option as a Discord long stamp and leaves free text alone', () => {
    expect(slotStamp('2026-09-19 19:00')).toBe(`<t:${Math.floor(Date.parse('2026-09-19 19:00') / 1000)}:F>`)
    expect(slotStamp('Saturday 2pm')).toBe('Saturday 2pm')
  })
})
