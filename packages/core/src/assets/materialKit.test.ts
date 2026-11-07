import { describe, it, expect, beforeAll } from 'vitest';
import { getAssetPackManager, resetAssetPackManager } from '../engine/assetPackInstance';
import type { ManifestEntry, PackManifest } from '../engine/assetPackManager';
import { materialFillId, materialIds, materialLabel } from './materialKit';

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
    },
  });
});

describe('materials', () => {
  it('are the installed band sets, named as a DM reads them', () => {
    expect(materialIds()).toEqual(['GG_Bare_Ink', 'GG_Cave_Ink', 'GG_Moss_Ink']);
    expect(materialLabel('GG_Cave_Ink')).toBe('Cave ink');
  });

  it('pair a band set with the floor of the same name until a pack says otherwise', () => {
    expect(materialFillId('GG_Cave_Ink')).toBe('forge:cave_floor_8x8');
    // A pack that names the fill wins over the name.
    expect(materialFillId('GG_Moss_Ink')).toBe('forge:moss_floor');
    // No floor goes with it: no fill.
    expect(materialFillId('GG_Bare_Ink')).toBeUndefined();
  });
});
