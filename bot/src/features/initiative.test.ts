import { describe, expect, it } from 'vitest'
import { initiativeReceipt } from './initiative'
import { cardText, componentCount, MAX_COMPONENTS } from '../lib/card'
import type { WireInitiativeEntry } from '../goblin/observer'

const entry = (key: string, name: string, initiative: number | null = null): WireInitiativeEntry => ({
  key,
  name,
  initiative,
})

const receipt = (entries: WireInitiativeEntry[], value = 17, on = 'e2') =>
  initiativeReceipt({
    campaignName: 'The Sunken Keep',
    entry: entries.find((e) => e.key === on)!,
    value,
    entries,
  })

describe('initiativeReceipt', () => {
  it('orders the encounter highest first, with the number just sent laid over the roster', () => {
    const spec = receipt([entry('e1', 'Goblin', 12), entry('e2', 'Zed'), entry('e3', 'Wolf', 20)])
    expect(cardText(spec)).toContain('**1.** Wolf · 20')
    expect(cardText(spec)).toContain('**2.** **Zed** · **17**')
    expect(cardText(spec)).toContain('**3.** Goblin · 12')
  })

  it('lists who has not rolled as subtext rather than numbering them into the order', () => {
    const spec = receipt([entry('e1', 'Goblin'), entry('e2', 'Zed'), entry('e3', 'Wolf')])
    expect(cardText(spec)).toContain('**1.** **Zed** · **17**')
    expect(cardText(spec)).toContain('-# Still to roll · Goblin, Wolf')
    expect(cardText(spec)).not.toContain('**2.**')
  })

  it('names the combatant and the number in the head', () => {
    const spec = receipt([entry('e2', 'Zed')], 8)
    expect(spec.eyebrow).toBe('Initiative · The Sunken Keep')
    expect(spec.subhead).toBe('**Zed** · initiative **8**')
  })

  // A big encounter is still one text block, and the block itself is windowed.
  it('stays well inside the component budget for a crowded fight', () => {
    const entries = [
      entry('e2', 'Zed'),
      ...Array.from({ length: 60 }, (_, i) => entry(`k${i}`, `Goblin ${i}`, i)),
    ]
    const spec = receipt(entries)
    expect(componentCount(spec)).toBeLessThan(MAX_COMPONENTS - 10)
    expect(cardText(spec)).toContain('further down the order')
  })
})
