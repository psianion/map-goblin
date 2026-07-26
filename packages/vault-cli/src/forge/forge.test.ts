import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JobSchema } from './types.js';
import { patchWorkflow, type Workflow } from './comfy.js';

const TEMPLATE_PATH = resolve(import.meta.dirname, '../../../../forge/workflows/txt2img.json');

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
