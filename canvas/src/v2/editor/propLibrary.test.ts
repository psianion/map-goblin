import { describe, it, expect } from 'vitest';
import { createDungeonLayer } from '@dnd/core/src/store/factories';
import type { AnyChild, Layer } from '@/store/types';
import {
  categoryLabel,
  familyTiles,
  favouriteTiles,
  fuzzyScore,
  propCategories,
  searchProps,
  usedOnMap,
  type PropEntryLike,
} from './propLibrary';

const DEMO_MANIFESTS = import.meta.glob<string>('../../../public/packs/gg-demo/pack-*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
});

/** The shipped gg-demo objects, read the way the catalogue builds its entries. */
function demoProps(): PropEntryLike[] {
  // A glob, not a name: the manifest's file name is its content hash.
  const raw = Object.values(DEMO_MANIFESTS)[0];
  if (!raw) throw new Error('no gg-demo manifest');
  const manifest = JSON.parse(raw) as {
    entries: Record<string, { type: string; set?: string; material: string; gridSize: string; tags: string[]; family?: string }>;
  };
  return Object.entries(manifest.entries)
    .filter(([, e]) => e.type === 'object')
    .map(([id, e]) => ({
      id: `gg-demo:${id}`,
      packId: 'gg-demo',
      set: e.set,
      material: e.material,
      gridSize: e.gridSize,
      label: e.material.replace(/_/g, ' '),
      tags: e.tags,
      family: e.family,
    }));
}

const entry = (id: string, over: Partial<PropEntryLike> = {}): PropEntryLike => ({
  id: `p:${id}`,
  packId: 'p',
  set: 'demo-storage',
  material: id,
  gridSize: '1x1',
  label: id.replace(/_/g, ' '),
  tags: ['storage'],
  ...over,
});

describe('categories', () => {
  it('names a set the way a DM reads it', () => {
    expect(categoryLabel('demo-door-props')).toBe('Door Props');
    expect(categoryLabel('demo-furniture')).toBe('Furniture');
    expect(categoryLabel('GG_Cave_Ink')).toBe('Cave Ink');
  });

  it('gives the fifteen gg-demo prop categories with their counts, biggest first', () => {
    const cats = propCategories(demoProps());
    expect(cats.map((c) => [c.label, c.count])).toEqual([
      ['Furniture', 142],
      ['Clutter', 119],
      ['Storage', 106],
      ['Gear', 67],
      ['Structures', 66],
      ['Decor', 51],
      ['Nature', 50],
      ['Camp', 49],
      ['Lighting', 44],
      ['Features', 41],
      ['Traps', 30],
      ['Kitchen', 24],
      ['Door Props', 14],
      ['Effects', 12],
      ['Creatures', 10],
    ]);
    expect(cats.reduce((n, c) => n + c.count, 0)).toBe(825);
  });

  it('lists each set\'s tags, most used first', () => {
    const cats = propCategories([
      entry('a', { tags: ['wood', 'storage'] }),
      entry('b', { tags: ['storage'] }),
      entry('c', { set: undefined, tags: [] }),
    ]);
    expect(cats[0]).toMatchObject({ label: 'Storage', count: 2, tags: ['storage', 'wood'] });
    expect(cats[1]).toMatchObject({ label: 'Other', count: 1, tags: [] });
  });
});

describe('family tiles', () => {
  it('folds a family into one tile named after it, in first-seen order, singletons as themselves', () => {
    const tiles = familyTiles([
      entry('barrel_1', { family: 'barrel', gridSize: '2x2' }),
      entry('crate_1'),
      entry('barrel_2', { family: 'barrel', gridSize: '2x2' }),
      entry('storage_barrel_2_dark', { family: 'storage_barrel_dark' }),
    ]);
    expect(tiles.map((t) => [t.label, t.members.length, t.rep.id])).toEqual([
      ['barrel', 2, 'p:barrel_1'],
      ['crate 1', 1, 'p:crate_1'],
      ['storage barrel 2 dark', 1, 'p:storage_barrel_2_dark'],
    ]);
  });

  it('favourites: a starred family is its whole tile, a starred member its own, in starring order', () => {
    const entries = [
      entry('barrel_1', { family: 'barrel' }),
      entry('barrel_2', { family: 'barrel' }),
      entry('barrel_3', { family: 'barrel' }),
      entry('crate_1'),
    ];
    const tiles = favouriteTiles(['p:barrel_2', 'p:demo-storage:barrel', 'p:crate_1', 'p:gone'], entries);
    expect(tiles.map((t) => [t.label, t.members.length, t.rep.id])).toEqual([
      ['barrel 2', 1, 'p:barrel_2'],
      ['barrel', 3, 'p:barrel_1'],
      ['crate 1', 1, 'p:crate_1'],
    ]);
  });

  it('keeps the same family name in two sets apart', () => {
    const tiles = familyTiles([entry('rock_1', { family: 'rock' }), entry('rock_2', { family: 'rock', set: 'demo-nature' })]);
    expect(tiles).toHaveLength(2);
  });
});

describe('used on this map', () => {
  it('counts each placed pack asset over every layer, and leaves imported images out', () => {
    const asset = (id: string, assetId: string, objectType: 'asset' | 'image' = 'asset'): AnyChild =>
      ({
        id,
        name: id,
        childType: 'asset',
        visible: true,
        objectType,
        assetId,
        position: { x: 0, y: 0 },
        rotation: 0,
        scale: 1,
        width: 1,
        height: 1,
        tint: '#ffffff',
        flipX: false,
        flipY: false,
      }) as AnyChild;
    const a = createDungeonLayer('A');
    const b = createDungeonLayer('B');
    a.children.push(asset('1', 'p:rubble'), asset('2', 'p:rubble'), asset('3', 'blob:img', 'image'));
    b.children.push(asset('4', 'p:rubble'), asset('5', 'p:rock'));
    const used = usedOnMap([a, b] as Layer[]);
    expect([...used]).toEqual([
      ['p:rubble', 3],
      ['p:rock', 1],
    ]);
  });
});

describe('fuzzy search', () => {
  it('needs every token in order, and prefers runs and word starts', () => {
    expect(fuzzyScore('brl', 'barrel')).toBeGreaterThan(0);
    expect(fuzzyScore('lrb', 'barrel')).toBe(0);
    expect(fuzzyScore('barrel dark', 'storage barrel 2 dark')).toBeGreaterThan(0);
    expect(fuzzyScore('barrel zzz', 'storage barrel 2 dark')).toBe(0);
    expect(fuzzyScore('barr', 'barrel')).toBeGreaterThan(fuzzyScore('barr', 'bar rack rope'));
  });

  it('ranks barrels first for "barel", "brl" and "barrel dark" over the real pack', () => {
    const props = demoProps();
    for (const q of ['barel', 'brl']) {
      const top = searchProps(props, q).slice(0, 5);
      expect(top.length).toBe(5);
      for (const e of top) expect(e.label).toMatch(/barrel/);
    }
    const dark = searchProps(props, 'barrel dark').slice(0, 3);
    for (const e of dark) expect(e.label).toMatch(/barrel.*dark/);
  });

  it('leaves out letters strewn far apart, so "barel" finds about ten families, not seventy', () => {
    expect(fuzzyScore('barel', 'bare tree large')).toBe(0);
    const families = new Set(searchProps(demoProps(), 'barel').map((e) => e.family ?? e.id));
    expect(families.size).toBeGreaterThan(5);
    expect(families.size).toBeLessThan(15);
  });

  it('goes to the shorter label on a tie, and an empty query keeps everything in order', () => {
    const list = [entry('barrel_stack_big'), entry('barrel')];
    expect(searchProps(list, 'barrel').map((e) => e.id)).toEqual(['p:barrel', 'p:barrel_stack_big']);
    expect(searchProps(list, '  ')).toEqual(list);
  });

  it('finds a prop by its set or tag when its name does not match', () => {
    const list = [entry('crate', { tags: ['wood'] }), entry('anvil', { set: 'demo-gear', tags: ['gear'] })];
    expect(searchProps(list, 'wood').map((e) => e.id)).toEqual(['p:crate']);
  });

  it('searches the whole pack in well under the 5 ms keystroke budget', () => {
    const props = demoProps();
    searchProps(props, 'warm up');
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) searchProps(props, 'barrel dark');
    expect((performance.now() - t0) / 10).toBeLessThan(5);
  });
});
