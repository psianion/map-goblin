// D3 — the server treats a `.mapbuilder` file as schema-validated JSON and nothing more.
// Rooms, walls and lighting were computed in the editor and arrive inside the file; this
// module only refuses payloads the renderer could not read, brings an older file up to the
// current schema (the editor's own `migrateToLatest`), and never throws doing it.

import { gunzipSync } from 'node:zlib'
import type { SerializedMapData } from '@dnd/core/src/store/types'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- D3 waiver, same as shared/mapBounds: store/migration is the shared version list + pure JSON migration, pixi-free by design
import { SUPPORTED_VERSIONS, countRetiredBodies, migrateToLatest, plateausFromShapes } from '@dnd/core/src/store/migration'

/**
 * The editor writes a `.mapbuilder` as `MPBLD\0` + gzip(UTF-8 JSON) — canvas/src/io/saveLoad.ts
 * owns that format. The fixtures in testdata are the same schema stored as plain JSON.
 */
const MAGIC = Buffer.from('MPBLD\0', 'latin1')

/**
 * The JSON inside an uploaded `.mapbuilder`, or null if there is none to be had.
 *
 * The server sniffs the container rather than trusting the client to unwrap it: this is the
 * only route map data enters by, and the editor's own save is the common case. `maxBytes`
 * caps the *decompressed* size — the request cap only bounds what arrives on the wire, and a
 * few compressed megabytes can otherwise expand without limit.
 */
export function unwrapMapFile(bytes: Buffer, maxBytes: number): string | null {
  if (!bytes.subarray(0, MAGIC.length).equals(MAGIC)) return bytes.toString('utf8')
  try {
    return gunzipSync(bytes.subarray(MAGIC.length), { maxOutputLength: maxBytes }).toString('utf8')
  } catch {
    // Truncated, corrupt, or bigger than we will store — all of them mean the same thing to
    // the DM, and none of them should reach `JSON.parse`.
    return null
  }
}

export type MapImportResult =
  | { ok: true; data: SerializedMapData; name: string }
  | { ok: false; error: string }

/** `migrated`: the schema moved (old water bodies and paths dropped, floor heights moved onto plateaus), so the stored JSON has to
 *  be re-serialised from `data`, not kept as the bytes that arrived. */
export type MapFileResult =
  | { ok: true; data: SerializedMapData; name: string; migrated: boolean }
  | { ok: false; error: string }

/**
 * Parse + validate + migrate in one step, because a body that is not JSON fails the same way.
 * The upload and the republish both come through here, so a 2.0 file is stored as the 3.x
 * document every reader past this point expects, and a file still holding the old water tool's
 * bodies or the Path tool's paths is stored without them (the same `dropRetiredBodies` the
 * editor's load runs), and a 3.2
 * file whose floors carry a height is stored with plateaus instead (`plateausFromShapes`). Any other
 * 3.x file keeps its own bytes: what else `migrateToLatest` does (legacy tints, retired fields) is load-time tidying
 * the editor's and the table's own load repeats and nothing on the server reads, and the map
 * GET answers with the file as uploaded.
 */
export function parseMapFile(text: string): MapFileResult {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, error: 'not valid JSON' }
  }
  const map = validateMapData(value)
  if (!map.ok) return map
  let data: SerializedMapData
  try {
    data = migrateToLatest(map.data)
  } catch {
    // The envelope passed, but a layer inside it is not one the migration can read.
    return { ok: false, error: 'could not migrate that .ggvtt file' }
  }
  const migrated =
    data.version !== map.data.version ||
    countRetiredBodies(map.data.layers) > 0 ||
    plateausFromShapes(map.data.layers) !== map.data.layers
  return { ...map, data: migrated ? data : map.data, migrated }
}

export function validateMapData(value: unknown): MapImportResult {
  if (!isRecord(value)) return { ok: false, error: 'expected a .ggvtt object' }

  const { version, mapSettings, grid, layers } = value
  if (typeof version !== 'string' || !SUPPORTED_VERSIONS.includes(version as SerializedMapData['version'])) {
    return { ok: false, error: `unsupported .ggvtt version: ${JSON.stringify(version)}` }
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
