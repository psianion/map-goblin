// src/store/migration.test.ts
import { describe, it, expect } from 'vitest'
import { migrateToLatest, CURRENT_VERSION } from './migration'

const V2_BASE = {
  version: '2.0',
  mapSettings: {
    name: 'Test',
    gridType: 'square',
    cellScale: { value: 5, unit: 'ft' },
    ambientLight: '#1a1a2e',
  },
  grid: { visible: true, snapDivision: 2, style: 'clean' },
  layers: [],
  customImages: {},
}

describe('migrateToLatest', () => {
  it('exports CURRENT_VERSION as 3.0', () => {
    expect(CURRENT_VERSION).toBe('3.0')
  })

  it('migrates v2.0 data to v3.0', () => {
    const result = migrateToLatest({ ...V2_BASE })
    expect(result.version).toBe('3.0')
  })

  it('converts blocksLight: true to wallType: normal', () => {
    const data = {
      ...V2_BASE,
      layers: [{
        type: 'dungeon', id: 'l1', name: 'L1', visible: true, locked: false, opacity: 1,
        children: [], standaloneWalls: [
          { id: 'w1', points: [[0,0],[100,0]] as [number, number][], blocksLight: true, color: '#000', width: 2, roughness: 0 },
        ], mergedFloor: null, style: {}, sublayerVisibility: {},
      }],
    }
    const result = migrateToLatest(data)
    expect(result.version).toBe('3.0')
    const wall = (result.layers[0] as unknown as { standaloneWalls: Array<Record<string, unknown>> }).standaloneWalls[0]
    expect(wall.wallType).toBe('normal')
    expect(wall.direction).toBe('both')
    expect(wall).not.toHaveProperty('blocksLight')
  })

  it('converts blocksLight: false to wallType: terrain', () => {
    const data = {
      ...V2_BASE,
      layers: [{
        type: 'dungeon', id: 'l1', name: 'L1', visible: true, locked: false, opacity: 1,
        children: [], standaloneWalls: [
          { id: 'w1', points: [[0,0],[100,0]] as [number, number][], blocksLight: false, color: '#000', width: 2, roughness: 0 },
        ], mergedFloor: null, style: {}, sublayerVisibility: {},
      }],
    }
    const result = migrateToLatest(data)
    const wall = (result.layers[0] as unknown as { standaloneWalls: Array<Record<string, unknown>> }).standaloneWalls[0]
    expect(wall.wallType).toBe('terrain')
  })

  it('passes non-dungeon layers unchanged', () => {
    const data = {
      ...V2_BASE,
      layers: [{ type: 'background', id: 'bg1' }],
    }
    const result = migrateToLatest(data)
    expect(result.layers[0].type).toBe('background')
  })

  it('loads v3 files without migration', () => {
    const v3Data = { ...V2_BASE, version: '3.0' }
    const result = migrateToLatest(v3Data)
    expect(result.version).toBe('3.0')
  })

  it('throws for unknown version', () => {
    const badData = { ...V2_BASE, version: '0.9' }
    expect(() => migrateToLatest(badData)).toThrow(/unknown map format version/i)
  })

  it('throws for v1.x data', () => {
    for (const ver of ['1.0', '1.1', '1.2', '1.3', '1.4']) {
      const oldData = { ...V2_BASE, version: ver }
      expect(() => migrateToLatest(oldData)).toThrow(/unknown map format version/i)
    }
  })
})
