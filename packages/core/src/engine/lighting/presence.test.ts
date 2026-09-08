import { describe, expect, it } from 'vitest'
import { LIGHT_FADE_MS, advancePresence, easePresence } from './presence'

describe('advancePresence', () => {
  it('brings a light that joined the set up over the fade, then holds it at 1', () => {
    let p = advancePresence(new Map(), new Set(['a']), 100, LIGHT_FADE_MS)
    expect(p.get('a')).toBeCloseTo(1 / 3)
    p = advancePresence(p, new Set(['a']), 100, LIGHT_FADE_MS)
    p = advancePresence(p, new Set(['a']), 100, LIGHT_FADE_MS)
    expect(p.get('a')).toBe(1)
    p = advancePresence(p, new Set(['a']), 1000, LIGHT_FADE_MS)
    expect(p.get('a')).toBe(1)
  })

  it('keeps a light that left the set until it has faded all the way out', () => {
    let p = new Map([['a', 1], ['b', 1]])
    p = advancePresence(p, new Set(['b']), 100, LIGHT_FADE_MS)
    expect(p.get('a')).toBeCloseTo(2 / 3)
    expect(p.get('b')).toBe(1)
    p = advancePresence(p, new Set(['b']), 250, LIGHT_FADE_MS)
    expect(p.has('a')).toBe(false)
    expect([...p.keys()]).toEqual(['b'])
  })

  it('a light that comes back mid-fade climbs from where it was, not from 0', () => {
    let p = new Map([['a', 1]])
    p = advancePresence(p, new Set(), 150, LIGHT_FADE_MS)
    expect(p.get('a')).toBeCloseTo(0.5)
    p = advancePresence(p, new Set(['a']), 30, LIGHT_FADE_MS)
    expect(p.get('a')).toBeCloseTo(0.6)
  })

  it('snaps with no fade — the first frame and reduced motion', () => {
    const p = advancePresence(new Map([['gone', 1]]), new Set(['a', 'b']), 0, 0)
    expect([...p.entries()]).toEqual([['a', 1], ['b', 1]])
  })

  it('never goes backwards on a stalled clock', () => {
    const p = advancePresence(new Map([['a', 0.4]]), new Set(['a']), -50, LIGHT_FADE_MS)
    expect(p.get('a')).toBeCloseTo(0.4)
  })
})

describe('easePresence', () => {
  it('is an ease-out through 0 and 1', () => {
    expect(easePresence(0)).toBe(0)
    expect(easePresence(1)).toBe(1)
    expect(easePresence(0.5)).toBeCloseTo(0.75)
    expect(easePresence(0.25)).toBeGreaterThan(0.25)
  })
})
