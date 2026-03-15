// src/engine/assetManifest.test.ts
import { describe, it, expect } from 'vitest'
import { getManifest, CATEGORY_IDS } from './assetManifest.ts'

describe('assetManifest', () => {
  it('exports the correct category IDs', () => {
    expect(CATEGORY_IDS).toEqual([
      'nature',
      'miscellaneous',
    ])
  })

  it('getManifest returns an AssetManifest with all categories', () => {
    const manifest = getManifest()
    expect(manifest.categories).toHaveLength(CATEGORY_IDS.length)
    const ids = manifest.categories.map((c) => c.id)
    expect(ids).toEqual([...CATEGORY_IDS])
  })

  it('each category has id, label, and non-empty assets array', () => {
    const manifest = getManifest()
    for (const category of manifest.categories) {
      expect(typeof category.id).toBe('string')
      expect(typeof category.label).toBe('string')
      expect(Array.isArray(category.assets)).toBe(true)
      expect(category.assets.length).toBeGreaterThan(0)
    }
  })

  it('assets have required fields', () => {
    const manifest = getManifest()
    for (const category of manifest.categories) {
      for (const asset of category.assets) {
        expect(typeof asset.id).toBe('string')
        expect(typeof asset.name).toBe('string')
        expect(typeof asset.url).toBe('string')
        expect(asset.url).toMatch(/^\/textures\//)
        expect(typeof asset.cellWidth).toBe('number')
        expect(typeof asset.cellHeight).toBe('number')
      }
    }
  })
})
