import { describe, it, expect, beforeAll } from 'vitest';
import { getAssetPackManager, resetAssetPackManager } from '../engine/assetPackInstance';
import type { ManifestEntry, PackManifest } from '../engine/assetPackManager';
import { isTextureMaterial, materialFillId, materialIds, materialLabel } from './materialKit';

const entry = (material: string, over: Partial<ManifestEntry> = {}): ManifestEntry => ({
  type: 'object',
  material,
  gridSize: '1x1',
  pieceType: 'object',
  variant: 'A',
  tags: ['cave'],
  ...over,
});

const kit = (set: string, extra: string[] = []): Record<string, ManifestEntry> => ({
  [`${set}_a`]: entry('wall_short', { set, tags: ['cave', ...extra] }),
  [`${set}_b`]: entry('inside_bend', { set }),
  [`${set}_c`]: entry('outside_bend', { set }),
});

beforeAll(() => {
  resetAssetPackManager();
  const cache = (getAssetPackManager() as unknown as { manifestCache: Map<string, PackManifest> }).manifestCache;
  cache.set('forge', {
    name: 'forge',
    description: '',
    version: '1.0.0',
    bundleSize: 0,
    atlases: {},
    files: {},
    entries: {
      ...kit('GG_Cave_Ink'),
      cave_floor_8x8: entry('cave_floor', { type: 'floor', set: 'GG_Cave_Floor', tags: [] }),
      ...kit('GG_Moss_Ink', ['fill:moss_floor']),
      moss_floor: entry('moss', { type: 'floor', set: 'GG_Leaves', tags: [] }),
      ...kit('GG_Bare_Ink'),
      wild_dirt_8x8_floor_A: entry('wild_dirt', { type: 'floor', set: 'GG_Wild_Ground', tags: ['outdoor', 'dirt'] }),
      wild_grass_dark_8x8_floor_A: entry('wild_grass_dark', { type: 'floor', set: 'GG_Wild_Ground', tags: ['outdoor', 'grass'] }),
      wild_water_deep_8x8_floor_A: entry('wild_water_deep', { type: 'floor', set: 'GG_Wild_Ground', tags: ['outdoor', 'water'] }),
      floor_small_8x8_floor_A: entry('floor_small', { type: 'floor', set: 'GG_Dungeon', tags: ['dungeon'] }),
    },
  });
});

describe('materials', () => {
  it('are the installed band sets, then the floors no band set fills, named as a DM reads them', () => {
    expect(materialIds()).toEqual([
      'GG_Bare_Ink',
      'GG_Cave_Ink',
      'GG_Moss_Ink',
      'forge:wild_dirt_8x8_floor_A',
      'forge:wild_grass_dark_8x8_floor_A',
      'forge:wild_water_deep_8x8_floor_A',
    ]);
    // The cave floor and the moss floor fill band sets: not offered twice.
    expect(materialIds()).not.toContain('forge:cave_floor_8x8');
    expect(materialIds()).not.toContain('forge:moss_floor');
    // Only outdoor ground is offered plain: a dungeon floor is not.
    expect(materialIds()).not.toContain('forge:floor_small_8x8_floor_A');
    expect(materialLabel('GG_Cave_Ink')).toBe('Cave ink');
    expect(materialLabel('forge:wild_dirt_8x8_floor_A')).toBe('Dirt');
    expect(materialLabel('forge:wild_grass_dark_8x8_floor_A')).toBe('Darker grass');
    expect(materialLabel('forge:wild_water_deep_8x8_floor_A')).toBe('Deep water');
    expect(materialLabel('forge:cave_floor_8x8')).toBe('Cave floor');
  });

  it('tell a plain texture from a band set', () => {
    expect(isTextureMaterial('forge:wild_dirt_8x8_floor_A')).toBe(true);
    expect(isTextureMaterial('GG_Cave_Ink')).toBe(false);
  });

  it('fill a plain texture patch with the texture itself', () => {
    expect(materialFillId('forge:wild_dirt_8x8_floor_A')).toBe('forge:wild_dirt_8x8_floor_A');
  });

  it('pair a band set with the floor of the same name until a pack says otherwise', () => {
    expect(materialFillId('GG_Cave_Ink')).toBe('forge:cave_floor_8x8');
    // A pack that names the fill wins over the name.
    expect(materialFillId('GG_Moss_Ink')).toBe('forge:moss_floor');
    // No floor goes with it: no fill.
    expect(materialFillId('GG_Bare_Ink')).toBeUndefined();
  });
});
