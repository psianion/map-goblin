// src/store/migration.test.ts
import { describe, it, expect } from 'vitest'
import { migrateToLatest, CURRENT_VERSION, NEUTRAL_TINT, isLegacyTint } from './migration'

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
  it('exports CURRENT_VERSION as 3.1', () => {
    expect(CURRENT_VERSION).toBe('3.1')
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

  it('loads v3.0 files without migration', () => {
    const v3Data = { ...V2_BASE, version: '3.0' }
    const result = migrateToLatest(v3Data)
    expect(result.version).toBe('3.0')
  })

  // '3.1' only adds the optional `prep` block — no migration step, and a doc
  // that already carries it must survive untouched, prep included.
  it('passes v3.1 files through unchanged, prep included', () => {
    const v31Data = { ...V2_BASE, version: '3.1', prep: { version: 1, triggers: [] } }
    const result = migrateToLatest(v31Data)
    expect(result.version).toBe('3.1')
    expect(result.prep).toEqual({ version: 1, triggers: [] })
  })

  it('a saved map with a gridType loads and drops it', () => {
    for (const version of ['2.0', '3.0', '3.1']) {
      const saved = { ...V2_BASE, version }
      const result = migrateToLatest(saved)
      expect(result.mapSettings).not.toHaveProperty('gridType')
      expect(result.mapSettings).toEqual({
        name: 'Test',
        cellScale: { value: 5, unit: 'ft' },
        ambientLight: '#ffffff', // Night was a legacy tint: white on load
      })
      // The caller's object is left alone.
      expect(saved.mapSettings).toHaveProperty('gridType', 'square')
    }
  })

  it('a saved layer style with shadow and roughness keys loads and drops them', () => {
    for (const version of ['2.0', '3.0', '3.1']) {
      const style = {
        floorColor: '#F1ECDF',
        wallColor: '#000000',
        wallWidth: 0.5,
        shadowEnabled: true,
        shadowColor: '#8C867D',
        shadowOffset: { x: 0.4, y: 0.3 },
        shadowIntensity: 0.4,
        roughnessAmplitude: 0.15,
        lineWidth: 0.04,
      }
      const background = { type: 'background', id: 'bg', name: 'BG', visible: true, locked: false, opacity: 1 }
      const saved = {
        ...V2_BASE,
        version,
        layers: [
          {
            type: 'dungeon', id: 'l1', name: 'L1', visible: true, locked: false, opacity: 1,
            children: [], standaloneWalls: [], mergedFloor: null, style, sublayerVisibility: {},
          },
          background,
        ],
      }
      const result = migrateToLatest(saved)
      const loaded = (result.layers[0] as unknown as { style: Record<string, unknown> }).style
      for (const key of ['shadowEnabled', 'shadowColor', 'shadowOffset', 'shadowIntensity', 'roughnessAmplitude']) {
        expect(loaded).not.toHaveProperty(key)
      }
      expect(loaded).toEqual({ floorColor: '#F1ECDF', wallColor: '#000000', wallWidth: 0.5, lineWidth: 0.04 })
      // Layers without a style pass through untouched.
      expect(result.layers[1]).toBe(background)
      // The caller's object is left alone.
      expect(style).toHaveProperty('shadowEnabled', true)
    }
  })

  it('drops the width a wall copied from its layer when drawn, and keeps a preset pin', () => {
    for (const version of ['3.0', '3.1']) {
      const base = { points: [[0, 0], [4, 0]], wallType: 'normal', direction: 'both', color: '#000', roughness: 0 }
      const walls = [
        { ...base, id: 'drawn', width: 0.5 },
        { ...base, id: 'pinned', width: 0.8, textureTint: '#b09878' },
        { ...base, id: 'set-pinned', width: 0.6, textureSetId: 'GG_Fieldstone' },
        { ...base, id: 'bare' },
      ]
      const saved = {
        ...V2_BASE,
        version,
        layers: [
          {
            type: 'dungeon', id: 'l1', name: 'L1', visible: true, locked: false, opacity: 1,
            children: [], standaloneWalls: walls, mergedFloor: null, style: { wallWidth: 0.5 }, sublayerVisibility: {},
          },
        ],
      }
      const result = migrateToLatest(saved as unknown as Parameters<typeof migrateToLatest>[0])
      const loaded = (result.layers[0] as unknown as { standaloneWalls: Record<string, unknown>[] }).standaloneWalls
      expect(loaded.map((w) => w.width)).toEqual([undefined, 0.8, 0.6, undefined])
      expect(loaded[0]).not.toHaveProperty('width')
      expect(loaded[3]).toBe(walls[3])
      // The caller's object is left alone.
      expect(walls[0]).toHaveProperty('width', 0.5)
    }
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

describe('the mood tint on load', () => {
  // The v1 presets, the warren's own tint, and Day: luma below 0.75 is a legacy darkness.
  const LEGACY = ['#2d2d44', '#1a1a2e', '#0a0a0f', '#6b5a7a', '#9a9a9a', '#4b4552']
  const TINTS = ['#e8e4d8', '#ffffff', '#fff4e0', '#E0E8FF']

  it('reads the v1 presets and the warren as legacy, Day and lighter as tints', () => {
    for (const hex of LEGACY) expect(isLegacyTint(hex), hex).toBe(true)
    for (const hex of TINTS) expect(isLegacyTint(hex), hex).toBe(false)
  })

  it('replaces a legacy tint with white on every supported version', () => {
    for (const version of ['2.0', '3.0', '3.1']) {
      for (const ambientLight of LEGACY) {
        const saved = { ...V2_BASE, version, mapSettings: { ...V2_BASE.mapSettings, ambientLight } }
        expect(migrateToLatest(saved).mapSettings.ambientLight).toBe(NEUTRAL_TINT)
        // The caller's object is left alone.
        expect(saved.mapSettings.ambientLight).toBe(ambientLight)
      }
    }
  })

  it('keeps a light tint as authored', () => {
    for (const ambientLight of TINTS) {
      const saved = { ...V2_BASE, version: '3.1', mapSettings: { ...V2_BASE.mapSettings, ambientLight } }
      expect(migrateToLatest(saved).mapSettings.ambientLight).toBe(ambientLight)
    }
  })

  it('lands an imported dark scene on white: the import documents load through here too', () => {
    // A Foundry scene at darkness 1 reads as #2d2d44 (`ambientForDarkness`).
    const imported = { ...V2_BASE, version: '3.1', mapSettings: { ...V2_BASE.mapSettings, ambientLight: '#2d2d44' } }
    expect(migrateToLatest(imported).mapSettings.ambientLight).toBe('#ffffff')
  })
})
