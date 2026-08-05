// D3 — the server treats a `.mapbuilder` file as schema-validated JSON and nothing more.
// Rooms, walls and lighting were computed in the editor and arrive inside the file; this
// module only refuses payloads the renderer could not read, and never throws doing it.

import { gunzipSync } from 'node:zlib'
import type { SerializedMapData } from '@dnd/core/src/store/types'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- D3 waiver, same as shared/mapBounds: store/migration is the shared version list + pure JSON migration, pixi-free by design
import { SUPPORTED_VERSIONS } from '@dnd/core/src/store/migration'

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
