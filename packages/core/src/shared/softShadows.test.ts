// T9 — soft shadow edges, with no staircase. Nothing here draws: Pixi's BlurFilter is modelled
// pass for pass over one row (five taps `u` px apart, the first pass at the strength that makes
// the passes add up to the filter's, each next one half the last), and the claims are about the
// rows it gives back — the light pass's penumbra on a hard wall edge, and a wall's sun shadow
// down its length.

import { describe, it, expect } from 'vitest';
import { sunAt, type MapEnvironment } from './world';
import { SHADOW_STEPS, bandAlpha, shadowLook, wallShadowSigma, type ShadowLook } from './shadows';
import { BLUR_WEIGHTS_5, blurPasses, blurStrengthForSigma } from './plateauShade';

const pixiBlur = (row: number[], strength: number, passes: number): number[] => {
  const n = row.length;
  const at = (r: number[], x: number): number => {
    const c = Math.max(0, Math.min(n - 1, x));
    const i = Math.floor(c);
    const t = c - i;
    return r[i] * (1 - t) + r[Math.min(n - 1, i + 1)] * t;
  };
  const w = [BLUR_WEIGHTS_5[2], BLUR_WEIGHTS_5[1], BLUR_WEIGHTS_5[0], BLUR_WEIGHTS_5[1], BLUR_WEIGHTS_5[2]];
  const sum = [...Array(passes).keys()].reduce((acc, i) => acc + 0.25 ** i, 0);
  let out = row;
  for (let pass = 0, u = strength / Math.sqrt(sum); pass < passes; pass++, u /= 2) {
    const prev = out;
    out = prev.map((_, x) => w.reduce((acc, wk, k) => acc + wk * at(prev, x + (k - 2) * u), 0));
  }
  return out;
};

/**
 * How many treads a falling `row` has: places where its slope sinks to under half of the slope
 * on both sides — a flat landing between two drops. A ramp has none, a staircase one per step;
 * the faint ripple a multi-pass blur leaves in a ramp's slope is not a landing.
 */
const treads = (row: number[]): number => {
  const d = row.slice(1).map((v, i) => row[i] - v);
  const top = Math.max(...d);
  const peaks: number[] = [];
  for (let i = 1; i < d.length - 1; i++) if (d[i] > d[i - 1] && d[i] >= d[i + 1] && d[i] > 0.1 * top) peaks.push(i);
  let landings = 0;
  for (let k = 1; k < peaks.length; k++) {
    const trough = Math.min(...d.slice(peaks[k - 1], peaks[k] + 1));
    if (trough < 0.5 * Math.min(d[peaks[k - 1]], d[peaks[k]])) landings++;
  }
  return landings;
};

const hardEdge = (): number[] => Array.from({ length: 400 }, (_, i) => (i < 200 ? 1 : 0));

describe("a light's shadow edge through the penumbra blur", () => {
  it('comes out one monotone ramp at every blur the lighting pass uses, never treads', () => {
    for (const strength of [2, 6, 12]) {
      const edge = pixiBlur(hardEdge(), strength, blurPasses(strength));
      for (let i = 1; i < edge.length; i++) expect(edge[i]).toBeLessThanOrEqual(edge[i - 1] + 1e-9);
      expect(treads(edge), `strength ${strength}`).toBe(0);
      // A penumbra, not a line: 90 % to 10 % over more than a pixel.
      expect(edge.findIndex((v) => v < 0.1) - edge.findIndex((v) => v < 0.9)).toBeGreaterThan(1);
    }
  });

  it('was a staircase at the two fixed passes it used to run', () => {
    expect(treads(pixiBlur(hardEdge(), 12, 2))).toBeGreaterThan(3);
  });
});

describe("a wall's sun shadow, down its length", () => {
  const OUTDOOR: MapEnvironment = { environment: 'outdoor', naturalLight: true };
  const lookAt = (minutes: number): ShadowLook => shadowLook(sunAt(minutes, OUTDOOR, 'full-moon'))!;
  // Down the middle of one long wall's shadow: band k of SHADOW_STEPS covers [0, length·k/steps),
  // stacked source-over at bandAlpha, then blurred at wallShadowSigma. x < 0 is the wall's sunny
  // side. PX pixels a cell, a close zoom.
  const PX = 80;
  const profile = (look: ShadowLook): { x: number[]; a: number[] } => {
    const per = bandAlpha(look);
    const x = Array.from({ length: Math.round((look.length + 4) * PX) }, (_, i) => -2 + i / PX);
    const flat = x.map((xi) => {
      if (xi < 0) return 0;
      const count = SHADOW_STEPS - Math.min(SHADOW_STEPS, Math.floor((xi / look.length) * SHADOW_STEPS));
      return 1 - (1 - per) ** count;
    });
    const strength = blurStrengthForSigma(wallShadowSigma(look) * PX);
    return { x, a: pixiBlur(flat, strength, blurPasses(strength)) };
  };
  const index = (x: number[], at: number): number => x.findIndex((xi) => xi >= at);

  for (const [name, minutes] of [
    ['a low sun', 7 * 60 + 30],
    ['mid-morning', 10 * 60],
    ['noon', 12 * 60],
  ] as const) {
    it(`falls off monotone from the wall to a soft tip, one ramp, no step: ${name}`, () => {
      const look = lookAt(minutes);
      const { x, a } = profile(look);
      const top = a.indexOf(Math.max(...a));
      // From its darkest point out past the tip: never darker again, and no visible step.
      for (let i = top + 1; i < a.length; i++) {
        expect(a[i]).toBeLessThanOrEqual(a[i - 1] + 1e-9);
        expect(a[i - 1] - a[i]).toBeLessThan(0.02);
      }
      // One ramp along the bands (and the tip's own fall), never eight treads.
      expect(treads(a.slice(top))).toBe(0);
      // The tip ends on a penumbra: from 90 % to 10 % of the last band over more than nothing.
      const last = a[index(x, (look.length * (SHADOW_STEPS - 0.5)) / SHADOW_STEPS)];
      const hi = a.findIndex((v, i) => i > top && v < 0.9 * last);
      const lo = a.findIndex((v, i) => i > top && v < 0.1 * last);
      expect(wallShadowSigma(look)).toBeGreaterThan(0);
      expect(lo - hi).toBeGreaterThan(0);
      // Next to nothing spills past the wall's own art (half a 0.5-cell wall) onto its sunny side.
      expect(a[index(x, -0.25)]).toBeLessThan(0.25 * a[index(x, 0.25)]);
    });
  }

  it("keeps the canvas's shadow depth: the stack darkens as the four multiplied bands did", () => {
    const look = lookAt(10 * 60);
    const n = parseInt(look.color.slice(1), 16);
    const stack = 1 - (1 - bandAlpha(look)) ** SHADOW_STEPS;
    for (const ch of [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff].map((v) => v / 255)) {
      const before = (1 - (look.alpha / 4) * (1 - ch)) ** 4;
      const after = 1 - stack * (1 - ch);
      expect(Math.abs(after - before)).toBeLessThan(0.01);
    }
  });
});
