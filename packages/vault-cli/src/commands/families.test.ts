import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { copyFile, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { PackManifest } from '@dnd/vault-engine';
import { familiesCommand } from './families.js';

const SHIPPED = fileURLToPath(new URL('../../../../canvas/public/packs/gg-demo', import.meta.url));
const TEST_DIR = join(tmpdir(), 'families-cli-test-' + Date.now());

async function manifestIn(dir: string): Promise<string> {
  return (await readdir(dir)).find((f) => /^pack-[0-9a-f]+\.json$/.test(f))!;
}

async function run(dir: string, version: string): Promise<void> {
  await familiesCommand().parseAsync(['-p', dir, '--pack-version', version], { from: 'user' });
}

describe('families command on a copy of the shipped gg-demo manifest', () => {
  let shippedFile: string;

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await mkdir(TEST_DIR, { recursive: true });
    shippedFile = await manifestIn(SHIPPED);
    await copyFile(join(SHIPPED, shippedFile), join(TEST_DIR, shippedFile));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('writes family on every object entry, sets the version and replaces the manifest', async () => {
    await run(TEST_DIR, '9.9.9');

    const files = await readdir(TEST_DIR);
    expect(files).toHaveLength(1);
    expect(files[0]).not.toBe(shippedFile);
    const m = JSON.parse(await readFile(join(TEST_DIR, files[0]!), 'utf-8')) as PackManifest;
    expect(m.version).toBe('9.9.9');

    const entries = Object.values(m.entries);
    const objects = entries.filter((e) => e.type === 'object');
    expect(objects).toHaveLength(825);
    expect(objects.every((e) => typeof e.family === 'string' && e.family.length > 0)).toBe(true);
    expect(entries.filter((e) => e.type !== 'object').some((e) => 'family' in e)).toBe(false);

    const sizes = new Map<string, number>();
    for (const e of objects) sizes.set(`${e.set}:${e.family}`, (sizes.get(`${e.set}:${e.family}`) ?? 0) + 1);
    const multi = [...sizes.values()].filter((n) => n >= 2);
    expect(sizes.size).toBe(545);
    expect(multi).toHaveLength(113);
    expect(multi.reduce((s, n) => s + n, 0)).toBe(393);
  });

  it('the shipped manifest is exactly what the command produces', async () => {
    const shipped = JSON.parse(await readFile(join(SHIPPED, shippedFile), 'utf-8')) as PackManifest;
    await run(TEST_DIR, shipped.version);
    expect(await manifestIn(TEST_DIR)).toBe(shippedFile);
  });
});
