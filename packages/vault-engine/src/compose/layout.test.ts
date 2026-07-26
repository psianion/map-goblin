import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { composeStraight, type LayoutSprite } from './layout.js';

async function makeSolidWebP(
  w: number,
  h: number,
  r = 100,
  g = 100,
  b = 100,
): Promise<Buffer> {
  return sharp({
    create: {
      width: w,
      height: h,
      channels: 4,
      background: { r, g, b, alpha: 1 },
    },
  })
    .webp()
    .toBuffer();
}

describe('composeStraight', () => {
  it('produces an image with correct target dimensions', async () => {
    const sprites: LayoutSprite[] = [
      {
        id: 'a',
        data: await makeSolidWebP(200, 200),
        width: 200,
        height: 200,
      },
      {
        id: 'b',
        data: await makeSolidWebP(200, 200),
        width: 200,
        height: 200,
      },
    ];
    const result = await composeStraight(sprites, {
      targetWidth: 600,
      targetHeight: 200,
    });
    const meta = await sharp(result).metadata();
    expect(meta.width).toBe(600);
    expect(meta.height).toBe(200);
  });

  it('fills the entire target width without gaps', async () => {
    const sprites: LayoutSprite[] = [
      {
        id: 'a',
        data: await makeSolidWebP(200, 200, 100, 0, 0),
        width: 200,
        height: 200,
      },
    ];
    const result = await composeStraight(sprites, {
      targetWidth: 400,
      targetHeight: 200,
    });
    const meta = await sharp(result).metadata();
    expect(meta.width).toBe(400);
  });

  it('returns WebP format', async () => {
    const sprites: LayoutSprite[] = [
      {
        id: 'a',
        data: await makeSolidWebP(200, 200),
        width: 200,
        height: 200,
      },
    ];
    const result = await composeStraight(sprites, {
      targetWidth: 200,
      targetHeight: 200,
    });
    const meta = await sharp(result).metadata();
    expect(meta.format).toBe('webp');
  });
});
