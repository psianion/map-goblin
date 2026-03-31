import { describe, it, expect } from 'vitest';
import { validateLegacyMappings, logMigrationStatus } from './legacyMigration';
import type { AssetPackManager } from './assetPackManager';

function createMockPackManager(installedPackIds: string[]): AssetPackManager {
  return {
    getInstalledPacks: () =>
      installedPackIds.map((packId) => ({
        packId,
        version: '1.0.0',
        entryCount: 10,
        themes: ['dungeon'],
        bundleSize: 5000,
      })),
  } as unknown as AssetPackManager;
}

describe('legacyMigration', () => {
  describe('validateLegacyMappings', () => {
    it('resolves all legacy IDs when dungeon-classic is installed', () => {
      const manager = createMockPackManager(['dungeon-classic']);
      const legacyIds = [
        'grass-a-01',
        'dirt-b-04',
        'cobblestone-a-01',
        'stone-slate',
        'wood-ashen',
      ];

      const report = validateLegacyMappings(legacyIds, manager);
      expect(report.total).toBe(5);
      expect(report.resolved).toBe(5);
      expect(report.unresolved).toHaveLength(0);
    });

    it('reports unresolved IDs not in the mapping table', () => {
      const manager = createMockPackManager(['dungeon-classic']);
      const legacyIds = ['grass-a-01', 'nonexistent-texture', 'another-unknown'];

      const report = validateLegacyMappings(legacyIds, manager);
      expect(report.total).toBe(3);
      expect(report.resolved).toBe(1);
      expect(report.unresolved).toEqual(['nonexistent-texture', 'another-unknown']);
    });

    it('reports all as unresolved when no packs installed', () => {
      const manager = createMockPackManager([]);
      const legacyIds = ['grass-a-01', 'stone-slate'];

      const report = validateLegacyMappings(legacyIds, manager);
      expect(report.total).toBe(2);
      expect(report.resolved).toBe(0);
      expect(report.unresolved).toHaveLength(2);
    });

    it('handles empty legacy ID list', () => {
      const manager = createMockPackManager(['dungeon-classic']);
      const report = validateLegacyMappings([], manager);
      expect(report.total).toBe(0);
      expect(report.resolved).toBe(0);
      expect(report.unresolved).toHaveLength(0);
    });

    it('validates all 17 mapped legacy IDs from the mapping table', () => {
      const manager = createMockPackManager(['dungeon-classic']);
      // All IDs from LEGACY_MAP in legacyAssetMapping.ts
      const allMappedIds = [
        'grass-a-01', 'grass-a-09', 'dirt-b-04', 'dirt-c-02',
        'cracked-dirt-a-01', 'grassy-dirt-a-02', 'cobblestone-a-01',
        'large-flagstone-a-01', 'rock-tiles-b-01', 'rectangular-tiles-a-01',
        'smooth-stone-floor-a-10', 'cave-floor-06-a', 'rock-ground-c-06',
        'gravel-06-c', 'gravel-06-j', 'stone-slate', 'wood-ashen',
      ];

      const report = validateLegacyMappings(allMappedIds, manager);
      expect(report.total).toBe(17);
      expect(report.resolved).toBe(17);
      expect(report.unresolved).toHaveLength(0);
    });
  });

  describe('logMigrationStatus', () => {
    it('does not throw for fully resolved report', () => {
      expect(() =>
        logMigrationStatus({ total: 5, resolved: 5, unresolved: [] }),
      ).not.toThrow();
    });

    it('does not throw for partially resolved report', () => {
      expect(() =>
        logMigrationStatus({ total: 5, resolved: 3, unresolved: ['a', 'b'] }),
      ).not.toThrow();
    });
  });
});
