import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectPackFiles, discoverPacks } from './deploy.js';

let dist: string;

beforeAll(async () => {
  dist = await mkdtemp(join(tmpdir(), 'deploy-test-'));
  await mkdir(join(dist, 'demo-pack', 'catalog'), { recursive: true });
  await writeFile(join(dist, 'demo-pack', 'pack-abc123.json'), '{}');
  await writeFile(join(dist, 'demo-pack', 'atlas-wall-ff00.webp'), 'bytes');
  await writeFile(join(dist, 'demo-pack', 'catalog', 'chunk-0.json'), '[]');
  // A directory with no manifest is not a pack.
  await mkdir(join(dist, 'not-a-pack'), { recursive: true });
  await writeFile(join(dist, 'not-a-pack', 'stray.webp'), 'x');
  await writeFile(join(dist, 'index.json'), '{}');
});

afterAll(async () => {
  await rm(dist, { recursive: true, force: true });
});

describe('collectPackFiles', () => {
  // These keys become URL paths on the CDN. On Windows `join` yields backslashes, which
  // would be uploaded verbatim as part of the object key and served at a URL no client
  // ever requests — a deploy that "succeeds" and 404s for every reader.
  it('keys files by forward-slashed path relative to the dist root', async () => {
    const files = await collectPackFiles(dist, 'demo-pack');
    const keys = [...files.keys()].sort();

    expect(keys).toEqual([
      'demo-pack/atlas-wall-ff00.webp',
      'demo-pack/catalog/chunk-0.json',
      'demo-pack/pack-abc123.json',
    ]);
    expect(keys.some((k) => k.includes('\\'))).toBe(false);
  });

  it('reads file contents, not just names', async () => {
    const files = await collectPackFiles(dist, 'demo-pack');
    expect(files.get('demo-pack/atlas-wall-ff00.webp')?.toString()).toBe('bytes');
  });
});

describe('discoverPacks', () => {
  it('counts only directories holding a pack manifest', async () => {
    expect(await discoverPacks(dist)).toEqual(['demo-pack']);
  });
});
