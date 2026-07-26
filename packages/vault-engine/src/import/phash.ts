import sharp from 'sharp';

/**
 * Simplified perceptual hash. Produces a 64-bit hash as a 16-char hex string.
 *
 * 1. Resize to 32×32, extract RGBA for transparency detection
 * 2. Convert to greyscale; for images with >50% transparency, replace
 *    transparent pixels with a checkerboard to avoid degenerate near-zero hashes
 * 3. Compute mean of all pixels
 * 4. Top-left 8×8 region: pixel > mean → 1 bit, else 0 bit → 64 bits
 *
 * Hamming distance ≤5 = likely duplicate, 6–8 = similar.
 */
export async function computePhash(imageData: Buffer): Promise<string> {
  const size = 32 * 32;

  // Get RGBA to detect transparency
  const { data: rgba } = await sharp(imageData)
    .resize(32, 32, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Get greyscale data (preserves original pipeline behavior for opaque images)
  const { data: greyRaw } = await sharp(imageData)
    .resize(32, 32, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const grey = new Uint8Array(size);
  let transparentCount = 0;

  for (let i = 0; i < size; i++) {
    grey[i] = greyRaw[i]!;
    if (rgba[i * 4 + 3]! < 128) transparentCount++;
  }

  // If >50% transparent, replace transparent pixels with checkerboard
  // to prevent false-positive duplicates among transparent-bg sprites
  if (transparentCount > size * 0.5) {
    for (let i = 0; i < size; i++) {
      if (rgba[i * 4 + 3]! < 128) {
        const x = i % 32;
        const y = Math.floor(i / 32);
        grey[i] = (x + y) % 2 === 0 ? 200 : 55;
      }
    }
  }

  // Compute mean
  let sum = 0;
  for (let i = 0; i < size; i++) {
    sum += grey[i]!;
  }
  const mean = sum / size;

  // Build 64-bit hash from top-left 8×8 region
  let hash = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const idx = y * 32 + x;
      if (grey[idx]! > mean) {
        hash |= 1n << BigInt(y * 8 + x);
      }
    }
  }

  return hash.toString(16).padStart(16, '0');
}

/** Hamming distance between two 16-char hex hash strings. */
export function hammingDistance(a: string, b: string): number {
  const av = BigInt('0x' + a);
  const bv = BigInt('0x' + b);
  let xor = av ^ bv;
  let count = 0;
  while (xor > 0n) {
    count += Number(xor & 1n);
    xor >>= 1n;
  }
  return count;
}
