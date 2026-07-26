// packages/engine/src/build/preview.test.ts
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { generatePreview } from './preview.js';

async function makeWebP(w: number, h: number): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: 100, g: 50, b: 150, alpha: 1 } } })
    .webp().toBuffer();
}

describe('generatePreview', () => {
  it('produces a 512x512 WebP image', async () => {
    const images = [await makeWebP(200, 200), await makeWebP(400, 200)];
    const preview = await generatePreview(images);
    const meta = await sharp(preview).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(512);
  });

  it('handles a single image', async () => {
    const preview = await generatePreview([await makeWebP(100, 100)]);
    const meta = await sharp(preview).metadata();
    expect(meta.width).toBe(512);
  });
});
