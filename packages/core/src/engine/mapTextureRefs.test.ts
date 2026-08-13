import { describe, it, expect } from 'vitest'
import { collectMapTextureIds, resolveAssetSets, type MapTextureSource } from './mapTextureRefs'
import { createDungeonLayer, createBackgroundLayer } from '../store/factories'
import type { PackManifest, ManifestEntry } from './assetPackManager'
import type {
  DoorChild,
  LightChild,
  ShapeChild,
  WallSegment,
  WaterChild,
} from '../shared/types'

function shape(id: string, textureId: string | undefined): ShapeChild {
  return {
    id,
    name: id,
    childType: 'shape',
    visible: true,
    shapeType: 'rectangle',
    contours: [[[0, 0], [1, 0], [1, 1], [0, 1]]],
    roughnessEnabled: false,
    textureId,
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
  }
}

function water(id: string, textureId: string, bankTextureId: string): WaterChild {
  return {
    id,
    name: id,
    childType: 'water',
    visible: true,
    waterType: 'lake',
    contours: [[[0, 0], [1, 0], [1, 1], [0, 1]]],
    textureId,
    tint: '#ffffff',
    opacity: 1,
    bankTextureId,
    bankWidth: 0.5,
    flowSpeed: 0,
    flowAngle: 0,
  }
}

function light(id: string, maskTextureId: string | undefined): LightChild {
  return {
    id,
    name: id,
    childType: 'light',
    visible: true,
    color: '#ffffff',
    radius: 6,
    featherRadius: 0,
    intensity: 1,
    falloff: 'linear',
    position: { x: 0, y: 0 },
    maskTextureId,
  }
}

function door(id: string, portalTextureId: string | undefined): DoorChild {
  return {
    id,
    name: id,
    childType: 'door',
    visible: true,
    wallId: '',
    position: [0, 0],
    angle: 0,
    width: 1,
    style: 'portal',
    state: 'closed',
    isSecret: false,
    portalTextureId,
  }
}

function wall(id: string, textureSetId?: string): WallSegment {
  return {
    id,
    points: [[0, 0], [1, 0]],
    wallType: 'normal',
    direction: 'both',
    color: '#000000',
    width: 0.5,
    roughness: 0,
    textureSetId,
  }
}

function emptyMap(): MapTextureSource {
  return {
    mapSettings: { name: 'x', gridType: 'square', cellScale: { value: 5, unit: 'ft' }, ambientLight: '#000' },
    layers: [],
  }
}

describe('collectMapTextureIds', () => {
  it('returns nothing for an empty map', () => {
    expect(collectMapTextureIds(emptyMap())).toEqual([])
  })

  it('collects terrain palette slots, skipping nulls', () => {
    const map = emptyMap()
    map.mapSettings.terrain = { palette: ['grass-a-01', null, 'dirt-b-04'], bounds: null }
    expect(collectMapTextureIds(map).sort()).toEqual(['dirt-b-04', 'grass-a-01'])
  })

  it('collects the dungeon layer default texture', () => {
    const layer = createDungeonLayer('L');
    layer.style.defaultTextureId = 'cobblestone-a-01'
    const map: MapTextureSource = { ...emptyMap(), layers: [layer] }
    expect(collectMapTextureIds(map)).toContain('cobblestone-a-01')
  })

  it('collects the background texture', () => {
    const bg = createBackgroundLayer()
    bg.backgroundTexture = 'grass-a-09'
    const map: MapTextureSource = { ...emptyMap(), layers: [bg] }
    expect(collectMapTextureIds(map)).toEqual(['grass-a-09'])
  })

  it('skips a null background texture', () => {
    const bg = createBackgroundLayer()
    bg.backgroundTexture = null
    const map: MapTextureSource = { ...emptyMap(), layers: [bg] }
    expect(collectMapTextureIds(map)).toEqual([])
  })

  it('collects shape, water (+bank), light mask and door portal ids from children', () => {
    const layer = createDungeonLayer('L')
    layer.style.defaultTextureId = undefined
    layer.style.wallTextureSetId = undefined
    layer.children = [
      shape('s1', 'large-flagstone-a-01'),
      shape('s2', undefined),
      water('w1', 'water-still-a-01', 'bank-grassy-01-a1'),
      light('l1', 'some-mask-id'),
      light('l2', undefined),
      door('d1', 'some-portal-id'),
      door('d2', undefined),
    ]
    const map: MapTextureSource = { ...emptyMap(), layers: [layer] }
    expect(collectMapTextureIds(map).sort()).toEqual(
      [
        'large-flagstone-a-01',
        'water-still-a-01',
        'bank-grassy-01-a1',
        'some-mask-id',
        'some-portal-id',
      ].sort(),
    )
  })

  it('expands a wall family into every piece id, from the layer default and per-wall pins', () => {
    const layer = createDungeonLayer('L')
    layer.style.defaultTextureId = undefined
    layer.style.wallTextureSetId = 'fieldstone'
    layer.standaloneWalls = [wall('w1'), wall('w2', 'palisade')]
    const map: MapTextureSource = { ...emptyMap(), layers: [layer] }
    const ids = collectMapTextureIds(map)
    // Every fieldstone piece present (spot-check a few kinds)...
    expect(ids).toContain('wall-fieldstone-straight-3x1-a')
    expect(ids).toContain('wall-fieldstone-corner-h-3x3')
    expect(ids).toContain('wall-fieldstone-straight-path')
    // ...and every palisade piece too, from the standalone pin.
    expect(ids).toContain('wall-palisade-straight-1x1-a')
    expect(ids).toContain('wall-palisade-ending-a-1x1')
    // Not the other families.
    expect(ids).not.toContain('wall-stone-a-straight-a-3x1')
  })

  it('does not choke on a wall with no textureSetId pin and no layer default', () => {
    const layer = createDungeonLayer('L')
    layer.style.defaultTextureId = undefined
    layer.style.wallTextureSetId = undefined
    layer.standaloneWalls = [wall('w1')]
    const map: MapTextureSource = { ...emptyMap(), layers: [layer] }
    expect(collectMapTextureIds(map)).toEqual([])
  })

  it('dedupes ids referenced more than once', () => {
    const layer = createDungeonLayer('L')
    layer.style.defaultTextureId = undefined
    layer.style.wallTextureSetId = undefined
    layer.children = [shape('s1', 'grass-a-01'), shape('s2', 'grass-a-01')]
    const map: MapTextureSource = { ...emptyMap(), layers: [layer] }
    expect(collectMapTextureIds(map)).toEqual(['grass-a-01'])
  })
})

function makeManifest(entries: Record<string, Partial<ManifestEntry>>): PackManifest {
  const full: Record<string, ManifestEntry> = {}
  for (const [id, e] of Object.entries(entries)) {
    full[id] = { type: 'wall', localId: id, atlas: '', frame: id, gridSize: '1x1', tags: [], ...e }
  }
  return {
    name: 'test',
    description: '',
    version: '1.0.0',
    bundleSize: 0,
    entries: full,
    atlases: {},
    files: {},
  }
}

describe('resolveAssetSets', () => {
  it('groups set-tagged entries by pack', () => {
    const manifest = makeManifest({
      GG_Fieldstone_Straight_3x1_A_3x1_wall_A: { set: 'GG_Fieldstone' },
      GG_Palisade_Straight_3x1_A_3x1_wall_A: { set: 'GG_Palisade' },
    })
    const result = resolveAssetSets(
      ['wall-fieldstone-straight-3x1-a', 'wall-palisade-straight-3x1-a'],
      [{ packId: 'dungeon-classic', manifest }],
    )
    expect(result.get('dungeon-classic')).toEqual(new Set(['GG_Fieldstone', 'GG_Palisade']))
  })

  it('ignores setless entries', () => {
    const manifest = makeManifest({
      'stone-slate_1x1_floor_A': {},
    })
    const result = resolveAssetSets(['stone-slate'], [{ packId: 'dungeon-classic', manifest }])
    expect(result.size).toBe(0)
  })

  it('ignores ids that fail to resolve at all', () => {
    const manifest = makeManifest({})
    const result = resolveAssetSets(['not-a-real-legacy-id'], [{ packId: 'dungeon-classic', manifest }])
    expect(result.size).toBe(0)
  })

  it('ignores ids resolving to a pack with no cached manifest', () => {
    const result = resolveAssetSets(['wall-fieldstone-straight-3x1-a'], [])
    expect(result.size).toBe(0)
  })

  it('collapses repeated ids from the same set into one Set entry', () => {
    const manifest = makeManifest({
      GG_Fieldstone_Straight_3x1_A_3x1_wall_A: { set: 'GG_Fieldstone' },
      GG_Fieldstone_Straight_3x1_B_3x1_wall_A: { set: 'GG_Fieldstone' },
    })
    const result = resolveAssetSets(
      ['wall-fieldstone-straight-3x1-a', 'wall-fieldstone-straight-3x1-b'],
      [{ packId: 'dungeon-classic', manifest }],
    )
    expect(result.get('dungeon-classic')?.size).toBe(1)
  })
})
