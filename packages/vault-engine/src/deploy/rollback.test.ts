import { describe, it, expect, vi } from 'vitest';
import { rollbackPack, type RollbackContext } from './rollback.js';

describe('rollbackPack', () => {
  it('copies archived manifest back to current', async () => {
    const ctx: RollbackContext = {
      getArchive: vi.fn().mockResolvedValue(Buffer.from('{"version":"1.0.0"}')),
      uploadFile: vi.fn().mockResolvedValue(undefined),
      purgeCache: vi.fn().mockResolvedValue(undefined),
    };

    await rollbackPack(ctx, { packId: 'test', targetVersion: '1.0.0' });
    expect(ctx.getArchive).toHaveBeenCalledWith('_archive/test/1.0.0/pack.json');
    expect(ctx.uploadFile).toHaveBeenCalled();
    expect(ctx.purgeCache).toHaveBeenCalled();
  });

  it('uploads manifest to correct pack path', async () => {
    const manifestData = Buffer.from('{"name":"my-pack"}');
    const ctx: RollbackContext = {
      getArchive: vi.fn().mockResolvedValue(manifestData),
      uploadFile: vi.fn().mockResolvedValue(undefined),
      purgeCache: vi.fn().mockResolvedValue(undefined),
    };

    await rollbackPack(ctx, { packId: 'biome-forest', targetVersion: '2.1.0' });
    expect(ctx.uploadFile).toHaveBeenCalledWith('biome-forest/pack.json', manifestData);
  });

  it('purges cache for pack manifest and index', async () => {
    const ctx: RollbackContext = {
      getArchive: vi.fn().mockResolvedValue(Buffer.from('{}')),
      uploadFile: vi.fn().mockResolvedValue(undefined),
      purgeCache: vi.fn().mockResolvedValue(undefined),
    };

    await rollbackPack(ctx, { packId: 'test', targetVersion: '1.0.0' });
    expect(ctx.purgeCache).toHaveBeenCalledWith(['test/pack.json', 'index.json']);
  });

  it('propagates error when manifest archive fetch fails (network error)', async () => {
    const ctx: RollbackContext = {
      getArchive: vi.fn().mockRejectedValue(new Error('NetworkError: connection refused')),
      uploadFile: vi.fn().mockResolvedValue(undefined),
      purgeCache: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      rollbackPack(ctx, { packId: 'test', targetVersion: '1.0.0' }),
    ).rejects.toThrow('NetworkError');
  });

  it('propagates error when upload fails (permission denied)', async () => {
    const ctx: RollbackContext = {
      getArchive: vi.fn().mockResolvedValue(Buffer.from('{}')),
      uploadFile: vi.fn().mockRejectedValue(new Error('AccessDenied: insufficient permissions')),
      purgeCache: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      rollbackPack(ctx, { packId: 'test', targetVersion: '1.0.0' }),
    ).rejects.toThrow('AccessDenied');
  });

  it('re-throws network errors from index.json archive fetch', async () => {
    const ctx: RollbackContext = {
      getArchive: vi.fn().mockImplementation(async (key: string) => {
        if (key.includes('index.json')) {
          throw new Error('NetworkError: DNS resolution failed');
        }
        return Buffer.from('{}');
      }),
      uploadFile: vi.fn().mockResolvedValue(undefined),
      purgeCache: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      rollbackPack(ctx, { packId: 'test', targetVersion: '1.0.0' }),
    ).rejects.toThrow('NetworkError');
  });

  it('swallows not-found errors for index.json archive', async () => {
    const ctx: RollbackContext = {
      getArchive: vi.fn().mockImplementation(async (key: string) => {
        if (key.includes('index.json')) {
          throw new Error('NoSuchKey: archive not found');
        }
        return Buffer.from('{}');
      }),
      uploadFile: vi.fn().mockResolvedValue(undefined),
      purgeCache: vi.fn().mockResolvedValue(undefined),
    };

    await rollbackPack(ctx, { packId: 'test', targetVersion: '1.0.0' });
    expect(ctx.purgeCache).toHaveBeenCalled();
  });

  it('re-uploads archived index.json when it exists', async () => {
    const indexData = Buffer.from('{"version":1}');
    const ctx: RollbackContext = {
      getArchive: vi.fn().mockImplementation(async (key: string) => {
        if (key.includes('index.json')) return indexData;
        return Buffer.from('{}');
      }),
      uploadFile: vi.fn().mockResolvedValue(undefined),
      purgeCache: vi.fn().mockResolvedValue(undefined),
    };

    await rollbackPack(ctx, { packId: 'test', targetVersion: '1.0.0' });
    expect(ctx.uploadFile).toHaveBeenCalledWith('index.json', indexData);
  });
});
