// Table v2 — effect timers tick when the encounter's round turns. The initiative module owns
// the order and never reads tokens; the tokens module owns the timers. This hook joins them:
// after an `initiative.next` that wrapped back to the top of the order, every timer on the
// encounter's scene ticks once (internal `tokens.tick-effects`). A player's End turn is a Next too.

import type { InitiativeState } from '@dnd/mechanics/initiative'
import { CLEAR_EFFECTS } from '@dnd/mechanics/tokens'
import type { AfterWrite } from './registry'

export const effectsTick: AfterWrite = ({ module, action }, ctx, registry) => {
  if (module !== 'initiative' || (action !== 'next' && action !== 'end-turn')) return
  const state = registry.readState(ctx.campaignId, 'initiative') as InitiativeState | undefined
  // `next` lands on turn 0 exactly when it wrapped, which is when `round` went up.
  if (!state || state.status !== 'running' || state.turn !== 0 || !state.sceneId) return
  const error = registry.dispatchInternal('tokens', 'tick-effects', { sceneId: state.sceneId }, ctx)
  if (error) console.warn(`[tokens] effect tick refused: ${error.message}`)
}

/**
 * Table fix pass F24: an encounter that ends takes its timers with it. The initiative state is
 * wiped by `end`, so the scene is read from the command's own tag.
 */
export const effectsClear: AfterWrite = ({ module, action, sceneId }, ctx, registry) => {
  if (module !== 'initiative' || action !== 'end') return
  const scene = sceneId ?? ctx.activeSceneId
  if (!scene) return
  const error = registry.dispatchInternal('tokens', CLEAR_EFFECTS, { sceneId: scene }, ctx)
  if (error) console.warn(`[tokens] effect clear refused: ${error.message}`)
}

/**
 * Table fix pass F22: a hidden combatant's row is withheld from players, so hiding or showing a
 * token re-sends the order under that rule.
 */
export const hiddenCombatants: AfterWrite = ({ module, action, sceneId }, ctx, registry) => {
  if (module !== 'tokens' || (action !== 'hide' && action !== 'delete')) return
  const state = registry.readState(ctx.campaignId, 'initiative') as InitiativeState | undefined
  if (!state || state.status === 'idle' || !state.entries.length) return
  registry.refresh('initiative', ctx, sceneId)
}

/** Several after-write rules, run in order; one that throws does not stop the next. */
export function afterWrites(...rules: AfterWrite[]): AfterWrite {
  return (event, ctx, registry) => {
    for (const rule of rules) {
      try {
        rule(event, ctx, registry)
      } catch (err) {
        console.warn(`[after-write] ${event.module}.${event.action} rule threw`, err)
      }
    }
  }
}
