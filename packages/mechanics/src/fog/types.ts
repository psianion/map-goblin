// Fog shapes. Scene-scoped: `byScene[sceneId]`. A scene absent from the record is fog off.

import type { Logged } from '../log'
import type { FogLook } from '@dnd/core/src/shared/fogLook'
import type { Cell, RegionMask } from './region'

export interface SceneFog {
  /** Absent ⇒ on. */
  autoExplore?: boolean
  /**
   * The DM's live override of the cloud's look (D7). Absent ⇒ the map's authored
   * `MapSettings.fogLook`, and if that too is absent, the shader's own `DEFAULT_FOG_LOOK`
   * (session/client/src/modules/fog/livingFog.ts). Partial so a DM can nudge one field
   * (say, `wind`) without re-sending the whole cloud — `fogLookOf` is the one merge every
   * reader should use rather than re-deriving the fallback chain itself.
   */
  look?: Partial<FogLook>
  /**
   * Fog rework — whether the scene is fogged at all. Absent = off: players are sent, and see,
   * the whole map. On, they see only the ground in {@link cleared}.
   */
  on?: boolean
  /**
   * Fog rework — the cells cleared for the players, per level id, on the scene frame's grid.
   * Per level because levels stacked at the same spot share one grid. An absent level has
   * nothing cleared. A cleared cell stays cleared until the DM fogs it.
   */
  cleared?: Record<string, RegionMask>
}

/** Fog rework — whether a scene is fogged. Off unless the DM turned it on. */
export const fogOn = (scene: SceneFog): boolean => scene.on === true

/** Fog rework — the cleared cells of one level, if any were ever cleared there. */
export const clearedOn = (scene: SceneFog, levelId: string): RegionMask | undefined => scene.cleared?.[levelId]

/** Fog rework — the brush's two strokes: open ground for the players, or cover it again. */
export type FogBrushOp = 'clear' | 'fog'
export const FOG_BRUSH_OPS: readonly FogBrushOp[] = ['clear', 'fog']

/**
 * Fog rework — the DM's fog commands, by action name. `sceneId` is optional on every one and
 * falls back to the table's active scene.
 */
export interface FogCommandPayloads {
  /** Switches fog. Refused on a scene too large to keep a cell record. */
  'set-on': { sceneId?: string; on: boolean }
  /** The brush. `clear` only opens ground the map has floor on; `fog` covers anything. */
  'region-set': { sceneId?: string; levelId: string; op: FogBrushOp; cells: Cell[] }
  /** Every level at once. */
  'clear-all': { sceneId?: string }
  'fog-all': { sceneId?: string }
  /** Puts back the record a Clear all or Fog all replaced (the toast's Undo). */
  restore: { sceneId?: string; cleared: Record<string, RegionMask> }
  'set-auto-explore': { sceneId?: string; autoExplore: boolean }
  /** `null` clears back to the default look. */
  'set-fog-look': { sceneId?: string; look: Partial<FogLook> | null }
}

/**
 * Fog rework — the server's own write: the cells the party's sight just earned, per level, in
 * one command. Internal, so no seat can send it.
 */
export interface AutoExploreByLevel {
  sceneId: string
  byLevel: Record<string, Cell[]>
}

/**
 * S6 — the two numbers a room's fog pad is made of, shared by the client's mask (`fogPad`) and the
 * server's geometry cut (`bandPad`), so the art a seat is sent and the hole its mask opens are
 * measured by one distance. FOG_MARGIN is the breathing room past a wall band's far face, and
 * DEFAULT_WALL_WIDTH the band's width where no layer names one, in cells.
 */
export const FOG_MARGIN = 0.5
export const DEFAULT_WALL_WIDTH = 0.5

/** The id of the Outdoors row: `@outdoors`, or `@outdoors:<levelId>` on a map with levels. */
export const OUTDOORS_ID = '@outdoors'

/** Whether a row id is an Outdoors row rather than a room. */
export const isOutdoorsId = (id: string): boolean => id === OUTDOORS_ID || id.startsWith(`${OUTDOORS_ID}:`)

/** Auto-explore defaults on: a fogged scene explores itself unless the DM says not to. */
export const autoExploreOn = (scene: SceneFog): boolean => scene.autoExplore ?? true

/**
 * The cloud look a viewer should render: the DM's live override (`scene.look`, field by
 * field) on top of the map's authored default. `authored` is `MapSettings.fogLook ??
 * DEFAULT_FOG_LOOK` — callers already have that value at hand (FogRenderer reads
 * `mapSettings` beside the session in one snapshot), so this stays a pure merge rather than
 * reaching for either fallback itself.
 */
export const fogLookOf = (scene: SceneFog, authored: FogLook): FogLook => ({
  ...authored,
  ...scene.look,
})

export interface FogState extends Logged {
  byScene: Record<string, SceneFog>
}

/** An untouched scene: fog off, nothing cleared. */
export function sceneFogOf(state: FogState, sceneId: string): SceneFog {
  return state.byScene[sceneId] ?? {}
}
