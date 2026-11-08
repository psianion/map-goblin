import { describe, expect, it } from 'vitest';
import { detectGrid, type GridSample } from './detectGrid';

/** A seeded generator, so a noisy picture is the same picture every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

interface Picture {
  width: number;
  height: number;
  /** Grey level at a pixel, 0 to 255. */
  at: (x: number, y: number) => number;
}

function sample({ width, height, at }: Picture): GridSample {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = at(x, y);
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

/** How much of pixel [x, x+1) lies on a line `thick` wide starting every `cell` from `origin`. */
function coverage(x: number, cell: number, origin: number, thick: number): number {
  let t = (x - origin) % cell;
  if (t < 0) t += cell;
  // The line covers [0, thick) of each period; a pixel can straddle its end or the wrap.
  const inLine = (a: number, b: number) => Math.max(0, Math.min(b, thick) - Math.max(a, 0));
  return Math.min(1, inLine(t, t + 1) + inLine(t - cell, t + 1 - cell));
}

/** Parchment with soft shading, dark grid lines `thick` wide, and optional noise and blots. */
function battlemap(opts: { width: number; height: number; cell: number; ox: number; oy: number; noise?: number; blots?: boolean; thick?: number }): Picture {
  const { width, height, cell, ox, oy, noise = 0, blots = false, thick = 1.6 } = opts;
  const rand = rng(7);
  const blotList = blots
    ? Array.from({ length: 40 }, () => ({ x: rand() * width, y: rand() * height, r: 5 + rand() * 40, v: rand() * 120 - 60 }))
    : [];
  const jitter = Array.from({ length: width * height }, () => (rand() * 2 - 1) * noise);
  return {
    width,
    height,
    at: (x, y) => {
      let v = 170 + 30 * Math.sin(x / 90) * Math.cos(y / 70);
      for (const b of blotList) if ((x - b.x) ** 2 + (y - b.y) ** 2 < b.r * b.r) v += b.v;
      const line = Math.max(coverage(x, cell, ox, thick), coverage(y, cell, oy, thick));
      v = v * (1 - line) + 50 * line;
      return Math.max(0, Math.min(255, v + jitter[y * width + x]));
    },
  };
}

/** Distance between two line offsets on a circle of one cell. */
function phaseError(a: number, b: number, cell: number): number {
  const d = Math.abs(a - b) % cell;
  return Math.min(d, cell - d);
}

describe('detectGrid', () => {
  it('finds a clean grid: spacing, offsets and high confidence', () => {
    const pic = battlemap({ width: 900, height: 600, cell: 37.5, ox: 11, oy: 23 });
    const g = detectGrid(sample(pic));
    expect(g.pxPerCell).toBeCloseTo(37.5, 1);
    expect(phaseError(g.originX, 11 + 0.8, 37.5)).toBeLessThan(0.6);
    expect(phaseError(g.originY, 23 + 0.8, 37.5)).toBeLessThan(0.6);
    expect(g.confidence).toBeGreaterThan(0.8);
  });

  it('finds it under noise and blots in the art', () => {
    const pic = battlemap({ width: 1000, height: 700, cell: 52.6, ox: 30.2, oy: 4.5, noise: 35, blots: true });
    const g = detectGrid(sample(pic));
    expect(g.pxPerCell).toBeCloseTo(52.6, 0);
    expect(phaseError(g.originX, 30.2 + 0.8, 52.6)).toBeLessThan(1);
    expect(phaseError(g.originY, 4.5 + 0.8, 52.6)).toBeLessThan(1);
    expect(g.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('answers in source pixels when the sample was shrunk', () => {
    // A 2000 px map with 100 px squares, sampled at half size.
    const pic = battlemap({ width: 1000, height: 600, cell: 50, ox: 20, oy: 10 });
    const g = detectGrid(sample(pic), { source: { width: 2000, height: 1200 } });
    expect(g.pxPerCell).toBeCloseTo(100, 0);
    expect(phaseError(g.originX, 2 * (20 + 0.8), 100)).toBeLessThan(2);
  });

  it('does not answer with a multiple of the true spacing', () => {
    const pic = battlemap({ width: 960, height: 640, cell: 24, ox: 3, oy: 3, noise: 10 });
    const g = detectGrid(sample(pic));
    expect(g.pxPerCell).toBeCloseTo(24, 1);
    expect(phaseError(g.originX, 3.8, 24)).toBeLessThan(0.6);
  });

  it('keeps to the seed: a 40 by 25 hint searches near 24 px', () => {
    const pic = battlemap({ width: 960, height: 600, cell: 24.4, ox: 0, oy: 0, noise: 20 });
    const g = detectGrid(sample(pic), { seed: { width: 40, height: 25 } });
    expect(g.pxPerCell).toBeGreaterThan(24 * 0.85);
    expect(g.pxPerCell).toBeLessThan(24 * 1.15);
    expect(g.pxPerCell).toBeCloseTo(24.4, 1);
  });

  it('gives low confidence for a picture with no grid', () => {
    const plain = battlemap({ width: 800, height: 560, cell: 1e9, ox: 5e8, oy: 5e8, noise: 35, blots: true });
    expect(detectGrid(sample(plain)).confidence).toBeLessThan(0.5);
  });

  it('gives nothing for a picture too small to hold a grid', () => {
    const tiny = sample({ width: 8, height: 8, at: () => 100 });
    expect(detectGrid(tiny)).toEqual({ pxPerCell: 0, originX: 0, originY: 0, confidence: 0 });
  });
});
