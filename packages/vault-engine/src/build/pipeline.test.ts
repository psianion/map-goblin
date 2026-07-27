// packages/engine/src/build/pipeline.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { buildPack } from './pipeline.js';

const TEST_DIR = join(tmpdir(), 'map-assets-test-' + Date.now());

async function makePng(filename: string, w = 200, h = 200, r = 100): Promise<void> {
  const buf = await sharp({
    create: { width: w, height: h, channels: 4, background: { r, g: 80, b: 60, alpha: 1 } },
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

    // Create test assets. slate-C is deliberately NOT a grid multiple: it used
    // to be declared 200x200 to sharp and blow up decoding a 150x150 buffer.
    await makePng(join(packDir, 'floors', 'stone-A.png'));
    await makePng(join(packDir, 'floors', 'stone-B.png'), 200, 200, 130);
    await makePng(join(packDir, 'floors', 'slate-C.png'), 150, 150, 160);
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

  it('packs a source whose size is not a grid multiple', async () => {
    const result = await buildPack({ packDir, outputDir, taxonomyPath });
    expect(result.manifest.entries).toHaveProperty('slate_1x1_floor_C');
    expect(result.rejected).toEqual([]);
  });

  it('includes the preview in the manifest, not just on disk', async () => {
    const result = await buildPack({ packDir, outputDir, taxonomyPath });
    const preview = Object.keys(result.manifest.files).find((f) => f.startsWith('preview-'));
    expect(preview).toBeDefined();
  });

  it('cross-references sibling atlases without listing itself', async () => {
    // 256px cap forces one sprite per atlas
    const result = await buildPack({ packDir, outputDir, taxonomyPath, maxAtlasSize: 256 });
    const atlasJson = result.writtenFiles.filter((f) => /atlas-floor-.*\.json$/.test(f));
    expect(atlasJson.length).toBeGreaterThan(1);

    const names = atlasJson.map((f) => f.split(/[\\/]/).pop()!);
    for (const file of atlasJson) {
      const { meta } = JSON.parse(await readFile(file, 'utf-8'));
      const self = file.split(/[\\/]/).pop()!;
      expect(meta.related_multi_packs).toEqual(names.filter((n) => n !== self));
    }
  });

  it('reports invalid sources instead of silently dropping them', async () => {
    await writeFile(join(packDir, 'floors', 'broken-D.png'), Buffer.from('not an image'));
    try {
      const result = await buildPack({ packDir, outputDir, taxonomyPath });
      expect(result.rejected.map((r) => r.file.replace(/\\/g, '/'))).toContain(
        'floors/broken-D.png',
      );
    } finally {
      await rm(join(packDir, 'floors', 'broken-D.png'), { force: true });
    }
  });

  it('fails on a theme the taxonomy does not define', async () => {
    await writeFile(join(packDir, 'config.json'), JSON.stringify({
      name: 'test-pack', version: '1.0.0', type: 'foundation', themes: ['atlantis'],
    }));
    try {
      await expect(buildPack({ packDir, outputDir, taxonomyPath })).rejects.toThrow(/atlantis/);
    } finally {
      await writeFile(join(packDir, 'config.json'), JSON.stringify({
        name: 'test-pack', version: '1.0.0', type: 'foundation', themes: ['dungeon'],
      }));
    }
  });

  it('fails loudly when two sources mint the same localId', async () => {
    // same material/grid/type/variant as floors/stone-A.png
    const dup = join(packDir, 'floors', 'nested');
    await mkdir(dup, { recursive: true });
    await makePng(join(dup, 'stone-A.png'));
    try {
      await expect(buildPack({ packDir, outputDir, taxonomyPath })).rejects.toThrow(
        /Duplicate localId 'stone_1x1_floor_A'/,
      );
    } finally {
      await rm(dup, { recursive: true, force: true });
    }
  });
});
