// Fog shapes (§2.2, D1). Room-granular and scene-scoped: `byScene[sceneId].rooms[roomId]`.
// A room absent from the record is `never_revealed`, so a map that grows new rooms needs no
// migration — and corridors are rooms like any other (D6), nothing here special-cases them.

import type { Logged } from '../log'
import type { RegionMask } from './region'

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

/** S3 P1 — `'rooms'` is everything this file did before token vision; absent reads as it. */
export type FogMode = 'rooms' | 'vision'
export const FOG_MODES: readonly FogMode[] = ['rooms', 'vision']

export type VisionShare = 'party' | 'individual'
export const VISION_SHARES: readonly VisionShare[] = ['party', 'individual']

export interface SceneFog {
  /** Absent roomId ⇒ never_revealed. */
  rooms: Record<string, RoomFog>
  /** D3 layer 2 — off means doors affect lighting only. */
  concealBehindDoors: boolean
  /**
   * Absent ⇒ `'rooms'`, which is why nothing below needs a migration: a scene stored
   * before token vision existed loads as the mode it was played in.
   */
  mode?: FogMode
  /**
   * Absent ⇒ `'party'`.
   *
   * ponytail: P1 stores and validates both values and behaves as `'party'` either way —
   * per-identity region records and per-viewer redaction divergence are P5. Nothing reads
   * this yet on purpose; it is here so a DM's choice survives the phases in between.
   */
  visionShare?: VisionShare
  /** Absent ⇒ on. Only meaningful in vision mode. */
  autoExplore?: boolean
  /** Region memory — absent until the first sweep or brush stroke writes one. */
  region?: RegionMask
}

/** The mode the rules run in. One reading of the optional field, everywhere. */
export const fogModeOf = (scene: SceneFog): FogMode => scene.mode ?? 'rooms'

/** Auto-explore defaults on: a vision-mode scene explores itself unless the DM says not to. */
export const autoExploreOn = (scene: SceneFog): boolean => scene.autoExplore ?? true

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
