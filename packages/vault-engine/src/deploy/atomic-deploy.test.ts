import { describe, it, expect, vi } from 'vitest';
import { atomicDeploy, archiveKey, type DeployContext } from './atomic-deploy.js';

function mockContext(): DeployContext {
  return {
    uploadFile: vi.fn().mockResolvedValue(undefined),
    purgeCache: vi.fn().mockResolvedValue(undefined),
  };
}

describe('atomicDeploy', () => {
  it('uploads content files before manifests', async () => {
    const ctx = mockContext();
    const callOrder: string[] = [];
    ctx.uploadFile = vi.fn().mockImplementation(async (key: string) => {
      callOrder.push(key);
    });

    await atomicDeploy(ctx, {
      packId: 'test',
      version: '1.0.0',
      files: new Map([
        ['test/atlas-abc.webp', Buffer.from('atlas')],
        ['test/pack-def.json', Buffer.from('manifest')],
        ['catalog/meta.json', Buffer.from('meta')],
        ['index.json', Buffer.from('index')],
      ]),
    });

    // Phase 1: content assets first
    const atlasIdx = callOrder.indexOf('test/atlas-abc.webp');
    // Phase 2a: pack manifests before index
    const manifestIdx = callOrder.indexOf('test/pack-def.json');
    const metaIdx = callOrder.indexOf('catalog/meta.json');
    // Phase 2b: index.json is ALWAYS last upload
    const indexIdx = callOrder.indexOf('index.json');
    expect(atlasIdx).toBeLessThan(manifestIdx);
    expect(manifestIdx).toBeLessThan(indexIdx);
    expect(metaIdx).toBeLessThan(indexIdx);
    // index.json must be the very last element uploaded
    expect(indexIdx).toBe(callOrder.length - 1);
  });

  it('purges cache for index.json after all uploads', async () => {
    const ctx = mockContext();
    await atomicDeploy(ctx, {
      packId: 'test',
      version: '1.0.0',
      files: new Map([['index.json', Buffer.from('{}')]]),
    });
    expect(ctx.purgeCache).toHaveBeenCalled();
  });

  it('propagates error when upload fails mid-deploy', async () => {
    const ctx = mockContext();
    ctx.uploadFile = vi.fn().mockRejectedValue(new Error('R2 upload failed: 503'));

    await expect(
      atomicDeploy(ctx, {
        packId: 'test',
        version: '1.0.0',
        files: new Map([['test/atlas.webp', Buffer.from('data')]]),
      }),
    ).rejects.toThrow('R2 upload failed');
  });

  it('handles empty files map without errors', async () => {
    const ctx = mockContext();
    await atomicDeploy(ctx, {
      packId: 'test',
      version: '1.0.0',
      files: new Map(),
    });
    // No uploads, no purge (no manifest URLs)
    expect(ctx.uploadFile).not.toHaveBeenCalled();
    expect(ctx.purgeCache).not.toHaveBeenCalled();
  });

  it('works without index.json in the file set', async () => {
    const ctx = mockContext();
    const callOrder: string[] = [];
    ctx.uploadFile = vi.fn().mockImplementation(async (key: string) => {
      callOrder.push(key);
    });

    await atomicDeploy(ctx, {
      packId: 'test',
      version: '1.0.0',
      files: new Map([
        ['test/atlas-abc.webp', Buffer.from('atlas')],
        ['test/pack-def.json', Buffer.from('manifest')],
      ]),
    });

    expect(callOrder).toContain('test/atlas-abc.webp');
    expect(callOrder).toContain('test/pack-def.json');
    expect(callOrder).not.toContain('index.json');
  });

  it('classifies catalog/meta.json as a manifest (Phase 2a)', async () => {
    const ctx = mockContext();
    const callOrder: string[] = [];
    ctx.uploadFile = vi.fn().mockImplementation(async (key: string) => {
      callOrder.push(key);
    });

    await atomicDeploy(ctx, {
      packId: 'test',
      version: '1.0.0',
      files: new Map([
        ['test/atlas-abc.webp', Buffer.from('atlas')],
        ['catalog/meta.json', Buffer.from('meta')],
        ['index.json', Buffer.from('index')],
      ]),
    });

    const atlasIdx = callOrder.indexOf('test/atlas-abc.webp');
    const metaIdx = callOrder.indexOf('catalog/meta.json');
    const indexIdx = callOrder.indexOf('index.json');

    // Content before meta, meta before index
    expect(atlasIdx).toBeLessThan(metaIdx);
    expect(metaIdx).toBeLessThan(indexIdx);
  });

  it('archives the index under its version before the switch', async () => {
    const ctx = mockContext();
    const callOrder: string[] = [];
    ctx.uploadFile = vi.fn().mockImplementation(async (key: string) => {
      callOrder.push(key);
    });

    await atomicDeploy(ctx, {
      packId: 'test',
      version: '2.1.0',
      files: new Map([['index.json', Buffer.from('index')]]),
    });

    const key = archiveKey('test', '2.1.0');
    expect(callOrder).toEqual([key, 'index.json']);
  });

  it('includes manifest URLs in cache purge', async () => {
    const ctx = mockContext();

    await atomicDeploy(ctx, {
      packId: 'test',
      version: '1.0.0',
      files: new Map([
        ['test/pack-abc123.json', Buffer.from('manifest')],
        ['index.json', Buffer.from('index')],
      ]),
    });

    expect(ctx.purgeCache).toHaveBeenCalledWith(
      expect.arrayContaining(['test/pack-abc123.json', 'index.json']),
    );
  });
});
