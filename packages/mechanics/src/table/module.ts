// The table module (table v2, Session menu): the DM's pause and movement lock. A player's
// `tokens.move` is refused while either is on (the tokens module reads this through its
// `tableOf` seam).
//
// The truth is the session's row (`sessions.paused`, `movement_locked`, migration 006): the
// server mirrors every write there and answers refusals from it. This slice is what the seats
// are shown; `sync` (internal, absent from `commands`) sets it from the row when a session
// opens, so a new session never inherits the last one's pause.

import type { GameModule } from '../contract'
import { Reject, bad, bool, obj } from '../tokens/validate'
import type { TableFlags } from '../tokens/types'

export type TableState = TableFlags

export const TABLE_INITIAL: TableState = { paused: false, movementLocked: false }

export const tableModule: GameModule<TableState> = {
  name: 'table',
  commands: { pause: ['dm'], 'lock-movement': ['dm'] },
  initialState: TABLE_INITIAL,

  handler(action, payload, ctx) {
    try {
      const p = obj(payload ?? {}, 'payload')
      if (action === 'sync') {
        return ctx.setState({ paused: bool(p.paused, 'paused'), movementLocked: bool(p.movementLocked, 'movementLocked') })
      }
      const on = bool(p.on, 'on')
      if (action === 'pause') ctx.setState({ ...ctx.state, paused: on })
      else if (action === 'lock-movement') ctx.setState({ ...ctx.state, movementLocked: on })
      else bad(`table has no action '${action}'`)
    } catch (err) {
      if (err instanceof Reject) return { code: err.code, message: err.message }
      throw err
    }
  },
}
