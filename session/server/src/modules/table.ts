// Table v2 — the `table` module (pause, lock movement) with its truth on the session's row
// (migration 006). The mechanics module validates and broadcasts; this wrapper mirrors each
// write onto `sessions.paused` / `movement_locked`, and `tableOf` answers a player's move
// from the row, so a fresh session starts unpaused whatever the last one did.

import type { GameModule } from '@dnd/mechanics/contract'
import { tableModule, type TableState } from '@dnd/mechanics/table'
import type { TableFlags, TableOf } from '@dnd/mechanics/tokens'
import type { Stores } from '../db/stores'

export function sessionTable(stores: Stores): {
  module: GameModule<TableState>
  tableOf: TableOf
  flagsOf: (sessionId: string) => TableFlags | null
} {
  const flagsOf = (sessionId: string): TableFlags | null => {
    const row = stores.sessions.get(sessionId)
    return row ? { paused: row.paused === 1, movementLocked: row.movement_locked === 1 } : null
  }
  const module: GameModule<TableState> = {
    ...tableModule,
    handler(action, payload, ctx) {
      return tableModule.handler(action, payload, {
        ...ctx,
        state: ctx.state,
        setState: (next) => {
          stores.sessions.setTableFlags(ctx.sessionId, next)
          ctx.setState(next)
        },
      })
    },
  }
  return { module, tableOf: ({ sessionId }) => flagsOf(sessionId), flagsOf }
}
