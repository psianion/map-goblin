import { describe, expect, it } from 'vitest'
import { rollExpression, rollReply, summarizeFaces } from './dice'

/** Deterministic rng: returns values from a fixed sequence, wrapping if exhausted. */
function sequence(...values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]
}

describe('rollExpression', () => {
  it('rolls a constant', () => {
    const result = rollExpression('5')
    expect(result).toMatchObject({ total: 5, terms: [{ label: '5', sign: 1, rolls: [], subtotal: 5 }] })
  })

  it('rolls dM as 1dM', () => {
    // rng() * 20 -> floor + 1; 0.5 -> floor(10)+1 = 11
    const result = rollExpression('d20', sequence(0.5))
    expect(result.terms).toEqual([{ label: '1d20', sign: 1, rolls: [11], subtotal: 11 }])
    expect(result.total).toBe(11)
  })

  it('sums NdM, constants, +/- across whitespace', () => {
    // 2d6 -> rolls 3,5 (rng 0.4166..->3? use exact fractions for faces=6: 2/6=0.333->2,4/6=0.666->5)
    const result = rollExpression(' 2d6 + 3 - 1 ', sequence(2 / 6, 4 / 6))
    expect(result.terms.map((t) => t.label)).toEqual(['2d6', '3', '1'])
    expect(result.terms[0].rolls).toEqual([3, 5])
    expect(result.total).toBe(3 + 5 + 3 - 1)
  })

  it('leading minus negates the first term', () => {
    const result = rollExpression('-4+10')
    expect(result.total).toBe(6)
    expect(result.terms[0].sign).toBe(-1)
  })

  it('flags a crit on a single d20 natural 20', () => {
    const result = rollExpression('1d20', sequence(19 / 20)) // floor(19)+1 = 20
    expect(result.isCrit).toBe(true)
    expect(result.isFail).toBe(false)
  })

  it('flags a fail on a single d20 natural 1', () => {
    const result = rollExpression('d20', sequence(0))
    expect(result.isFail).toBe(true)
    expect(result.isCrit).toBe(false)
  })

  it('does not flag crit/fail on a multi-die d20 term', () => {
    const result = rollExpression('2d20', sequence(19 / 20, 19 / 20))
    expect(result.isCrit).toBe(false)
    expect(result.isFail).toBe(false)
  })

  it.each(['', '   ', '5++3', '2d', 'd', '2x6', 'AND', '2d6*3'])('rejects malformed expression %j', (expr) => {
    expect(() => rollExpression(expr)).toThrowError(/user_input|read/)
  })

  it('caps dice count', () => {
    expect(() => rollExpression('101d6')).toThrowError(/no more than 100/i)
  })

  it('caps die faces', () => {
    expect(() => rollExpression('1d1001')).toThrowError(/no more than 1000/i)
  })

  it('caps expression length', () => {
    expect(() => rollExpression('1'.repeat(101))).toThrowError(/100 characters/i)
  })

  it('is case-insensitive on the die marker', () => {
    const result = rollExpression('1D6', sequence(0))
    expect(result.terms[0].label).toBe('1d6')
  })
})

describe('summarizeFaces', () => {
  it('renders a compact per-term summary with signs', () => {
    const result = rollExpression('2d6+3-1d4', sequence(0, 1 / 6, 0.5))
    expect(summarizeFaces(result)).toMatch(/^2d6\[1,2\]\+3-1d4\[3\]$/)
  })
})

describe('rollReply', () => {
  it('adds crit flair', () => {
    const result = rollExpression('d20', sequence(19 / 20))
    const spec = rollReply('Thalor', result)
    expect(spec.blocks?.[0]).toMatch(/CRITICAL/)
    expect(spec.header).toBe('Thalor rolls d20')
  })

  it('adds fumble flair', () => {
    const result = rollExpression('d20', sequence(0))
    const spec = rollReply('Thalor', result)
    expect(spec.blocks?.[0]).toMatch(/fumble/)
  })

  it('is plain for a non-d20 roll', () => {
    const result = rollExpression('2d6', sequence(0, 0))
    const spec = rollReply('Thalor', result)
    expect(spec.blocks?.[0]).not.toMatch(/CRITICAL|fumble/)
  })
})
