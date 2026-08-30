// The paint, read off the splat bitmaps. What matters here is the pair of claims the fog's
// clip rests on: a cell with paint in it is ground, and a cell without is not — the second
// being the one the bounding box it replaced could never make.

import { describe, expect, it, vi } from 'vitest';
import { TERRAIN_EXTENT_HALF } from '@dnd/core/src/engine/terrain/terrainShared';
import {
  PAINT_GRID,
  boundsRect,
  decodePaintedArea,
  markPainted,
  paintedPolygons,
} from './paintedArea';

/** A small splat over the same 128-cell world the real 2048 one covers: 2 texels per cell. */
const SIZE = PAINT_GRID * 2;
const TEXELS = SIZE / PAINT_GRID;
const HALF = TERRAIN_EXTENT_HALF;
const BOUNDS = { minX: -HALF, minY: -HALF, maxX: HALF, maxY: HALF };

/** RGBA weights, `paint` deciding the red channel per texel. */
function splat(paint: (tx: number, ty: number) => number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let ty = 0; ty < SIZE; ty++) {
    for (let tx = 0; tx < SIZE; tx++) {
      pixels[(ty * SIZE + tx) * 4] = paint(tx, ty);
      pixels[(ty * SIZE + tx) * 4 + 3] = 255; // every stamp writes alpha, weights or not
    }
  }
  return pixels;
}

const cells = (): Uint8Array => new Uint8Array(PAINT_GRID * PAINT_GRID);
/** Grid coordinates, 0…127 — `paintedPolygons` is what puts them back in the world. */
const at = (grid: Uint8Array, cx: number, cy: number): number => grid[cy * PAINT_GRID + cx];
const set = (grid: Uint8Array, cx: number, cy: number): void => {
  grid[cy * PAINT_GRID + cx] = 1;
};
const painted = (grid: Uint8Array): number => grid.reduce((n, v) => n + v, 0);

describe('markPainted', () => {
  it('marks the cell a painted texel falls in, and only that one', () => {
    const one = splat((tx, ty) => (tx === TEXELS * 3 && ty === TEXELS * 5 ? 255 : 0));
    const grid = markPainted(cells(), one, BOUNDS, SIZE);
    expect(at(grid, 3, 5)).toBe(1);
    expect(at(grid, 2, 5)).toBe(0);
    expect(at(grid, 3, 4)).toBe(0);
    expect(painted(grid)).toBe(1);
  });

  it('ignores what the shader ignores', () => {
    // `splatBounds`' own cutoff: alpha alone is not paint — every stamp writes it — and an RGB
    // sum under 1 is the blank the terrain renderer draws nothing for.
    expect(painted(markPainted(cells(), splat(() => 0), BOUNDS, SIZE))).toBe(0);
  });

  it('accumulates the second weight map over the first', () => {
    const grid = cells();
    markPainted(grid, splat((tx, ty) => (tx < TEXELS && ty < TEXELS ? 255 : 0)), BOUNDS, SIZE);
    markPainted(grid, splat((tx, ty) => (tx >= TEXELS * 3 && tx < TEXELS * 4 && ty < TEXELS ? 255 : 0)), BOUNDS, SIZE);
    expect(at(grid, 0, 0)).toBe(1);
    expect(at(grid, 3, 0)).toBe(1);
    expect(at(grid, 2, 0)).toBe(0);
  });

  it('scans only inside the authored bounds', () => {
    // The box is useless as a clip and perfectly good as a bound: paint cannot exist outside
    // the bounds the editor wrote, so the scan does not pay for the rest of the bitmap.
    const everywhere = splat(() => 255);
    const grid = markPainted(cells(), everywhere, { minX: -HALF, minY: -HALF, maxX: -HALF + 2, maxY: -HALF + 3 }, SIZE);
    expect(painted(grid)).toBe(6);
    expect(at(grid, 1, 2)).toBe(1);
    expect(at(grid, 2, 0)).toBe(0);
  });
});

describe('paintedPolygons', () => {
  it('merges a block into one rectangle, in world coordinates', () => {
    const grid = cells();
    for (let cy = 0; cy < 3; cy++) for (let cx = 0; cx < 2; cx++) set(grid, cx, cy);
    expect(paintedPolygons(grid)).toEqual([
      [
        [-HALF, -HALF],
        [-HALF + 2, -HALF],
        [-HALF + 2, -HALF + 3],
        [-HALF, -HALF + 3],
      ],
    ]);
  });

  it('keeps two strips apart, which is the whole point of reading the paint', () => {
    const grid = cells();
    for (let cy = 0; cy < 2; cy++) {
      set(grid, 10, cy);
      set(grid, 20, cy);
    }
    const rects = paintedPolygons(grid);
    expect(rects).toHaveLength(2);
    expect(rects.map((r) => r[0][0]).sort((a, b) => a - b)).toEqual([-HALF + 10, -HALF + 20]);
  });

  it('closes a run the row below narrows', () => {
    const grid = cells();
    set(grid, 0, 0);
    set(grid, 1, 0);
    set(grid, 0, 1);
    // Two rectangles, not one: the 2-wide run ends where the 1-wide one starts.
    expect(paintedPolygons(grid)).toHaveLength(2);
  });

  it('is nothing at all for a blank grid', () => {
    expect(paintedPolygons(cells())).toEqual([]);
  });
});

describe('decodePaintedArea', () => {
  const blob = new Blob(['png'], { type: 'image/png' });

  it('is nothing at all with no splats or no bounds', async () => {
    await expect(decodePaintedArea([null, null, null], { bounds: BOUNDS })).resolves.toEqual([]);
    await expect(decodePaintedArea([blob, null, null], { bounds: null })).resolves.toEqual([]);
    await expect(decodePaintedArea([blob, null, null], undefined)).resolves.toEqual([]);
  });

  it('ignores the tint map — tint rides on paint and is not ground of its own', async () => {
    await expect(decodePaintedArea([null, null, blob], { bounds: BOUNDS })).resolves.toEqual([]);
  });

  it('falls back to the authored bounds when the paint cannot be read', async () => {
    // jsdom has no `createImageBitmap`. A browser that cannot decode would otherwise put every
    // painted path under solid black and strand a party standing on one, so this degrades to
    // what shipped before — leakier, but not a map the party cannot walk.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(decodePaintedArea([blob, null, null], { bounds: BOUNDS })).resolves.toEqual([
      boundsRect(BOUNDS),
    ]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
