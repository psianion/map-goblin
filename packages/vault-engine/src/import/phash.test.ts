import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { computePhash, hammingDistance } from './phash.js';

async function makeImage(r: number, g: number, b: number): Promise<Buffer> {
  return sharp({
    create: { width: 200, height: 200, channels: 3, background: { r, g, b } },
  })
    .png()
    .toBuffer();
}

/** Deterministic textured image — a solid fill hashes to all zeroes. */
async function makeNoise(seed: number, w = 200, h = 200): Promise<Buffer> {
  const px = Buffer.alloc(w * h * 3);
  let s = seed >>> 0;
  for (let i = 0; i < px.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    px[i] = s >>> 24;
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

describe('computePhash', () => {
  it('returns a 16-char hex string (64-bit hash)', async () => {
    const buf = await makeImage(128, 128, 128);
    const hash = await computePhash(buf);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('returns same hash for identical images', async () => {
    const buf = await makeNoise(1);
    expect(await computePhash(buf)).toBe(await computePhash(buf));
  });

  it('returns different hashes for visually different images', async () => {
    const a = await makeNoise(1);
    const b = await makeNoise(99);
    expect(await computePhash(a)).not.toBe(await computePhash(b));
  });

  it('samples the whole image, not just the top-left corner', async () => {
    // Same left half, different right half — a corner-only hash collides here
    const left = await makeNoise(7, 100, 200);
    const compose = async (rightSeed: number) =>
      sharp({
        create: { width: 200, height: 200, channels: 3, background: { r: 0, g: 0, b: 0 } },
      })
        .composite([
          { input: left, left: 0, top: 0 },
          { input: await makeNoise(rightSeed, 100, 200), left: 100, top: 0 },
        ])
        .png()
        .toBuffer();

    expect(await computePhash(await compose(11))).not.toBe(
      await computePhash(await compose(22)),
    );
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
