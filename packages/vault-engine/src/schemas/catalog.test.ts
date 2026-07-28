import { describe, it, expect } from 'vitest';
import { CatalogChunkSchema, CatalogMetaSchema } from './catalog.js';

describe('CatalogChunkSchema', () => {
  const validEntry = {
    entryId: 'dungeon-classic:stone_1x1_floor_A',
    localId: 'stone_1x1_floor_A',
    packId: 'dungeon-classic',
    type: 'floor',
    material: 'stone-cobble',
    theme: 'dungeon',
    gridSize: '1x1',
    tags: ['stone'],
    tint: '#7a7a6e',
    thumbnailUrl: 'dungeon-classic/thumbs/stone_1x1_floor_A.webp',
  };

  it('accepts valid chunk with new field names', () => {
    const result = CatalogChunkSchema.safeParse({ entries: [validEntry] });
    expect(result.success).toBe(true);
  });

  it('accepts empty entries array', () => {
    expect(CatalogChunkSchema.safeParse({ entries: [] }).success).toBe(true);
  });

  it('requires entryId with min 1 char', () => {
    const result = CatalogChunkSchema.safeParse({
      entries: [{ ...validEntry, entryId: '' }],
    });
    expect(result.success).toBe(false);
  });

  it('requires localId with min 1 char', () => {
    const result = CatalogChunkSchema.safeParse({
      entries: [{ ...validEntry, localId: '' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts entry with valid 16-char pHash', () => {
    const result = CatalogChunkSchema.safeParse({
      entries: [{ ...validEntry, pHash: 'abcdef0123456789' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects pHash that is not exactly 16 chars', () => {
    const result = CatalogChunkSchema.safeParse({
      entries: [{ ...validEntry, pHash: 'tooshort' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts entry without pHash (optional)', () => {
    const { pHash: _, ...noPHash } = { ...validEntry, pHash: 'abcdef0123456789' };
    const result = CatalogChunkSchema.safeParse({ entries: [noPHash] });
    expect(result.success).toBe(true);
  });

  it('rejects old field name "id" instead of "entryId"', () => {
    const { entryId: _, ...rest } = validEntry;
    const result = CatalogChunkSchema.safeParse({
      entries: [{ ...rest, id: 'dungeon-classic:stone_1x1_floor_A' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects old field name "preview" instead of "thumbnailUrl"', () => {
    const { thumbnailUrl: _, ...rest } = validEntry;
    const result = CatalogChunkSchema.safeParse({
      entries: [{ ...rest, preview: 'some/path.webp' }],
    });
    expect(result.success).toBe(false);
  });

  it('thumbnailUrl accepts any string', () => {
    const result = CatalogChunkSchema.safeParse({
      entries: [{ ...validEntry, thumbnailUrl: 'any-string-is-fine' }],
    });
    expect(result.success).toBe(true);
  });
});

describe('CatalogMetaSchema', () => {
  const validMeta = {
    version: 1,
    totalEntries: 42,
    chunkCount: 3,
    chunks: [
      { index: 0, url: 'chunk-0.json', entryCount: 20 },
      { index: 1, url: 'chunk-1.json', entryCount: 20 },
      { index: 2, url: 'chunk-2.json', entryCount: 2 },
    ],
    invertedIndex: {
      type: { floor: [0, 1], wall: [1, 2] },
      theme: { dungeon: [0, 1, 2] },
      material: { stone: [0], wood: [1, 2] },
    },
  };

  it('accepts valid meta with all new fields', () => {
    const result = CatalogMetaSchema.safeParse(validMeta);
    expect(result.success).toBe(true);
  });

  it('version must be a positive integer', () => {
    expect(CatalogMetaSchema.safeParse({ ...validMeta, version: 0 }).success).toBe(false);
    expect(CatalogMetaSchema.safeParse({ ...validMeta, version: -1 }).success).toBe(false);
    expect(CatalogMetaSchema.safeParse({ ...validMeta, version: 1.5 }).success).toBe(false);
  });

  it('totalEntries must be nonnegative', () => {
    expect(CatalogMetaSchema.safeParse({ ...validMeta, totalEntries: -1 }).success).toBe(false);
    expect(CatalogMetaSchema.safeParse({ ...validMeta, totalEntries: 0 }).success).toBe(true);
  });

  it('validates chunks array items (index, url, entryCount)', () => {
    const badChunks = { ...validMeta, chunks: [{ index: -1, url: '', entryCount: 0 }] };
    expect(CatalogMetaSchema.safeParse(badChunks).success).toBe(false);
  });

  it('invertedIndex uses structured category keys', () => {
    const result = CatalogMetaSchema.safeParse(validMeta);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.invertedIndex.type).toHaveProperty('floor');
      expect(result.data.invertedIndex.theme).toHaveProperty('dungeon');
      expect(result.data.invertedIndex.material).toHaveProperty('stone');
    }
  });

  it('rejects old chunkIndex field name', () => {
    const old = {
      chunkCount: 3,
      chunkIndex: { 'type:floor': [0, 1] },
    };
    expect(CatalogMetaSchema.safeParse(old).success).toBe(false);
  });

  it('accepts empty chunks array (empty catalog)', () => {
    const empty = {
      version: 1,
      totalEntries: 0,
      chunkCount: 0,
      chunks: [],
      invertedIndex: { type: {}, theme: {}, material: {} },
    };
    expect(CatalogMetaSchema.safeParse(empty).success).toBe(true);
  });

  it('invertedIndex categories default to empty objects', () => {
    const partial = {
      version: 1,
      totalEntries: 0,
      chunkCount: 0,
      chunks: [],
      invertedIndex: {},
    };
    const result = CatalogMetaSchema.safeParse(partial);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.invertedIndex.type).toEqual({});
      expect(result.data.invertedIndex.theme).toEqual({});
      expect(result.data.invertedIndex.material).toEqual({});
    }
  });
});
