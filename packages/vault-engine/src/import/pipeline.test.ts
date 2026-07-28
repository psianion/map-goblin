import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { importFiles } from './pipeline.js';

/** Deterministic textured image — distinct seeds give distinct hashes. */
async function makeNoise(seed: number, w = 200, h = 200): Promise<Buffer> {
  const px = Buffer.alloc(w * h * 3);
  let s = seed >>> 0;
  for (let i = 0; i < px.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    px[i] = s >>> 24;
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

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
    const results = await importFiles([
      { filename: 'floors/cobblestone-A.jpg', data: await makeNoise(1) },
      { filename: 'floors/grass-A.jpg', data: await makeNoise(99) },
    ]);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'ok')).toBe(true);
  });

  it('rejects only the undecodable file, not the whole batch', async () => {
    // PNG magic bytes and a plausible header, but no decodable image data
    const corrupt = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64, 0x7f),
    ]);
    const results = await importFiles([
      { filename: 'floors/good-A.png', data: await makeNoise(5) },
      { filename: 'floors/corrupt-A.png', data: corrupt },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0]!.status).toBe('ok');
    expect(results[1]!.status).toBe('rejected');
  });

  it('rejects SVG, which has no pixel dimensions', async () => {
    const svg = Buffer.from('<?xml version="1.0"?><svg width="10" height="10"></svg>');
    const results = await importFiles([{ filename: 'floors/vector-A.svg', data: svg }]);
    expect(results[0]!.status).toBe('rejected');
    expect(results[0]!.reason).toMatch(/SVG/);
  });
});
