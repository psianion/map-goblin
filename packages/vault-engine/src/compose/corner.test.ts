import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { composeCorner } from './corner.js';

async function makeSolidWebP(w: number, h: number): Promise<Buffer> {
  return sharp({
    create: {
      width: w,
      height: h,
      channels: 4,
      background: { r: 150, g: 100, b: 50, alpha: 1 },
    },
  })
    .webp()
    .toBuffer();
}

describe('composeCorner', () => {
  it('produces a square image for 90-degree corner', async () => {
    const straight = await makeSolidWebP(200, 200);
    const result = await composeCorner(straight, {
      angleDeg: 90,
      outputSize: 200,
    });
    const meta = await sharp(result).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(200);
  });

  it('produces WebP output', async () => {
    const straight = await makeSolidWebP(200, 200);
    const result = await composeCorner(straight, {
      angleDeg: 90,
      outputSize: 200,
    });
    const meta = await sharp(result).metadata();
    expect(meta.format).toBe('webp');
  });

  it('handles 120-degree corners', async () => {
    const straight = await makeSolidWebP(200, 200);
    const result = await composeCorner(straight, {
      angleDeg: 120,
      outputSize: 200,
    });
    const meta = await sharp(result).metadata();
    expect(meta.width).toBe(200);
  });

  it('handles 135-degree corners', async () => {
    const straight = await makeSolidWebP(200, 200);
    const result = await composeCorner(straight, {
      angleDeg: 135,
      outputSize: 200,
    });
    const meta = await sharp(result).metadata();
    expect(meta.width).toBe(200);
  });
});
