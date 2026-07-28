// Door shapes (§2.2, D2). The map file is the authored default; this is the live overlay
// the table plays with — `byScene[sceneId][doorId]`, seeded from the authored data the
// first time a command touches the scene, so an untouched campaign persists nothing.

export interface DoorLiveState {
  open: boolean
  locked: boolean
  /** Only meaningful for authored-secret doors; a plain door is revealed from birth. */
  revealed: boolean
}

export interface DoorsState {
  byScene: Record<string, Record<string, DoorLiveState>>
}

/**
 * The authored fields the runner reads off a map's door. A structural subset of
 * `DoorChild` from @dnd/core, so a map's door child is assignable as-is (the test pins
 * that, which is what catches a map-schema drift).
 */
export interface AuthoredDoor {
  id: string
  state: 'closed' | 'open' | 'locked'
  isSecret: boolean
  /** Room on one side. `null` = exterior, absent = never bound. */
  roomA?: string | null
  roomB?: string | null
}

// The wire's `code` union is fixed by the protocol (`invalid-command` here), so the typed
// refusals of §2.2 ride at the head of the message; clients match on these constants.
export const DOOR_LOCKED = 'door-locked'
export const UNKNOWN_DOOR = 'unknown-door'

export function seedDoor(door: AuthoredDoor): DoorLiveState {
  return {
    open: door.state === 'open',
    locked: door.state === 'locked',
    revealed: !door.isSecret,
  }
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
