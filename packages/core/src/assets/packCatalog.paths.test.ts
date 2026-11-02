import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { pathMaterial, pathMaterials } from './packCatalog';
import { resetAssetPackManager, seedPathMaterials } from '../testing/seedCatalog';

beforeEach(() => {
  resetAssetPackManager();
  seedPathMaterials();
});
afterEach(() => resetAssetPackManager());

describe('path materials', () => {
  it('lists each set of path entries with a strip as one material, by label', () => {
    expect(pathMaterials().map((m) => [m.id, m.label])).toEqual([
      ['gg-forge:road-dirt', 'Road dirt'],
      ['gg-forge:water', 'Water'],
    ]);
  });

  it('keys a material’s pieces by name', () => {
    const water = pathMaterial('gg-forge:water')!;
    expect(Object.keys(water.pieces).sort()).toEqual(['edge', 'end', 'fall', 'fill', 'strip']);
    expect(water.pieces.strip?.id).toBe('gg-forge:water-strip');
    expect(water.pieces.fill?.gridSize).toBe('4x4');
    expect(Object.keys(pathMaterial('gg-forge:road-dirt')!.pieces).sort()).toEqual(['edge', 'end', 'strip']);
  });

  it('ignores a wall piece named path and a set without a strip', () => {
    expect(pathMaterial('gg-forge:GG_Test')).toBeUndefined();
    expect(pathMaterial('gg-forge:no-strip')).toBeUndefined();
  });

  it('follows the packs installed', () => {
    resetAssetPackManager();
    expect(pathMaterials()).toEqual([]);
  });
});
