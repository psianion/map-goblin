// D3 — the server treats a `.mapbuilder` file as schema-validated JSON and nothing more
// (see the header comment on mapImport.ts). These pin the version gate, which is the one
// thing here that moves when the map schema does.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseMapFile, validateMapData } from './mapImport'

/** A 2.0 file (background, then the dungeon layer): walls still say `blocksLight`, which 3.0 replaced with `wallType`/`direction`. */
const V2_FILE = readFileSync(join(import.meta.dirname, '../../testdata/old-keep-v2.mapbuilder'), 'utf8')

function doc(version: unknown): unknown {
  return {
    version,
    mapSettings: { name: 'Test' },
    grid: { visible: true },
    layers: [],
  }
}

describe('validateMapData', () => {
  it('accepts every version SUPPORTED_VERSIONS lists', () => {
    for (const version of ['2.0', '3.0', '3.1']) {
      expect(validateMapData(doc(version))).toMatchObject({ ok: true })
    }
  })

  it('still rejects an unknown version', () => {
    const result = validateMapData(doc('4.0'))
    expect(result).toMatchObject({ ok: false })
    if (result.ok) throw new Error('expected rejection')
    expect(result.error).toMatch(/unsupported \.mapbuilder version/)
  })

  it('rejects a payload that is not an object', () => {
    expect(validateMapData('not an object')).toMatchObject({ ok: false })
    expect(validateMapData(null)).toMatchObject({ ok: false })
  })
})

describe('parseMapFile', () => {
  it('lands a 2.0 file migrated, walls and all', () => {
    const result = parseMapFile(V2_FILE)
    if (!result.ok) throw new Error(result.error)
    expect(result.migrated).toBe(true)
    expect(result.data.version).toBe('3.0')
    const walls = (result.data.layers[1] as unknown as { standaloneWalls: Record<string, unknown>[] }).standaloneWalls
    expect(walls.map((w) => [w.wallType, w.direction, 'blocksLight' in w])).toEqual([
      ['normal', 'both', false],
      ['terrain', 'both', false],
    ])
  })

  it('leaves a current file that has nothing to migrate as it arrived', () => {
    const result = parseMapFile(JSON.stringify(doc('3.1')))
    expect(result).toMatchObject({ ok: true, migrated: false })
  })

  it('refuses a 2.0 file whose layers the migration cannot read, instead of throwing', () => {
    expect(parseMapFile(JSON.stringify({ ...JSON.parse(V2_FILE), layers: [null] }))).toMatchObject({ ok: false })
  })
})
