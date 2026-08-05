// A pure dice roller (M4 mechanics lane). No dependencies: parses a `NdM(+K|-K)` formula
// and draws from an injectable `rng`, so callers own randomness — real play uses
// `Math.random`, tests pin a stub and get an exact total back.

export interface RollResult {
  formula: string
  rolls: number[]
  modifier: number
  total: number
}

// Case-insensitive 'd', bare `dM` = 1dM (empty count group), optional signed modifier.
// Anchored so "1d6 extra junk" cannot sneak past the count/sides captures.
const FORMULA = /^(\d*)d(\d+)([+-]\d+)?$/i

/**
 * `mode` rolls the whole pool twice (fresh draws, not a re-read of the first) and keeps
 * whichever pool's total is better ('adv') or worse ('dis') — `rolls` reports that kept
 * pool, never both.
 */
export function roll(formula: string, rng: () => number = Math.random, mode?: 'adv' | 'dis'): RollResult {
  // Whitespace is tolerated anywhere, so strip it all before matching rather than trying to
  // thread optional \s* through every gap in the pattern.
  const normalized = formula.replace(/\s+/g, '')
  const m = FORMULA.exec(normalized)
  if (!m) throw new Error(`malformed dice formula '${formula}'`)

  const count = m[1] === '' ? 1 : Number(m[1])
  const sides = Number(m[2])
  const modifier = m[3] === undefined ? 0 : Number(m[3])
  if (count < 1 || count > 100) throw new Error(`dice count must be 1..100, got ${count}`)
  if (sides < 2 || sides > 1000) throw new Error(`die size must be 2..1000, got d${sides}`)
  if (Math.abs(modifier) > 1000) throw new Error(`modifier must be within +/-1000, got ${modifier}`)

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
