// Table v2 — the `table` module (pause, lock movement) with its truth on the session's row
// (migration 006). The mechanics module validates and broadcasts; this wrapper mirrors each
// write onto `sessions.paused` / `movement_locked`, and `tableOf` answers a player's move
// from the row, so a fresh session starts unpaused whatever the last one did. The lobby
// pass's `started`, `players_make_pcs` and `lobby_shows_scene` (009) ride the same way.

import type { GameModule } from '@dnd/mechanics/contract'
import {
  LOBBY_COMMANDS,
  TABLE_NOT_STARTED_ERROR,
  TABLE_PAUSED_ERROR,
  tableModule,
  type TableState,
} from '@dnd/mechanics/table'
import type { TableFlags, TableOf } from '@dnd/mechanics/tokens'
import type { Stores } from '../db/stores'
import type { SeatGate } from './registry'

export function sessionTable(stores: Stores): {
  module: GameModule<TableState>
  tableOf: TableOf
  flagsOf: (sessionId: string) => TableFlags | null
  seatGate: SeatGate
} {
  const flagsOf = (sessionId: string): TableFlags | null => {
    const row = stores.sessions.get(sessionId)
    return row
      ? {
          paused: row.paused === 1,
          movementLocked: row.movement_locked === 1,
          started: row.started === 1,
          playersMakePcs: row.players_make_pcs === 1,
          lobbyShowsScene: row.lobby_shows_scene === 1,
        }
      : null
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
  // A table in the lobby, or paused, refuses every player command but the lobby's own.
  const seatGate: SeatGate = (sessionId, module, action) => {
    const flags = flagsOf(sessionId)
    if (!flags || LOBBY_COMMANDS.includes(`${module}.${action}`)) return null
    if (!flags.started) return TABLE_NOT_STARTED_ERROR
    return flags.paused ? TABLE_PAUSED_ERROR : null
  }
  return { module, tableOf: ({ sessionId }) => flagsOf(sessionId), flagsOf, seatGate }
}
