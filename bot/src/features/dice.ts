// Own dice parser/roller/formatter, no dependency (plan §11 M3). RNG is injected so tests
// are deterministic; command-registry.ts wires this to Discord (a container reply) and to
// the rolls store.

import { userInput } from '../lib/errors'
import type { ContainerSpec } from '../lib/ui'

const MAX_EXPR_LENGTH = 100
const MAX_DICE_COUNT = 100
const MAX_DIE_FACES = 1000

export interface DiceTermResult {
  /** How the term reads back, e.g. "2d6", "d20", "3". Unsigned — sign is separate. */
  label: string
  sign: 1 | -1
  /** Individual die results, in roll order. Empty for a constant term. */
  rolls: number[]
  /** Unsigned magnitude: sum(rolls) for dice, the value itself for a constant. */
  subtotal: number
}

export interface DiceResult {
  expr: string
  terms: DiceTermResult[]
  total: number
  /** Any single-die (1dM) d20 term that rolled a natural 20. */
  isCrit: boolean
  /** Any single-die (1dM) d20 term that rolled a natural 1. */
  isFail: boolean
}

interface ParsedTerm {
  sign: 1 | -1
  label: string
  count?: number
  faces?: number
  value?: number
}

/** Grammar: whitespace-tolerant sum of `NdM` / `dM` (N=1) / integer constants, +/-. */
function parseTerms(expr: string): ParsedTerm[] {
  if (expr.length > MAX_EXPR_LENGTH) throw userInput(`Keep roll expressions under ${MAX_EXPR_LENGTH} characters.`)
  const stripped = expr.replace(/\s+/g, '')
  if (!stripped) throw userInput('Give me something to roll, like `2d6+3`.')

  const TERM_RE = /([+-]?)(?:(\d*)d(\d+)|(\d+))/gi
  const terms: ParsedTerm[] = []
  let cursor = 0
  for (const match of stripped.matchAll(TERM_RE)) {
    if (match.index !== cursor) throw userInput(`I can't read "${expr}" as a roll.`)
    cursor += match[0].length

    const sign: 1 | -1 = match[1] === '-' ? -1 : 1
    const [, , countRaw, facesRaw, constRaw] = match
    if (facesRaw !== undefined) {
      const count = countRaw === '' ? 1 : Number(countRaw)
      const faces = Number(facesRaw)
      if (count < 1) throw userInput('Need at least one die per dice term.')
      if (count > MAX_DICE_COUNT) throw userInput(`No more than ${MAX_DICE_COUNT} dice in one term.`)
      if (faces < 1) throw userInput("A die needs at least 1 face.")
      if (faces > MAX_DIE_FACES) throw userInput(`No more than ${MAX_DIE_FACES} faces on a die.`)
      terms.push({ sign, label: `${count}d${faces}`, count, faces })
    } else {
      terms.push({ sign, label: constRaw, value: Number(constRaw) })
    }
  }
  if (cursor !== stripped.length || terms.length === 0) throw userInput(`I can't read "${expr}" as a roll.`)
  return terms
}

/** Parses, rolls (via the injected rng), and totals `expr`. Throws BotError(user_input) on
 * bad grammar or a cap violation — never on a valid but unlucky roll. */
export function rollExpression(expr: string, rng: () => number = Math.random): DiceResult {
  const parsed = parseTerms(expr)

  let total = 0
  let isCrit = false
  let isFail = false
  const terms: DiceTermResult[] = parsed.map((term) => {
    if (term.faces !== undefined && term.count !== undefined) {
      const rolls = Array.from({ length: term.count }, () => Math.floor(rng() * term.faces!) + 1)
      const subtotal = rolls.reduce((a, b) => a + b, 0)
      total += term.sign * subtotal
      if (term.faces === 20 && term.count === 1) {
        if (rolls[0] === 20) isCrit = true
        if (rolls[0] === 1) isFail = true
      }
      return { label: term.label, sign: term.sign, rolls, subtotal }
    }
    total += term.sign * term.value!
    return { label: term.label, sign: term.sign, rolls: [], subtotal: term.value! }
  })

  return { expr, terms, total, isCrit, isFail }
}

/** Short text summary persisted in `rolls.faces` — e.g. "2d6[3,5]+d20[14]-2". */
export function summarizeFaces(result: DiceResult): string {
  return result.terms
    .map((t, i) => {
      const body = t.rolls.length ? `${t.label}[${t.rolls.join(',')}]` : t.label
      const sign = t.sign < 0 ? '-' : i === 0 ? '' : '+'
      return `${sign}${body}`
    })
    .join('')
}

const CRIT_ACCENT = 0xd4af37
const FAIL_ACCENT = 0x8b2c2c

/** The public reply container: expression, per-die breakdown, total, crit/fail flair. */
export function rollReply(rollerLabel: string, result: DiceResult): ContainerSpec {
  const breakdown = result.terms
    .map((t, i) => {
      const body = t.rolls.length ? `${t.label} [${t.rolls.join(', ')}]` : t.label
      if (i === 0) return t.sign < 0 ? `-${body}` : body
      return t.sign < 0 ? `- ${body}` : `+ ${body}`
    })
    .join(' ')
  const flair = result.isCrit ? ' — **CRITICAL!**' : result.isFail ? ' — fumble.' : ''

  return {
    accent: result.isCrit ? CRIT_ACCENT : result.isFail ? FAIL_ACCENT : undefined,
    header: `${rollerLabel} rolls ${result.expr}`,
    blocks: [`${breakdown} = **${result.total}**${flair}`],
  }
}
