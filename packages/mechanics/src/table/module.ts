// The table module (table v2, Session menu): the DM's pause and movement lock. A player's
// `tokens.move` is refused while either is on (the tokens module reads this through its
// `tableOf` seam).
//
// ponytail: persisted in `module_state` per campaign for now. Plan 4.3 moves the two flags to
// `sessions` columns (migration 006); when that lands the server wires `tableOf` to the row and
// this module's writes mirror into it — the wire shape below does not change.

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
