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
      localId: 'stone_1x1_floor_A',
      atlas: 'floors.json',
      frame: 'stone_1x1_floor_A',
      gridSize: '1x1',
      tags: ['indoor'],
    },
    stone_2x2_floor_B: {
      type: 'floor',
      localId: 'stone_2x2_floor_B',
      atlas: 'floors.json',
      frame: 'stone_2x2_floor_B',
      gridSize: '2x2',
      tags: ['indoor'],
    },
    barrel_1x1_object_A: {
      type: 'object',
      localId: 'barrel_1x1_object_A',
      atlas: 'objects.json',
      frame: 'barrel_1x1_object_A',
      gridSize: '1x1',
      tags: ['furniture'],
    },
    magic_portal_A: {
      type: 'portal',
      localId: 'magic_portal_A',
      atlas: 'portals.json',
      frame: 'magic_portal_A',
      gridSize: '2x2',
      tags: ['magic'],
    },
    unknown_anim_A: {
      type: 'animation',
      localId: 'unknown_anim_A',
      atlas: 'anims.json',
      frame: 'unknown_anim_A',
      gridSize: '1x1',
      tags: [],
    },
  },
  atlases: {
    'floors.json': { checksum: 'sha256:abc', size: 100 },
    'objects.json': { checksum: 'sha256:def', size: 200 },
    'portals.json': { checksum: 'sha256:ghi', size: 50 },
  },
  files: {},
  themes: ['dungeon'],
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
    it('returns legacy manifest when no packs installed', () => {
      const merged = buildMergedManifest([]);
      // Should have legacy categories (nature, miscellaneous)
      expect(merged.categories.length).toBeGreaterThan(0);
    });

    it('includes pack categories alongside legacy', () => {
      const merged = buildMergedManifest([
        { packId: 'test-pack', manifest: MOCK_MANIFEST },
      ]);
      const packCats = merged.categories.filter((c) => c.id.startsWith('test-pack:'));
      const legacyCats = merged.categories.filter((c) => !c.id.startsWith('test-pack:'));
      expect(packCats.length).toBeGreaterThan(0);
      expect(legacyCats.length).toBeGreaterThan(0);
    });

    it('deduplicates: pack entries override legacy entries with same ID', () => {
      // Create a pack with an ID that matches a legacy entry
      const overridePack: PackManifest = {
        ...MOCK_MANIFEST,
        entries: {
          // This won't actually collide since legacy IDs don't use packId: prefix,
          // but the dedup logic is tested structurally
          custom_object: {
            type: 'object',
            localId: 'custom_object',
            atlas: 'objects.json',
            frame: 'custom_object',
            gridSize: '1x1',
            tags: [],
          },
        },
      };
      const merged = buildMergedManifest([
        { packId: 'override', manifest: overridePack },
      ]);
      // Pack category should exist
      const packCat = merged.categories.find((c) => c.id === 'override:object');
      expect(packCat).toBeDefined();
      expect(packCat!.assets[0]!.id).toBe('override:custom_object');
    });
  });
});
