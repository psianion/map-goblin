// §4 — party-mode auto-explore. One hook, on one seam: after a token move/place or a door
// swing lands, ask the vision whether the party's sight just earned them any ground, and if
// it did, write it back through the fog module.
//
// Everything after that is somebody else's existing path: `dispatchInternal` runs the write,
// `ctx.setState` persists it and broadcasts it, the Broadcaster attaches D5's geometry delta
// for non-DM viewers, and the fog RETRACTS re-send tokens and doors under fresh redaction.
// There is deliberately no second reveal path.

import type { AfterWrite } from '../modules/registry'
import type { Vision } from './vision'

/**
 * The commands that can move what the party can see. Nothing here writes fog, and the hook
 * ignores its own `fog.auto-explore` write, so the loop closes on the first pass.
 *
 * Everything that changes the *set* of tokens doing the sweeping is in it, not just the two
 * that move one: a claim adds a pair of eyes, `update` can resize the token they belong to (and
 * since P4, hand it sight or a torch), `set-sight-link` lends the party a whole extra sweep,
 * and hide/delete take them away. Left out, the party's own newly-claimed scout lit nothing
 * until somebody happened to take a step.
 */
const TRIGGERS: Record<string, readonly string[]> = {
  tokens: ['move', 'place', 'claim', 'update', 'hide', 'delete', 'set-sight-link'],
  doors: ['toggle', 'reveal-secret'],
}

export function autoExplore(vision: Vision): AfterWrite {
  return ({ module, action, sceneId }, ctx, registry) => {
    if (!sceneId || !TRIGGERS[module]?.includes(action)) return
    const patch = vision.autoExplorePatch(sceneId)
    if (!patch) return
    const error = registry.dispatchInternal('fog', 'auto-explore', patch, ctx)
    if (error) console.warn(`[fog] auto-explore after ${module}.${action} refused: ${error.message}`)
  }
}
