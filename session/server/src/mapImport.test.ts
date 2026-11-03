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
    for (const version of ['2.0', '3.0', '3.1', '3.2', '3.3', '3.4']) {
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

  it('stores a file that still holds old water bodies without them, the rest kept', () => {
    const lake = { id: 'lake', name: 'Lake', childType: 'water', visible: true, contours: [[[0, 0], [2, 0], [2, 2]]] }
    const torch = { id: 'torch', name: 'Torch', childType: 'light', visible: true, position: { x: 1, y: 1 } }
    const result = parseMapFile(JSON.stringify({ ...(doc('3.1') as object), layers: [{ type: 'dungeon', id: 'l', children: [lake, torch] }] }))
    if (!result.ok) throw new Error(result.error)
    expect(result.migrated).toBe(true)
    expect((result.data.layers[0] as unknown as { children: { id: string }[] }).children.map((c) => c.id)).toEqual(['torch'])
  })

  it('stores a 3.3 file with paths without them, its plateaus and openings kept', () => {
    const road = { id: 'road', name: 'Road', childType: 'path', visible: true, points: [{ x: 0, y: 0 }, { x: 4, y: 0 }], closed: false, width: 1 }
    const mesa = { id: 'm', name: 'Mesa', childType: 'plateau', visible: true, contours: [[[0, 0], [4, 0], [4, 4]]], height: 2, edge: 'cliff' }
    const stairs = { id: 'stairs', name: 'Stairs', childType: 'opening', visible: true, kind: 'stairs', hostId: 'm', t: 0.5, width: 2 }
    const result = parseMapFile(JSON.stringify({ ...(doc('3.3') as object), layers: [{ type: 'dungeon', id: 'l', children: [road, mesa, stairs] }] }))
    if (!result.ok) throw new Error(result.error)
    expect(result.migrated).toBe(true)
    expect((result.data.layers[0] as unknown as { children: { id: string }[] }).children.map((c) => c.id)).toEqual(['m', 'stairs'])
  })

  it('takes a 3.4 file with plateaus and openings as it arrived', () => {
    const mesa = { id: 'm', name: 'Mesa', childType: 'plateau', visible: true, contours: [[[0, 0], [4, 0], [4, 4]]], height: 2, edge: 'cliff' }
    const stairs = { id: 'stairs', name: 'Stairs', childType: 'opening', visible: true, kind: 'stairs', hostId: 'm', t: 0.5, width: 2 }
    const file = { ...(doc('3.4') as object), layers: [{ type: 'dungeon', id: 'l', children: [mesa, stairs] }] }
    const result = parseMapFile(JSON.stringify(file))
    if (!result.ok) throw new Error(result.error)
    expect(result.migrated).toBe(false)
    expect(result.data).toEqual(file)
  })

  it('stores a 3.2 file whose floors carry a height with plateaus instead', () => {
    const floor = { id: 's', name: 'Mesa', childType: 'shape', visible: true, contours: [[[0, 0], [4, 0], [4, 4]]], height: 2, edge: 'cliff' }
    const stairs = { id: 'stairs', name: 'Stairs', childType: 'opening', visible: true, kind: 'stairs', shapeId: 's', t: 0.5, width: 2 }
    const result = parseMapFile(JSON.stringify({ ...(doc('3.2') as object), layers: [{ type: 'dungeon', id: 'l', children: [floor, stairs] }] }))
    if (!result.ok) throw new Error(result.error)
    expect(result.migrated).toBe(true)
    const children = (result.data.layers[0] as unknown as { children: Record<string, unknown>[] }).children
    expect(children.map((c) => c.childType)).toEqual(['shape', 'plateau', 'opening'])
    expect(children[1]).toMatchObject({ id: 's-plateau', height: 2, edge: 'cliff' })
    expect(children[2]).toMatchObject({ hostId: 's-plateau' })
  })

  it('refuses a 2.0 file whose layers the migration cannot read, instead of throwing', () => {
    expect(parseMapFile(JSON.stringify({ ...JSON.parse(V2_FILE), layers: [null] }))).toMatchObject({ ok: false })
  })
})
