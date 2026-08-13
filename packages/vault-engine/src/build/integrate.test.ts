// packages/engine/src/build/integrate.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { integrateSets } from './integrate.js';
import { sha256File } from '../hash.js';

const TEST_DIR = join(tmpdir(), 'integrate-test-' + Date.now());

async function makePng(w: number, h: number, r = 100): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 4, background: { r, g: 80, b: 60, alpha: 1 } } })
    .png()
    .toBuffer();
}

async function writeFileRecord(dir: string, name: string, data: Buffer): Promise<[string, { checksum: string; size: number }]> {
  await writeFile(join(dir, name), data);
  return [name, { checksum: `sha256:${sha256File(data)}`, size: data.length }];
}

/** A base pack with one atlas entry, one loose entry that a set will replace, and one that it won't. */
async function makeBasePack(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });

  const atlasWebp = await makePng(400, 400);
  const atlasJson = Buffer.from(JSON.stringify({ frames: {}, meta: { image: 'atlas-floor-aaaaaaaa.webp' } }));
  const woodWebp = await makePng(200, 200, 50);
  const otherWebp = await makePng(200, 200, 20);

  const [af1, af1r] = await writeFileRecord(dir, 'atlas-floor-aaaaaaaa.webp', atlasWebp);
  const [af2, af2r] = await writeFileRecord(dir, 'atlas-floor-aaaaaaaa.json', atlasJson);
  const [wf, wfr] = await writeFileRecord(dir, 'Wood_A_1x1_A-11112222.webp', woodWebp);
  const [of, ofr] = await writeFileRecord(dir, 'Other_1x1_A-33334444.webp', otherWebp);
  // Untracked by any entry (index requires it, no manifest entry ever references it) —
  // must still carry through, matching the live dungeon-classic pack.
  await writeFile(join(dir, 'preview-9e0e45e5.webp'), await makePng(64, 64, 90));

  const manifest = {
    name: 'test-pack',
    version: '1.0.0',
    description: 'A test pack',
    theme: ['dungeon', 'cave'],
    entries: {
      stone_1x1_floor_A: {
        type: 'floor',
        material: 'stone',
        gridSize: '1x1',
        pieceType: 'floor',
        variant: 'A',
        atlas: af1,
        frame: { x: 0, y: 0, w: 200, h: 200 },
        tags: ['dungeon'],
      },
      Wood_A_1x1_wall_A: {
        type: 'wall',
        material: 'Wood_A',
        gridSize: '1x1',
        pieceType: 'straight',
        variant: 'A',
        tags: ['dungeon'],
      },
      Other_1x1_object_A: {
        type: 'object',
        material: 'Other',
        gridSize: '1x1',
        pieceType: 'object',
        variant: 'A',
        tags: ['dungeon'],
      },
    },
    atlases: { [af1]: af1r, [af2]: af2r },
    files: { [wf]: wfr, [of]: ofr },
    checksums: { [wf]: wfr.checksum }, // hand-patch artifact — integrate must not carry this forward
    bundleSize: af1r.size + af2r.size + wfr.size + ofr.size,
  };

  await writeFile(join(dir, 'pack-deadbeef.json'), JSON.stringify(manifest, null, 2));
}

/** A forge set with one piece that collides with the base's Wood_A entry and one brand-new piece with no gridSize. */
async function makeSetDir(dir: string, setName: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'Wood_A.png'), await makePng(200, 200, 50));
  await writeFile(join(dir, 'Wood_B.png'), await makePng(400, 200, 60));
  await writeFile(
    join(dir, 'manifest.json'),
    JSON.stringify({
      set: setName,
      pieces: [
        { file: 'Wood_A.png', piece: 'straight', gridSize: '1x1', naturalWidth: 200, naturalHeight: 200, variant: 'A' },
        // no gridSize — must derive from naturalWidth/naturalHeight (400x200 -> 2x1)
        { file: 'Wood_B.png', piece: 'corner', naturalWidth: 400, naturalHeight: 200 },
      ],
    }),
  );
}

describe('integrateSets', () => {
  const basePackDir = join(TEST_DIR, 'base');
  const setDir = join(TEST_DIR, 'sets', 'TestSet');
  const outputDir = join(TEST_DIR, 'out');

  beforeAll(async () => {
    await makeBasePack(basePackDir);
    await makeSetDir(setDir, 'TestSet');
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('mints ids from stem + gridSize + type + variant, deriving gridSize when absent', async () => {
    const result = await integrateSets({ basePackDir, setDirs: [setDir], type: 'wall', version: '1.1.0', output: outputDir });
    expect(result.manifest.entries).toHaveProperty('Wood_A_1x1_wall_A');
    expect(result.manifest.entries['Wood_B_2x1_wall_A']).toMatchObject({ gridSize: '2x1', pieceType: 'corner', set: 'TestSet' });
  });

  it('replaces the colliding loose entry with an atlas-backed one and drops its old file', async () => {
    const result = await integrateSets({ basePackDir, setDirs: [setDir], type: 'wall', version: '1.1.0', output: outputDir });
    const entry = result.manifest.entries['Wood_A_1x1_wall_A']!;
    expect(entry.atlas).toMatch(/^atlas-TestSet-wall-/);
    expect(entry.frame).toBeDefined();
    expect(result.manifest.files).not.toHaveProperty('Wood_A_1x1_A-11112222.webp');
    expect(result.manifest.checksums).toBeUndefined();
  });

  it('carries untouched files byte-identical', async () => {
    const result = await integrateSets({ basePackDir, setDirs: [setDir], type: 'wall', version: '1.1.0', output: outputDir });
    expect(result.manifest.files).toHaveProperty('Other_1x1_A-33334444.webp');
    expect(result.manifest.atlases).toHaveProperty('atlas-floor-aaaaaaaa.webp');

    const original = await readFile(join(basePackDir, 'atlas-floor-aaaaaaaa.webp'));
    const carried = await readFile(join(outputDir, 'test-pack', 'atlas-floor-aaaaaaaa.webp'));
    expect(carried.equals(original)).toBe(true);
  });

  it('carries an untracked preview-* file byte-identical even though no entry references it', async () => {
    await integrateSets({ basePackDir, setDirs: [setDir], type: 'wall', version: '1.1.0', output: outputDir });
    const original = await readFile(join(basePackDir, 'preview-9e0e45e5.webp'));
    const carried = await readFile(join(outputDir, 'test-pack', 'preview-9e0e45e5.webp'));
    expect(carried.equals(original)).toBe(true);
  });

  it('throws on an untracked file that is neither preview-* nor manifest-tracked', async () => {
    const dir = join(TEST_DIR, 'stray-file-base');
    await mkdir(dir, { recursive: true });
    await makeBasePack(dir);
    await writeFile(join(dir, 'mystery.webp'), await makePng(50, 50));

    await expect(
      integrateSets({ basePackDir: dir, setDirs: [setDir], type: 'wall', version: '1.1.0', output: join(TEST_DIR, 'stray-out') }),
    ).rejects.toThrow(/mystery\.webp/);
  });

  it('produces a deterministic manifest hash across runs', async () => {
    const r1 = await integrateSets({ basePackDir, setDirs: [setDir], type: 'wall', version: '1.1.0', output: join(TEST_DIR, 'out-a') });
    const r2 = await integrateSets({ basePackDir, setDirs: [setDir], type: 'wall', version: '1.1.0', output: join(TEST_DIR, 'out-b') });
    const hashOf = (files: string[]) => files.map((f) => f.split(/[\\/]/).pop()).find((f) => f!.startsWith('pack-'));
    expect(hashOf(r1.writtenFiles)).toBe(hashOf(r2.writtenFiles));
  });

  it('keys the minted atlas json frames by the full entry id', async () => {
    const result = await integrateSets({ basePackDir, setDirs: [setDir], type: 'wall', version: '1.1.0', output: outputDir });
    const jsonFile = result.writtenFiles.find((f) => /atlas-TestSet-wall-.*\.json$/.test(f))!;
    const atlasJson = JSON.parse(await readFile(jsonFile, 'utf-8'));
    expect(Object.keys(atlasJson.frames).sort()).toEqual(['Wood_A_1x1_wall_A', 'Wood_B_2x1_wall_A']);
    expect(atlasJson.meta.image).toBe(jsonFile.split(/[\\/]/).pop()!.replace('.json', '.webp'));
  });

  it('throws when a set needs more than one atlas sheet', async () => {
    // Two 200x200 pieces don't both fit in a single 300x300 bin with padding.
    const overflowSet = join(TEST_DIR, 'overflow-set');
    await mkdir(overflowSet, { recursive: true });
    await writeFile(join(overflowSet, 'A.png'), await makePng(200, 200));
    await writeFile(join(overflowSet, 'B.png'), await makePng(200, 200));
    await writeFile(
      join(overflowSet, 'manifest.json'),
      JSON.stringify({
        set: 'Overflow',
        pieces: [
          { file: 'A.png', piece: 'straight', gridSize: '1x1', naturalWidth: 200, naturalHeight: 200 },
          { file: 'B.png', piece: 'straight', gridSize: '1x1', naturalWidth: 200, naturalHeight: 200 },
        ],
      }),
    );

    await expect(
      integrateSets({
        basePackDir,
        setDirs: [overflowSet],
        type: 'wall',
        version: '1.1.0',
        output: join(TEST_DIR, 'overflow-out'),
        maxAtlasSize: 300,
      }),
    ).rejects.toThrow(/Overflow.*atlas sheets/);
  });

  it('refuses to drop a file still referenced by an entry that is not being replaced', async () => {
    const dir = join(TEST_DIR, 'shared-file-base');
    await mkdir(dir, { recursive: true });
    const ghostWebp = await makePng(200, 200, 10);
    const [gf, gfr] = await writeFileRecord(dir, 'Ghost_1x1_A-55556666.webp', ghostWebp);
    const manifest = {
      name: 'shared-pack',
      version: '1.0.0',
      description: 'shares one loose file between two entries',
      theme: ['dungeon'],
      entries: {
        Ghost_1x1_wall_A: { type: 'wall', material: 'Ghost', gridSize: '1x1', pieceType: 'straight', variant: 'A', tags: ['dungeon'] },
        Ghost_1x1_object_A: { type: 'object', material: 'Ghost', gridSize: '1x1', pieceType: 'object', variant: 'A', tags: ['dungeon'] },
      },
      atlases: {},
      files: { [gf]: gfr },
      bundleSize: gfr.size,
    };
    await writeFile(join(dir, 'pack-cafefeed.json'), JSON.stringify(manifest, null, 2));

    const ghostSet = join(TEST_DIR, 'ghost-set');
    await mkdir(ghostSet, { recursive: true });
    await writeFile(join(ghostSet, 'Ghost.png'), await makePng(200, 200, 10));
    await writeFile(
      join(ghostSet, 'manifest.json'),
      JSON.stringify({ set: 'Ghost', pieces: [{ file: 'Ghost.png', piece: 'straight', gridSize: '1x1', naturalWidth: 200, naturalHeight: 200 }] }),
    );

    await expect(
      integrateSets({ basePackDir: dir, setDirs: [ghostSet], type: 'wall', version: '1.1.0', output: join(TEST_DIR, 'ghost-out') }),
    ).rejects.toThrow(/still referenced/);
  });
});
