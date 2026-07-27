// packages/engine/src/build/catalog-gen.test.ts
import { describe, it, expect } from 'vitest';
import { generateCatalogChunks, type CatalogEntryInput } from './catalog-gen.js';
import { CatalogMetaSchema, CatalogChunkSchema } from '../schemas/catalog.js';

function makeEntry(id: string, type: string, theme: string, material: string): CatalogEntryInput {
  return {
    entryId: id,
    localId: id,
    packId: 'test',
    type,
    material,
    theme,
    gridSize: '1x1',
    tags: [type],
    tint: '#000',
    thumbnailUrl: `${id}.webp`,
  };
}

describe('generateCatalogChunks', () => {
  it('generates a single chunk for small catalogs', () => {
    const entries = [makeEntry('a', 'floor', 'dungeon', 'stone'), makeEntry('b', 'wall', 'dungeon', 'stone')];
    const result = generateCatalogChunks(entries, { chunkSize: 10000 });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]!.entries).toHaveLength(2);
  });

  it('splits into multiple chunks when exceeding chunkSize', () => {
    const entries = Array.from({ length: 5 }, (_, i) => makeEntry(`e${i}`, 'floor', 'dungeon', 'stone'));
    const result = generateCatalogChunks(entries, { chunkSize: 2 });
    expect(result.chunks.length).toBe(3); // 5 entries / 2 per chunk = 3 chunks
  });

  it('generates meta with correct chunkCount and totals', () => {
    const entries = Array.from({ length: 10 }, (_, i) => makeEntry(`e${i}`, 'floor', 'dungeon', 'stone'));
    const result = generateCatalogChunks(entries, { chunkSize: 3 });
    expect(result.meta.chunkCount).toBe(4); // 10 / 3 = 4 chunks
    expect(result.meta.totalEntries).toBe(10);
    expect(result.meta.chunks.map((c) => c.entryCount)).toEqual([3, 3, 3, 1]);
  });

  it('generates inverted index in meta', () => {
    const entries = [
      makeEntry('a', 'floor', 'dungeon', 'stone'),
      makeEntry('b', 'wall', 'forest', 'wood'),
    ];
    const result = generateCatalogChunks(entries, { chunkSize: 1 });
    expect(result.meta.invertedIndex.type['floor']).toContain(0);
    expect(result.meta.invertedIndex.type['wall']).toContain(1);
    expect(result.meta.invertedIndex.theme['dungeon']).toContain(0);
    expect(result.meta.invertedIndex.theme['forest']).toContain(1);
  });

  it('output validates against catalog schemas', () => {
    const entries = [makeEntry('a', 'floor', 'dungeon', 'stone')];
    const result = generateCatalogChunks(entries, { chunkSize: 10, urlPrefix: 'catalog/' });
    expect(CatalogMetaSchema.safeParse(result.meta).success).toBe(true);
    expect(result.chunks.every((c) => CatalogChunkSchema.safeParse(c).success)).toBe(true);
    // Content-hashed so Phase 1 of a deploy never overwrites live chunk bodies
    expect(result.meta.chunks[0]!.url).toMatch(/^catalog\/chunk-0-[a-f0-9]{8}\.json$/);
  });

  it('sorts entries by type → material → theme', () => {
    const entries = [
      makeEntry('z', 'wall', 'dungeon', 'stone'),
      makeEntry('a', 'floor', 'dungeon', 'stone'),
      makeEntry('m', 'floor', 'forest', 'wood'),
    ];
    const result = generateCatalogChunks(entries, { chunkSize: 10000 });
    const ids = result.chunks[0]!.entries.map((e) => e.entryId);
    expect(ids[0]).toBe('a'); // floor comes first
    expect(ids[2]).toBe('z'); // wall last
  });
});
