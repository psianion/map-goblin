import { describe, expect, it } from 'vitest';
import type { AssetCategory, AssetEntry } from '@/store/types';
import { categoryToType, recentAssetsOfType, toolToTypeFilter } from './assetTypeFilter';

const asset = (id: string): AssetEntry => ({ id, name: id, url: '', thumbnailUrl: '', cellWidth: 1, cellHeight: 1 });

const categories: AssetCategory[] = [
  { id: 'gg-demo:floor', label: 'Floors', assets: [asset('gg-demo:floor_small'), asset('gg-demo:floor_large')] },
  { id: 'gg-demo:object', label: 'Objects', assets: [asset('gg-demo:bush'), asset('gg-demo:table')] },
  { id: 'gg-demo:wall', label: 'Walls', assets: [asset('gg-demo:wall_stone')] },
  { id: 'nature', label: 'Nature', assets: [asset('tree')] },
];

const ids = (assets: AssetEntry[]) => assets.map((a) => a.id);

describe('categoryToType', () => {
  it('reads the type from a pack category and maps legacy ones', () => {
    expect(categoryToType('gg-demo:floor')).toBe('floor');
    expect(categoryToType('gg-demo:portal')).toBeNull();
    expect(categoryToType('nature')).toBe('object');
    expect(categoryToType('unknown')).toBeNull();
  });
});

describe('recentAssetsOfType', () => {
  const recent = ['gg-demo:bush', 'gg-demo:floor_large', 'tree', 'gg-demo:wall_stone', 'gg-demo:floor_small'];

  it('lists every recent asset on the All tab, most recent first', () => {
    expect(ids(recentAssetsOfType(recent, categories, 'all'))).toEqual(recent);
  });

  it('keeps only the recent assets of the active type', () => {
    expect(ids(recentAssetsOfType(recent, categories, 'floor'))).toEqual(['gg-demo:floor_large', 'gg-demo:floor_small']);
    expect(ids(recentAssetsOfType(recent, categories, 'object'))).toEqual(['gg-demo:bush', 'tree']);
    expect(ids(recentAssetsOfType(recent, categories, 'wall'))).toEqual(['gg-demo:wall_stone']);
    expect(recentAssetsOfType(recent, categories, 'scatter')).toEqual([]);
  });

  it('skips ids no installed category holds', () => {
    expect(ids(recentAssetsOfType(['gone:floor', 'gg-demo:floor_small'], categories, 'all'))).toEqual(['gg-demo:floor_small']);
  });
});

describe('toolToTypeFilter', () => {
  it('opens the props brush on Object, where the props are, never on an empty Scatter tab', () => {
    expect(toolToTypeFilter('scatterBrush')).toBe('object');
  });

  it('keeps floors, paths and walls on their own tabs and everything else on All', () => {
    expect(toolToTypeFilter('rectangle')).toBe('floor');
    expect(toolToTypeFilter('path')).toBe('path');
    expect(toolToTypeFilter('door')).toBe('wall');
    expect(toolToTypeFilter('select')).toBe('all');
  });
});
