import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { importFiles } from './pipeline.js';

const TEST_ASSETS = resolve(import.meta.dirname, '../../../../assets/test');

async function makePng(
  w = 200,
  h = 200,
  r = 128,
  g = 128,
  b = 128,
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

describe('importFiles', () => {
  it('processes a valid PNG and returns metadata', async () => {
    const buf = await makePng();
    const results = await importFiles([
      { filename: 'floors/stone-A.png', data: buf },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe('ok');
    expect(results[0]!.metadata?.type).toBe('floor');
    expect(results[0]!.metadata?.material).toBe('stone');
    expect(results[0]!.metadata?.variant).toBe('A');
  });

  it('rejects invalid files', async () => {
    const results = await importFiles([
      { filename: 'bad.png', data: Buffer.from('not an image') },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe('rejected');
  });

  it('flags second of two identical images as duplicate, first gets ok', async () => {
    const buf = await makePng(200, 200, 100, 100, 100);
    const results = await importFiles([
      { filename: 'a.png', data: buf },
      { filename: 'b.png', data: Buffer.from(buf) }, // identical copy
    ]);
    expect(results[0]!.status).toBe('ok');
    expect(results[0]!.metadata).toBeDefined();
    expect(results[1]!.status).toBe('duplicate');
  });

  it('processes multiple files in a batch', async () => {
    const cobble = readFileSync(resolve(TEST_ASSETS, 'floors/Cobblestone_A_01.jpg'));
    const grass = readFileSync(resolve(TEST_ASSETS, 'floors/Grass_A_01.jpg'));
    const results = await importFiles([
      { filename: 'floors/cobblestone-A.jpg', data: cobble },
      { filename: 'floors/grass-A.jpg', data: grass },
    ]);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'ok')).toBe(true);
  });
});
