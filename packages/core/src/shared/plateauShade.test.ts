// The shade a raised edge throws: the drop shade's stacked bands, and the sun shadow's fill
// and clip, read along a ray the way the blur and the mask make them.
import { describe, it, expect, beforeAll } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import {
  DROP_SHADE_ALPHA,
  SUN_SHADOW_ALPHA,
  SUN_SHADOW_BACK,
  contourOffsets,
  dropShadeWidth,
  leeSweeps,
  nestedAlphas,
  slopeBandAlpha,
  slopeSunFactor,
  stackedAlpha,
  sunShadowLength,
} from './plateauShade';
import { CLIFF_SHADOW_FADE, cliffShadowParts } from '../engine/shadowPass';
import { pointInPoly } from './plateaus';
import type { DungeonLayer, PlateauChild } from '../store/types';
import type { Polygon } from '../types/geometry';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

const plat = (id: string, x0: number, y0: number, x1: number, y1: number, extra: Partial<PlateauChild> = {}): PlateauChild => ({
  id,
  name: id,
  childType: 'plateau',
  visible: true,
  contours: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]],
  height: 1,
  edge: 'cliff',
  ...extra,
});
const layerOf = (children: unknown[]) => ({ id: 'l', type: 'dungeon', children }) as unknown as DungeonLayer;
const GROUND: Polygon[] = [[[0, 0], [30, 0], [30, 30], [0, 30]]];
const inAny = (p: [number, number], rings: Polygon[]) => rings.filter((r) => pointInPoly(p[0], p[1], r)).length % 2 === 1;

/**
 * The shadow's opacity along a ray from `from` along (dx, dy), `step` cells a sample: the fill
 * blurred across the ray (a Gaussian fading 90 % to 10 % over CLIFF_SHADOW_FADE, as the pass's
 * blur is set to), then cut by the clip. A long straight edge is all the blur sees across it.
 */
function profile(fill: Polygon[], clip: Polygon[], from: [number, number], dir: [number, number], reach: number, step = 0.02): number[] {
  const sigma = CLIFF_SHADOW_FADE / 2.5631;
  const at = (t: number): [number, number] => [from[0] + dir[0] * t, from[1] + dir[1] * t];
  const span = Math.ceil((3 * sigma) / step);
  const raw = (t: number) => (inAny(at(t), fill) ? SUN_SHADOW_ALPHA : 0);
  const out: number[] = [];
  for (let t = step / 2; t < reach; t += step) {
    let sum = 0;
    let w = 0;
    for (let k = -span; k <= span; k++) {
      const g = Math.exp(-((k * step) ** 2) / (2 * sigma * sigma));
      sum += g * raw(t + k * step);
      w += g;
    }
    out.push(inAny(at(t), clip) ? sum / w : 0);
  }
  return out;
}

describe('the drop shade', () => {
  it('is 0.35 + 0.3 a cell of drop wide, at most 1.5', () => {
    expect(dropShadeWidth(1)).toBeCloseTo(0.65);
    expect(dropShadeWidth(-2)).toBeCloseTo(0.95);
    expect(dropShadeWidth(3)).toBeCloseTo(1.25);
    expect(dropShadeWidth(9)).toBe(1.5);
  });

  it('stacks its bands to 45 % at the edge, falling in even steps to the outermost', () => {
    const alphas = nestedAlphas(DROP_SHADE_ALPHA, 8);
    expect(stackedAlpha(alphas, 0)).toBeCloseTo(0.45, 6);
    for (let j = 0; j < 8; j++) expect(stackedAlpha(alphas, j)).toBeCloseTo(0.45 * (1 - j / 8), 6);
    for (const a of alphas) expect(a).toBeGreaterThan(0);
  });
});

describe('the sun shadow off an edge', () => {
  it('is 0.8 + 0.6 a cell of drop long, whatever the sun', () => {
    expect(sunShadowLength(1)).toBeCloseTo(1.4);
    expect(sunShadowLength(-2)).toBeCloseTo(2.0);
    expect(sunShadowLength(3)).toBeCloseTo(2.6);
  });

  it('sweeps only the stretches turned from the light, reaching back behind the edge', () => {
    // A plateau ring, outside on the left of travel: (10,10) → (14,10) → (14,14) → (10,14).
    const ring: Polygon = [[10, 10], [14, 10], [14, 14], [10, 14]];
    const sweeps = leeSweeps(ring, true, true, { dx: 1, dy: 0 }, 2);
    expect(sweeps).toHaveLength(1);
    const xs = sweeps[0].map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(14 - SUN_SHADOW_BACK);
    expect(Math.max(...xs)).toBeCloseTo(16);
    // A pit's low side is inside: the west rim is the one the light comes over.
    const pit = leeSweeps(ring, true, false, { dx: 1, dy: 0 }, 2);
    expect(pit).toHaveLength(1);
    expect(Math.min(...pit[0].map((p) => p[0]))).toBeCloseTo(10 - SUN_SHADOW_BACK);
  });

  it('starts on the edge at full strength and only lightens outward, at +1 and +3, indoors sun and out', () => {
    const dirs: [number, number][] = [[1, 0], [Math.SQRT1_2, Math.SQRT1_2], [0.6, -0.8]];
    for (const height of [1, 3]) {
      for (const [dx, dy] of dirs) {
        const look = { dx, dy, length: 1, alpha: 0.4, color: '#000000' };
        const parts = cliffShadowParts(layerOf([plat('top', 10, 10, 16, 16, { height })]), look, GROUND);
        expect(parts).toHaveLength(1);
        const { fill, clip } = parts[0];
        // From the middle of the side the light leaves, along the sun.
        const from: [number, number] = Math.abs(dx) >= Math.abs(dy) ? [dx > 0 ? 16 : 10, 13] : [13, dy > 0 ? 16 : 10];
        const reach = sunShadowLength(height) + 1;
        const a = profile(fill, clip, from, [dx, dy], reach);
        // Dark right at the edge: within 0.02 cell of it, all but none of the full strength.
        expect(a[0]).toBeGreaterThan(0.97 * SUN_SHADOW_ALPHA);
        // No sample within 0.3 cell of the edge lighter than its neighbour further out, nor anywhere.
        for (let i = 0; i + 1 < a.length; i++) expect(a[i + 1], `+${height} (${dx},${dy}) at ${(i * 0.02).toFixed(2)}`).toBeLessThanOrEqual(a[i] + 1e-9);
        // And it is gone a cell past its length.
        expect(a[a.length - 1]).toBeLessThan(0.02);
      }
    }
  });

  it('never lands on the caster’s own top', () => {
    const look = { dx: 1, dy: 0, length: 1, alpha: 0.4, color: '#000000' };
    const [{ clip }] = cliffShadowParts(layerOf([plat('top', 10, 10, 16, 16, { height: 2 })]), look, GROUND);
    expect(inAny([15.9, 13], clip)).toBe(false);
    expect(inAny([16.1, 13], clip)).toBe(true);
  });
});

describe('the slope', () => {
  it('shades from none at the top to 40 % at the foot, in steps under 12/255 on white', () => {
    const steps = Array.from({ length: 16 }, (_, k) => slopeBandAlpha(k));
    expect(steps[0]).toBeLessThan(0.02);
    expect(steps[15]).toBeGreaterThan(0.38);
    expect(steps[15]).toBeLessThanOrEqual(0.4);
    for (let k = 1; k < 16; k++) expect((steps[k] - steps[k - 1]) * 255).toBeLessThan(12);
  });

  it('keeps 60 % of its shade on the face square to the sun, all of it turned away or indoors', () => {
    const look = { dx: 1, dy: 0 };
    expect(slopeSunFactor([-1, 0], look)).toBeCloseTo(0.6);
    expect(slopeSunFactor([1, 0], look)).toBe(1);
    expect(slopeSunFactor([0, 1], look)).toBe(1);
    expect(slopeSunFactor([-1, 0], null)).toBe(1);
  });

  it('rings one contour a cell of drop, evenly spaced, the last at the foot', () => {
    expect(contourOffsets(1, 1)).toEqual([1]);
    expect(contourOffsets(2, 2)).toEqual([1, 2]);
    expect(contourOffsets(-3, 1.5)).toEqual([0.5, 1, 1.5]);
  });
});
