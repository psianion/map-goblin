import { describe, expect, it } from 'vitest'
import type { SchedulePoll } from '../db/stores'
import { parseCandidateDate, pollAnnouncement, pollResultAnnouncement, toggleVote, voteConfirmation, winningOption } from './schedule'

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
    expect(spec.blocks?.[0]).toContain('<@&role-1>')
    expect(spec.blocks?.[1]).toBe('1. Friday 8pm\n2. Saturday 2pm')
  })
})

describe('pollResultAnnouncement', () => {
  it('announces the winner', () => {
    expect(pollResultAnnouncement({ index: 0, label: 'Friday 8pm', votes: 3 }).blocks?.[0]).toContain('Friday 8pm')
  })

  it('handles a poll nobody voted in', () => {
    expect(pollResultAnnouncement(undefined).blocks?.[0]).toMatch(/no votes/i)
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
