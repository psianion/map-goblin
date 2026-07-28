import sharp from 'sharp';

export interface QualityOptions {
  expectedWidth: number;
  expectedHeight: number;
}

export interface QualityResult {
  passed: boolean;
  reason?: string;
}

export async function checkQuality(
  imageData: Buffer,
  opts: QualityOptions,
): Promise<QualityResult> {
  const { expectedWidth, expectedHeight } = opts;

  const meta = await sharp(imageData).metadata();
  const width = meta.width!;
  const height = meta.height!;

  if (width !== expectedWidth || height !== expectedHeight) {
    return {
      passed: false,
      reason: `Dimension mismatch: got ${width}x${height}, expected ${expectedWidth}x${expectedHeight}`,
    };
  }

  const { data } = await sharp(imageData)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let gapCount = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] === 0) gapCount++;
  }

  const totalPixels = width * height;
  const gapRatio = gapCount / totalPixels;
  if (gapRatio > 0.01) {
    return {
      passed: false,
      reason: `Transparent gap detected: ${(gapRatio * 100).toFixed(1)}% of pixels are fully transparent`,
    };
  }

  return { passed: true };
}
