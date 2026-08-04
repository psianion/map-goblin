import { describe, expect, it } from 'vitest';
import {
  SPLAT_SIZE,
  TERRAIN_EXTENT_HALF,
  TEXELS_PER_CELL,
  applySplatPatch,
  planWindowBake,
  splatBounds,
  splatRegionsEqual,
  unionBounds,
} from './terrainShared';

/** Tiny RGBA buffer helper. */
function rgba(size: number): Uint8Array {
  return new Uint8Array(size * size * 4);
}

describe('applySplatPatch', () => {
  it('copies patch rows into the right region of the full buffer', () => {
    const splat = rgba(8);
    const patch = new Uint8Array(2 * 2 * 4).fill(200);
    applySplatPatch(splat, { x: 3, y: 4, width: 2, height: 2 }, patch, 8);
    // Pixel (3,4) written, (2,4) untouched, (4,5) written.
    expect(splat[(4 * 8 + 3) * 4]).toBe(200);
    expect(splat[(4 * 8 + 2) * 4]).toBe(0);
    expect(splat[(5 * 8 + 4) * 4]).toBe(200);
    expect(splat[(5 * 8 + 5) * 4]).toBe(0);
  });
});

describe('splatBounds', () => {
  it('is null for a blank map', () => {
    expect(splatBounds(rgba(16), 16)).toBeNull();
  });

  it('boxes the painted texels in world units', () => {
    const size = SPLAT_SIZE;
    const splat = rgba(size);
    // Two painted texels: (0,0) and (31,15) — a 2-cell-ish box at the corner.
    splat[0] = 255;
    splat[(15 * size + 31) * 4 + 1] = 128;
    const b = splatBounds(splat, size)!;
    expect(b.minX).toBeCloseTo(-TERRAIN_EXTENT_HALF);
    expect(b.minY).toBeCloseTo(-TERRAIN_EXTENT_HALF);
    expect(b.maxX).toBeCloseTo(32 / TEXELS_PER_CELL - TERRAIN_EXTENT_HALF);
    expect(b.maxY).toBeCloseTo(16 / TEXELS_PER_CELL - TERRAIN_EXTENT_HALF);
  });

  it('ignores alpha-only texels, matching the shader cutoff', () => {
    const splat = rgba(16);
    splat[3] = 255; // alpha only — rgb sum is 0
    expect(splatBounds(splat, 16)).toBeNull();
  });
});

describe('unionBounds', () => {
  it('passes through single sides and unions both', () => {
    const a = { minX: 0, minY: 0, maxX: 2, maxY: 2 };
    const b = { minX: -1, minY: 1, maxX: 1, maxY: 3 };
    expect(unionBounds(a, null)).toEqual(a);
    expect(unionBounds(null, b)).toEqual(b);
    expect(unionBounds(a, b)).toEqual({ minX: -1, minY: 0, maxX: 2, maxY: 3 });
  });
});

describe('planWindowBake', () => {
  it('is inactive at or below the base bake density', () => {
    expect(planWindowBake(32, 32, 200, 4096, 20, 15)).toBeNull();
    expect(planWindowBake(20, 32, 200, 4096, 20, 15)).toBeNull();
  });

  it('sizes the RT to world span × zoom density once above the base density', () => {
    const plan = planWindowBake(64, 32, 200, 4096, 20, 10);
    expect(plan).toEqual({ width: 1280, height: 640 });
  });

  it('caps density at the splat/texture native resolution', () => {
    // 500 px/cell requested, capped to 200 — width tracks the cap, not the request.
    const plan = planWindowBake(500, 32, 200, 4096, 10, 10);
    expect(plan).toEqual({ width: 2000, height: 2000 });
  });

  it('caps the RT dimension so a huge viewport cannot blow the VRAM budget', () => {
    const plan = planWindowBake(200, 32, 200, 4096, 100, 5);
    expect(plan).toEqual({ width: 4096, height: 1000 });
  });

  it('rejects a degenerate (zero-area) span', () => {
    expect(planWindowBake(64, 32, 200, 4096, 0, 10)).toBeNull();
  });
});

describe('splatRegionsEqual', () => {
  it('ignores the alpha byte', () => {
    const a = new Uint8Array([1, 2, 3, 255, 9, 9, 9, 0]);
    const b = new Uint8Array([1, 2, 3, 0, 9, 9, 9, 77]);
    expect(splatRegionsEqual(a, b)).toBe(true);
  });

  it('catches an rgb difference', () => {
    const a = new Uint8Array([1, 2, 3, 255]);
    const b = new Uint8Array([1, 2, 4, 255]);
    expect(splatRegionsEqual(a, b)).toBe(false);
  });

  it('handles unaligned subarray views', () => {
    const backing = new Uint8Array(12);
    // byteOffset 1 → the Uint32 fast path would throw; fallback must kick in.
    const a = backing.subarray(1, 9);
    const b = new Uint8Array([0, 0, 0, 9, 0, 0, 0, 9]);
    expect(splatRegionsEqual(a, b)).toBe(true);
    b[1] = 5;
    expect(splatRegionsEqual(a, b)).toBe(false);
  });

  it('rejects length mismatches', () => {
    expect(splatRegionsEqual(new Uint8Array(4), new Uint8Array(8))).toBe(false);
  });
});
