import sharp from 'sharp';

export interface LayoutSprite {
  id: string;
  data: Buffer;
  width: number;
  height: number;
}

export interface LayoutOptions {
  targetWidth: number;
  targetHeight: number;
  seamBlendPx?: number;
}

export async function composeStraight(
  sprites: LayoutSprite[],
  opts: LayoutOptions,
): Promise<Buffer> {
  const { targetWidth, targetHeight } = opts;

  const sorted = [...sprites].sort((a, b) => b.width - a.width);

  const composites: sharp.OverlayOptions[] = [];
  let x = 0;
  let idx = 0;

  while (x < targetWidth) {
    const sprite = sorted[idx % sorted.length]!;

    const resized = await sharp(sprite.data)
      .resize({ width: sprite.width, height: targetHeight, fit: 'fill' })
      .ensureAlpha()
      .raw()
      .toBuffer();

    composites.push({
      input: resized,
      raw: { width: sprite.width, height: targetHeight, channels: 4 },
      left: x,
      top: 0,
    });

    x += sprite.width;
    idx++;
  }

  return sharp({
    create: {
      width: Math.max(targetWidth, x),
      height: targetHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .extract({ left: 0, top: 0, width: targetWidth, height: targetHeight })
    .webp({ quality: 90 })
    .toBuffer();
}
