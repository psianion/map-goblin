import sharp from 'sharp';

export interface CornerOptions {
  angleDeg: 90 | 120 | 135;
  outputSize: number;
}

export async function composeCorner(
  straightPiece: Buffer,
  opts: CornerOptions,
): Promise<Buffer> {
  const { angleDeg, outputSize } = opts;
  const halfAngle = angleDeg / 2;

  const resized = await sharp(straightPiece)
    .resize(outputSize, outputSize, { fit: 'fill' })
    .toBuffer();

  const strip1 = await sharp(resized)
    .rotate(-halfAngle, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize(outputSize, outputSize, { fit: 'cover' })
    .toBuffer();

  const strip2 = await sharp(resized)
    .rotate(halfAngle, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize(outputSize, outputSize, { fit: 'cover' })
    .toBuffer();

  return sharp({
    create: {
      width: outputSize,
      height: outputSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: strip1, blend: 'over' },
      { input: strip2, blend: 'over' },
    ])
    .webp({ quality: 90 })
    .toBuffer();
}
