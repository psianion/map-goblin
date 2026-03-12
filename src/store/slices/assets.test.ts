import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../store.ts'
import type { Light, PlacedObject, AssetManifest } from '../types.ts'

describe('AssetsSlice — manifest state', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault()
  })

  it('initializes with null manifest', () => {
    const { manifest } = useStore.getState().assets
    expect(manifest).toBeNull()
  })

  it('setManifest stores manifest and exposes categories', () => {
    const manifest: AssetManifest = {
      categories: [
        {
          id: 'furniture',
          label: 'Furniture',
          assets: [
            {
              id: 'chair-01',
              name: 'Chair',
              url: '/assets/chair-01.png',
              thumbnailUrl: '/assets/chair-01-thumb.png',
              cellWidth: 1,
              cellHeight: 1,
            },
          ],
        },
      ],
    }
    useStore.getState().setManifest(manifest)
    expect(useStore.getState().assets.manifest).toEqual(manifest)
  })

  it('markCategoryLoaded adds categoryId to loadedCategories', () => {
    useStore.getState().markCategoryLoaded('furniture')
    expect(useStore.getState().assets.loadedCategories).toContain('furniture')
  })

  it('markCategoryLoaded is idempotent', () => {
    useStore.getState().markCategoryLoaded('furniture')
    useStore.getState().markCategoryLoaded('furniture')
    const loaded = useStore.getState().assets.loadedCategories
    expect(loaded.filter((id) => id === 'furniture')).toHaveLength(1)
  })
})

describe('Light type — name and visible fields', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault()
  })

  it('addLight accepts a light with name and visible fields', () => {
    const light: Light = {
      id: 'l1',
      position: { x: 0, y: 0 },
      color: '#ffffff',
      radius: 5,
      intensity: 0.8,
      falloff: 'quadratic',
      name: 'Torch',
      visible: true,
    }
    useStore.getState().addLight(light)
    const stored = useStore.getState().lights[0]
    expect(stored.name).toBe('Torch')
    expect(stored.visible).toBe(true)
  })

  it('updateLight can toggle visible', () => {
    const light: Light = {
      id: 'l2',
      position: { x: 1, y: 1 },
      color: '#ff8800',
      radius: 3,
      intensity: 1.0,
      falloff: 'linear',
      name: 'Lantern',
      visible: true,
    }
    useStore.getState().addLight(light)
    useStore.getState().updateLight('l2', { visible: false })
    expect(useStore.getState().lights[0].visible).toBe(false)
  })
})

describe('PlacedObject — expanded fields', () => {
  it('PlacedObject type accepts all required fields', () => {
    const obj: PlacedObject = {
      id: 'obj-1',
      layerId: 'layer-1',
      objectType: 'asset',
      assetId: 'chair-01',
      position: { x: 5, y: 10 },
      rotation: 0,
      scale: 1,
      tint: '#ffffff',
      groupId: null,
      flipX: false,
      flipY: false,
    }
    expect(obj.assetId).toBe('chair-01')
    expect(obj.groupId).toBeNull()
  })

  it('PlacedObject objectType accepts image', () => {
    const obj: PlacedObject = {
      id: 'obj-2',
      layerId: 'layer-1',
      objectType: 'image',
      assetId: 'custom-img-abc123',
      position: { x: 0, y: 0 },
      rotation: Math.PI / 4,
      scale: 2,
      tint: '#ff0000',
      groupId: null,
      flipX: true,
      flipY: false,
    }
    expect(obj.objectType).toBe('image')
    expect(obj.flipX).toBe(true)
  })
})
