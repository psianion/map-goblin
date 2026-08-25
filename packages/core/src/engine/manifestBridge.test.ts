import { describe, it, expect } from 'vitest';
import type { PackManifest } from './assetPackManager';
import { packToCategories, buildMergedManifest } from './manifestBridge';

const MOCK_MANIFEST: PackManifest = {
  name: 'Test Pack',
  description: 'A test pack',
  version: '1.0.0',
  bundleSize: 10_000,
  entries: {
    stone_1x1_floor_A: {
      type: 'floor',
      material: 'stone',
      gridSize: '1x1',
      pieceType: 'tile',
      variant: 'A',
      atlas: 'floors.webp',
      tags: ['indoor'],
    },
    stone_2x2_floor_B: {
      type: 'floor',
      material: 'stone',
      gridSize: '2x2',
      pieceType: 'tile',
      variant: 'B',
      atlas: 'floors.webp',
      tags: ['indoor'],
    },
    barrel_1x1_object_A: {
      type: 'object',
      material: 'barrel',
      gridSize: '1x1',
      pieceType: 'prop',
      variant: 'A',
      tags: ['furniture'],
    },
    magic_portal_A: {
      type: 'portal',
      material: 'magic_portal',
      gridSize: '2x2',
      pieceType: 'portal',
      variant: 'A',
      tags: ['magic'],
    },
    unknown_anim_A: {
      type: 'animation',
      material: 'unknown_anim',
      gridSize: '1x1',
      pieceType: 'anim',
      variant: 'A',
      tags: [],
    },
  },
  atlases: {
    'floors.json': { checksum: 'sha256:abc', size: 100 },
    'floors.webp': { checksum: 'sha256:def', size: 200 },
  },
  files: {},
  theme: ['dungeon'],
};

describe('manifestBridge', () => {
  describe('packToCategories', () => {
    it('groups entries by type into categories', () => {
      const categories = packToCategories('test-pack', MOCK_MANIFEST);

      const floorCat = categories.find((c) => c.id === 'test-pack:floor');
      const objectCat = categories.find((c) => c.id === 'test-pack:object');

      expect(floorCat).toBeDefined();
      expect(floorCat!.assets).toHaveLength(2);
      expect(objectCat).toBeDefined();
      expect(objectCat!.assets).toHaveLength(1);
    });

    it('includes portal type (now supported)', () => {
      const categories = packToCategories('test-pack', MOCK_MANIFEST);
      const portalCat = categories.find((c) => c.id === 'test-pack:portal');
      expect(portalCat).toBeDefined();
      expect(portalCat!.assets).toHaveLength(1);
    });

    it('filters out unsupported types (animation)', () => {
      const categories = packToCategories('test-pack', MOCK_MANIFEST);
      const animCat = categories.find((c) => c.id === 'test-pack:animation');
      expect(animCat).toBeUndefined();
    });

    it('prefixes entry IDs with packId', () => {
      const categories = packToCategories('test-pack', MOCK_MANIFEST);
      const floorCat = categories.find((c) => c.id === 'test-pack:floor')!;
      expect(floorCat.assets[0]!.id).toBe('test-pack:stone_1x1_floor_A');
    });

    it('parses gridSize into cellWidth/cellHeight', () => {
      const categories = packToCategories('test-pack', MOCK_MANIFEST);
      const floorCat = categories.find((c) => c.id === 'test-pack:floor')!;
      const big = floorCat.assets.find((a) => a.id === 'test-pack:stone_2x2_floor_B')!;
      expect(big.cellWidth).toBe(2);
      expect(big.cellHeight).toBe(2);
    });

    it('generates human-readable labels', () => {
      const categories = packToCategories('test-pack', MOCK_MANIFEST);
      const floorCat = categories.find((c) => c.id === 'test-pack:floor')!;
      expect(floorCat.label).toBe('Test Pack — Floor');
    });
  });

  describe('buildMergedManifest', () => {
    it('returns an empty manifest when no packs installed', () => {
      const merged = buildMergedManifest([]);
      expect(merged.categories).toEqual([]);
    });

    it('collects categories from every installed pack', () => {
      const merged = buildMergedManifest([
        { packId: 'test-pack', manifest: MOCK_MANIFEST },
        { packId: 'other', manifest: MOCK_MANIFEST },
      ]);
      expect(merged.categories.some((c) => c.id.startsWith('test-pack:'))).toBe(true);
      expect(merged.categories.some((c) => c.id.startsWith('other:'))).toBe(true);
    });
  });
});
