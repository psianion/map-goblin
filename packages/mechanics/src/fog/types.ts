// Fog shapes (§2.2, D1). Room-granular and scene-scoped: `byScene[sceneId].rooms[roomId]`.
// A room absent from the record is `never_revealed`, so a map that grows new rooms needs no
// migration — and corridors are rooms like any other (D6), nothing here special-cases them.

import type { Logged } from '../log'

export type RoomFogStatus = 'never_revealed' | 'revealed' | 're_hidden'

export const ROOM_FOG_STATUSES: readonly RoomFogStatus[] = [
  'never_revealed',
  'revealed',
  're_hidden',
]

export interface RoomFog {
  status: RoomFogStatus
  /** Latches true on the first reveal and stays true — only `reset` clears it (D1). */
  wasEverRevealed: boolean
}

export interface SceneFog {
  /** Absent roomId ⇒ never_revealed. */
  rooms: Record<string, RoomFog>
  /** D3 layer 2 — off means doors affect lighting only. */
  concealBehindDoors: boolean
}

export interface FogState extends Logged {
  byScene: Record<string, SceneFog>
}

/** An untouched scene: nothing revealed, concealment on. */
export function sceneFogOf(state: FogState, sceneId: string): SceneFog {
  return state.byScene[sceneId] ?? { rooms: {}, concealBehindDoors: true }
}

export function roomFogOf(scene: SceneFog, roomId: string): RoomFog {
  return scene.rooms[roomId] ?? { status: 'never_revealed', wasEverRevealed: false }
}
