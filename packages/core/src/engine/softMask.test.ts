// A soft piece's mask as the shader reads it (softMask.ts): a ramp with no steps at any
// width, nothing outside, fades eased across their feather and multiplied.
import { describe, expect, it } from 'vitest';
import type { Polygon } from '../types/geometry';
import type { PieceFade } from '../store/types';
import { maskGridFor, movedBy, softMaskPixels, type MaskGrid } from './softMask';

const RES = 16;
const rect = (x0: number, y0: number, x1: number, y1: number): Polygon => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const disc = (cx: number, cy: number, r: number, n = 128): Polygon =>
  Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)] as [number, number]);
const gridOf = (outline: Polygon[]): MaskGrid => maskGridFor(outline, 0.25, RES, 1024)!;

/** The channel (0 edge, 1 fades) of the texel holding (x, y). */
function at(px: Uint8Array, grid: MaskGrid, x: number, y: number, ch: 0 | 1): number {
  const i = Math.floor((x - grid.x) * grid.res);
  const j = Math.floor((y - grid.y) * grid.res);
  return px[(j * grid.width + i) * 4 + ch];
}

/** One row of a channel, left to right. */
function row(px: Uint8Array, grid: MaskGrid, y: number, ch: 0 | 1): number[] {
  const j = Math.floor((y - grid.y) * grid.res);
  return Array.from({ length: grid.width }, (_, i) => px[(j * grid.width + i) * 4 + ch]);
}

describe('the edge', () => {
  it('rises across a wide soft edge one texel at a time, with no flat bands', () => {
    const outline = [rect(0.3, 0.3, 20.3, 20.3)];
    const grid = gridOf(outline);
    const soft = 3;
    const values = row(softMaskPixels(outline, soft, [], grid), grid, 10.3, 0);
    // From the left outline in to past the soft edge.
    const first = values.findIndex((v) => v > 0);
    const rimX = grid.x + (first + 0.5) / grid.res;
    expect(rimX - 0.3).toBeGreaterThanOrEqual(0);
    expect(rimX - 0.3).toBeLessThan(1 / grid.res);
    const ramp = values.slice(first, first + Math.ceil((soft + 1) * grid.res));
    expect(ramp.at(-1)).toBe(255);
    const slope = 255 / (soft * grid.res);
    const maxRun = Math.max(1, Math.ceil(1 / slope));
    let run = 1;
    for (let i = 1; i < ramp.length; i++) {
      const step = ramp[i] - ramp[i - 1];
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step).toBeLessThanOrEqual(Math.ceil(slope) + 1);
      run = step === 0 && ramp[i] < 255 ? run + 1 : 1;
      expect(run).toBeLessThanOrEqual(maxRun);
    }
  });

  it('is nothing outside, full at and past soft inside, nothing in a hole, full inside with no soft', () => {
    const outline = [rect(0, 0, 20, 20), rect(8, 8, 12, 12).reverse()];
    const grid = gridOf(outline);
    const px = softMaskPixels(outline, 1, [], grid);
    expect(at(px, grid, -0.1, 5, 0)).toBe(0);
    expect(at(px, grid, -0.2, -0.2, 0)).toBe(0);
    expect(at(px, grid, 0.05, 5, 0)).toBeGreaterThan(0);
    expect(at(px, grid, 0.05, 5, 0)).toBeLessThan(20);
    expect(at(px, grid, 1.1, 5, 0)).toBe(255);
    expect(at(px, grid, 4, 4, 0)).toBe(255);
    expect(at(px, grid, 10, 10, 0)).toBe(0);
    expect(at(px, grid, 8.02, 10, 0)).toBe(0);
    expect(at(px, grid, 7.95, 10, 0)).toBeLessThan(20);
    const crisp = softMaskPixels(outline, 0, [], grid);
    expect(at(crisp, grid, 4, 4, 0)).toBe(255);
    expect(at(crisp, grid, 0.02, 5, 0)).toBe(255);
    // No fades: the fades' channel is full.
    expect(at(px, grid, 4, 4, 1)).toBe(255);
  });
});

describe('the fades', () => {
  const outline = [rect(0, 0, 20, 20)];
  const grid = gridOf(outline);
  const fade: PieceFade = { rings: [disc(10, 10, 3)], feather: 1, depth: 0.8, within: [rect(0, 0, 10, 20)] };

  it('take nothing at their outline, the depth in their core, eased between, nothing outside within', () => {
    const px = softMaskPixels(outline, 0, [fade], grid);
    expect(at(px, grid, 7.02, 10, 1)).toBeGreaterThanOrEqual(250);
    expect(at(px, grid, 8.5, 10, 1)).toBe(51);
    expect(at(px, grid, 7.5, 10, 1)).toBeGreaterThan(125);
    expect(at(px, grid, 7.5, 10, 1)).toBeLessThan(175);
    expect(at(px, grid, 12, 10, 1)).toBe(255);
    expect(at(px, grid, 2, 10, 1)).toBe(255);
    // Falling steadily from rim to core, gently at both ends: no crease.
    const values = row(px, grid, 10.03, 1);
    const rim = values.findIndex((v) => v < 255);
    const across = values.slice(rim, rim + grid.res + 1);
    for (let i = 1; i < across.length; i++) expect(across[i]).toBeLessThanOrEqual(across[i - 1]);
    const steps = across.slice(1).map((v, i) => across[i] - v);
    const mid = steps[Math.floor(steps.length / 2)];
    expect(steps[0]).toBeLessThan(mid);
    expect(steps.at(-1)!).toBeLessThan(mid);
    // The edge channel is the piece's own: full, the fades only in green.
    expect(at(px, grid, 8.5, 10, 0)).toBe(255);
  });

  it('multiply, and with no feather are a hard patch', () => {
    const hard: PieceFade = { rings: [disc(10, 10, 3)], feather: 0, depth: 0.5 };
    const one = softMaskPixels(outline, 0, [hard], grid);
    expect(at(one, grid, 10, 10, 1)).toBe(128);
    expect(at(one, grid, 7.03, 10, 1)).toBe(128);
    expect(at(one, grid, 6.97, 10, 1)).toBe(255);
    const two = softMaskPixels(outline, 0, [hard, hard], grid);
    expect(at(two, grid, 10, 10, 1)).toBe(64);
  });

  it('rebuilds a 20 by 20 cell piece with five fades well inside a frame', () => {
    const big = [rect(0, 0, 20, 20)];
    const g = maskGridFor(big, 0.25, 16, 1024)!;
    const fades: PieceFade[] = [2, 6, 10, 14, 18].map((c) => ({ rings: [disc(c, c, 3)], feather: 1.5, depth: 0.7, within: [rect(c - 3, c - 3, c + 3, c)] }));
    let best = Infinity;
    for (let n = 0; n < 5; n++) {
      const t0 = performance.now();
      softMaskPixels(big, 2, fades, g);
      best = Math.min(best, performance.now() - t0);
    }
    expect(best).toBeLessThan(100);
  });
});

describe('a moved piece', () => {
  const outline = [rect(0, 0, 4, 4)];
  const fades: PieceFade[] = [{ rings: [rect(1, 1, 3, 3)], feather: 0.5, within: [rect(0, 0, 2, 4)] }];
  const shift = (r: Polygon): Polygon => r.map(([x, y]) => [x + 1.5, y - 2] as [number, number]);

  it('reads as a move when its outline and fades all shifted alike', () => {
    const moved = { outline: outline.map(shift), fades: fades.map((f) => ({ ...f, rings: f.rings.map(shift), within: f.within!.map(shift) })) };
    expect(movedBy({ outline, fades }, moved)).toEqual([1.5, -2]);
  });

  it('is not a move when its fades stayed, changed or its outline turned', () => {
    expect(movedBy({ outline, fades }, { outline: outline.map(shift), fades })).toBeNull();
    expect(movedBy({ outline, fades }, { outline, fades: [{ ...fades[0], feather: 1 }] })).toBeNull();
    expect(movedBy({ outline, fades }, { outline: [[[0, 0], [4, 0], [4, 4.5], [0, 4]]], fades })).toBeNull();
  });
});
