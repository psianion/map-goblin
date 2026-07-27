import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { JobSchema } from './types.js';
import { approve } from './staging.js';
import { patchWorkflow, type Workflow } from './comfy.js';

const TEMPLATE_PATH = resolve(import.meta.dirname, '../../../../forge/workflows/txt2img.json');
const TEST_DIR = join(tmpdir(), 'forge-test-' + Date.now());

describe('JobSchema', () => {
  it('applies defaults', () => {
    const job = JobSchema.parse({ name: 'brazier', type: 'object', prompt: 'an iron brazier' });
    expect(job.count).toBe(4);
    expect(job.gridSize).toBe('1x1');
    expect(job.workflow).toBe('txt2img.json');
    expect(job.negative.length).toBeGreaterThan(0);
  });

  it('rejects unsafe names and bad grid sizes', () => {
    expect(JobSchema.safeParse({ name: 'a/b', type: 'object', prompt: 'x' }).success).toBe(false);
    expect(
      JobSchema.safeParse({ name: 'ok', type: 'object', prompt: 'x', gridSize: '0x1' }).success,
    ).toBe(false);
  });

  it('rejects a workflow filename that escapes the workflows dir', () => {
    const bad = { name: 'ok', type: 'object', prompt: 'x', workflow: '../../../.env' };
    expect(JobSchema.safeParse(bad).success).toBe(false);
  });
});

describe('approve', () => {
  afterAll(async () => { await rm(TEST_DIR, { recursive: true, force: true }); });

  async function stage(name: string): Promise<string> {
    const dir = join(TEST_DIR, name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'job.json'), JSON.stringify({
      name, type: 'object', prompt: 'a lamp', gridSize: '1x1',
    }));
    const png = await sharp({
      create: { width: 64, height: 64, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } },
    }).png().toBuffer();
    for (const n of ['a.png', 'b.png']) await writeFile(join(dir, n), png);
    return dir;
  }

  it('rejects out-of-range --keep without deleting the staging dir', async () => {
    const dir = await stage('bad-keep');
    await expect(
      approve({ stagingDir: TEST_DIR, name: 'bad-keep', keep: [1, 5], dest: join(TEST_DIR, 'out') }),
    ).rejects.toThrow(/invalid --keep indices: 5/);
    // candidates survive a typo
    expect((await readdir(dir)).filter((f) => f.endsWith('.png'))).toHaveLength(2);
  });

  it('emits filenames the importer can parse back', async () => {
    await stage('good-keep');
    const written = await approve({
      stagingDir: TEST_DIR, name: 'good-keep', dest: join(TEST_DIR, 'out'),
    });
    const names = written.map((f) => f.split(/[\\/]/).pop()!);
    expect(names).toEqual(['good-keep_1x1-A.png', 'good-keep_1x1-B.png']);
  });
});

describe('patchWorkflow on the shipped template', () => {
  const template = JSON.parse(readFileSync(TEMPLATE_PATH, 'utf-8')) as Workflow;

  it('patches prompt, negative, size, batch, seed, checkpoint', () => {
    const wf = patchWorkflow(template, {
      positive: 'a stone golem',
      negative: 'blurry',
      width: 768,
      height: 512,
      batchSize: 2,
      seed: 42,
      checkpoint: 'custom.safetensors',
    });
    expect(wf['6']!.inputs['text']).toBe('a stone golem');
    expect(wf['7']!.inputs['text']).toBe('blurry');
    expect(wf['5']!.inputs).toMatchObject({ width: 768, height: 512, batch_size: 2 });
    expect(wf['3']!.inputs['seed']).toBe(42);
    expect(wf['4']!.inputs['ckpt_name']).toBe('custom.safetensors');
    // original untouched
    expect(template['6']!.inputs['text']).toBe('placeholder');
  });

  it('leaves workflow defaults alone when params are omitted', () => {
    const wf = patchWorkflow(template, { positive: 'x' });
    expect(wf['5']!.inputs).toMatchObject({ width: 1024, height: 1024, batch_size: 4 });
    expect(wf['4']!.inputs['ckpt_name']).toBe('sd_xl_base_1.0.safetensors');
  });
});
