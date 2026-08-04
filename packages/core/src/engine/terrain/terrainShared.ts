/**
 * Terrain constants and pure splat-pixel operations shared between the main
 * thread (TerrainRenderer) and the splat worker. This module must stay free
 * of pixi.js and DOM imports — the worker bundles it.
 */

/** Half-extent of the paintable terrain region in world units (grid cells). */
export const TERRAIN_EXTENT_HALF = 64;
/** Splatmap resolution — 2048 texels over 128 cells = 16 texels/cell. */
export const SPLAT_SIZE = 2048;
/** Number of paintable terrain slots (2 splatmaps × RGB channels). */
export const TERRAIN_SLOTS = 6;
/** customImages keys the splat bitmaps persist under in .mapbuilder files. */
export const SPLAT_IMAGE_KEYS = ['__terrain-splat-0__', '__terrain-splat-1__'] as const;

export const WORLD_SIZE = TERRAIN_EXTENT_HALF * 2;
export const TEXELS_PER_CELL = SPLAT_SIZE / WORLD_SIZE;

export interface SplatRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TerrainBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Copy an RGBA region's rows into the full-size splat buffer. */
export function applySplatPatch(
  splat: Uint8Array,
  rect: SplatRect,
  pixels: Uint8Array,
  size: number = SPLAT_SIZE,
): void {
  for (let row = 0; row < rect.height; row++) {
    const src = row * rect.width * 4;
    const dst = ((rect.y + row) * size + rect.x) * 4;
    splat.set(pixels.subarray(src, src + rect.width * 4), dst);
  }
}

/**
 * Non-empty AABB of a splat buffer, in world units, or null if it's blank.
 * Matches the shader's `rgb sum < 0.004` cutoff so bounds track what's drawn.
 */
export function splatBounds(pixels: Uint8Array, size: number = SPLAT_SIZE): TerrainBounds | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
    if (pixels[i] + pixels[i + 1] + pixels[i + 2] < 1) continue;
    const x = p % size;
    const y = (p / size) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!isFinite(minX)) return null;
  const toWorld = (t: number) => t / TEXELS_PER_CELL - TERRAIN_EXTENT_HALF;
  return {
    minX: toWorld(minX),
    minY: toWorld(minY),
    maxX: toWorld(maxX + 1),
    maxY: toWorld(maxY + 1),
  };
}

export interface WindowBakePlan {
  width: number;
  height: number;
}

/**
 * Decide whether the crisp viewport-window bake is worth doing, and at what RT
 * size, for the current zoom and an (already extent-clamped) world-space span.
 * Null means the base bake already meets or exceeds display density — the
 * window stays inactive and nothing bakes. Shared by TerrainRenderer (GPU path,
 * untested here) and this pure math (pinned below).
 */
export function planWindowBake(
  zoomPxPerCell: number,
  baseTexelsPerCell: number,
  maxTexelsPerCell: number,
  maxRtDim: number,
  worldWidth: number,
  worldHeight: number,
): WindowBakePlan | null {
  if (zoomPxPerCell <= baseTexelsPerCell || worldWidth <= 0 || worldHeight <= 0) return null;
  const density = Math.min(zoomPxPerCell, maxTexelsPerCell);
  return {
    width: Math.min(maxRtDim, Math.max(1, Math.ceil(worldWidth * density))),
    height: Math.min(maxRtDim, Math.max(1, Math.ceil(worldHeight * density))),
  };
}

/** Union of two optional bounds. */
export function unionBounds(a: TerrainBounds | null, b: TerrainBounds | null): TerrainBounds | null {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/**
 * RGB-only equality: the shader reads .rgb and ignores alpha, and every paint
 * stamp writes alpha to both splatmaps even where it changes no weights.
 * Word-compare with the alpha byte masked out (RGBA little-endian → alpha is
 * the high byte) — 4× fewer iterations than the byte loop it replaces.
 */
export function splatRegionsEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  if (a.byteOffset % 4 !== 0 || b.byteOffset % 4 !== 0) {
    // Unaligned view — Uint32Array over it would throw. Byte loop fallback.
    for (let i = 0; i < a.length; i++) {
      if (i % 4 !== 3 && a[i] !== b[i]) return false;
    }
    return true;
  }
  const wordLen = a.length >>> 2;
  const aw = new Uint32Array(a.buffer, a.byteOffset, wordLen);
  const bw = new Uint32Array(b.buffer, b.byteOffset, wordLen);
  for (let i = 0; i < wordLen; i++) {
    if (((aw[i] ^ bw[i]) & 0x00ffffff) !== 0) return false;
  }
  return true;
}
