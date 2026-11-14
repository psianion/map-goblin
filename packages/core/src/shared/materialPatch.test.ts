// The brush's stroke geometry, and how far an older map's patches reach. Painting, merging
// and erasing are tested where they live now: engine/tools/MaterialTool.test.ts.
import { beforeAll, describe, expect, it } from 'vitest';
import { setClipperModule } from '../geometry/Clipper2Engine';
import type { Polygon } from '../types/geometry';
import { cutCorners, keptToFloors, patchArea, patchesBounds, pointInRings, shoreWidthOf, SHORE_DEFAULT_WIDTH, SHORE_MAX_WIDTH, SHORE_MIN_WIDTH, strokeArea, type MaterialPatch } from './materialPatch';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  setClipperModule(await mod.default({ wasmBinary }));
}, 30_000);

const square: Polygon = [[0, 0], [4, 0], [4, 4], [0, 4]];
const patch = (extra: Partial<MaterialPatch> = {}): MaterialPatch => ({ id: 'p', material: 'GG_Cave_Ink', rings: [square], smooth: false, border: true, ...extra });

describe('a stroke', () => {
  it('covers the line grown by the brush radius, round at its ends', () => {
    const area = patchArea(strokeArea([[0, 0], [10, 0]], 1));
    expect(area).toBeGreaterThan(20 + Math.PI * 0.95);
    expect(area).toBeLessThan(20 + Math.PI * 1.01);
  });

  it('is a disc for a single point, and nothing for no points or no radius', () => {
    expect(patchArea(strokeArea([[5, 5]], 2))).toBeGreaterThan(Math.PI * 4 * 0.95);
    expect(strokeArea([], 2)).toEqual([]);
    expect(strokeArea([[0, 0]], 0)).toEqual([]);
  });
});

describe('rings', () => {
  it('measure their area with holes taken out', () => {
    const hole: Polygon = [[1, 1], [1, 2], [2, 2], [2, 1]];
    expect(patchArea([square, hole])).toBeCloseTo(15, 9);
  });

  it('count a point inside by even-odd: a hole is outside', () => {
    const hole: Polygon = [[1, 1], [1, 2], [2, 2], [2, 1]];
    expect(pointInRings(3, 3, [square, hole])).toBe(true);
    expect(pointInRings(1.5, 1.5, [square, hole])).toBe(false);
    expect(pointInRings(9, 9, [square, hole])).toBe(false);
  });

  it('lose their corners to Chaikin, each edge keeping its middle half', () => {
    const cut = cutCorners(square);
    expect(cut).toHaveLength(8);
    expect(cut[0]).toEqual([1, 0]);
    expect(cut[1]).toEqual([3, 0]);
  });
});

describe('an older map’s patch', () => {
  it('was kept to the floors when it was a plain texture not painted as ground', () => {
    expect(keptToFloors(patch({ material: 'pack:grass' }))).toBe(true);
    expect(keptToFloors(patch({ material: 'pack:grass', ground: true }))).toBe(false);
    expect(keptToFloors(patch())).toBe(false);
  });

  it('reaches as far as its rings', () => {
    expect(patchesBounds([patch(), patch({ rings: [[[10, -2], [12, -2], [12, 1]]] })])).toEqual({ minX: 0, minY: -2, maxX: 12, maxY: 4 });
    expect(patchesBounds([])).toBeNull();
    expect(patchesBounds(undefined)).toBeNull();
  });

  it('keeps a shore width inside its limits, the default when unset', () => {
    expect(shoreWidthOf(undefined)).toBe(SHORE_DEFAULT_WIDTH);
    expect(shoreWidthOf(0)).toBe(SHORE_MIN_WIDTH);
    expect(shoreWidthOf(9)).toBe(SHORE_MAX_WIDTH);
  });
});
