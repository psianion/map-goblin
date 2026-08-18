import { describe, expect, it } from 'vitest'
import { questLog } from './quests'
import type { Quest } from '../db/stores'

function quest(over: Partial<Quest>): Quest {
  return { id: 1, campaignId: 'c', title: 'Find the key', status: 'active', addedBy: 'dm-1', createdAt: 0, ...over }
}

describe('questLog', () => {
  it('lists active quests before completed ones, struck through', () => {
    const spec = questLog('The Sunken Keep', [
      quest({ id: 1, title: 'Find the key', status: 'active' }),
      quest({ id: 2, title: 'Slay the dragon', status: 'done' }),
    ])
    expect(spec.blocks?.[0]).toBe('• Find the key')
    expect(spec.blocks?.[1]).toBe('~~Slay the dragon~~')
  })

  it('says no active quests when there are none, but still shows completed', () => {
    const spec = questLog('The Sunken Keep', [quest({ status: 'done' })])
    expect(spec.blocks?.[0]).toMatch(/no active quests/i)
  })

  it('omits the completed block entirely when nothing is done', () => {
    const spec = questLog('The Sunken Keep', [quest({ status: 'active' })])
    expect(spec.blocks).toHaveLength(1)
  })
})
