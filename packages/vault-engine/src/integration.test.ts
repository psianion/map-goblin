import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile, rm, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { buildPack } from './build/pipeline.js';
import { importFiles } from './import/pipeline.js';
import { PackManifestSchema } from './schemas/pack-manifest.js';

const TEST_DIR = join(tmpdir(), 'map-assets-integration-' + Date.now());
const REAL_ASSETS = resolve(import.meta.dirname, '../../../assets/test');

async function makePng(
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
): Promise<Buffer> {
  return sharp({
    create: {
      width: w,
      height: h,
      channels: 4,
      background: { r, g, b, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

describe('Integration: full build pipeline', () => {
  const packDir = join(TEST_DIR, 'packs', 'integration-test');
  const outputDir = join(TEST_DIR, 'dist');
  const taxonomyPath = join(TEST_DIR, 'taxonomy.json');

  beforeAll(async () => {
    await mkdir(join(packDir, 'floors'), { recursive: true });
    await mkdir(join(packDir, 'walls'), { recursive: true });
    await mkdir(join(packDir, 'objects'), { recursive: true });
    await mkdir(outputDir, { recursive: true });

    await writeFile(
      join(packDir, 'floors', 'stone-A.png'),
      await makePng(200, 200, 120, 110, 100),
    );
    await writeFile(
      join(packDir, 'floors', 'stone-B.png'),
      await makePng(200, 200, 110, 100, 90),
    );
    await writeFile(
      join(packDir, 'floors', 'wood-A.png'),
      await makePng(200, 200, 160, 120, 80),
    );
    await writeFile(
      join(packDir, 'walls', 'stone-A.png'),
      await makePng(600, 200, 100, 95, 90),
    );
    await writeFile(
      join(packDir, 'objects', 'table.png'),
      await makePng(400, 400, 140, 100, 60),
    );
    await writeFile(
      join(packDir, 'objects', 'chair.png'),
      await makePng(200, 200, 130, 90, 50),
    );

    await writeFile(
      join(packDir, 'config.json'),
      JSON.stringify({
        name: 'integration-test',
        version: '1.0.0',
        type: 'foundation',
        themes: ['dungeon', 'tavern'],
      }),
    );

    await writeFile(
      taxonomyPath,
      JSON.stringify({
        types: [
          'floor',
          'wall',
          'pattern',
          'edge',
          'object',
          'scatter',
          'path',
          'portal',
          'light-mask',
        ],
        themes: ['dungeon', 'tavern'],
        materials: { stone: ['cobble', 'brick'], wood: ['oak'] },
        pieceTypes: {
          wall: ['straight'],
          floor: ['base'],
          path: ['straight'],
        },
      }),
    );
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('import pipeline processes real test images', async () => {
    const cobble = await readFile(join(REAL_ASSETS, 'floors/Cobblestone_A_01.jpg'));
    const grass = await readFile(join(REAL_ASSETS, 'floors/Grass_A_01.jpg'));
    const lamp = await readFile(join(REAL_ASSETS, 'objects/Lamp_Metal_Brass_A_1x1.png'));
    const files = [
      { filename: 'floors/cobblestone-A.jpg', data: cobble },
      { filename: 'floors/grass-A.jpg', data: grass },
      { filename: 'objects/lamp-A.png', data: lamp },
    ];
    const results = await importFiles(files);
    expect(
      results.every((r) => r.status === 'ok' || r.status === 'similar'),
    ).toBe(true);
    expect(results).toHaveLength(3);
  });

  it('full build produces valid manifest', async () => {
    const result = await buildPack({ packDir, outputDir, taxonomyPath });

    const parsed = PackManifestSchema.safeParse(result.manifest);
    expect(parsed.success).toBe(true);

    expect(
      Object.keys(result.manifest.entries).length,
    ).toBeGreaterThanOrEqual(3);
    expect(result.writtenFiles.length).toBeGreaterThan(0);
  });

  it('output directory contains expected files', async () => {
    await buildPack({ packDir, outputDir, taxonomyPath });
    const files = await readdir(join(outputDir, 'integration-test'), {
      recursive: true,
    });
    const filenames = files.map(String);

    expect(filenames.some((f) => f.includes('atlas-'))).toBe(true);
    expect(filenames.some((f) => f.includes('pack-'))).toBe(true);
  });
});
