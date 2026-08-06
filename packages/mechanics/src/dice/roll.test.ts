import { describe, expect, it } from 'vitest'

import { isValidFormula, roll } from './roll'

/** Feeds `values` to `rng()` one draw at a time, so each die's face is pinned exactly. */
function queue(values: number[]): () => number {
  let i = 0
  return () => values[i++]
}

describe('roll', () => {
  it('rolls NdM+K deterministically', () => {
    // sides=6: floor(v*6)+1 → 0→1, 0.5→4, 0.99→6
    expect(roll('3d6+2', queue([0, 0.5, 0.99]))).toEqual({
      formula: '3d6+2',
      rolls: [1, 4, 6],
      modifier: 2,
      total: 13,
    })
  })

  it('accepts NdM-K', () => {
    expect(roll('1d20-3', queue([0.5]))).toEqual({
      formula: '1d20-3',
      rolls: [11],
      modifier: -3,
      total: 8,
    })
  })

  it('accepts bare dM as 1dM', () => {
    expect(roll('d8', queue([0]))).toEqual({ formula: 'd8', rolls: [1], modifier: 0, total: 1 })
  })

  it('tolerates whitespace and is case-insensitive on d', () => {
    // Whitespace is stripped; case is accepted but not rewritten — parsing, not formatting.
    expect(roll(' 2D6 + 1 ', queue([0, 0])).formula).toBe('2D6+1')
  })

  it('defaults rng to Math.random when the caller wants real randomness', () => {
    const r = roll('2d6')
    expect(r.rolls).toHaveLength(2)
    expect(r.rolls.every((n) => n >= 1 && n <= 6)).toBe(true)
  })

  it('keeps the better pool on advantage', () => {
    // first draw: low roll (1); second draw: high roll (20)
    expect(roll('1d20', queue([0, 0.99]), 'adv')).toEqual({
      formula: '1d20',
      rolls: [20],
      modifier: 0,
      total: 20,
    })
  })

  it('keeps the worse pool on disadvantage', () => {
    expect(roll('1d20', queue([0, 0.99]), 'dis')).toEqual({
      formula: '1d20',
      rolls: [1],
      modifier: 0,
      total: 1,
    })
  })

  it('rolls the whole pool twice under adv/dis, not just one die', () => {
    // pool 1: [1,1] = 2; pool 2: [6,6] = 12 → adv keeps pool 2 entirely
    expect(roll('2d6', queue([0, 0, 0.99, 0.99]), 'adv').rolls).toEqual([6, 6])
  })

  it('rejects out-of-bounds counts, sides and modifiers', () => {
    expect(() => roll('0d6')).toThrow()
    expect(() => roll('101d6')).toThrow()
    expect(() => roll('1d1')).toThrow()
    expect(() => roll('1d1001')).toThrow()
    expect(() => roll('1d6+1001')).toThrow()
    expect(() => roll('1d6-1001')).toThrow()
  })

  it('rejects malformed formulas', () => {
    for (const bad of ['', 'd', '1d', 'foo', '1d6*2', '1d6++1', '1.5d6']) {
      expect(() => roll(bad)).toThrow()
    }
  })
})

describe('isValidFormula', () => {
  it('agrees with roll(): true for whatever it accepts, false for whatever it throws on', () => {
    for (const good of ['3d6+2', '1d20-3', 'd8', ' 2D6 + 1 ']) {
      expect(isValidFormula(good)).toBe(true)
    }
    for (const bad of ['', 'd', '1d', 'foo', '1d6*2', '0d6', '101d6', '1d1', '1d1001', '1d6+1001']) {
      expect(isValidFormula(bad)).toBe(false)
    }
  })
})
