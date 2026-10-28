import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../store'
import type { AssetManifest } from '../types'
import { RECENT_ASSET_LIMIT } from './assets'

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

  it('resetToDefault preserves the manifest and installed packs (session state, not per-document)', () => {
    const manifest: AssetManifest = { categories: [] }
    useStore.getState().setManifest(manifest)
    useStore.getState().setInstalledPacks([
      { packId: 'gg-demo', name: 'gg-demo', version: '1.0.0', sizeBytes: 0, bundled: true, installedAt: 0 },
    ])

    useStore.getState().resetToDefault()

    expect(useStore.getState().assets.manifest).toEqual(manifest)
    expect(useStore.getState().packs.installedPacks).toHaveLength(1)
  })
})


describe('AssetsSlice — recently used', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault()
    useStore.setState((s) => {
      s.assets.recentlyUsed = []
    })
  })

  it('puts the latest use first and drops its older entry', () => {
    const { trackRecentUse } = useStore.getState()
    trackRecentUse('a')
    trackRecentUse('b')
    trackRecentUse('a')
    expect(useStore.getState().assets.recentlyUsed).toEqual(['a', 'b'])
  })

  it(`keeps the newest ${RECENT_ASSET_LIMIT}`, () => {
    const { trackRecentUse } = useStore.getState()
    for (let i = 0; i < RECENT_ASSET_LIMIT + 5; i++) trackRecentUse(`id-${i}`)
    const recent = useStore.getState().assets.recentlyUsed
    expect(recent).toHaveLength(RECENT_ASSET_LIMIT)
    expect(recent[0]).toBe(`id-${RECENT_ASSET_LIMIT + 4}`)
    expect(recent).not.toContain('id-0')
  })

  it('survives resetToDefault: recents belong to the DM, not the map', () => {
    useStore.getState().trackRecentUse('a')
    useStore.getState().resetToDefault()
    expect(useStore.getState().assets.recentlyUsed).toEqual(['a'])
  })
})

describe('AssetsSlice — favourites', () => {
  beforeEach(() => {
    useStore.getState().resetToDefault()
    useStore.setState((s) => {
      s.assets.favourites = []
    })
  })

  it('stars newest first and unstars on a second toggle', () => {
    const { toggleFavourite } = useStore.getState()
    toggleFavourite('a')
    toggleFavourite('b')
    expect(useStore.getState().assets.favourites).toEqual(['b', 'a'])
    toggleFavourite('a')
    expect(useStore.getState().assets.favourites).toEqual(['b'])
  })

  it('survives resetToDefault: favourites belong to the DM, not the map', () => {
    useStore.getState().toggleFavourite('a')
    useStore.getState().resetToDefault()
    expect(useStore.getState().assets.favourites).toEqual(['a'])
  })
})
