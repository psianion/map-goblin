import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { computePhash, hammingDistance } from './phash.js';

const TEST_ASSETS = resolve(import.meta.dirname, '../../../../assets/test');

async function makeImage(r: number, g: number, b: number): Promise<Buffer> {
  return sharp({
    create: { width: 200, height: 200, channels: 3, background: { r, g, b } },
  })
    .png()
    .toBuffer();
}

describe('computePhash', () => {
  it('returns a 16-char hex string (64-bit hash)', async () => {
    const buf = await makeImage(128, 128, 128);
    const hash = await computePhash(buf);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('returns same hash for identical images', async () => {
    const buf = readFileSync(resolve(TEST_ASSETS, 'floors/Cobblestone_A_01.jpg'));
    expect(await computePhash(buf)).toBe(await computePhash(buf));
  });

  it('returns different hashes for visually different images', async () => {
    const cobble = readFileSync(resolve(TEST_ASSETS, 'floors/Cobblestone_A_01.jpg'));
    const grass = readFileSync(resolve(TEST_ASSETS, 'floors/Grass_A_01.jpg'));
    expect(await computePhash(cobble)).not.toBe(await computePhash(grass));
  });

  it('returns all-zero hash for uniform solid color', async () => {
    const solid = await makeImage(128, 128, 128);
    expect(await computePhash(solid)).toBe('0000000000000000');
  });

  it('produces different hashes for transparent-bg sprites with different content', async () => {
    // Create two sprites with >50% transparency but different visible content
    const sprite1 = await sharp({
      create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{
        input: await sharp({
          create: { width: 50, height: 50, channels: 3, background: { r: 255, g: 0, b: 0 } },
        }).png().toBuffer(),
        left: 0,
        top: 0,
      }])
      .png()
      .toBuffer();

    const sprite2 = await sharp({
      create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{
        input: await sharp({
          create: { width: 50, height: 50, channels: 3, background: { r: 0, g: 0, b: 255 } },
        }).png().toBuffer(),
        left: 100,
        top: 100,
      }])
      .png()
      .toBuffer();

    const hash1 = await computePhash(sprite1);
    const hash2 = await computePhash(sprite2);
    expect(hash1).not.toBe(hash2);
  });

  it('still produces consistent hashes for opaque images', async () => {
    const buf = await makeImage(200, 100, 50);
    const h1 = await computePhash(buf);
    const h2 = await computePhash(buf);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('hammingDistance', () => {
  it('returns 0 for identical hashes', () => {
    expect(hammingDistance('abcdef0123456789', 'abcdef0123456789')).toBe(0);
  });

  it('returns correct distance for known difference', () => {
    // 0x0 vs 0x1 = 1 bit different
    expect(hammingDistance('0000000000000000', '0000000000000001')).toBe(1);
  });

  it('returns max 64 for completely different hashes', () => {
    const dist = hammingDistance('0000000000000000', 'ffffffffffffffff');
    expect(dist).toBe(64);
  });
});
