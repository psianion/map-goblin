// packages/engine/src/build/pipeline.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { buildPack } from './pipeline.js';

const TEST_DIR = join(tmpdir(), 'map-assets-test-' + Date.now());

async function makePng(filename: string, w = 200, h = 200): Promise<void> {
  const buf = await sharp({
    create: { width: w, height: h, channels: 4, background: { r: 100, g: 80, b: 60, alpha: 1 } },
  }).png().toBuffer();
  await writeFile(filename, buf);
}

describe('buildPack', () => {
  const packDir = join(TEST_DIR, 'packs', 'test-pack');
  const outputDir = join(TEST_DIR, 'dist');
  const taxonomyPath = join(TEST_DIR, 'taxonomy.json');

  beforeAll(async () => {
    await mkdir(join(packDir, 'floors'), { recursive: true });
    await mkdir(join(packDir, 'objects'), { recursive: true });
    await mkdir(outputDir, { recursive: true });

    // Create test assets
    await makePng(join(packDir, 'floors', 'stone-A.png'));
    await makePng(join(packDir, 'floors', 'stone-B.png'));
    await makePng(join(packDir, 'objects', 'chest.png'), 400, 400);

    // Pack config
    await writeFile(join(packDir, 'config.json'), JSON.stringify({
      name: 'test-pack',
      version: '1.0.0',
      type: 'foundation',
      themes: ['dungeon'],
    }));

    // Taxonomy
    await writeFile(taxonomyPath, JSON.stringify({
      types: ['floor', 'wall', 'object'],
      themes: ['dungeon'],
      materials: { stone: ['cobble'] },
      pieceTypes: { wall: ['straight'], floor: ['base'], path: ['straight'] },
    }));
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('builds a pack and produces manifest', async () => {
    const result = await buildPack({
      packDir,
      outputDir,
      taxonomyPath,
    });
    expect(result.manifest.name).toBe('test-pack');
    expect(result.manifest.version).toBe('1.0.0');
    expect(Object.keys(result.manifest.entries).length).toBeGreaterThan(0);
  });

  it('produces atlas files for floor textures', async () => {
    const result = await buildPack({ packDir, outputDir, taxonomyPath });
    const atlasKeys = Object.keys(result.manifest.atlases);
    expect(atlasKeys.some((k) => k.includes('floor'))).toBe(true);
  });

  it('produces individual files for objects', async () => {
    const result = await buildPack({ packDir, outputDir, taxonomyPath });
    expect(Object.keys(result.manifest.files).length).toBeGreaterThan(0);
  });
});
