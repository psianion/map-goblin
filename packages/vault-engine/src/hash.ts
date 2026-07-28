import { createHash } from 'node:crypto';

/**
 * MurmurHash3 32-bit finalizer used as a 2-input combiner.
 * Deterministic randomization for wall segments, floor cells.
 */
export function hashCombine(a: number, b: number): number {
  let h = (a * 0xcc9e2d51) | 0;
  h = (h << 15) | (h >>> 17);
  h = (h * 0x1b873593) | 0;
  h ^= b;
  h = (h << 13) | (h >>> 19);
  h = ((h * 5) + 0xe6546b64) | 0;
  h ^= h >>> 16;
  h = (h * 0x85ebca6b) | 0;
  h ^= h >>> 13;
  h = (h * 0xc2b2ae35) | 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Full SHA-256 hex digest of a buffer. */
export function sha256File(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Truncated 8-char content hash for cache-busting filenames. */
export function contentHash(data: Buffer): string {
  return sha256File(data).slice(0, 8);
}
