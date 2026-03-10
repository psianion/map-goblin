// src/engine/assetManifest.test.ts
import { describe, it, expect } from 'vitest'
import { getManifest, CATEGORY_IDS } from './assetManifest.ts'

describe('assetManifest', () => {
  it('exports the correct category IDs', () => {
    expect(CATEGORY_IDS).toEqual([
      'furniture',
      'structures',
      'nature',
      'doors',
      'miscellaneous',
    ])
  })

  it('getManifest returns an AssetManifest with all five categories', () => {
    const manifest = getManifest()
    expect(manifest.categories).toHaveLength(5)
    const ids = manifest.categories.map((c) => c.id)
    expect(ids).toEqual(CATEGORY_IDS)
  })

  it('each category has id, label, and assets array', () => {
    const manifest = getManifest()
    for (const category of manifest.categories) {
      expect(typeof category.id).toBe('string')
      expect(typeof category.label).toBe('string')
      expect(Array.isArray(category.assets)).toBe(true)
    }
  })

  it('category labels match expected display names', () => {
    const manifest = getManifest()
    const labelMap: Record<string, string> = {
      furniture: 'Furniture',
      structures: 'Structures',
      nature: 'Nature',
      doors: 'Doors',
      miscellaneous: 'Miscellaneous',
    }
    for (const category of manifest.categories) {
      expect(category.label).toBe(labelMap[category.id])
    }
  })
})
