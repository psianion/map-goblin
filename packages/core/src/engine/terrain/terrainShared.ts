/**
 * Terrain constants and pure splat-pixel operations shared between the main
 * thread (TerrainRenderer) and the splat worker. This module must stay free
 * of pixi.js and DOM imports — the worker bundles it.
 */

/** Half-extent of the paintable terrain region in world units (grid cells). */
export const TERRAIN_EXTENT_HALF = 64;
/** Splatmap resolution — 2048 texels over 128 cells = 16 texels/cell. */
export const SPLAT_SIZE = 2048;
/** Number of paintable terrain slots (2 weight splatmaps × RGB channels). */
export const TERRAIN_SLOTS = 6;
/**
 * Splatmap layout: maps 0 and 1 hold per-slot paint weights in their RGB
 * channels; map 2 is the brush-tint layer — premultiplied colour in RGB,
 * coverage in alpha. A map saved before the tint layer existed simply has no
 * third bitmap and renders untinted.
 */
export const SPLAT_MAP_INDICES = [0, 1, 2] as const;
export type SplatMapIndex = (typeof SPLAT_MAP_INDICES)[number];
/** The tint layer's index in every splat array. */
export const TINT_MAP_INDEX = 2 as const;
/** customImages keys the splat bitmaps persist under in .mapbuilder files. */
export const SPLAT_IMAGE_KEYS = [
  '__terrain-splat-0__',
  '__terrain-splat-1__',
  '__terrain-splat-tint__',
] as const;
/** The splat bitmaps as they ride the store — one optional PNG blob per map. */
export type SplatPngs = [Blob | null, Blob | null, Blob | null];

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

// ─── A stroke, as one composite over the pre-stroke splats ───────────────

/** The colour each slot's weight is written in, within its map: red, green, blue. */
export const CHANNEL_TINTS = [0xff0000, 0x00ff00, 0x0000ff] as const;

/**
 * One draw of the stroke's coverage mask onto a splat map, over that map's pre-stroke copy.
 * Blends are premultiplied, as on the GPU: `normal` is src + dst × (1 − srcA), `add` is
 * src + dst, `erase` is dst × (1 − srcA); src is `tint` × coverage × `alpha`.
 */
export interface StrokePass {
  map: SplatMapIndex;
  blend: 'normal' | 'add' | 'erase';
  tint: number;
  alpha: number;
}

/**
 * The passes a stroke lays over the splats it started from, through its coverage mask.
 * The mask holds the paint the stroke has added so far (see `accumulate`), so the splats
 * are re-laid from their pre-stroke copy as a lerp towards the slot by that amount. The
 * composite is idempotent: paint builds only as the mask does, never by re-laying.
 *
 * Painting lerps the slot's channel towards 1 and every other channel towards 0; erase
 * lerps every channel, and the brush tint, towards 0 (back to the floor's own texture).
 */
export function strokePasses(slot: number, erase: boolean): StrokePass[] {
  const decay = (map: SplatMapIndex): StrokePass => ({ map, blend: 'normal', tint: 0x000000, alpha: 1 });
  if (erase) return [decay(0), decay(1), { map: TINT_MAP_INDEX, blend: 'erase', tint: 0xffffff, alpha: 1 }];
  const target = (Math.floor(slot / 3) === 0 ? 0 : 1) as SplatMapIndex;
  return [decay(0), decay(1), { map: target, blend: 'add', tint: CHANNEL_TINTS[slot % 3], alpha: 1 }];
}

// ─── Holding the brush adds paint over time ───────────────────────────────

/**
 * The paint a held brush has laid at a texel: intensity is a rate per second, so a still
 * pointer keeps adding and the frame rate never changes how much. It never passes full;
 * erase is the same rate taken away, down to nothing.
 */
export function accumulate(amount: number, intensity: number, seconds: number, erase = false): number {
  const step = Math.max(0, intensity) * Math.max(0, seconds);
  return Math.min(1, Math.max(0, erase ? amount - step : amount + step));
}

/**
 * The least one deposit lays. The coverage mask is eight bits a channel, so a sliver of
 * paint (a slow brush on a fast display) would round away: a still brush waits until it
 * has this much to lay, and a moving one lays at least this much a stamp.
 */
export const MIN_DEPOSIT = 1 / 64;

/**
 * What one tick of a held brush lays: `pending` paint carried from earlier ticks plus
 * intensity × seconds, shared between the `stamps` the pointer crossed since the last
 * tick. With none the pointer is still and the brush stamps where it is, carrying the
 * paint on while it is under MIN_DEPOSIT.
 *
 * A `solid` brush lays full paint at every stamp, whatever the intensity and the time, so
 * one pass is the whole stroke at any speed.
 */
export function depositForTick(
  pending: number,
  intensity: number,
  seconds: number,
  stamps: number,
  solid = false,
): { each: number; count: number; pending: number } {
  if (solid) return { each: 1, count: Math.max(1, stamps), pending: 0 };
  const total = pending + accumulate(0, intensity, seconds);
  if (stamps > 0) return { each: Math.max(MIN_DEPOSIT, total / stamps), count: stamps, pending: 0 };
  if (total < MIN_DEPOSIT) return { each: 0, count: 0, pending: total };
  return { each: total, count: 1, pending: 0 };
}

// ─── Fill enclosed floor ──────────────────────────────────────────────────

type Ring = [number, number][];

function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(a / 2);
}

/**
 * The floor a Fill floods from a point: of a layer's floor union (outer rings and holes
 * alike), the innermost ring around the point and the holes directly inside it; null when
 * the point is on no floor (outside every ring, or in a hole). The fill stops at the
 * floor's own edge, so an island standing in one of its holes is left alone.
 */
export function floorRegionAt(rings: readonly Ring[], x: number, y: number): { outer: Ring; holes: Ring[] } | null {
  const around = rings.filter((r) => r.length >= 3 && inRing(x, y, r));
  // Even-odd: an even count of rings around the point puts it in a hole or outside.
  if (around.length % 2 === 0) return null;
  const outer = around.reduce((a, b) => (ringArea(b) < ringArea(a) ? b : a));
  const area = ringArea(outer);
  const inside = rings.filter((r) => r !== outer && r.length >= 3 && ringArea(r) < area && inRing(r[0][0], r[0][1], outer));
  // Only the rings one level down are its holes; one inside another of them is an island.
  const holes = inside.filter((r) => !inside.some((o) => o !== r && ringArea(o) > ringArea(r) && inRing(r[0][0], r[0][1], o)));
  return { outer, holes };
}

/** One texel of the three splat maps, each RGBA in 0 to 1. */
export type SplatTexel = [number, number, number, number][];

/**
 * What the GPU composite writes for one texel: `passes` over its pre-stroke value, at the
 * stroke's coverage there (0 to 1). The renderer draws exactly these passes; this is the
 * same arithmetic on the CPU, for tests.
 */
export function compositeTexel(before: SplatTexel, passes: readonly StrokePass[], coverage: number): SplatTexel {
  const out = before.map((px) => [...px] as [number, number, number, number]);
  for (const p of passes) {
    const a = p.alpha * coverage;
    const src = [(p.tint >> 16) & 0xff, (p.tint >> 8) & 0xff, p.tint & 0xff].map((c) => (c / 255) * a);
    const px = out[p.map];
    for (let i = 0; i < 4; i++) {
      const s = i < 3 ? src[i] : a;
      if (p.blend === 'normal') px[i] = s + px[i] * (1 - a);
      else if (p.blend === 'add') px[i] = Math.min(1, s + px[i]);
      else px[i] = px[i] * (1 - a);
    }
  }
  return out;
}
