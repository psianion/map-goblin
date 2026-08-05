// A pure dice roller (M4 mechanics lane). Parses a `NdM(+K|-K)` formula and draws from an
// injectable `rng`, so callers own randomness — real play uses `Math.random`, tests pin a
// stub and get an exact total back.
//
// The grammar/bounds live in @dnd/core/src/shared/dice-format so canvas's trap-damage field
// can validate a draft without rolling it — one parser, shared, so the two can never drift.

import { DICE_FORMULA, isValidFormula, parseDiceFormula } from '@dnd/core/src/shared/dice-format'

export { DICE_FORMULA, isValidFormula }

export interface RollResult {
  formula: string
  rolls: number[]
  modifier: number
  total: number
}

/**
 * `mode` rolls the whole pool twice (fresh draws, not a re-read of the first) and keeps
 * whichever pool's total is better ('adv') or worse ('dis') — `rolls` reports that kept
 * pool, never both.
 */
export function roll(formula: string, rng: () => number = Math.random, mode?: 'adv' | 'dis'): RollResult {
  const parsed = parseDiceFormula(formula)
  if (!parsed) throw new Error(`malformed dice formula '${formula}'`)
  const { count, sides, modifier } = parsed
  // Whitespace is tolerated anywhere, so strip it all before echoing it back rather than
  // trying to thread optional \s* through every gap in the pattern.
  const normalized = formula.replace(/\s+/g, '')

  const draw = (): number[] => Array.from({ length: count }, () => 1 + Math.floor(rng() * sides))
  const sum = (rolls: number[]): number => rolls.reduce((a, b) => a + b, modifier)

  let rolls = draw()
  if (mode) {
    const second = draw()
    const pickSecond = mode === 'adv' ? sum(second) > sum(rolls) : sum(second) < sum(rolls)
    if (pickSecond) rolls = second
  }
  return { formula: normalized, rolls, modifier, total: sum(rolls) }
}
