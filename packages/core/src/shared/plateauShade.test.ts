// The shade a raised edge throws: the drop shade's stacked bands, and the sun shadow's fill
// and clip, read along a ray the way the blur and the mask make them.
import { describe, it, expect, beforeAll } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import {
  DROP_SHADE_ALPHA,
  SUN_SHADOW_ALPHA,
  SUN_SHADOW_BACK,
  SLOPE_MAX_WIDTH,
  contourOffsets,
  offsetPath,
  slopeRamp,
  slopeWidthOf,
  dropShadeWidth,
  leeSweeps,
  nestedAlphas,
  slopeBandAlpha,
  slopeSunFactor,
  stackedAlpha,
  sunShadowLength,
} from './plateauShade';
import { CLIFF_SHADOW_FADE, cliffShadowParts, reliefShadowParts } from '../engine/shadowPass';
import { clipper2Engine } from '../geometry/Clipper2Engine';
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
  // A faint contact shade: a quarter of the old 45 %, never wider than a third of a cell.
  it('is 0.15 + 0.06 a cell of drop wide, at most a third of a cell', () => {
    expect(dropShadeWidth(1)).toBeCloseTo(0.21);
    expect(dropShadeWidth(-2)).toBeCloseTo(0.27);
    expect(dropShadeWidth(3)).toBeCloseTo(0.33);
    expect(dropShadeWidth(9)).toBeCloseTo(1 / 3);
  });

  it('stacks its bands to 11 % at the edge, falling in even steps to the outermost', () => {
    const alphas = nestedAlphas(DROP_SHADE_ALPHA, 8);
    expect(stackedAlpha(alphas, 0)).toBeCloseTo(0.11, 6);
    for (let j = 0; j < 8; j++) expect(stackedAlpha(alphas, j)).toBeCloseTo(0.11 * (1 - j / 8), 6);
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

describe('the shadow of a floor or patch with a height', () => {
  const look = { dx: 1, dy: 0, length: 1, alpha: 0.4, color: '#000000' };
  const shape = (height: number | undefined) => ({
    id: 'f',
    name: 'f',
    childType: 'shape',
    visible: true,
    shapeType: 'rectangle',
    contours: [[[10, 10], [14, 10], [14, 14], [10, 14]]],
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,
    textureFillRotation: 0,
    textureTint: '#ffffff',
    ...(height === undefined ? {} : { height }),
  });
  const shown = (parts: { fill: Polygon[]; clip: Polygon[] }[]) => parts.flatMap(({ fill, clip }) => clipper2Engine.intersection(fill, clip)).flat();

  it('falls on the low side of a raised floor, as long as a plateau of its height casts', () => {
    const pts = shown(reliefShadowParts(layerOf([shape(2)]), look, GROUND));
    expect(pts.length).toBeGreaterThan(0);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(14 - 1e-6);
      expect(x).toBeLessThanOrEqual(14 + sunShadowLength(2) + 1e-6);
      expect(y).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(y).toBeLessThanOrEqual(14 + 1e-6);
    }
  });

  it('shades a sunk patch inside its edge, from the rim the light comes over', () => {
    const patch = { id: 'p', material: 'p:water', rings: [[[10, 10], [14, 10], [14, 14], [10, 14]]], smooth: false, border: false, height: -1 };
    const pts = shown(reliefShadowParts({ ...layerOf([]), materials: [patch] } as unknown as DungeonLayer, look, GROUND));
    expect(pts.length).toBeGreaterThan(0);
    for (const [x] of pts) {
      expect(x).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(x).toBeLessThanOrEqual(10 + sunShadowLength(1) + 1e-6);
    }
  });

  it('casts nothing at height 0 or unset', () => {
    expect(reliefShadowParts(layerOf([shape(0)]), look, GROUND)).toEqual([]);
    expect(reliefShadowParts(layerOf([shape(undefined)]), look, GROUND)).toEqual([]);
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

  it('rings one contour a cell of drop, evenly spaced inside the band', () => {
    expect(contourOffsets(1, 1)).toEqual([0.5]);
    expect(contourOffsets(2, 1.5)).toEqual([0.5, 1]);
    expect(contourOffsets(-3, 1)).toEqual([0.25, 0.5, 0.75]);
  });

  it('is the card’s slope width wide whatever the drop, 1 when unset, at most 3', () => {
    expect(slopeWidthOf(undefined)).toBe(1);
    expect(slopeWidthOf(2.5)).toBe(2.5);
    expect(slopeWidthOf(9)).toBe(SLOPE_MAX_WIDTH);
    expect(SLOPE_MAX_WIDTH).toBe(3);
  });

  it('lays its band outside the outline only, out to its width, rounded at convex corners', () => {
    // A 4 x 3.5 plateau's ring, outside on the left of travel.
    const ring: Polygon = [[2, 2], [6, 2], [6, 5.5], [2, 5.5]];
    const faces = slopeRamp(ring, true, true, 1);
    const pts = faces.flatMap((f) => f.bands.flat());
    for (const [x, y] of pts) {
      // Never inside the top…
      expect(x > 2 + 1e-9 && x < 6 - 1e-9 && y > 2 + 1e-9 && y < 5.5 - 1e-9).toBe(false);
      // …and never further from it than the band is wide.
      const dx = Math.max(2 - x, 0, x - 6);
      const dy = Math.max(2 - y, 0, y - 5.5);
      expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(1 + 1e-9);
    }
    // Four sides and a fan at each corner.
    expect(faces.filter((f) => Math.abs(f.normal[0]) === 1 || Math.abs(f.normal[1]) === 1).length).toBe(4);
    expect(faces.length).toBeGreaterThan(8);
    for (const f of faces) expect(f.bands).toHaveLength(16);
    // The contour at 0.5 rounds each corner at 0.5 from it.
    const line = offsetPath(ring, true, true, 0.5);
    for (const [x, y] of line) {
      const dx = Math.max(2 - x, 0, x - 6);
      const dy = Math.max(2 - y, 0, y - 5.5);
      expect(Math.hypot(dx, dy)).toBeCloseTo(0.5, 6);
    }
  });

  it('mitres a pit’s band inside its rim without crossing itself', () => {
    const ring: Polygon = [[2, 2], [6, 2], [6, 6], [2, 6]];
    const faces = slopeRamp(ring, true, false, 1);
    expect(faces).toHaveLength(4);
    for (const [x, y] of faces.flatMap((f) => f.bands.flat())) {
      expect(x).toBeGreaterThanOrEqual(2 - 1e-9);
      expect(x).toBeLessThanOrEqual(6 + 1e-9);
      expect(Math.min(x - 2, 6 - x, y - 2, 6 - y)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});
