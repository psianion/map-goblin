// The Material brush's patch geometry: the stroke's outline, merging and cutting patches,
// smoothing before the border goes on, and the border walk round an outline that is not a
// floor's or a wall's.

import { beforeAll, describe, expect, it } from 'vitest';
import { setClipperModule } from '../geometry/Clipper2Engine';
import { erasePatches, paintPatch, patchArea, patchOutline, patchesBounds, strokeArea, type MaterialPatch } from './materialPatch';
import { layOutlineBand } from '../engine/caveBandRenderer';
import { jointsOf } from '../assets/caveWallKit';
import type { Polygon } from '../types/geometry';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  setClipperModule(await mod.default({ wasmBinary }));
}, 30_000);

const look = { smooth: false, border: true };
const line = (x0: number, x1: number, y = 0): [number, number][] =>
  Array.from({ length: 11 }, (_, i) => [x0 + ((x1 - x0) * i) / 10, y] as [number, number]);

/** How sharply a ring turns at its sharpest vertex, in degrees. */
function sharpest(ring: Polygon): number {
  let worst = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[(i + ring.length - 1) % ring.length];
    const b = ring[i];
    const c = ring[(i + 1) % ring.length];
    const t1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const t2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let d = Math.abs(t2 - t1);
    if (d > Math.PI) d = 2 * Math.PI - d;
    worst = Math.max(worst, (d * 180) / Math.PI);
  }
  return worst;
}

describe('the stroke outline', () => {
  it('closes a stroke into one solid patch as wide as the brush, with round ends', () => {
    const area = strokeArea(line(0, 10), 1);
    expect(area).toHaveLength(1);
    // A 10 by 2 band plus a disc of radius 1 for its two round ends.
    expect(patchArea(area)).toBeCloseTo(20 + Math.PI, 0);
    expect(patchesBounds([{ id: 'p', material: 'm', rings: area, smooth: false, border: false }])).toMatchObject({ minX: -1, maxX: 11 });
  });

  it('is a disc for a single dab', () => {
    const area = strokeArea([[3, 3]], 2);
    expect(patchArea(area)).toBeCloseTo(Math.PI * 4, 0);
  });

  it('closes a stroke that loops back on itself round the hole it leaves', () => {
    const loop: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    const area = strokeArea(loop, 1);
    expect(area).toHaveLength(2);
    // The outer corners are rounded by the brush: a quarter disc short of square each.
    expect(patchArea(area)).toBeCloseTo(12 * 12 - 8 * 8 - (4 - Math.PI), 0);
  });
});

describe('painting and erasing patches', () => {
  it('merges a stroke with the patches of its material it touches, into one', () => {
    let patches: MaterialPatch[] = paintPatch([], strokeArea(line(0, 4), 1), 'ink', look, 'a');
    patches = paintPatch(patches, strokeArea(line(10, 14), 1), 'ink', look, 'b');
    expect(patches.map((p) => p.id)).toEqual(['a', 'b']);
    patches = paintPatch(patches, strokeArea(line(4, 10), 1), 'ink', { smooth: true, border: false }, 'c');
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ id: 'a', material: 'ink', smooth: true, border: false });
    expect(patches[0].rings).toHaveLength(1);
  });

  it('keeps a stroke of another material its own patch', () => {
    let patches = paintPatch([], strokeArea(line(0, 4), 1), 'ink', look, 'a');
    patches = paintPatch(patches, strokeArea(line(2, 6), 1), 'moss', look, 'b');
    expect(patches.map((p) => [p.id, p.material])).toEqual([['a', 'ink'], ['b', 'moss']]);
  });

  it('cuts an erase out of every patch, and drops a patch cut away whole', () => {
    let patches = paintPatch([], strokeArea(line(0, 10), 1), 'ink', look, 'a');
    patches = paintPatch(patches, strokeArea([[20, 0]], 1), 'moss', look, 'b');
    patches = erasePatches(patches, strokeArea([[5, -3], [5, 3]], 1));
    expect(patches.map((p) => p.id)).toEqual(['a', 'b']);
    // Cut in two: still one patch, now two rings.
    expect(patches[0].rings).toHaveLength(2);
    patches = erasePatches(patches, strokeArea([[20, 0]], 2));
    expect(patches.map((p) => p.id)).toEqual(['a']);
  });
});

describe('smoothing', () => {
  it('rounds the outline before the border goes on, keeping its size', () => {
    const square: Polygon = [[0, 0], [8, 0], [8, 8], [0, 8]];
    const rough = { rings: [square], smooth: false };
    expect(patchOutline(rough)).toEqual([square]);
    const [smooth] = patchOutline({ ...rough, smooth: true });
    expect(smooth.length).toBeGreaterThan(square.length * 4);
    expect(sharpest(smooth)).toBeLessThan(30);
    // Rounded inside the painted outline, never past it.
    expect(patchArea([smooth])).toBeGreaterThan(64 * 0.7);
    expect(patchArea([smooth])).toBeLessThan(64);
    for (const [x, y] of smooth) expect(x >= 0 && x <= 8 && y >= 0 && y <= 8).toBe(true);
  });
});

describe('the border walk round any outline', () => {
  it('lays the band kit all the way round a patch outline', () => {
    const area = strokeArea([[0, 0], [12, 4]], 3);
    const [ring] = patchOutline({ rings: area, smooth: true });
    const [placed] = layOutlineBand([ring]);
    expect(placed.length).toBeGreaterThan(6);
    // Every joint lands on the next piece's: the ring is closed, with no gap.
    for (let k = 0; k < placed.length; k++) {
      const a = jointsOf(placed[k].piece, placed[k].at)[1];
      const b = jointsOf(placed[(k + 1) % placed.length].piece, placed[(k + 1) % placed.length].at)[0];
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(0.6);
    }
  });

  it('walks a hole of the patch too', () => {
    const area = strokeArea([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], 1.5);
    const laid = layOutlineBand(patchOutline({ rings: area, smooth: true }));
    expect(laid).toHaveLength(2);
    for (const placed of laid) expect(placed.length).toBeGreaterThan(4);
  });
});
