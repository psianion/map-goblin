import { describe, it, expect } from 'vitest'
import { resolveLegacyId, buildMappingFromManifest } from './legacyAssetMapping'

describe('legacyAssetMapping', () => {
  it('maps old texture ID to new entry ID', () => {
    expect(resolveLegacyId('stone-slate')).toBe('dungeon-classic:stone-slate_1x1_floor_A')
  })

  it('returns null for unknown legacy ID', () => {
    expect(resolveLegacyId('nonexistent')).toBeNull()
  })

  it('passes through new-format IDs unchanged', () => {
    expect(resolveLegacyId('dungeon-classic:stone_1x1_floor_A')).toBe(
      'dungeon-classic:stone_1x1_floor_A',
    )
  })
})

describe('buildMappingFromManifest', () => {
  it('generates mapping from manifest entries', () => {
    const entries = [
      { id: 'grass-a-01', type: 'floor' },
      { id: 'stone-slate-straight', type: 'wall' },
      { id: 'oak-tree-01', type: 'object' },
    ]
    const mapping = buildMappingFromManifest(entries, 'my-pack')
    expect(mapping['grass-a-01']).toBe('my-pack:grass-a-01_1x1_floor_A')
    expect(mapping['stone-slate-straight']).toBe('my-pack:stone-slate-straight_wall_A')
    expect(mapping['oak-tree-01']).toBe('my-pack:oak-tree-01_object_A')
  })
})
