// Fog shapes (§2.2, D1). Room-granular and scene-scoped: `byScene[sceneId].rooms[roomId]`.
// A room absent from the record is `never_revealed`, so a map that grows new rooms needs no
// migration — and corridors are rooms like any other (D6), nothing here special-cases them.

import type { Logged } from '../log'
import { orRegion, type RegionMask } from './region'

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
  /** Absent ⇒ `'party'`. */
  visionShare?: VisionShare
  /** Absent ⇒ on. Only meaningful in vision mode. */
  autoExplore?: boolean
  /**
   * Region memory — the party's, absent until the first sweep or brush stroke writes one.
   *
   * In `'individual'` share this is also the *seed*: an identity with no record of its own
   * reads and writes through this one (see {@link identityRegion}), so a seat that claims a
   * token after the DM flipped the switch starts where the table already was.
   */
  region?: RegionMask
  /**
   * S3 P5 — region memory per identity, kept beside the party record rather than instead of
   * it, so a flip in either direction merges and destroys nothing (`set-share`).
   *
   * Never on a player's wire: `redact` maps this viewer's own record onto `region` and strips
   * the field, so the client mask code goes on reading `region` and no seat is ever handed
   * another seat's memory.
   */
  regions?: Record<string, RegionMask>
}

/** The mode the rules run in. One reading of the optional field, everywhere. */
export const fogModeOf = (scene: SceneFog): FogMode => scene.mode ?? 'rooms'

/** Auto-explore defaults on: a vision-mode scene explores itself unless the DM says not to. */
export const autoExploreOn = (scene: SceneFog): boolean => scene.autoExplore ?? true

/** Whose sight a viewer's mask is drawn through. One reading of the optional field (P5). */
export const visionShareOf = (scene: SceneFog): VisionShare => scene.visionShare ?? 'party'

/**
 * The record one identity's memory is read and written through — their own if they have one,
 * the party's if they do not.
 *
 * That fallback *is* P5's "party → individual seeds every identity", said once and lazily:
 * a seat with no record of its own reads the table's, and its first write starts from the
 * same copy. Doing it at the flip instead would need a list of who is playing, and would
 * leave anyone who claimed a token afterwards starting from black.
 *
 * ponytail: the ceiling is that a seat which has swept nothing has no *stored* record, so a
 * DM tool asking "what does this player remember" reads the party record for them. That is
 * the true answer today; the upgrade, the day per-seat inspection is a real screen, is to
 * materialise the copy at claim time rather than to change this rule.
 */
export const identityRegion = (scene: SceneFog, identityId: string): RegionMask | undefined =>
  scene.regions?.[identityId] ?? scene.region

/**
 * Every cell *anyone* at the table remembers — the party record with every seat's own ORed
 * in. Two callers, one function: it is what a flip back to party leaves behind (`set-share`),
 * and it is what the DM's overlay washes, because the DM is owed the table's memory and not
 * whichever half of it predates the switch (principle 3).
 *
 * Identity in party share, where no seat holds a record of its own.
 */
export function tableRegion(scene: SceneFog): RegionMask | undefined {
  let merged = scene.region
  for (const mask of Object.values(scene.regions ?? {})) {
    merged = merged ? orRegion(merged, mask) : mask
  }
  return merged
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
