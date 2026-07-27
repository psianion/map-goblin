import { describe, it, expect, vi } from 'vitest';
import { atomicDeploy, type DeployContext } from './atomic-deploy.js';
import { getCacheControl, CACHE_MUTABLE, CACHE_IMMUTABLE } from './r2-upload.js';
import {
  CatalogMetaSchema,
  CatalogChunkSchema,
  IndexFileSchema,
} from '../schemas/index.js';

function mockContext(): DeployContext & { uploads: Map<string, Buffer> } {
  const uploads = new Map<string, Buffer>();
  return {
    uploads,
    uploadFile: vi.fn().mockImplementation(async (key: string, data: Buffer) => {
      uploads.set(key, data);
    }),
    purgeCache: vi.fn().mockResolvedValue(undefined),
  };
}

function buildTestCatalogMeta(): Buffer {
  return Buffer.from(JSON.stringify({
    version: 1,
    totalEntries: 2,
    chunkCount: 1,
    chunks: [{ index: 0, url: 'https://cdn.mapbuilder.app/catalog/chunk-0.json', entryCount: 2 }],
    invertedIndex: {
      type: { floor: [0] },
      theme: { dungeon: [0] },
      material: { stone: [0] },
    },
  }));
}

function buildTestChunk(): Buffer {
  return Buffer.from(JSON.stringify({
    entries: [
      {
        entryId: 'test-pack:stone_1x1_floor_A',
        localId: 'stone_1x1_floor_A',
        packId: 'test-pack',
        type: 'floor',
        material: 'stone',
        theme: 'dungeon',
        gridSize: '1x1',
        tags: ['dungeon'],
        tint: '#888888',
        thumbnailUrl: 'test-pack/thumbs/stone.webp',
      },
      {
        entryId: 'test-pack:wall_1x1_wall_A',
        localId: 'wall_1x1_wall_A',
        packId: 'test-pack',
        type: 'wall',
        material: 'stone-wall',
        theme: 'dungeon',
        gridSize: '1x1',
        tags: ['dungeon'],
        tint: '#666666',
        thumbnailUrl: 'test-pack/thumbs/wall.webp',
      },
    ],
  }));
}

function buildTestIndex(): Buffer {
  return Buffer.from(JSON.stringify({
    version: 1,
    packs: {
      'test-pack': {
        version: '1.0.0',
        themes: ['dungeon'],
        preview: 'test-pack/preview-abc.webp',
        manifest: 'test-pack/pack-def.json',
        entryCount: 2,
        bundleSize: 1024,
      },
    },
    catalog: {
      totalEntries: 2,
      chunkCount: 1,
      lastUpdated: '2026-03-28T00:00:00Z',
    },
  }));
}

describe('deploy integration', () => {
  it('deployed meta.json validates against CatalogMetaSchema', async () => {
    const ctx = mockContext();
    const meta = buildTestCatalogMeta();

    await atomicDeploy(ctx, {
      packId: 'test-pack',
      version: '1.0.0',
      files: new Map([['catalog/meta.json', meta]]),
    });

    const deployed = ctx.uploads.get('catalog/meta.json')!;
    const parsed = CatalogMetaSchema.safeParse(JSON.parse(deployed.toString()));
    expect(parsed.success).toBe(true);
  });

  it('deployed chunk files validate against CatalogChunkSchema', async () => {
    const ctx = mockContext();
    const chunk = buildTestChunk();

    await atomicDeploy(ctx, {
      packId: 'test-pack',
      version: '1.0.0',
      files: new Map([['catalog/chunk-0.json', chunk]]),
    });

    const deployed = ctx.uploads.get('catalog/chunk-0.json')!;
    const parsed = CatalogChunkSchema.safeParse(JSON.parse(deployed.toString()));
    expect(parsed.success).toBe(true);
  });

  it('deployed index.json validates against IndexFileSchema', async () => {
    const ctx = mockContext();
    const index = buildTestIndex();

    await atomicDeploy(ctx, {
      packId: 'test-pack',
      version: '1.0.0',
      files: new Map([['index.json', index]]),
    });

    const deployed = ctx.uploads.get('index.json')!;
    const parsed = IndexFileSchema.safeParse(JSON.parse(deployed.toString()));
    expect(parsed.success).toBe(true);
  });

  it('chunk entries have entryId, localId, thumbnailUrl (not id or preview)', async () => {
    const chunk = JSON.parse(buildTestChunk().toString());
    for (const entry of chunk.entries) {
      expect(entry).toHaveProperty('entryId');
      expect(entry).toHaveProperty('localId');
      expect(entry).toHaveProperty('thumbnailUrl');
      expect(entry).not.toHaveProperty('id');
      expect(entry).not.toHaveProperty('preview');
    }
  });

  it('meta.json has invertedIndex (not chunkIndex), version, totalEntries, chunks', () => {
    const meta = JSON.parse(buildTestCatalogMeta().toString());
    expect(meta).toHaveProperty('invertedIndex');
    expect(meta).not.toHaveProperty('chunkIndex');
    expect(meta).toHaveProperty('version');
    expect(meta).toHaveProperty('totalEntries');
    expect(meta).toHaveProperty('chunks');
  });

  it('three-phase deploy completes with all expected files', async () => {
    const ctx = mockContext();

    await atomicDeploy(ctx, {
      packId: 'test-pack',
      version: '1.0.0',
      files: new Map([
        ['test-pack/atlas-abc.webp', Buffer.from('img')],
        ['catalog/chunk-0.json', buildTestChunk()],
        ['catalog/meta.json', buildTestCatalogMeta()],
        ['test-pack/pack-def.json', Buffer.from('{}')],
        ['index.json', buildTestIndex()],
      ]),
    });

    // 5 inputs + the versioned archive copy of index.json
    expect(ctx.uploads.size).toBe(6);
    expect(ctx.uploads.has('_archive/test-pack/1.0.0/index.json')).toBe(true);
    expect(ctx.uploads.has('test-pack/atlas-abc.webp')).toBe(true);
    expect(ctx.uploads.has('catalog/chunk-0.json')).toBe(true);
    expect(ctx.uploads.has('catalog/meta.json')).toBe(true);
    expect(ctx.uploads.has('test-pack/pack-def.json')).toBe(true);
    expect(ctx.uploads.has('index.json')).toBe(true);
  });
});

describe('cache control', () => {
  it('index.json gets mutable cache', () => {
    expect(getCacheControl('index.json')).toBe(CACHE_MUTABLE);
  });

  it('meta.json gets mutable cache', () => {
    expect(getCacheControl('catalog/meta.json')).toBe(CACHE_MUTABLE);
  });

  it('chunk JSON gets mutable cache', () => {
    expect(getCacheControl('catalog/chunk-0.json')).toBe(CACHE_MUTABLE);
  });

  it('pack manifest gets mutable cache', () => {
    expect(getCacheControl('test-pack/pack-abc123.json')).toBe(CACHE_MUTABLE);
  });

  it('content-hashed webp gets immutable cache', () => {
    expect(getCacheControl('test-pack/atlas-floor-abc12345.webp')).toBe(CACHE_IMMUTABLE);
  });

  it('content-hashed preview webp gets immutable cache too', () => {
    expect(getCacheControl('test-pack/preview-abc12345.webp')).toBe(CACHE_IMMUTABLE);
  });

  it('an unhashed webp stays mutable', () => {
    expect(getCacheControl('test-pack/logo.webp')).toBe(CACHE_MUTABLE);
  });
});
