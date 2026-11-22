// The walk grid of a scene's level (table fix pass §2.1): which cells are ground, which are
// solid, and which steps between cells a wall, a shut door or a refusing raised edge stops. The
// flood and the refusal order are mechanics' (`@dnd/mechanics/tokens` walk.ts), and so is the
// reading of a level into the grid (`@dnd/mechanics/levelGrid`); this file hands it the scene's
// live doors and crossings.
//
// Kept per parsed map object and level, rebuilt when a door's live state or a crossing rule
// changes: the key is the door states and the crossing overrides, read the same way the sight
// sweep reads its own (`sweep.ts`).

import { seedDoor, type DoorLiveState } from '@dnd/mechanics/doors'
import { sceneCrossings, type CrossingsState } from '@dnd/mechanics/crossings'
import type { WalkGrid } from '@dnd/mechanics/tokens'
import { levelWalkGrid } from '@dnd/mechanics/levelGrid'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- pixi-free by design: the Lighting pass's level rules
import { firstLevelId } from '@dnd/core/src/shared/visionGate'
import type { SceneMap } from './sceneMap'
import { liveLayers } from './sweep'
import { hasHiddenGround } from './outdoorGround'

type Doors = Record<string, DoorLiveState>

export interface WalkGrids {
  /** The grid of one level, or null for a scene with no frame. */
  gridFor(map: SceneMap, doors: Doors, crossings: CrossingsState | undefined, sceneId: string, levelId?: string): WalkGrid | null
}

export function createWalkGrids(): WalkGrids {
  const cache = new WeakMap<SceneMap, Map<string, { key: string; grid: WalkGrid }>>()
  return {
    gridFor(map, doors, crossings, sceneId, levelId) {
      if (!map.frame) return null
      const level = levelId || firstLevelId(map.data)
      const live = sceneCrossings(crossings, sceneId)
      const key = `${map.doors.map((door) => walkState(door.id, door, doors)).join('')}|${JSON.stringify(live)}`
      let byLevel = cache.get(map)
      if (!byLevel) cache.set(map, (byLevel = new Map()))
      const hit = byLevel.get(level)
      if (hit && hit.key === key) return hit.grid
      const grid = buildLevelGrid(map, doors, live, level)
      byLevel.set(level, { key, grid })
      return grid
    },
  }
}

function walkState(id: string, door: SceneMap['doors'][number], doors: Doors): string {
  const state = doors[id] ?? seedDoor(door)
  if (door.isSecret && !state.revealed) return 's'
  return state.open ? 'o' : 'c'
}

function buildLevelGrid(
  map: SceneMap,
  doors: Doors,
  live: ReturnType<typeof sceneCrossings>,
  levelId: string,
): WalkGrid {
  return levelWalkGrid({
    frame: map.frame!,
    settings: map.data.mapSettings,
    level: map.data.levels?.find((l) => l.id === levelId) ?? null,
    layers: liveLayers(map, doors, levelId),
    hasRooms: map.rooms.length > 0,
    hiddenGround: hasHiddenGround(map.data),
    crossings: live,
  })
}
