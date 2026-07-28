import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { checkQuality } from './quality.js';

async function makeSolid(w: number, h: number): Promise<Buffer> {
  return sharp({
    create: {
      width: w,
      height: h,
      channels: 4,
      background: { r: 100, g: 100, b: 100, alpha: 1 },
    },
  })
    .webp()
    .toBuffer();
}

async function makeWithGap(w: number, h: number): Promise<Buffer> {
  const left = await sharp({
    create: {
      width: w / 2,
      height: h,
      channels: 4,
      background: { r: 100, g: 100, b: 100, alpha: 1 },
    },
  })
    .raw()
    .toBuffer();

  return sharp({
    create: {
      width: w,
      height: h,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: left,
        raw: { width: w / 2, height: h, channels: 4 },
        left: 0,
        top: 0,
      },
    ])
    .webp()
    .toBuffer();
}

describe('checkQuality', () => {
  it('passes a solid image with correct dimensions', async () => {
    const img = await makeSolid(600, 200);
    const result = await checkQuality(img, {
      expectedWidth: 600,
      expectedHeight: 200,
    });
    expect(result.passed).toBe(true);
  });

  it('fails on dimension mismatch', async () => {
    const img = await makeSolid(600, 200);
    const result = await checkQuality(img, {
      expectedWidth: 400,
      expectedHeight: 200,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('Dimension');
  });

  it('detects transparent gaps', async () => {
    const img = await makeWithGap(600, 200);
    const result = await checkQuality(img, {
      expectedWidth: 600,
      expectedHeight: 200,
    });
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('gap');
  });
});
