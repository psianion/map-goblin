import { describe, it, expect, beforeAll } from 'vitest';
import { getAssetPackManager, resetAssetPackManager } from '../engine/assetPackInstance';
import type { ManifestEntry, PackManifest } from '../engine/assetPackManager';
import { familyKeyOf, familyMembers, familyPosition, nextAssetName, propEntries, siblingOf } from './packCatalog';

const entry = (material: string, over: Partial<ManifestEntry> = {}): ManifestEntry => ({
  type: 'object',
  material,
  gridSize: '1x1',
  pieceType: 'object',
  variant: 'A',
  set: 'demo-storage',
  tags: [],
  ...over,
});

const manifest = (entries: Record<string, ManifestEntry>): PackManifest => ({
  name: 'test',
  description: '',
  version: '0.0.1',
  bundleSize: 0,
  entries,
  atlases: {},
  files: {},
});

beforeAll(() => {
  resetAssetPackManager();
  const manager = getAssetPackManager();
  const cache = (manager as unknown as { manifestCache: Map<string, PackManifest> }).manifestCache;
  cache.set(
    'p',
    manifest({
      crate_10: entry('crate_10', { family: 'crate' }),
      crate_2: entry('crate_2', { family: 'crate' }),
      crate_big: entry('crate_1', { family: 'crate', gridSize: '2x2' }),
      crate_1: entry('crate_1', { family: 'crate' }),
      crate_wide: entry('crate_3', { family: 'crate', gridSize: '2x1' }),
      barrel: entry('barrel'),
      // A wall set: its walls and any object piece filed under it are not props.
      stone_wall: entry('wall_short', { type: 'wall', set: 'stone' }),
      stone_post: entry('post', { set: 'stone' }),
      // A cave band kit: rock the walk lays, never stamped.
      cave_a: entry('wall_short', { set: 'cave', tags: ['cave'] }),
      cave_b: entry('inside_bend', { set: 'cave', tags: ['cave'] }),
      cave_c: entry('outside_bend', { set: 'cave', tags: ['cave'] }),
      floor: entry('flagstone', { type: 'floor', set: 'floors' }),
    }),
  );
  // The same set and family names in another pack are another family.
  cache.set('q', manifest({ crate_1: entry('crate_1', { family: 'crate' }) }));
  manager.catalogVersion++;
});

describe('variant families', () => {
  it('keys a family by pack, set and family, and an entry without one by its own id', () => {
    expect(familyKeyOf('p:crate_1')).toBe('p:demo-storage:crate');
    expect(familyKeyOf('p:crate_big')).toBe('p:demo-storage:crate');
    expect(familyKeyOf('q:crate_1')).toBe('q:demo-storage:crate');
    expect(familyKeyOf('p:barrel')).toBe('p:barrel');
    expect(familyKeyOf('image-key')).toBe('image-key');
  });

  it('lists the same grid size first, then by grid area, then by the numbers in the name', () => {
    expect(familyMembers('p:crate_2').map((e) => e.id)).toEqual([
      'p:crate_1',
      'p:crate_2',
      'p:crate_10',
      'p:crate_wide',
      'p:crate_big',
    ]);
    expect(familyMembers('p:crate_big').map((e) => e.id)).toEqual([
      'p:crate_big',
      'p:crate_1',
      'p:crate_2',
      'p:crate_10',
      'p:crate_wide',
    ]);
  });

  it('an entry without a family is a family of itself; an unknown id has none', () => {
    expect(familyMembers('p:barrel').map((e) => e.id)).toEqual(['p:barrel']);
    expect(familyMembers('image-key')).toEqual([]);
  });

  it('steps through same-size siblings before another size, and wraps both ways', () => {
    const cycle = ['p:crate_1'];
    for (let i = 0; i < 5; i++) cycle.push(siblingOf(cycle[cycle.length - 1], 1));
    expect(cycle).toEqual(['p:crate_1', 'p:crate_2', 'p:crate_10', 'p:crate_wide', 'p:crate_big', 'p:crate_1']);
    expect(siblingOf('p:crate_1', -1)).toBe('p:crate_big');
    expect(familyPosition('p:crate_10')).toEqual({ index: 3, count: 5 });
  });

  it('a prop with no siblings, or an unknown id, steps to itself', () => {
    expect(siblingOf('p:barrel', 1)).toBe('p:barrel');
    expect(siblingOf('q:crate_1', -1)).toBe('q:crate_1');
    expect(siblingOf('image-key', 1)).toBe('image-key');
    expect(familyPosition('image-key')).toEqual({ index: 0, count: 0 });
  });

  it('props are object entries outside wall sets and cave band kits', () => {
    expect(propEntries().map((e) => e.id).sort()).toEqual(
      ['p:barrel', 'p:crate_1', 'p:crate_10', 'p:crate_2', 'p:crate_big', 'p:crate_wide', 'q:crate_1'].sort(),
    );
  });
});

describe('nextAssetName', () => {
  it('numbers past a label that already ends in a number: the next "crate 4" is "crate 5"', () => {
    expect(nextAssetName('p:crate_2', [])).toBe('crate 2');
    expect(nextAssetName('p:crate_2', ['crate 2'])).toBe('crate 3');
    expect(nextAssetName('p:crate_10', ['crate 2', 'crate 3'])).toBe('crate 4');
    expect(nextAssetName('p:barrel', [])).toBe('barrel');
    expect(nextAssetName('p:barrel', ['barrel'])).toBe('barrel 2');
  });
});
