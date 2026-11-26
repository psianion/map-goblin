// Every soft edge the engine draws is a true ramp, never steps: sampled along a line across it,
// neighbouring samples never differ by more than a sixth of its peak, and it never rises on the
// way out. Samples are 0.05 cell apart, or a tenth of the fade for one narrower than half a cell,
// which 0.05-cell samples cannot follow at that bound whatever its shape.
import { beforeAll, describe, expect, it } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import type { DungeonLayer, PlateauChild } from '../store/types';
import type { Polygon } from '../types/geometry';
import { edgeRuns, layerPlateaus } from '../shared/plateaus';
import { BORDER_FADE, DROP_SHADE_ALPHA, dropShadeWidth, TOP_SEAM } from '../shared/plateauShade';
import { GROUND_SOFT_EDGE } from '../assets/materialKit';
import { innerBandRamp, MOUTH_FADE, mouthRamp } from './softEdge';
import { maskGridFor, softMaskPixels } from './softMask';
import { insideRings, rampAlphaAt, sampleRamp, type Ramp, type RampField } from './rampMask';
import { BANK_SHADE_ALPHA, BANK_SHADE_WIDTH, bankShadeRamp, FALL_HALF, fallRamp, SHORE_FADE, shoreRamp } from './material/materialRenderer';
import { dropShadeField, paintedBorderRamp, seamFadeField } from './plateauRenderer';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

type V = [number, number];
const square = (x0: number, y0: number, x1: number, y1: number): Polygon => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const ROOM = square(0, 0, 10, 8);
const plateau = (id: string, ring: Polygon, extra: Partial<PlateauChild> = {}): PlateauChild =>
  ({ id, name: id, childType: 'plateau', visible: true, contours: [ring], height: 2, edge: 'cliff', ...extra }) as PlateauChild;
const layerOf = (children: unknown[]) => ({ id: 'l1', type: 'dungeon', children, style: { floorColor: '#808080' } }) as unknown as DungeonLayer;
const fieldRamp = (field: RampField | null): Ramp => ({ field: field!, clip: null });

/**
 * The opacity along `from` → `to` (inside the fade at full, out past it), every `step`: its
 * peak is held at the start, nothing at the end, no jump over a sixth of `peak`, and no rise.
 */
function holdsRamp(alpha: (p: V) => number, from: V, to: V, peak: number, step: number): void {
  const L = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const n = Math.ceil(L / step);
  const samples = Array.from({ length: n + 1 }, (_, k): number => alpha([from[0] + ((to[0] - from[0]) * k) / n, from[1] + ((to[1] - from[1]) * k) / n]));
  expect(samples[0]).toBeGreaterThan(0.95 * peak);
  expect(samples[0]).toBeLessThanOrEqual(peak + 1e-6);
  expect(samples[n]).toBeLessThan(0.01 * peak);
  for (let k = 1; k <= n; k++) {
    expect(Math.abs(samples[k] - samples[k - 1]), `sample ${k} of ${n}`).toBeLessThanOrEqual(peak / 6 + 1e-6);
    // Filtering between texels takes a hundredth off a fade's crest on its very line, no more.
    expect(samples[k], `sample ${k} of ${n}`).toBeLessThanOrEqual(samples[k - 1] + 0.01 * peak);
  }
  // A ramp, not a cliff: some samples lie part way.
  expect(samples.filter((a) => a > 0.05 * peak && a < 0.95 * peak).length).toBeGreaterThan(2);
}

/** 0.05 cell, or a tenth of a fade narrower than half a cell. */
const stepFor = (fade: number): number => Math.min(0.05, fade / 10);

describe('soft edges are ramps, not steps', () => {
  it('a floor fading out across a cave mouth', () => {
    // A mouth two cells wide on the room's left wall.
    const ramp = mouthRamp([ROOM], [[[0, 5], [0, 3]]], 7)!;
    // Out from the mouth onto the ground, and past the rock's end beside it.
    holdsRamp((p) => rampAlphaAt(ramp, p), [-0.001, 4], [-1.4, 4], 1, stepFor(MOUTH_FADE));
    holdsRamp((p) => rampAlphaAt(ramp, p), [-0.001, 2.6], [-1.4, 2.6], rampAlphaAt(ramp, [-0.001, 2.6]), stepFor(MOUTH_FADE));
  });

  it('a soft-edged ground or Material brush patch, as its edge mask', () => {
    const outline = [ROOM];
    const grid = maskGridFor(outline, 0.25, 16, 1024)!;
    const px = softMaskPixels(outline, GROUND_SOFT_EDGE, [], grid);
    const field: RampField = { grid, alpha: Float32Array.from({ length: px.length / 4 }, (_, k) => px[k * 4] / 255) };
    const alpha = (p: V) => (insideRings(outline, p) ? sampleRamp(field, p[0], p[1]) : 0);
    holdsRamp(alpha, [1, 4], [-0.05, 4], 1, stepFor(GROUND_SOFT_EDGE));
  });

  for (const width of [0.75, 1.5]) {
    it(`a floor’s painted border ${width} wide`, () => {
      const ramp = innerBandRamp([ROOM], width, 3)!;
      holdsRamp((p) => rampAlphaAt(ramp, p), [0.02, 4], [width * 1.4 + 0.05, 4], 1, stepFor(width * BORDER_FADE));
    });
  }

  for (const width of [0.5, 2]) {
    it(`a water patch’s shore ${width} wide`, () => {
      const ramp = shoreRamp([ROOM], width, [ROOM])!;
      holdsRamp((p) => rampAlphaAt(ramp, p), [-0.02, 4], [-width - 0.05, 4], 1, stepFor(width * SHORE_FADE));
    });
  }

  it('deep water’s bank shade', () => {
    const ramp = bankShadeRamp([ROOM], BANK_SHADE_ALPHA, BANK_SHADE_WIDTH)!;
    holdsRamp((p) => rampAlphaAt(ramp, p), [0.001, 4], [BANK_SHADE_WIDTH + 0.05, 4], BANK_SHADE_ALPHA, stepFor(BANK_SHADE_WIDTH));
  });

  it('a fall where water crosses a cliff', () => {
    const ramp = fallRamp(layerOf([plateau('p', square(4, -2, 20, 20))]), [ROOM])!;
    expect(ramp).not.toBeNull();
    holdsRamp((p) => rampAlphaAt(ramp, p), [4, 4], [4 - FALL_HALF - 0.05, 4], 0.7, stepFor(FALL_HALF));
  });

  for (const width of [0.75, 1.5]) {
    it(`a plateau’s painted border ${width} wide`, () => {
      const run = edgeRuns(layerPlateaus(layerOf([plateau('p', square(5, 5, 11, 11), { edgeArt: 'paint' })])).bands[0])[0];
      const ramp = paintedBorderRamp(run, width)!;
      holdsRamp((p) => rampAlphaAt(ramp, p), [5.02, 8], [5 + width * 1.4 + 0.05, 8], 1, stepFor(width * BORDER_FADE));
    });
  }

  it('a plateau’s drop shade', () => {
    const run = edgeRuns(layerPlateaus(layerOf([plateau('p', square(5, 5, 11, 11))])).bands[0])[0];
    const ramp = fieldRamp(dropShadeField([run]));
    const width = dropShadeWidth(run.drop);
    holdsRamp((p) => rampAlphaAt(ramp, p), [5, 8], [5 - width - 0.05, 8], DROP_SHADE_ALPHA, stepFor(width));
  });

  it('a seam between two tops of one height', () => {
    const top = square(10, 3, 18, 9);
    const ramp: Ramp = { field: seamFadeField([top], [[[10, 3], [10, 9]]], 5)!, clip: [top] };
    holdsRamp((p) => rampAlphaAt(ramp, p), [10 + TOP_SEAM * 1.4 + 0.05, 6], [10.001, 6], 1, stepFor(TOP_SEAM));
  });
});
