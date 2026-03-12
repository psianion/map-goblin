// src/store/migration.test.ts
import { describe, it, expect } from 'vitest'
import { migrateToLatest, CURRENT_VERSION } from './migration.ts'
import type { SerializedMapData } from './types.ts'

describe('migrateToLatest', () => {
  it('exports CURRENT_VERSION as 1.1', () => {
    expect(CURRENT_VERSION).toBe('1.2')
  })

  it('returns v1.1 data unchanged', () => {
    const data: SerializedMapData = {
      version: '1.1',
      mapSettings: {
        name: 'Test',
        gridType: 'square',
        cellScale: { value: 5, unit: 'ft' },
        ambientLight: '#1a1a2e',
      },
      grid: { visible: true, snapDivision: 2, style: 'clean' },
      layers: [],
      lights: [],
      placedObjects: [],
      customImages: {},
    }
    const result = migrateToLatest(data)
    expect(result.version).toBe('1.2')
    expect(result.placedObjects).toEqual([])
    expect(result.customImages).toEqual({})
  })

  it('migrates v1.0 data to v1.1 — adds placedObjects and customImages', () => {
    const v10Data = {
      version: '1.0',
      mapSettings: {
        name: 'Old Map',
        gridType: 'square' as const,
        cellScale: { value: 5, unit: 'ft' },
        ambientLight: '#1a1a2e',
      },
      grid: { visible: true, snapDivision: 2 as const, style: 'clean' as const },
      layers: [],
      lights: [],
    }
    const result = migrateToLatest(v10Data as unknown as SerializedMapData)
    expect(result.version).toBe('1.2')
    expect(result.placedObjects).toEqual([])
    expect(result.customImages).toEqual({})
  })

  it('migrates v1.0 lights — adds default name and visible fields', () => {
    const v10Data = {
      version: '1.0',
      mapSettings: {
        name: 'Torch Map',
        gridType: 'square' as const,
        cellScale: { value: 5, unit: 'ft' },
        ambientLight: '#000000',
      },
      grid: { visible: true, snapDivision: 1 as const, style: 'dotted' as const },
      layers: [],
      lights: [
        { id: 'l1', position: { x: 0, y: 0 }, color: '#fff', radius: 5, intensity: 1, falloff: 'linear' },
      ],
    }
    const result = migrateToLatest(v10Data as unknown as SerializedMapData)
    const light = result.lights[0]
    expect(light.name).toBe('Light')
    expect(light.visible).toBe(true)
  })

  it('migrates v1.0 lights — preserves existing name and visible values', () => {
    const v10Data = {
      version: '1.0',
      mapSettings: {
        name: 'Named Lights',
        gridType: 'square' as const,
        cellScale: { value: 5, unit: 'ft' },
        ambientLight: '#000000',
      },
      grid: { visible: true, snapDivision: 1 as const, style: 'dotted' as const },
      layers: [],
      lights: [
        {
          id: 'l1',
          position: { x: 0, y: 0 },
          color: '#fff',
          radius: 5,
          intensity: 1,
          falloff: 'linear' as const,
          name: 'Torch',  // pre-existing name — should NOT be overwritten
          visible: false, // pre-existing visible — should NOT be overwritten
        },
      ],
    }
    const result = migrateToLatest(v10Data as unknown as SerializedMapData)
    expect(result.lights[0].name).toBe('Torch')    // preserved
    expect(result.lights[0].visible).toBe(false)   // preserved
  })

  it('throws for unknown versions', () => {
    const badData = { version: '0.9', mapSettings: {}, grid: {}, layers: [], lights: [] }
    expect(() => migrateToLatest(badData as unknown as SerializedMapData)).toThrow(
      /unsupported.*version/i
    )
  })
})
