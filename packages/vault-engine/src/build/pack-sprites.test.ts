// packages/engine/src/build/pack-sprites.test.ts
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { packSprites, type SpriteInput } from './pack-sprites.js';

async function makeWebP(w: number, h: number): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: 100, g: 100, b: 100, alpha: 1 } } })
    .webp()
    .toBuffer();
}

describe('packSprites', () => {
  it('packs multiple sprites into an atlas', async () => {
    const sprites: SpriteInput[] = [
      { id: 'a', data: await makeWebP(200, 200), width: 200, height: 200 },
      { id: 'b', data: await makeWebP(200, 200), width: 200, height: 200 },
      { id: 'c', data: await makeWebP(400, 200), width: 400, height: 200 },
    ];

    const result = await packSprites(sprites, { maxSize: 2048, padding: 1 });
    expect(result.atlases).toHaveLength(1);
    expect(result.atlases[0]!.frames).toHaveProperty('a');
    expect(result.atlases[0]!.frames).toHaveProperty('b');
    expect(result.atlases[0]!.frames).toHaveProperty('c');
  });

  it('produces valid PixiJS atlas JSON', async () => {
    const sprites: SpriteInput[] = [
      { id: 'test', data: await makeWebP(100, 100), width: 100, height: 100 },
    ];

    const result = await packSprites(sprites, { maxSize: 2048, padding: 1 });
    const atlas = result.atlases[0]!;
    expect(atlas.frames.test).toMatchObject({
      frame: { x: expect.any(Number), y: expect.any(Number), w: 100, h: 100 },
      rotated: false,
      trimmed: false,
      sourceSize: { w: 100, h: 100 },
    });
    expect(atlas.meta.format).toBe('RGBA8888');
  });

  it('produces atlas image as WebP buffer', async () => {
    const sprites: SpriteInput[] = [
      { id: 'x', data: await makeWebP(200, 200), width: 200, height: 200 },
    ];
    const result = await packSprites(sprites, { maxSize: 2048, padding: 1 });
    const meta = await sharp(result.atlases[0]!.imageData).metadata();
    expect(meta.format).toBe('webp');
  });

  it('splits into multiple atlases when exceeding max size', async () => {
    // 4 sprites of 1024x1024 won't fit in 2048x2048 (accounting for padding)
    const sprites: SpriteInput[] = [];
    for (let i = 0; i < 5; i++) {
      sprites.push({ id: `big-${i}`, data: await makeWebP(1024, 1024), width: 1024, height: 1024 });
    }

    const result = await packSprites(sprites, { maxSize: 2048, padding: 1 });
    expect(result.atlases.length).toBeGreaterThan(1);
  });
});
