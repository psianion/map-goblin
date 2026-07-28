// packages/engine/src/build/preview.ts
import sharp from 'sharp';

const PREVIEW_SIZE = 512;

/** Generate a 512x512 composite preview thumbnail from representative images. */
export async function generatePreview(images: Buffer[]): Promise<Buffer> {
  const count = Math.min(images.length, 16);
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const cellW = Math.floor(PREVIEW_SIZE / cols);
  const cellH = Math.floor(PREVIEW_SIZE / rows);

  const composites: sharp.OverlayOptions[] = [];

  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const resized = await sharp(images[i])
      .resize(cellW, cellH, { fit: 'cover' })
      .toBuffer();

    composites.push({
      input: resized,
      left: col * cellW,
      top: row * cellH,
    });
  }

  return sharp({
    create: {
      width: PREVIEW_SIZE,
      height: PREVIEW_SIZE,
      channels: 4,
      background: { r: 30, g: 30, b: 30, alpha: 1 },
    },
  })
    .composite(composites)
    .webp({ quality: 85 })
    .toBuffer();
}
