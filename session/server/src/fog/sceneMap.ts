// The map file as the runner reads it: the scene's rooms, its doors, and which room a
// point sits in (§2.3.1, D5). Everything else in this folder asks these questions.
//
// A `.mapbuilder` runs to tens of megabytes, so it is parsed once and kept. A map row is
// immutable — an upload mints a new id and never rewrites one — which makes the row id its
// own version, and the cache needs no invalidation at all.

import type { AnyChild, DoorChild, Room, WallSegment } from '@dnd/core/src/shared/types'
import type { DungeonLayer, Layer, SerializedMapData } from '@dnd/core/src/store/types'
import type { Stores } from '../db/stores'
import { validateMapData } from '../mapImport'

/**
 * How far off a wall segment the room test is taken. Room boundaries are detected inset by
 * half a wall width, so a wall's own midpoint lands just *outside* the rooms it encloses —
 * probing perpendicularly is what puts it back inside them, and it finds both rooms of a
 * shared wall. Calibration knob: the value only has to clear the inset, and the dressed
 * gate map assigns 204 of its 206 walls identically anywhere from 0.3 to 0.75.
 */
const WALL_PROBE = 0.5

/** ponytail: two maps is a DM switching scenes; a third is rare and a fourth is a leak. */
export const CACHE_MAX = 3

export interface SceneMap {
  /** The campaign the map belongs to — module state is keyed by it. */
  campaignId: string
  data: SerializedMapData
  /** Every dungeon layer's rooms, corridors included: they are rooms like any other (D6). */
  rooms: readonly Room[]
  doors: readonly DoorChild[]
  /** The room whose polygon contains the point, or null if it is on unzoned map (D6). */
  roomAt(x: number, y: number): string | null
  /** The rooms a wall segment borders — both sides of a shared wall. */
  roomsAlong(wall: WallSegment): readonly string[]
}

/** Reads a scene's map, or null when the id is unknown or the stored file will not parse. */
export type SceneMapOf = (sceneId: string) => SceneMap | null

/**
 * #47 — a scene's `map_id` can move (re-publish repoints it without changing the
 * scene's own id), so the row this cache keys on is no longer immutable by
 * construction. `invalidate` is the one door back open: http.ts's publish route calls
 * it the moment `scenes.republish` runs, so nothing here is served stale.
 */
export interface SceneMaps {
  sceneMapOf: SceneMapOf
  invalidate(sceneId: string): void
}

export function createSceneMaps(stores: Stores): SceneMaps {
  const cache = new Map<string, SceneMap | null>()
  return {
    sceneMapOf: (sceneId) => {
      if (cache.has(sceneId)) return cache.get(sceneId) ?? null
      const scene = stores.scenes.get(sceneId)
      const row = scene ? stores.maps.get(scene.map_id) : undefined
      const parsed = row ? validateMapData(JSON.parse(row.data) as unknown) : null
      const result = row && parsed?.ok ? index(row.campaign_id, parsed.data) : null
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string)
      cache.set(sceneId, result)
      return result
    },
    invalidate: (sceneId) => {
      cache.delete(sceneId)
    },
  }
}

export function isDungeon(layer: Layer): layer is DungeonLayer {
  return layer.type === 'dungeon'
}

// A stored map is uploaded JSON: it satisfied `validateMapData`, which checks the envelope
// and not every array inside it. These two are read on every scene, so they read defensively.
export const childrenOf = (layer: DungeonLayer): readonly AnyChild[] => layer.children ?? []
export const wallsOf = (layer: DungeonLayer): readonly WallSegment[] => layer.standaloneWalls ?? []

function index(campaignId: string, data: SerializedMapData): SceneMap {
  const layers = data.layers.filter(isDungeon)
  const rooms = layers.flatMap((layer) => layer.rooms ?? [])
  const doors = layers.flatMap((layer) =>
    childrenOf(layer).filter((child): child is DoorChild => child.childType === 'door'),
  )
  return {
    campaignId,
    data,
    rooms,
    doors,
    roomAt: (x, y) => rooms.find((room) => contains(room, x, y))?.id ?? null,
    roomsAlong: (wall) => {
      const [ax, ay] = wall.points[0]
      const [bx, by] = wall.points[wall.points.length - 1]
      const [mx, my] = [(ax + bx) / 2, (ay + by) / 2]
      const length = Math.hypot(bx - ax, by - ay) || 1
      const [nx, ny] = [((ay - by) / length) * WALL_PROBE, ((bx - ax) / length) * WALL_PROBE]
      return rooms
        .filter((room) => contains(room, mx + nx, my + ny) || contains(room, mx - nx, my - ny))
        .map((room) => room.id)
    },
  }
}

/**
 * The point a child is judged by (D5): its centre, and for an outline that is the centre of
 * its bounding box. Doors are excluded on purpose — they sit *on* a wall, between two
 * rooms, so their own `roomA`/`roomB` binding answers this instead.
 *
 * ponytail: a C-shaped outline whose bounding-box centre falls outside its own polygon
 * reads as unzoned. Test the vertices too if a dressed map ever shows it.
 */
export function centreOf(child: AnyChild): [number, number] {
  switch (child.childType) {
    case 'asset':
    case 'light':
    case 'text':
      return [child.position.x, child.position.y]
    case 'door':
      return child.position
    default: {
      let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
      for (const [x, y] of child.contours[0] ?? []) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
      // ponytail: translate only — a rotated or scaled outline is judged by its untransformed
      // centre. Nothing the editor writes today uses those on a floor shape.
      const [dx, dy] = (child.childType === 'shape' && child.transform?.translate) || [0, 0]
      return [(minX + maxX) / 2 + dx, (minY + maxY) / 2 + dy]
    }
  }
}

/** Ray casting, the one geometry primitive this needs — @dnd/core is type-only here (D3). */
function contains(room: Room, x: number, y: number): boolean {
  const poly = room.boundary
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
