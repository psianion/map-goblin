import { describe, it, expect, vi } from 'vitest';
import { rollbackPack, type RollbackContext } from './rollback.js';

function ctxWith(over: Partial<RollbackContext> = {}): RollbackContext {
  return {
    getArchive: vi.fn().mockResolvedValue(Buffer.from('{"version":1}')),
    uploadFile: vi.fn().mockResolvedValue(undefined),
    purgeCache: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe('rollbackPack', () => {
  it('reads the archived index for the target version', async () => {
    const ctx = ctxWith();
    await rollbackPack(ctx, { packId: 'test', targetVersion: '1.0.0' });
    expect(ctx.getArchive).toHaveBeenCalledWith('_archive/test/1.0.0/index.json');
  });

  it('restores index.json — the only mutable pointer — and purges it', async () => {
    const indexData = Buffer.from('{"version":1}');
    const ctx = ctxWith({ getArchive: vi.fn().mockResolvedValue(indexData) });

    await rollbackPack(ctx, { packId: 'biome-forest', targetVersion: '2.1.0' });

    expect(ctx.uploadFile).toHaveBeenCalledTimes(1);
    expect(ctx.uploadFile).toHaveBeenCalledWith('index.json', indexData);
    expect(ctx.purgeCache).toHaveBeenCalledWith(['index.json']);
  });

  it('writes nothing when the archive is missing', async () => {
    const notFound = Object.assign(new Error('nope'), { name: 'NoSuchKey' });
    const ctx = ctxWith({ getArchive: vi.fn().mockRejectedValue(notFound) });

    await expect(
      rollbackPack(ctx, { packId: 'test', targetVersion: '9.9.9' }),
    ).rejects.toThrow('No archived deploy for test@9.9.9');
    expect(ctx.uploadFile).not.toHaveBeenCalled();
  });

  it('detects not-found via $metadata status, not message text', async () => {
    const notFound = Object.assign(new Error('irrelevant text'), {
      $metadata: { httpStatusCode: 404 },
    });
    const ctx = ctxWith({ getArchive: vi.fn().mockRejectedValue(notFound) });

    await expect(
      rollbackPack(ctx, { packId: 'test', targetVersion: '1.0.0' }),
    ).rejects.toThrow('No archived deploy');
    expect(ctx.uploadFile).not.toHaveBeenCalled();
  });

  it('propagates network errors from the archive read', async () => {
    const ctx = ctxWith({
      getArchive: vi.fn().mockRejectedValue(new Error('NetworkError: connection refused')),
    });

    await expect(
      rollbackPack(ctx, { packId: 'test', targetVersion: '1.0.0' }),
    ).rejects.toThrow('NetworkError');
  });

  it('propagates upload failures', async () => {
    const ctx = ctxWith({
      uploadFile: vi.fn().mockRejectedValue(new Error('AccessDenied: insufficient permissions')),
    });

    await expect(
      rollbackPack(ctx, { packId: 'test', targetVersion: '1.0.0' }),
    ).rejects.toThrow('AccessDenied');
  });
});
