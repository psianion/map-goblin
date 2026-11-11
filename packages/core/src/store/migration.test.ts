// src/store/migration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  migrateToLatest,
  CURRENT_VERSION,
  NEUTRAL_TINT,
  countRetiredBodies,
  dropRetiredBodies,
  isLegacyTint,
  retiredRemovedMessage,
} from './migration'
import { defaultCrossingKinds } from '../shared/crossingKinds'
import { isBandSet } from '../assets/packCatalog'
import { isCaveBandAsset } from '../assets/caveWallKit'
import { seedCaveBandPack, caveBandChildren, resetAssetPackManager } from '../testing/seedCatalog'

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
  it('exports CURRENT_VERSION as 3.2', () => {
    expect(CURRENT_VERSION).toBe('3.10')
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
        sightDropCells: 2,
        crossingKinds: defaultCrossingKinds(),
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

describe('3.2: old water goes, plateau settings arrive', () => {
  const river = {
    id: 'river', name: 'River', childType: 'water', visible: true, waterType: 'river',
    contours: [[[0, 0], [8, 0], [8, 1], [0, 1]]], textureId: 'gg-forge:water-still-a-01', tint: '#ffffff',
    opacity: 1, bankTextureId: 'gg-forge:bank-grassy-01-a1', bankWidth: 0.5,
  }
  const lake = { ...river, id: 'lake', name: 'Lake', waterType: 'lake', contours: [[[2, 2], [6, 2], [6, 6], [2, 6]]] }
  // A corridor from the retired path tool: a plain floor shape that must keep loading.
  const corridor = {
    id: 'corridor', name: 'Corridor', childType: 'shape', visible: true, shapeType: 'path',
    contours: [[[0, 4], [8, 4], [8, 4.5], [0, 4.5]]], textureScale: 1, textureOffsetX: 0, textureOffsetY: 0,
    textureFillRotation: 0, textureTint: '#ffffff',
  }
  const torch = { id: 'torch', name: 'Torch', childType: 'light', position: { x: 1, y: 1 } }
  const dungeon = (id: string, children: unknown[]) => ({
    type: 'dungeon', id, name: id, visible: true, locked: false, opacity: 1,
    children, standaloneWalls: [], mergedFloor: null, style: {}, sublayerVisibility: {},
  })
  const saved = (version: string) =>
    ({
      ...V2_BASE,
      version,
      layers: [dungeon('l1', [river, corridor, torch]), dungeon('l2', [lake]), { type: 'background', id: 'bg' }],
    }) as unknown as Parameters<typeof migrateToLatest>[0]
  const kids = (data: { layers: unknown[] }, i: number) =>
    (data.layers[i] as { children: { id: string; childType: string }[] }).children

  it('drops every river and lake from every layer on 2.0, 3.0 and 3.1, and keeps the rest', () => {
    for (const version of ['2.0', '3.0', '3.1']) {
      const doc = saved(version)
      expect(countRetiredBodies(doc.layers)).toBe(2)
      const result = migrateToLatest(doc)
      // The stamp moves on the next save, as for every 3.x file.
      expect(result.version).toBe(version === '2.0' ? '3.0' : version)
      expect(kids(result, 0).map((c) => c.id)).toEqual(['corridor', 'torch'])
      expect(kids(result, 1)).toEqual([])
      expect(countRetiredBodies(result.layers)).toBe(0)
      // The caller's document is left alone.
      expect(kids(doc, 0)).toHaveLength(3)
    }
  })

  it('keeps an old path-tool corridor as a plain floor shape', () => {
    const result = migrateToLatest(saved('3.1'))
    expect(kids(result, 0)[0]).toMatchObject({ id: 'corridor', childType: 'shape', shapeType: 'path' })
  })

  it('seeds the sight threshold and the crossing kinds on older files', () => {
    for (const version of ['2.0', '3.0', '3.1']) {
      const { mapSettings } = migrateToLatest(saved(version))
      expect(mapSettings.sightDropCells).toBe(2)
      expect(mapSettings.crossingKinds.map((k) => [k.name, k.blocks])).toEqual([
        ['Free', false],
        ['Difficult', false],
        ['Climb', false],
        ['Impassable', true],
      ])
      expect(mapSettings.crossingKinds.find((k) => k.id === 'climb')?.note).toBe('e.g. DC 12 Athletics')
    }
  })

  it('loads a 3.2 file as it is, its own rules kept', () => {
    const kinds = [{ id: 'free', name: 'Open', blocks: false }]
    const doc = {
      ...V2_BASE,
      version: '3.2',
      mapSettings: { ...V2_BASE.mapSettings, ambientLight: '#ffffff', sightDropCells: 3, crossingKinds: kinds },
      layers: [dungeon('l1', [corridor])],
    } as unknown as Parameters<typeof migrateToLatest>[0]
    const result = migrateToLatest(doc)
    expect(result.version).toBe('3.2')
    expect(result.mapSettings.sightDropCells).toBe(3)
    expect(result.mapSettings.crossingKinds).toEqual(kinds)
    expect(result.layers).toBe(doc.layers)
  })

  it('loads a prop with no attachment unchanged, and lets a path-placed one go of its host', () => {
    const prop = {
      id: 'p1', name: 'Crate', childType: 'asset', visible: true, objectType: 'asset', assetId: 'gg-demo:crate',
      position: { x: 2, y: 3 }, rotation: 0, scale: 1, width: 1, height: 1, tint: '#ffffff', flipX: false, flipY: false,
    }
    const tree = { ...prop, id: 'r~0', attachedTo: { kind: 'path', id: 'r', t: 0.4, side: 1 } }
    const doc = { ...V2_BASE, version: '3.2', layers: [dungeon('l1', [prop, tree])] } as unknown as Parameters<typeof migrateToLatest>[0]
    const result = migrateToLatest(doc)
    const [kept, freed] = kids(result, 0) as unknown as Record<string, unknown>[]
    expect(kept).toEqual(prop)
    expect(freed).toEqual({ ...prop, id: 'r~0' })
  })

  it('hands the layers back untouched when there is no water', () => {
    const layers = [dungeon('l1', [corridor, torch])] as unknown as Parameters<typeof dropRetiredBodies>[0]
    expect(dropRetiredBodies(layers)).toEqual({ layers, removed: 0 })
    expect(dropRetiredBodies(layers).layers).toBe(layers)
  })

  it('words the load toast for one body and for several', () => {
    expect(retiredRemovedMessage(1)).toBe('1 path or water body from a retired tool was removed.')
    expect(retiredRemovedMessage(3)).toBe('3 paths and water bodies from a retired tool were removed.')
  })
})

describe('3.4: the Path tool\'s paths go', () => {
  const road = {
    id: 'road', name: 'Road', childType: 'path', visible: true, closed: false, width: 1.5,
    points: [{ x: 0, y: 0 }, { x: 6, y: 0 }], materialId: 'gg-forge:road-dirt', sort: 'under',
  }
  const torch = { id: 'torch', name: 'Torch', childType: 'light', position: { x: 1, y: 1 } }
  const doc = () =>
    ({
      ...V2_BASE,
      version: '3.3',
      layers: [{ type: 'dungeon', id: 'l1', name: 'l1', children: [road, torch], standaloneWalls: [], style: {} }],
    }) as unknown as Parameters<typeof migrateToLatest>[0]

  it('drops every path from a 3.3 file and keeps the rest', () => {
    const saved = doc()
    expect(countRetiredBodies(saved.layers)).toBe(1)
    const result = migrateToLatest(saved)
    expect((result.layers[0] as unknown as { children: { id: string }[] }).children.map((c) => c.id)).toEqual(['torch'])
    expect(countRetiredBodies(result.layers)).toBe(0)
  })

  it('reads and writes 3.4', () => {
    expect(migrateToLatest({ ...doc(), version: '3.4' } as unknown as Parameters<typeof migrateToLatest>[0]).version).toBe('3.4')
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

describe('placed cave band pieces', () => {
  // The forge kit as a band set (GG_Cave_Ink, tagged cave) and the plain pack the
  // fixture's rock children resolve against, both answering the kit's measurements.
  beforeEach(() => {
    resetAssetPackManager()
    seedCaveBandPack()
    seedCaveBandPack('gg-forge', { set: 'GG_Cave_Ink', tags: ['cave'] })
  })
  afterEach(() => resetAssetPackManager())

  const caveKit = { isBandSet, isCaveBandAsset }
  const rubble = {
    id: 'rubble', name: 'Rubble', childType: 'asset', objectType: 'asset',
    assetId: 'gg-demo:rubble_small_3x3_object_A', position: { x: 2, y: 2 }, rotation: 0, scale: 1,
    width: 1, height: 1, tint: '#ffffff', flipX: false, flipY: false, visible: true,
  }
  const torch = { id: 'torch', name: 'Torch', childType: 'light', position: { x: 1, y: 1 } }

  function savedWith(wallTextureSetId: string | undefined, extra: Record<string, unknown> = {}) {
    const rock = caveBandChildren().children
    return {
      ...V2_BASE,
      version: '3.1',
      layers: [
        {
          type: 'dungeon', id: 'l1', name: 'L1', visible: true, locked: false, opacity: 1,
          children: [...rock, rubble, torch], standaloneWalls: [], mergedFloor: null,
          style: { floorColor: '#F1ECDF', wallColor: '#000000', wallWidth: 0.5, wallTextureSetId },
          sublayerVisibility: {},
        },
      ],
      ...extra,
    } as unknown as Parameters<typeof migrateToLatest>[0]
  }
  const ids = (data: { layers: unknown[] }) =>
    (data.layers[0] as { children: { id: string }[] }).children.map((c) => c.id)

  it('drops the pieces from a layer drawn with a band set, and nothing else', () => {
    const result = migrateToLatest(savedWith('GG_Cave_Ink'), caveKit)
    expect(ids(result)).toEqual(['rubble', 'torch'])
  })

  it('reads the wall set off the level when the layer names none', () => {
    const saved = savedWith(undefined, {
      levels: [{ id: 'lv1', name: 'Ground', look: { wallTextureSetId: 'GG_Cave_Ink' } }],
    })
    expect(ids(migrateToLatest(saved, caveKit))).toEqual(['rubble', 'torch'])
  })

  it('leaves the pieces on a layer that is not on a band set', () => {
    for (const setId of [undefined, 'GG_Fieldstone']) {
      const saved = savedWith(setId)
      const result = migrateToLatest(saved, caveKit)
      expect(ids(result)).toEqual(ids(saved))
      expect(ids(result)).toHaveLength(5)
    }
  })

  it('leaves every layer as it was when there is nothing to drop', () => {
    const saved = savedWith('GG_Cave_Ink')
    const layer = saved.layers[0] as unknown as { children: { id: string; childType: string }[] }
    layer.children = layer.children.filter((c) => c.childType !== 'asset' || c.id === 'rubble')
    expect(migrateToLatest(saved, caveKit).layers).toBe(saved.layers)
  })

  it('is skipped without a catalog lookup, as the server reads this module', () => {
    const saved = savedWith('GG_Cave_Ink')
    expect(ids(migrateToLatest(saved))).toEqual(ids(saved))
  })

  it("leaves the caller's document alone", () => {
    const saved = savedWith('GG_Cave_Ink')
    migrateToLatest(saved, caveKit)
    expect(ids(saved)).toHaveLength(5)
  })
})
