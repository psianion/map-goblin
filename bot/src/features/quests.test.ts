import { describe, expect, it } from 'vitest'
import { questLog } from './quests'
import type { Quest } from '../db/stores'
import { cardText } from '../lib/card'

function quest(over: Partial<Quest>): Quest {
  return { id: 1, campaignId: 'c', title: 'Find the key', status: 'active', addedBy: 'dm-1', createdAt: 0, ...over }
}

describe('questLog', () => {
  it('lists active quests before completed ones, struck through', () => {
    const spec = questLog('The Sunken Keep', [
      quest({ id: 1, title: 'Find the key', status: 'active' }),
      quest({ id: 2, title: 'Slay the dragon', status: 'done' }),
    ])
    expect(cardText(spec)).toContain('**Find the key**')
    expect(cardText(spec)).toContain('~~Slay the dragon~~')
    expect(cardText(spec).indexOf('Find the key')).toBeLessThan(cardText(spec).indexOf('Slay the dragon'))
  })

  it('says no active quests when there are none, but still shows completed', () => {
    const spec = questLog('The Sunken Keep', [quest({ status: 'done' })])
    expect(cardText(spec)).toMatch(/no active quests/i)
  })

  it('omits the completed block entirely when nothing is done', () => {
    const spec = questLog('The Sunken Keep', [quest({ status: 'active' })])
    expect(spec.blocks).toHaveLength(1)
    expect(cardText(spec)).not.toContain('Closed')
  })

  it('shows a window of each list and counts the rest, staying at three blocks', () => {
    const many = [
      ...Array.from({ length: 14 }, (_, i) => quest({ id: i, title: `Open ${i}`, status: 'active' })),
      ...Array.from({ length: 8 }, (_, i) => quest({ id: 100 + i, title: `Done ${i}`, status: 'done', createdAt: i })),
    ]
    const text = cardText(questLog('The Sunken Keep', many))
    expect(text).toContain('### Open · 14')
    expect(text).toContain('**Open 9**')
    expect(text).not.toContain('**Open 10**')
    expect(text).toContain('-# and 4 more')
    expect(text).toContain('### Closed · 8')
    // Most recent first: the newest five of the eight, so "Done 2" is the oldest shown.
    expect(text).toContain('~~Done 7~~')
    expect(text).toContain('~~Done 3~~')
    expect(text).not.toContain('~~Done 2~~')
    expect(text).toContain('-# and 3 more')
  })
})
