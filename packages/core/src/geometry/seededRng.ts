// src/geometry/seededRng.ts

/**
 * Mulberry32 — fast 32-bit seeded PRNG.
 * Returns a function that produces values in [0, 1) on each call.
 */
export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hash a 2D grid position into a single integer seed.
 * Quantizes world coords to grid cells for stable preview.
 */
export function hashPosition(qx: number, qy: number): number {
  // Simple hash combining two integers
  let h = 0x9e3779b9;
  h ^= (qx * 0x45d9f3b) | 0;
  h = ((h << 16) | (h >>> 16)) ^ ((qy * 0x119de1f3) | 0);
  h = Math.imul(h, 0x45d9f3b);
  h = (h ^ (h >>> 16)) | 0;
  return h;
}
