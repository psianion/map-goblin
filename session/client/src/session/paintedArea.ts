// Where the map actually carries terrain paint, as polygons the fog's clip can use.
//
// `paintedGround` used to answer this with the splat's own bounding box, and the box is a
// statement about a rectangle rather than about paint: on the Goblin Warren it spans
// x -5.3…58.8, y 40.4…64 — 1536 cells — over 521 cells of actual paint. Everything inside it
// counted as ground the party's sight was allowed to open, so the cave mouth's fire ring
// (radius 15, and the mouth has no door) poured out through the opening and cleared a lit dome
// over bare void on every player seat. The referee's own map has nothing there at all.
//
// So: read the paint. The splat bitmaps are already in the store beside the document, and one
// decode per map load (~30ms, plus a bounds-clipped texel scan) is the whole cost — nothing
// here runs per frame, per rebuild, or per token step.

import {
  SPLAT_SIZE,
  TERRAIN_EXTENT_HALF,
  TINT_MAP_INDEX,
  WORLD_SIZE,
  type SplatPngs,
  type TerrainBounds,
} from '@dnd/core/src/engine/terrain/terrainShared';
import type { Polygon } from '@dnd/core/src/geometry/GeometryEngine';

/** The paint, one bit per world cell, over the terrain's own square extent. */
export const PAINT_GRID = WORLD_SIZE;

/** The terrain settings the decode reads — the same slice `paintedGround` gates on. */
export interface TerrainSettings {
  bounds?: TerrainBounds | null;
}

/**
 * Mark every cell that carries paint, on the shader's own cutoff (`splatBounds`: a texel
 * counts once its RGB sums past 1/255). Maps 0 and 1 hold the per-slot weights; the tint map
 * is skipped — tint rides on paint, so it can only ever repeat what the weights already said,
 * and a tint stroke is not ground.
 *
 * Scanning is clipped to the authored bounds because that box, useless as a clip, is a
 * perfectly good bound on where paint can be: everything outside it is blank by construction.
 */
export function markPainted(
  cells: Uint8Array,
  pixels: Uint8ClampedArray,
  bounds: TerrainBounds | null,
  size = SPLAT_SIZE,
): Uint8Array {
  const texels = size / PAINT_GRID;
  const clamp = (t: number): number => Math.max(0, Math.min(size, Math.round(t)));
  const toTexel = (world: number): number => (world + TERRAIN_EXTENT_HALF) * texels;
  const x0 = bounds ? clamp(toTexel(bounds.minX)) : 0;
  const x1 = bounds ? clamp(toTexel(bounds.maxX)) : size;
  const y0 = bounds ? clamp(toTexel(bounds.minY)) : 0;
  const y1 = bounds ? clamp(toTexel(bounds.maxY)) : size;

  for (let ty = y0; ty < y1; ty++) {
    const row = ty * size * 4;
    const cell = ((ty / texels) | 0) * PAINT_GRID;
    for (let tx = x0; tx < x1; tx++) {
      const i = row + tx * 4;
      if (pixels[i] + pixels[i + 1] + pixels[i + 2] < 1) continue;
      cells[cell + ((tx / texels) | 0)] = 1;
    }
  }
  return cells;
}

/**
 * The marked cells as rectangles in world coordinates — horizontal runs, merged downwards
 * while a run keeps the same span, which turns a painted band into a handful of polygons
 * rather than one per cell. Clipper unions them into `held` on the other side, and its cost
 * is vertices.
 */
export function paintedPolygons(cells: Uint8Array, size = PAINT_GRID): Polygon[] {
  const out: Polygon[] = [];
  const origin = -TERRAIN_EXTENT_HALF;
  const rect = (x0: number, x1: number, y0: number, y1: number): Polygon => [
    [origin + x0, origin + y0],
    [origin + x1, origin + y0],
    [origin + x1, origin + y1],
    [origin + x0, origin + y1],
  ];
  /** Runs still growing downwards, by their left edge. */
  let open = new Map<number, { x1: number; y0: number }>();

  for (let y = 0; y < size; y++) {
    const next = new Map<number, { x1: number; y0: number }>();
    let x = 0;
    while (x < size) {
      if (!cells[y * size + x]) {
        x++;
        continue;
      }
      const x0 = x;
      while (x < size && cells[y * size + x]) x++;
      const run = open.get(x0);
      if (run && run.x1 === x) {
        next.set(x0, run);
        open.delete(x0);
      } else next.set(x0, { x1: x, y0: y });
    }
    // Whatever the row did not continue is finished, and ends where this row starts.
    for (const [x0, run] of open) out.push(rect(x0, run.x1, run.y0, y));
    open = next;
  }
  for (const [x0, run] of open) out.push(rect(x0, run.x1, run.y0, size));
  return out;
}

/** The splat's own bounds as one rectangle — what this used to answer, and the fallback. */
export function boundsRect(bounds: TerrainBounds): Polygon {
  return [
    [bounds.minX, bounds.minY],
    [bounds.maxX, bounds.minY],
    [bounds.maxX, bounds.maxY],
    [bounds.minX, bounds.maxY],
  ];
}

/** One splat PNG's RGBA at its own resolution, or null where the platform cannot decode. */
async function splatPixels(blob: Blob): Promise<{ pixels: Uint8ClampedArray; size: number } | null> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return null;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    return {
      pixels: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data,
      size: bitmap.width,
    };
  } finally {
    bitmap.close();
  }
}

/**
 * The painted ground for a document's splats, or the authored bounding box if the paint
 * cannot be read at all.
 *
 * The fallback is deliberate and it is the *leaky* direction: a browser with no
 * `createImageBitmap` would otherwise put every painted path on the map under solid black and
 * strand the party on ground they are standing on. Degrading to the box is degrading to what
 * shipped before this file existed, which is a known quantity; the pending state before the
 * decode lands is the one that fails dark, and it lasts one map load.
 */
export async function decodePaintedArea(
  splats: SplatPngs,
  terrain: TerrainSettings | null | undefined,
): Promise<Polygon[]> {
  const bounds = terrain?.bounds ?? null;
  const maps = splats.filter((blob, index): blob is Blob => index !== TINT_MAP_INDEX && !!blob);
  if (!maps.length || !bounds) return [];
  try {
    const cells = new Uint8Array(PAINT_GRID * PAINT_GRID);
    for (const blob of maps) {
      const decoded = await splatPixels(blob);
      if (!decoded) {
        console.warn('[paintedArea] no splat decode here, falling back to the authored bounds');
        return [boundsRect(bounds)];
      }
      markPainted(cells, decoded.pixels, bounds, decoded.size);
    }
    return paintedPolygons(cells);
  } catch (err) {
    console.warn('[paintedArea] splat decode failed, falling back to the authored bounds:', err);
    return [boundsRect(bounds)];
  }
}
