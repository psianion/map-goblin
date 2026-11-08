// Settings the editor dropped because they changed nothing on the made map (plan 6.3, 6.4):
// climate, the time of day, weather and the night sky on the map; a light's night-only window
// and darkvision-sees; a room's, area's or level's mood; a prop's glow and blocks-movement.
// A map that carries them still loads; they are taken off on load (migrateToLatest) and on
// save (getSerializableState), so no file written from here on carries them.

import type { SerializedMapData } from './types'

/** The map settings that went: climate (`timePalette`), time (`timeMode`, `fixedTime`), weather, night sky. */
export const REMOVED_MAP_KEYS = ['timePalette', 'timeMode', 'fixedTime', 'weather', 'nightSky'] as const
/** Per light. */
export const REMOVED_LIGHT_KEYS = ['nightOnly', 'darkvisionSees'] as const
/** Per prop. */
export const REMOVED_PROP_KEYS = ['glows', 'glow', 'blocksMovement'] as const
/** On a room's, area's or level's look. */
export const REMOVED_LOOK_KEYS = ['mood', 'moodTint', 'moodVision'] as const

type Bag = Record<string, unknown>

const isBag = (v: unknown): v is Bag => typeof v === 'object' && v !== null && !Array.isArray(v)

/** `obj` without `keys`, the same object when it carried none of them. */
function without(obj: Bag, keys: readonly string[]): Bag {
  if (!keys.some((k) => k in obj)) return obj
  const out = { ...obj }
  for (const k of keys) delete out[k]
  return out
}

/** A scope (room, area, level) without the mood keys on its look; an emptied look goes too. */
function withoutMood<T>(scope: T): T {
  if (!isBag(scope) || !isBag(scope.look)) return scope
  const look = without(scope.look, REMOVED_LOOK_KEYS)
  if (look === scope.look) return scope
  const out: Bag = { ...scope, look }
  if (Object.keys(look).length === 0) delete out.look
  return out as T
}

function mapList<T>(list: T[] | undefined, fn: (item: T) => T): T[] | undefined {
  if (!Array.isArray(list)) return list
  let changed = false
  const out = list.map((item) => {
    const next = fn(item)
    if (next !== item) changed = true
    return next
  })
  return changed ? out : list
}

function cleanChild<T>(child: T): T {
  if (!isBag(child)) return child
  if (child.childType === 'light') return without(child, REMOVED_LIGHT_KEYS) as T
  if (child.childType === 'asset') return without(child, REMOVED_PROP_KEYS) as T
  return child
}

function cleanLayer<T>(layer: T): T {
  if (!isBag(layer)) return layer
  const children = mapList(layer.children as unknown[] | undefined, cleanChild)
  const rooms = mapList(layer.rooms as unknown[] | undefined, withoutMood)
  const areas = mapList(layer.areas as unknown[] | undefined, withoutMood)
  if (children === layer.children && rooms === layer.rooms && areas === layer.areas) return layer
  const out: Bag = { ...layer }
  if (children !== undefined) out.children = children
  if (rooms !== undefined) out.rooms = rooms
  if (areas !== undefined) out.areas = areas
  return out as T
}

/** `data` without any removed field; the same object when it carried none. */
export function dropRemovedFields(data: SerializedMapData): SerializedMapData {
  let result = data
  const settings = data.mapSettings as unknown
  if (isBag(settings)) {
    const mapSettings = without(settings, REMOVED_MAP_KEYS)
    if (mapSettings !== settings) result = { ...result, mapSettings: mapSettings as unknown as SerializedMapData['mapSettings'] }
  }
  const layers = mapList(result.layers, cleanLayer)
  if (layers !== result.layers) result = { ...result, layers: layers! }
  const levels = mapList(result.levels, withoutMood)
  if (levels !== result.levels) result = { ...result, levels }
  return result
}
