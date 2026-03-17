import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../store.ts'
import type { AssetManifest } from '../types.ts'

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

