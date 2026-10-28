// packages/engine/src/build/families.test.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deriveFamily, addFamilies, rewriteManifest } from './families.js';
import { contentHash } from '../hash.js';
import type { PackManifest } from '../schemas/pack-manifest.js';

const TEST_DIR = join(tmpdir(), 'families-test-' + Date.now());

function entry(type: string, material: string) {
  return { type, material, gridSize: '1x1', pieceType: type, variant: 'A', set: 'demo-gear', tags: ['fantasy'] };
}

const MANIFEST = {
  name: 'test-pack',
  version: '0.1.1',
  description: 'A test pack',
  theme: ['fantasy'],
  entries: {
    storage_barrel_1_dark_1x1_object_A: entry('object', 'storage_barrel_1_dark'),
    cat_10_d_1x1_object_A: entry('object', 'cat_10_d'),
    stone_1_1x1_floor_A: entry('floor', 'stone_1'),
    'door-single-closed': entry('door', 'door-single-closed'),
  },
  atlases: {},
  files: { 'cat_10_d_1x1_A-11112222.webp': { checksum: 'sha256:abc', size: 10 } },
  bundleSize: 10,
} as unknown as PackManifest;

describe('deriveFamily', () => {
  it.each([
    ['storage_barrel_1_dark', 'storage_barrel_dark'],
    ['cat_10_d', 'cat'],
    ['light_brazier_1_a', 'light_brazier'],
    ['rock_1', 'rock'],
    ['crate', 'crate'],
    ['Wood_A', 'Wood'],
    ['bones_2b', 'bones_2b'],
    ['door-single-closed', 'door-single-closed'],
    ['a_1', 'a_1'],
  ])('%s -> %s', (material, family) => {
    expect(deriveFamily(material)).toBe(family);
  });
});

describe('addFamilies', () => {
  it('writes family on object entries only', () => {
    const out = addFamilies(MANIFEST);
    expect(out.entries['storage_barrel_1_dark_1x1_object_A']!.family).toBe('storage_barrel_dark');
    expect(out.entries['cat_10_d_1x1_object_A']!.family).toBe('cat');
    expect(out.entries['stone_1_1x1_floor_A']).not.toHaveProperty('family');
    expect(out.entries['door-single-closed']).not.toHaveProperty('family');
    expect(MANIFEST.entries['cat_10_d_1x1_object_A']).not.toHaveProperty('family');
  });
});

describe('rewriteManifest', () => {
  const packDir = join(TEST_DIR, 'pack');

  beforeEach(async () => {
    await rm(packDir, { recursive: true, force: true });
    await mkdir(packDir, { recursive: true });
    // CRLF on disk, as a Windows checkout leaves it: the new name must still come from the LF JSON.
    await writeFile(join(packDir, 'pack-deadbeef.json'), JSON.stringify(MANIFEST, null, 2).replace(/\n/g, '\r\n'));
    await writeFile(join(packDir, 'cat_10_d_1x1_A-11112222.webp'), 'webp bytes');
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('names the new manifest by the hash of its LF JSON, sets the version and removes the old one', async () => {
    const name = await rewriteManifest(packDir, addFamilies, '0.1.2');

    const files = (await readdir(packDir)).sort();
    expect(files).toEqual(['cat_10_d_1x1_A-11112222.webp', name]);
    const raw = await readFile(join(packDir, name), 'utf-8');
    expect(raw).not.toContain('\r');
    expect(name).toBe(`pack-${contentHash(Buffer.from(raw))}.json`);

    const written = JSON.parse(raw) as PackManifest;
    expect(written.version).toBe('0.1.2');
    expect(written.entries['cat_10_d_1x1_object_A']!.family).toBe('cat');
    expect(written.entries['stone_1_1x1_floor_A']).not.toHaveProperty('family');
    expect(await readFile(join(packDir, 'cat_10_d_1x1_A-11112222.webp'), 'utf-8')).toBe('webp bytes');
  });

  it('is stable: running it again on its own output keeps the same name', async () => {
    const first = await rewriteManifest(packDir, addFamilies, '0.1.2');
    const second = await rewriteManifest(packDir, addFamilies, '0.1.2');
    expect(second).toBe(first);
    expect((await readdir(packDir)).filter((f) => f.startsWith('pack-'))).toEqual([first]);
  });

  it('refuses a pack without exactly one manifest', async () => {
    await writeFile(join(packDir, 'pack-0badc0de.json'), '{}');
    await expect(rewriteManifest(packDir, addFamilies, '0.1.2')).rejects.toThrow(/exactly one pack-\*\.json/);
  });

  it('refuses a version that is not semver and leaves the old manifest in place', async () => {
    await expect(rewriteManifest(packDir, addFamilies, 'next')).rejects.toThrow();
    expect(await readdir(packDir)).toContain('pack-deadbeef.json');
  });
});
