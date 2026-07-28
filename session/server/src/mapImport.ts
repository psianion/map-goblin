// D3 — the server treats a `.mapbuilder` file as schema-validated JSON and nothing more.
// Rooms, walls and lighting were computed in the editor and arrive inside the file; this
// module only refuses payloads the renderer could not read, and never throws doing it.

import type { SerializedMapData } from '@dnd/core/src/store/types'

/** Everything `SerializedMapData['version']` allows. Widen it when core widens. */
const SUPPORTED_VERSIONS: readonly SerializedMapData['version'][] = ['2.0', '3.0']

export type MapImportResult =
  | { ok: true; data: SerializedMapData; name: string }
  | { ok: false; error: string }

/** Parse + validate in one step, because a body that is not JSON fails the same way. */
export function parseMapFile(text: string): MapImportResult {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, error: 'not valid JSON' }
  }
  return validateMapData(value)
}

export function validateMapData(value: unknown): MapImportResult {
  if (!isRecord(value)) return { ok: false, error: 'expected a .mapbuilder object' }

  const { version, mapSettings, grid, layers } = value
  if (typeof version !== 'string' || !SUPPORTED_VERSIONS.includes(version as SerializedMapData['version'])) {
    return { ok: false, error: `unsupported .mapbuilder version: ${JSON.stringify(version)}` }
  }
  if (!isRecord(mapSettings)) return { ok: false, error: 'mapSettings must be an object' }
  if (!isRecord(grid)) return { ok: false, error: 'grid must be an object' }
  if (!Array.isArray(layers)) return { ok: false, error: 'layers must be an array' }

  const name = typeof mapSettings.name === 'string' ? mapSettings.name.trim() : ''
  return { ok: true, data: value as unknown as SerializedMapData, name: name || 'Untitled map' }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
