// src/engine/assetManifest.test.ts
import { describe, it, expect } from 'vitest'
import { getManifest, CATEGORY_IDS, ASSET_TYPE_IDS } from './assetManifest'

describe('assetManifest', () => {
  it('exports the correct category IDs', () => {
    expect(CATEGORY_IDS).toEqual([
      'floors',
      'walls',
      'edges',
      'nature',
      'miscellaneous',
      'scatter',
    ])
  })

  it('exports all 9 asset type IDs', () => {
    expect(ASSET_TYPE_IDS).toEqual([
      'floor',
      'wall',
      'edge',
      'object',
      'scatter',
      'pattern',
      'portal',
      'light-mask',
      'path',
    ])
    expect(ASSET_TYPE_IDS).toHaveLength(9)
  })

  it('getManifest returns an AssetManifest with all categories', () => {
    const manifest = getManifest()
    expect(manifest.categories).toHaveLength(CATEGORY_IDS.length)
    const ids = manifest.categories.map((c) => c.id)
    expect(ids).toEqual([...CATEGORY_IDS])
  })

  it('each category has id, label, and assets array', () => {
    const manifest = getManifest()
    for (const category of manifest.categories) {
      expect(typeof category.id).toBe('string')
      expect(typeof category.label).toBe('string')
      expect(Array.isArray(category.assets)).toBe(true)
    }
  })

  it('floors category has floor textures', () => {
    const manifest = getManifest()
    const floors = manifest.categories.find((c) => c.id === 'floors')
    expect(floors).toBeDefined()
    expect(floors!.assets.length).toBeGreaterThan(0)
  })

  it('walls category has wall textures', () => {
    const manifest = getManifest()
    const walls = manifest.categories.find((c) => c.id === 'walls')
    expect(walls).toBeDefined()
    expect(walls!.assets.length).toBeGreaterThan(0)
  })

  it('edges category has edge textures', () => {
    const manifest = getManifest()
    const edges = manifest.categories.find((c) => c.id === 'edges')
    expect(edges).toBeDefined()
    expect(edges!.assets.length).toBeGreaterThan(0)
  })

  it('nature category has object textures', () => {
    const manifest = getManifest()
    const nature = manifest.categories.find((c) => c.id === 'nature')
    expect(nature).toBeDefined()
    expect(nature!.assets.length).toBeGreaterThan(0)
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
