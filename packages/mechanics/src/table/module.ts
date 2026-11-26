// The table module (table v2, Session menu): the DM's pause and movement lock. A player's
// `tokens.move` is refused while either is on (the tokens module reads this through its
// `tableOf` seam).
//
// The truth is the session's row (`sessions.paused`, `movement_locked`, migration 006): the
// server mirrors every write there and answers refusals from it. This slice is what the seats
// are shown; `sync` (internal, absent from `commands`) sets it from the row when a session
// opens, so a new session never inherits the last one's pause.
//
// Table lobby pass: the row also says whether the table has started (false is the lobby) and
// the DM's two lobby switches. `ready` is not on the row: it is which `sceneId:mapId` each seat
// has finished loading, said by the seat itself.

import { ANY_ROLE, type CommandError, type GameModule } from '../contract'
import { refusal } from '../doors/types'
import { TABLE_PAUSED } from '../tokens/module'
import { Reject, bad, bool, obj } from '../tokens/validate'
import type { TableFlags } from '../tokens/types'

export interface TableState extends TableFlags {
  /** identityId → the `sceneId:mapId` that seat has finished loading. */
  ready: Record<string, string>
}

/** What the seats are shown before a session's row is read: a running table, as before the lobby. */
export const TABLE_INITIAL: TableState = {
  paused: false,
  movementLocked: false,
  started: true,
  playersMakePcs: true,
  lobbyShowsScene: false,
  ready: {},
}

/**
 * What every command from a player's seat gets while the DM holds the table, whatever its
 * module: the server's dispatch answers it before any handler runs. The DM's never do.
 */
export const TABLE_PAUSED_ERROR: CommandError = {
  code: 'unauthorized',
  message: refusal(TABLE_PAUSED, null, 'the DM has paused the table'),
}

export const TABLE_NOT_STARTED = 'table-not-started'

/** A player's command on a table still in the lobby, unless it is on {@link LOBBY_COMMANDS}. */
export const TABLE_NOT_STARTED_ERROR: CommandError = {
  code: 'unauthorized',
  message: refusal(TABLE_NOT_STARTED, null, 'the DM has not started the table yet'),
}

/** `module.action` a player may send in the lobby, and while the table is paused. */
export const LOBBY_COMMANDS: readonly string[] = [
  'tokens.pc-create',
  'tokens.pc-claim',
  'tokens.pc-release',
  'tokens.pc-update',
  'table.ready',
  'story.dismiss',
]

/** A slice stored before the lobby pass, with the fields it lacks. */
const normalized = (state: Partial<TableState>): TableState => ({ ...TABLE_INITIAL, ...state })

export const tableModule: GameModule<TableState> = {
  name: 'table',
  commands: {
    pause: ['dm'],
    'lock-movement': ['dm'],
    start: ['dm'],
    'set-lobby': ['dm'],
    ready: ANY_ROLE,
  },
  initialState: TABLE_INITIAL,

  handler(action, payload, ctx) {
    try {
      const p = obj(payload ?? {}, 'payload')
      const state = normalized(ctx.state)
      if (action === 'sync') {
        const flag = (key: keyof TableFlags) => (p[key] === undefined ? TABLE_INITIAL[key] : bool(p[key], key))
        return ctx.setState({
          ...state,
          paused: bool(p.paused, 'paused'),
          movementLocked: bool(p.movementLocked, 'movementLocked'),
          started: flag('started'),
          playersMakePcs: flag('playersMakePcs'),
          lobbyShowsScene: flag('lobbyShowsScene'),
        })
      }
      if (action === 'start' || action === 'set-lobby' || action === 'ready') bad(`table.${action} is not built yet`)
      const on = bool(p.on, 'on')
      if (action === 'pause') ctx.setState({ ...state, paused: on })
      else if (action === 'lock-movement') ctx.setState({ ...state, movementLocked: on })
      else bad(`table has no action '${action}'`)
    } catch (err) {
      if (err instanceof Reject) return { code: err.code, message: err.message }
      throw err
    }
  },
}
