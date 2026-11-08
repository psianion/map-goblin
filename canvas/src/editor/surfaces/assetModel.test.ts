import { describe, expect, it } from 'vitest';
import type { Layer } from '@/store/types';
import { assetTiles, byPack, chipFor, usedIds } from './assetModel';

describe('asset model', () => {
  it('opens each trigger on its kind of art', () => {
    expect(chipFor('floor')).toBe('textures');
    expect(chipFor('object')).toBe('props');
    expect(chipFor('scatter')).toBe('props');
    expect(chipFor('wall')).toBe('walls');
    expect(chipFor('path')).toBe('paths');
    expect(chipFor(undefined)).toBe('textures');
  });

  it('groups tiles under their pack in first-seen order', () => {
    const t = (id: string, packId: string) => ({ key: id, id, name: id, packId });
    expect(byPack([t('a', 'p1'), t('b', 'p2'), t('c', 'p1')])).toEqual([
      { packId: 'p1', tiles: [t('a', 'p1'), t('c', 'p1')] },
      { packId: 'p2', tiles: [t('b', 'p2')] },
    ]);
  });

  it('counts placed props and floor textures as used', () => {
    const layers = [
      {
        type: 'dungeon',
        children: [
          { childType: 'asset', objectType: 'asset', assetId: 'pack:barrel' },
          { childType: 'shape', textureId: 'pack:flagstone' },
          { childType: 'shape' },
        ],
      },
      { type: 'background', children: [] },
    ] as unknown as Layer[];
    expect([...usedIds(layers)].sort()).toEqual(['pack:barrel', 'pack:flagstone']);
  });

  it('has no light art to list yet', () => {
    expect(assetTiles('lights', '')).toEqual([]);
  });
});
