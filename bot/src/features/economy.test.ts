import { describe, expect, it } from 'vitest'
import { lootListEmbed, splitNote, splitShares } from './economy'
import type { LedgerEntry } from '../db/stores'

describe('splitShares', () => {
  it('splits evenly with no remainder', () => {
    expect(splitShares(100, 4)).toEqual({ share: 25, remainder: 0 })
  })

  it('floors and carries the remainder', () => {
    expect(splitShares(100, 3)).toEqual({ share: 33, remainder: 1 })
  })

  it('puts everything in the remainder when there is no one to split with', () => {
    expect(splitShares(100, 0)).toEqual({ share: 0, remainder: 100 })
    expect(splitShares(100, -1)).toEqual({ share: 0, remainder: 100 })
  })
})

describe('splitNote', () => {
  it('mentions the leftover only when there is one', () => {
    expect(splitNote(4, { share: 25, remainder: 0 })).not.toMatch(/left in the pot/)
    expect(splitNote(3, { share: 33, remainder: 1 })).toMatch(/1 left in the pot/)
  })
})

describe('lootListEmbed', () => {
  it('shows the gold total and recent entries, item and gold formatted differently', () => {
    const entries: LedgerEntry[] = [
      { id: 1, campaignId: 'c', kind: 'gold', delta: 50, item: null, actor: 'u1', note: null, createdAt: 1 },
      { id: 2, campaignId: 'c', kind: 'item', delta: null, item: 'Ruby', actor: 'u1', note: 'shiny', createdAt: 2 },
    ]
    const spec = lootListEmbed(150, entries)
    expect(spec.header).toBe('Party gold: 150')
    expect(spec.blocks?.[0]).toContain('+50 gold')
    expect(spec.blocks?.[0]).toContain('Ruby — shiny')
  })

  it('says nothing logged for an empty ledger', () => {
    expect(lootListEmbed(0, []).blocks?.[0]).toMatch(/nothing logged/i)
  })
})
