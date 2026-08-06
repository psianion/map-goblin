// src/shared/dice-format.ts
// The dice formula grammar and bounds — shared by the roller (packages/mechanics's
// dice/roll.ts) and anything that needs to validate a formula without rolling it (canvas's
// trap-damage field, ZoneProperties.tsx). One grammar, one bounds check: a client-side
// "looks fine" and the server's "will actually roll" must never be free to drift apart.
//
// Lives in core rather than mechanics because canvas depends on @dnd/core already and does
// not depend on @dnd/mechanics — this is the shared home neither side has to add an edge to
// reach.

/** Case-insensitive 'd', bare `dM` = 1dM (empty count group), optional signed modifier.
 *  Anchored so "1d6 extra junk" cannot sneak past the count/sides captures. */
export const DICE_FORMULA = /^(\d*)d(\d+)([+-]\d+)?$/i;

export interface ParsedDiceFormula {
  count: number;
  sides: number;
  modifier: number;
}

const COUNT_MIN = 1;
const COUNT_MAX = 100;
const SIDES_MIN = 2;
const SIDES_MAX = 1000;
const MODIFIER_ABS_MAX = 1000;

/**
 * Parses and bounds-checks in one pass. Null on anything the roller would refuse — malformed
 * syntax or a count/sides/modifier outside the ranges below. Callers that only need a yes/no
 * should use {@link isValidFormula}.
 */
export function parseDiceFormula(formula: string): ParsedDiceFormula | null {
  const normalized = formula.replace(/\s+/g, '');
  const m = DICE_FORMULA.exec(normalized);
  if (!m) return null;

  const count = m[1] === '' ? 1 : Number(m[1]);
  const sides = Number(m[2]);
  const modifier = m[3] === undefined ? 0 : Number(m[3]);
  if (count < COUNT_MIN || count > COUNT_MAX) return null;
  if (sides < SIDES_MIN || sides > SIDES_MAX) return null;
  if (Math.abs(modifier) > MODIFIER_ABS_MAX) return null;
  return { count, sides, modifier };
}

/** Full grammar + bounds check, no rolling — what a form field validates a draft against. */
export function isValidFormula(formula: string): boolean {
  return parseDiceFormula(formula) !== null;
}
