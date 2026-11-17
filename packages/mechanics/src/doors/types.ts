// Door shapes (§2.2, D2). The map file is the authored default; this is the live overlay
// the table plays with — `byScene[sceneId][doorId]`, seeded from the authored data the
// first time a command touches the scene, so an untouched campaign persists nothing.

import type { Logged } from '../log'

export interface DoorLiveState {
  open: boolean
  locked: boolean
  /** Only meaningful for authored-secret doors; a plain door is revealed from birth. */
  revealed: boolean
}

export interface DoorsState extends Logged {
  byScene: Record<string, Record<string, DoorLiveState>>
  /** The DM's "Players open doors" switch. Absent = on. */
  playersOpen?: boolean
}

/** The DM command that flips {@link DoorsState.playersOpen}. */
export const SET_PLAYERS_OPEN = 'set-players-open'

/** How near a player's token must stand to a door to open or close it, in cells. */
export const PLAYER_DOOR_REACH = 1.5

/** A player's toggle refused: none of their tokens stands within reach of the door. */
export const DOOR_OUT_OF_REACH = 'door-out-of-reach'
/** A player's toggle refused: the DM switched "Players open doors" off. */
export const DOORS_DM_ONLY = 'doors-dm-only'

/**
 * The authored fields the runner reads off a map's door. A structural subset of
 * `DoorChild` from @dnd/core, so a map's door child is assignable as-is (the test pins
 * that, which is what catches a map-schema drift).
 */
export interface AuthoredDoor {
  id: string
  state: 'closed' | 'open' | 'locked'
  isSecret: boolean
  /**
   * An archway is a permanent opening — no leaf to swing or lock, and core's own renderer
   * draws no state indicator on one. Absent reads as an ordinary door.
   */
  style?: 'single' | 'double' | 'portcullis' | 'archway' | 'portal'
  /** Room on one side. `null` = exterior, absent = never bound. */
  roomA?: string | null
  roomB?: string | null
}

// The wire's `code` union is fixed by the protocol (`invalid-command` here), so the typed
// refusals of §2.2 ride at the head of the message; clients match on these constants.
export const DOOR_LOCKED = 'door-locked'
export const DOOR_CLOSED = 'door-closed'
export const UNKNOWN_DOOR = 'unknown-door'

/**
 * The refusal grammar every lane writes to: `<cause> <subject?>: sentence`.
 *
 * The cause alone got a player "The door is locked." for a door they can see the name of on
 * the panel beside it, because the id never left the server. The subject is the id, never
 * the name: the name a *player* is allowed to read is already decided by the map redactor
 * (a door onto a room nobody has entered comes over blank), so the client resolves the id
 * against the doors it actually holds and falls back to the nameless sentence when it holds
 * nothing. Putting the name on the wire here would hand it over behind the redactor's back.
 */
export const refusal = (cause: string, subjectId: string | null, sentence: string): string =>
  `${cause}${subjectId ? ` ${subjectId}` : ''}: ${sentence}`

/** The id a refusal named, or null — including for the older, subjectless form. */
export function refusalSubject(message: string): string | null {
  const colon = message.indexOf(':')
  if (colon < 0) return null
  const head = message.slice(0, colon).split(' ')
  return head.length === 2 ? head[1] : null
}

/** Why a room the party cannot reach is shut off, and which door said so. */
export interface BlockedEdge {
  kind: 'locked-door' | 'closed-door'
  doorId: string
}

export const isArchway = (door: AuthoredDoor): boolean => door.style === 'archway'

// An archway stands open whatever the map authored on it: sight, light and the BFS all read
// `open`, and a map that ships one `closed` must not wall the party in behind a hole.
export function seedDoor(door: AuthoredDoor): DoorLiveState {
  return {
    open: isArchway(door) || door.state === 'open',
    locked: !isArchway(door) && door.state === 'locked',
    revealed: !door.isSecret,
  }
}

/**
 * S2 — the doors whose live state a republish must drop: authored in both maps, with an authored
 * state that seeds differently (open, locked, secret, archway). Stored state used to outlive the
 * edit, so a door the DM re-authored as locked stayed open at the table. The new map then seeds
 * them afresh (`doorsOfScene`).
 */
export function reauthoredDoors(before: readonly AuthoredDoor[], after: readonly AuthoredDoor[]): string[] {
  const was = new Map(before.map((door) => [door.id, seedDoor(door)]))
  return after
    .filter((door) => {
      const old = was.get(door.id)
      const now = seedDoor(door)
      return !!old && (old.open !== now.open || old.locked !== now.locked || old.revealed !== now.revealed)
    })
    .map((door) => door.id)
}

/**
 * The scene's live doors, seeded from the authored list for anything not touched yet.
 * Doors the map no longer authors drop out — the map is the source of truth for existence.
 */
export function doorsOfScene(
  state: DoorsState,
  sceneId: string,
  authored: readonly AuthoredDoor[],
): Record<string, DoorLiveState> {
  const live = state.byScene[sceneId] ?? {}
  const seeded: Record<string, DoorLiveState> = {}
  for (const door of authored) seeded[door.id] = live[door.id] ?? seedDoor(door)
  return seeded
}
