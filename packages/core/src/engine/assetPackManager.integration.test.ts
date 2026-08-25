// SYNC: mirrors vault-engine's PackManifestSchema — update when it changes
//
// Integration type tests validating that builder interfaces are structurally
// compatible with the pack build pipeline's output.

import { describe, it, expect } from 'vitest'
import type { PackManifest, ManifestEntry, FileRef } from './assetPackManager'
import type { CatalogMeta, CatalogEntry, InvertedIndex } from './catalogBrowser'

// ─── Sample canonical data (mirrors vault-engine build output) ───────

const SAMPLE_PACK_MANIFEST: PackManifest = {
  name: 'gg-forge',
  description: 'Good Goblin forge-generated asset sets',
  version: '1.0.0',
  bundleSize: 25_600_000,
  entries: {
    'stone_1x1_floor_A': {
      type: 'floor',
      material: 'stone',
      gridSize: '1x1',
      pieceType: 'tile',
      variant: 'A',
      atlas: 'floors.webp',
      frame: { x: 0, y: 0, w: 200, h: 200 },
      tags: ['indoor', 'dungeon'],
    },
    'GG_Fieldstone_Straight_3x1_A_3x1_wall_A': {
      type: 'wall',
      material: 'GG_Fieldstone_Straight_3x1_A',
      gridSize: '3x1',
      pieceType: 'straight',
      variant: 'A',
      atlas: 'walls.webp',
      frame: { x: 0, y: 0, w: 600, h: 200 },
      contentRect: { x: 0, y: 66, w: 600, h: 68 },
      set: 'GG_Fieldstone',
      tags: ['fantasy'],
    },
  },
  atlases: {
    'floors.json': { checksum: 'sha256:abc123', size: 1024 },
    'floors.webp': { checksum: 'sha256:def456', size: 2_048_000 },
    'walls.json': { checksum: 'sha256:789abc', size: 512 },
    'walls.webp': { checksum: 'sha256:012def', size: 1_500_000 },
  },
  files: {
    'preview.webp': { checksum: 'sha256:aaa111', size: 50_000 },
  },
  theme: ['dungeon'],
}

const SAMPLE_CATALOG_META: CatalogMeta = {
  version: 1,
  totalEntries: 150,
  chunkCount: 3,
  chunks: [
    { index: 0, url: 'chunk-0.json', entryCount: 50 },
    { index: 1, url: 'chunk-1.json', entryCount: 50 },
    { index: 2, url: 'chunk-2.json', entryCount: 50 },
  ],
  invertedIndex: {
    type: { floor: [0, 1], wall: [2], object: [1] },
    theme: { dungeon: [0, 1, 2], cave: [0] },
    material: { stone: [0, 2], wood: [1], dirt: [0] },
  },
}

const SAMPLE_CATALOG_ENTRY: CatalogEntry = {
  entryId: 'dungeon-classic:stone_1x1_floor_A',
  packId: 'dungeon-classic',
  localId: 'stone_1x1_floor_A',
  type: 'floor',
  theme: 'dungeon',
  material: 'stone',
  gridSize: '1x1',
  tags: ['indoor', 'dungeon'],
  tint: '#ffffff',
  thumbnailUrl: '/thumb/stone_floor.webp',
  pHash: 'a0b1c2d3e4f56789',
}

// ─── Type compatibility tests ────────────────────────────────────────

describe('map-assets schema compatibility', () => {
  describe('PackManifest', () => {
    it('has required top-level fields', () => {
      expect(typeof SAMPLE_PACK_MANIFEST.name).toBe('string')
      expect(typeof SAMPLE_PACK_MANIFEST.description).toBe('string')
      expect(typeof SAMPLE_PACK_MANIFEST.version).toBe('string')
      expect(typeof SAMPLE_PACK_MANIFEST.bundleSize).toBe('number')
      expect(typeof SAMPLE_PACK_MANIFEST.entries).toBe('object')
      expect(typeof SAMPLE_PACK_MANIFEST.atlases).toBe('object')
      expect(typeof SAMPLE_PACK_MANIFEST.files).toBe('object')
    })

    it('entries carry the build pipeline structure', () => {
      const entries = Object.entries(SAMPLE_PACK_MANIFEST.entries)
      expect(entries.length).toBeGreaterThan(0)

      for (const [, entry] of entries) {
        expect(typeof entry.type).toBe('string')
        expect(typeof entry.material).toBe('string')
        expect(typeof entry.gridSize).toBe('string')
        expect(typeof entry.pieceType).toBe('string')
        expect(typeof entry.variant).toBe('string')
        expect(Array.isArray(entry.tags)).toBe(true)
      }
    })

    it('FileRef includes checksum and size', () => {
      for (const ref of Object.values(SAMPLE_PACK_MANIFEST.atlases)) {
        expect(typeof ref.checksum).toBe('string')
        expect(ref.checksum).toMatch(/^sha256:/)
        expect(typeof ref.size).toBe('number')
        expect(ref.size).toBeGreaterThan(0)
      }
      for (const ref of Object.values(SAMPLE_PACK_MANIFEST.files)) {
        expect(typeof ref.checksum).toBe('string')
        expect(typeof ref.size).toBe('number')
      }
    })

    it('theme is optional string array', () => {
      if (SAMPLE_PACK_MANIFEST.theme !== undefined) {
        expect(Array.isArray(SAMPLE_PACK_MANIFEST.theme)).toBe(true)
        for (const theme of SAMPLE_PACK_MANIFEST.theme) {
          expect(typeof theme).toBe('string')
        }
      }
    })
  })

  describe('CatalogMeta', () => {
    it('has required top-level fields', () => {
      expect(typeof SAMPLE_CATALOG_META.version).toBe('number')
      expect(typeof SAMPLE_CATALOG_META.totalEntries).toBe('number')
      expect(typeof SAMPLE_CATALOG_META.chunkCount).toBe('number')
      expect(Array.isArray(SAMPLE_CATALOG_META.chunks)).toBe(true)
      expect(typeof SAMPLE_CATALOG_META.invertedIndex).toBe('object')
    })

    it('chunks have required structure', () => {
      for (const chunk of SAMPLE_CATALOG_META.chunks) {
        expect(typeof chunk.index).toBe('number')
        expect(typeof chunk.url).toBe('string')
        expect(typeof chunk.entryCount).toBe('number')
      }
    })

    it('invertedIndex is structured with type/theme/material sub-objects', () => {
      const idx = SAMPLE_CATALOG_META.invertedIndex
      expect(typeof idx.type).toBe('object')
      expect(typeof idx.theme).toBe('object')
      expect(typeof idx.material).toBe('object')

      // Each sub-object maps string keys to number arrays (chunk indices)
      for (const [, chunks] of Object.entries(idx.type)) {
        expect(Array.isArray(chunks)).toBe(true)
        for (const c of chunks) {
          expect(typeof c).toBe('number')
        }
      }
    })
  })

  describe('CatalogEntry', () => {
    it('has all canonical fields', () => {
      expect(typeof SAMPLE_CATALOG_ENTRY.entryId).toBe('string')
      expect(typeof SAMPLE_CATALOG_ENTRY.packId).toBe('string')
      expect(typeof SAMPLE_CATALOG_ENTRY.localId).toBe('string')
      expect(typeof SAMPLE_CATALOG_ENTRY.type).toBe('string')
      expect(typeof SAMPLE_CATALOG_ENTRY.theme).toBe('string')
      expect(typeof SAMPLE_CATALOG_ENTRY.material).toBe('string')
      expect(typeof SAMPLE_CATALOG_ENTRY.gridSize).toBe('string')
      expect(Array.isArray(SAMPLE_CATALOG_ENTRY.tags)).toBe(true)
      expect(typeof SAMPLE_CATALOG_ENTRY.tint).toBe('string')
      expect(typeof SAMPLE_CATALOG_ENTRY.thumbnailUrl).toBe('string')
    })

    it('entryId follows packId:localId format', () => {
      const [packId, localId] = SAMPLE_CATALOG_ENTRY.entryId.split(':')
      expect(packId).toBe(SAMPLE_CATALOG_ENTRY.packId)
      expect(localId).toBe(SAMPLE_CATALOG_ENTRY.localId)
    })

    it('pHash is optional 16-char hex string', () => {
      if (SAMPLE_CATALOG_ENTRY.pHash !== undefined) {
        expect(typeof SAMPLE_CATALOG_ENTRY.pHash).toBe('string')
        expect(SAMPLE_CATALOG_ENTRY.pHash).toMatch(/^[0-9a-f]{16}$/)
      }
    })
  })

  describe('structural compatibility', () => {
    it('PackManifest satisfies builder interface at compile time', () => {
      // This test validates TypeScript structural typing — if it compiles, the types align
      const manifest: PackManifest = SAMPLE_PACK_MANIFEST
      const entry: ManifestEntry = manifest.entries['stone_1x1_floor_A']!
      const fileRef: FileRef = manifest.atlases['floors.json']!
      expect(entry).toBeDefined()
      expect(fileRef).toBeDefined()
    })

    it('CatalogMeta satisfies builder interface at compile time', () => {
      const meta: CatalogMeta = SAMPLE_CATALOG_META
      const idx: InvertedIndex = meta.invertedIndex
      expect(idx.type).toBeDefined()
      expect(idx.theme).toBeDefined()
      expect(idx.material).toBeDefined()
    })

    it('CatalogEntry satisfies builder interface at compile time', () => {
      const entry: CatalogEntry = SAMPLE_CATALOG_ENTRY
      expect(entry.entryId).toBeDefined()
      expect(entry.gridSize).toBeDefined()
      expect(entry.tint).toBeDefined()
    })
  })
})
