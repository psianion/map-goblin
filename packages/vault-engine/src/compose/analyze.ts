import sharp from 'sharp';

const ALPHA_THRESHOLD = 10;
const EDGE_STRIP_PX = 4;
const RMSE_THRESHOLD = 12;

export interface SpriteAnalysis {
  width: number;
  height: number;
  contentBounds: { x: number; y: number; w: number; h: number };
}

export interface TileableResult {
  leftRight: boolean;
  topBottom: boolean;
}

export async function analyzeSprite(
  imageData: Buffer,
): Promise<SpriteAnalysis> {
  const meta = await sharp(imageData).metadata();
  const width = meta.width!;
  const height = meta.height!;

  try {
    const { data: raw } = await sharp(imageData)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    let minX = width,
      minY = height,
      maxX = 0,
      maxY = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const alpha = raw[(y * width + x) * 4 + 3]!;
        if (alpha >= ALPHA_THRESHOLD) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX < minX) {
      return {
        width,
        height,
        contentBounds: { x: 0, y: 0, w: width, h: height },
      };
    }

    return {
      width,
      height,
      contentBounds: {
        x: minX,
        y: minY,
        w: maxX - minX + 1,
        h: maxY - minY + 1,
      },
    };
  } catch {
    return {
      width,
      height,
      contentBounds: { x: 0, y: 0, w: width, h: height },
    };
  }
}

async function extractEdgeStrip(
  imageData: Buffer,
  edge: 'left' | 'right' | 'top' | 'bottom',
  width: number,
  height: number,
): Promise<Buffer> {
  // Clamp so images smaller than the strip never produce a negative offset,
  // which sharp's extract() rejects.
  const sw = Math.min(EDGE_STRIP_PX, width);
  const sh = Math.min(EDGE_STRIP_PX, height);

  const regions: Record<
    string,
    { left: number; top: number; width: number; height: number }
  > = {
    left: { left: 0, top: 0, width: sw, height },
    right: { left: width - sw, top: 0, width: sw, height },
    top: { left: 0, top: 0, width, height: sh },
    bottom: { left: 0, top: height - sh, width, height: sh },
  };

  return sharp(imageData)
    .extract(regions[edge]!)
    .ensureAlpha()
    .raw()
    .toBuffer();
}

function computeRMSE(a: Buffer, b: Buffer): number {
  if (a.length !== b.length) return 255;
  let sumSq = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i]! - b[i]!;
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq / a.length);
}

export async function computeTileableEdges(
  imageA: Buffer,
  imageB: Buffer,
): Promise<TileableResult> {
  const metaA = await sharp(imageA).metadata();
  const metaB = await sharp(imageB).metadata();

  const wA = metaA.width!,
    hA = metaA.height!;
  const wB = metaB.width!,
    hB = metaB.height!;

  let leftRight = false;
  let topBottom = false;

  if (hA === hB) {
    const rightA = await extractEdgeStrip(imageA, 'right', wA, hA);
    const leftB = await extractEdgeStrip(imageB, 'left', wB, hB);
    leftRight = computeRMSE(rightA, leftB) < RMSE_THRESHOLD;
  }

  if (wA === wB) {
    const bottomA = await extractEdgeStrip(imageA, 'bottom', wA, hA);
    const topB = await extractEdgeStrip(imageB, 'top', wB, hB);
    topBottom = computeRMSE(bottomA, topB) < RMSE_THRESHOLD;
  }

  return { leftRight, topBottom };
}
