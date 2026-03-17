// src/store/migration.test.ts
import { describe, it, expect } from 'vitest'
import { migrateToLatest, CURRENT_VERSION } from './migration.ts'
import type { SerializedMapData } from './types.ts'

const V2_DATA: SerializedMapData = {
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
  it('exports CURRENT_VERSION as 2.0', () => {
    expect(CURRENT_VERSION).toBe('2.0')
  })

  it('returns v2.0 data unchanged (same reference)', () => {
    const result = migrateToLatest(V2_DATA)
    expect(result).toBe(V2_DATA)
    expect(result.version).toBe('2.0')
  })

  it('v2.0 data with layers passes through intact', () => {
    const data: SerializedMapData = {
      ...V2_DATA,
      layers: [
        {
          id: 'layer-1',
          type: 'dungeon',
          name: 'Ground Floor',
          visible: true,
          locked: false,
          opacity: 1,
          children: [],
          style: {
            floorColor: '#333',
            wallColor: '#111',
            wallWidth: 2,
            shadowColor: '#000',
            shadowOpacity: 0.5,
            shadowOffsetX: 2,
            shadowOffsetY: 2,
            hatchingColor: '#555',
            hatchingOpacity: 0.3,
            hatchingSpacing: 8,
            hatchingAngle: 45,
            hatchingWidth: 1,
            preset: 'default',
            floorTexture: null,
            wallTexture: null,
            wallTextureTint: '#ffffff',
            edgeTransitionWidth: 0.5,
            showEdgeTransitions: true,
          },
        } as unknown as SerializedMapData['layers'][0],
      ],
    }
    const result = migrateToLatest(data)
    expect(result.version).toBe('2.0')
    expect(result.layers).toHaveLength(1)
  })

  it('throws for v1.4 data', () => {
    const oldData = { ...V2_DATA, version: '1.4' }
    expect(() => migrateToLatest(oldData as unknown as SerializedMapData)).toThrow(
      /cannot open files from version/i,
    )
  })

  it('throws for v1.3 data', () => {
    const oldData = { ...V2_DATA, version: '1.3' }
    expect(() => migrateToLatest(oldData as unknown as SerializedMapData)).toThrow(
      /cannot open files from version/i,
    )
  })

  it('throws for v1.2 data', () => {
    const oldData = { ...V2_DATA, version: '1.2' }
    expect(() => migrateToLatest(oldData as unknown as SerializedMapData)).toThrow(
      /cannot open files from version/i,
    )
  })

  it('throws for v1.1 data', () => {
    const oldData = { ...V2_DATA, version: '1.1' }
    expect(() => migrateToLatest(oldData as unknown as SerializedMapData)).toThrow(
      /cannot open files from version/i,
    )
  })

  it('throws for v1.0 data', () => {
    const oldData = { ...V2_DATA, version: '1.0' }
    expect(() => migrateToLatest(oldData as unknown as SerializedMapData)).toThrow(
      /cannot open files from version/i,
    )
  })

  it('throws for unknown version string', () => {
    const badData = { ...V2_DATA, version: '0.9' }
    expect(() => migrateToLatest(badData as unknown as SerializedMapData)).toThrow(
      /cannot open files from version/i,
    )
  })
})
