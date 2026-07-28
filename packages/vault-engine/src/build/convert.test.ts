// packages/engine/src/build/convert.test.ts
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { convertToWebP } from './convert.js';

async function makePng(w = 200, h = 200): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: 128, g: 128, b: 128, alpha: 1 } } })
    .png()
    .toBuffer();
}

describe('convertToWebP', () => {
  it('converts PNG to WebP', async () => {
    const png = await makePng();
    const webp = await convertToWebP(png, 'texture');
    const meta = await sharp(webp).metadata();
    expect(meta.format).toBe('webp');
  });

  it('preserves dimensions', async () => {
    const png = await makePng(400, 300);
    const webp = await convertToWebP(png, 'texture');
    const meta = await sharp(webp).metadata();
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(300);
  });

  it('light-mask profile is lossless, texture profile is lossy', async () => {
    // Output size comparisons are unreliable across content types; assert the
    // real contract instead: lossless roundtrips to identical pixels, lossy does not.
    const raw = Buffer.alloc(200 * 200 * 4);
    let s = 12345;
    for (let i = 0; i < raw.length; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      raw[i] = i % 4 === 3 ? 255 : (s >>> 16) & 0xff;
    }
    const png = await sharp(raw, { raw: { width: 200, height: 200, channels: 4 } })
      .png()
      .toBuffer();

    const lossless = await convertToWebP(png, 'light-mask');
    const losslessRaw = await sharp(lossless).ensureAlpha().raw().toBuffer();
    expect(Buffer.compare(losslessRaw, raw)).toBe(0);

    const lossy = await convertToWebP(png, 'texture');
    const lossyRaw = await sharp(lossy).ensureAlpha().raw().toBuffer();
    expect(Buffer.compare(lossyRaw, raw)).not.toBe(0);
  });

  it('preserves alpha channel', async () => {
    const png = await sharp({
      create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).png().toBuffer();
    const webp = await convertToWebP(png, 'object');
    const meta = await sharp(webp).metadata();
    expect(meta.hasAlpha).toBe(true);
  });
});
