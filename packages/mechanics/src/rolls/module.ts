// The rolls module (§2.2, D7). One command, `post`, open to everyone: whatever landed in
// your tab is your roll. The handler's whole job is to refuse malformed display data and
// stamp the parts a client is not allowed to choose — who rolled it and when.

import { ANY_ROLE, type CommandError, type GameModule } from '../contract'
import type { RollEvent, RollsState } from './types'

export type { RollEvent, RollPost, RollsState } from './types'

/** Optional string fields and their caps. Anything longer is rejected, never truncated —
 *  a silently shortened roll reads as a real one. */
const CAPS = {
  characterName: 60,
  title: 100,
  formula: 100,
  breakdown: 200,
  text: 200,
} as const

/** D5: state carries the last 200 entries. Full history is a later feature. */
export const MAX_LOG = 200

// ponytail: a counter, not a UUID — this package is dependency-free with `lib: ES2022`, so
// neither `node:crypto` nor the DOM `crypto` global is in scope, and an id only has to be
// unique inside a 200-entry log. Swap for `crypto.randomUUID()` if ids ever leave the log.
let minted = 0

const invalid = (message: string): CommandError => ({ code: 'invalid-command', message })

export const rollsModule: GameModule<RollsState> = {
  name: 'rolls',
  commands: { post: ANY_ROLE },
  initialState: { log: [] },

  handler(_action, payload, ctx) {
    const p = (payload ?? {}) as Record<string, unknown>

    if (p.source !== 'dndbeyond' && p.source !== 'manual') {
      return invalid("rolls.post needs source 'dndbeyond' or 'manual'")
    }
    if (p.visibility !== 'public' && p.visibility !== 'private') {
      return invalid("rolls.post needs visibility 'public' or 'private'")
    }

    const at = Date.now()
    minted += 1
    const event: RollEvent = {
      id: `r${at.toString(36)}${minted.toString(36)}`,
      at,
      identityId: ctx.sender.identityId,
      playerName:
        ctx.players.find((player) => player.identityId === ctx.sender.identityId)?.name ??
        'Someone',
      source: p.source,
      visibility: p.visibility,
    }

    for (const field of Object.keys(CAPS) as (keyof typeof CAPS)[]) {
      const value = p[field]
      if (value === undefined || value === null) continue
      if (typeof value !== 'string') return invalid(`rolls.post ${field} must be a string`)
      if (value.length > CAPS[field]) {
        return invalid(`rolls.post ${field} exceeds ${CAPS[field]} characters`)
      }
      if (value) event[field] = value
    }

    if (p.total !== undefined && p.total !== null) {
      if (typeof p.total !== 'number' || !Number.isFinite(p.total)) {
        return invalid('rolls.post total must be a finite number')
      }
      event.total = p.total
    }

    ctx.setState({ log: [...ctx.state.log, event].slice(-MAX_LOG) })
  },

  // D4: a private roll reaches the roller and the DM, and never appears in anyone else's
  // frames at all. Pure and idempotent — filtering an already-filtered log is a no-op.
  redact(state, viewer) {
    return {
      log: state.log.filter(
        (e) =>
          e.visibility === 'public' || viewer.role === 'dm' || e.identityId === viewer.identityId,
      ),
    }
  },
}
