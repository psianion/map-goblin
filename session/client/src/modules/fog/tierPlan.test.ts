// The fog mask's contracts, pinned against the *plan*: which cells the mask opens, on which
// level, and the feather and scrim built off it. No GPU and no Clipper — the whole point of
// splitting the compositor in two is that this half needs neither.

import { describe, expect, it } from 'vitest';
import type { Polygon } from '@dnd/core/src/geometry/GeometryEngine';
import { getCell, regionOf, setCells } from '@dnd/mechanics/fog';
import {
  BLUR_SIGMA_PER_STRENGTH,
  COVER_MARGIN,
  EDGE_FEATHER_CELLS,
  FRAME_SHADOW_CELLS,
  FRAME_SHADOW_DEPTH,
  GUARD_BLUR_CELLS,
  MASK_LIVE,
  OWN_CLEAR_FEATHER,
  blurPasses,
  cellTexture,
  edgeFeather,
  frameShadow,
  onMapSample,
  outsideFrame,
  ownClearAt,
  ownClearing,
  ownDisc,
  shownAt,
  tierPlan,
  type DrawOp,
  type DrawPlan,
  type TierTarget,
} from './tierPlan';

const FRAME = { minX: 0, minY: 0, maxX: 24, maxY: 8 };

const opsOn = (plan: DrawPlan, target: TierTarget): DrawOp[] => plan.ops.filter((op) => op.target === target);

/** T13 — the standard normal CDF (Abramowitz and Stegun 7.1.26 erf, good to 1.5e-7). */
const normalCdf = (z: number): number => {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const e = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + (z >= 0 ? e : -e));
};

/** Whether the mask's cells op opens a world cell: its texel is white. */
const opened = (plan: DrawPlan, col: number, row: number): boolean => {
  const op = opsOn(plan, 'mask').find((o): o is Extract<DrawOp, { kind: 'cells' }> => o.kind === 'cells');
  if (!op) return false;
  return op.cells.data[(row * op.cells.cols + col) * 4 + 3] === 255;
};

describe('tierPlan — the mask is the frame minus the cleared cells', () => {
  // The two-level fixture's question in miniature: a record per level, the plan handed one.
  const upper = setCells(regionOf(FRAME)!, [
    [2, 2],
    [3, 2],
  ]);
  const lower = setCells(regionOf(FRAME)!, [[10, 5]]);
  const cleared: Record<string, ReturnType<typeof regionOf>> = { upper, lower };

  it('opens exactly the cleared cells of the level shown and covers everything else', () => {
    const plan = tierPlan({ frame: FRAME, cleared: cleared.upper });
    expect(plan.cells).toBe(2);
    expect(opened(plan, 2, 2)).toBe(true);
    expect(opened(plan, 3, 2)).toBe(true);
    for (const [c, r] of [
      [0, 0],
      [4, 2],
      [2, 3],
      [23, 7],
    ] as const) {
      expect(opened(plan, c, r)).toBe(false);
    }
  });

  it('opens nothing of another level', () => {
    const plan = tierPlan({ frame: FRAME, cleared: cleared.upper });
    expect(getCell(cleared.lower, 10, 5)).toBe(true);
    expect(opened(plan, 10, 5)).toBe(false);
    const other = tierPlan({ frame: FRAME, cleared: cleared.lower });
    expect(opened(other, 10, 5)).toBe(true);
    expect(opened(other, 2, 2)).toBe(false);
  });

  it('draws no cells at all with nothing cleared: the whole frame is fogged', () => {
    const plan = tierPlan({ frame: FRAME });
    expect(plan.cells).toBe(0);
    expect(opsOn(plan, 'mask')).toEqual([]);
    expect(tierPlan({ frame: FRAME, cleared: regionOf(FRAME) }).cells).toBe(0);
  });

  it('covers nothing for a seat with no frame', () => {
    expect(tierPlan({ frame: null, cleared: upper })).toMatchObject({ cover: null, ops: [] });
  });

  it('covers the frame and a margin round it, and counts the margin as shown for the blurs', () => {
    const plan = tierPlan({ frame: FRAME });
    expect(plan.cover).toEqual({
      minX: -COVER_MARGIN,
      minY: -COVER_MARGIN,
      maxX: FRAME.maxX + COVER_MARGIN,
      maxY: FRAME.maxY + COVER_MARGIN,
    });
    expect(plan.beyond).toEqual(outsideFrame(plan.cover!, FRAME));
  });

  it('paints the seat’s own token over the record, and opens the scrim round it', () => {
    const TOKEN: Polygon = [
      [7, 6],
      [8, 6],
      [8, 7],
      [7, 7],
    ];
    const plan = tierPlan({ frame: FRAME, cleared: upper, own: [TOKEN] });
    const mask = opsOn(plan, 'mask');
    expect(mask.map((o) => o.kind)).toEqual(['cells', 'polys']);
    expect(mask[1]).toMatchObject({ kind: 'polys', polys: [TOKEN], grow: 0, blend: 'normal' });
    const scrim = opsOn(plan, 'scrim');
    expect(scrim.at(-1)).toMatchObject({ kind: 'polys', blend: 'erase', polys: [ownDisc(ownClearing(TOKEN))] });
  });

  it('builds the feather off the finished mask and the scrim as one erase of it', () => {
    const plan = tierPlan({ frame: FRAME, cleared: upper });
    expect(opsOn(plan, 'edge')).toEqual([{ kind: 'sprite', target: 'edge', source: 'mask', blend: 'normal', featherCells: EDGE_FEATHER_CELLS }]);
    expect(opsOn(plan, 'scrim')).toEqual([
      { kind: 'rect', target: 'scrim', rect: plan.cover, color: 0x000000, blend: 'normal' },
      { kind: 'sprite', target: 'scrim', source: 'mask', blend: 'erase' },
    ]);
  });
});

describe('tierPlan — the record as a texture', () => {
  it('carries every bit of the record into texture bytes one for one', () => {
    const record = setCells(regionOf(FRAME)!, [
      [0, 0],
      [5, 3],
      [23, 7],
    ]);
    const tex = cellTexture(record)!;
    expect([tex.cols, tex.rows, tex.minX, tex.minY]).toEqual([24, 8, 0, 0]);
    const lit: string[] = [];
    for (let row = 0; row < tex.rows; row++) {
      for (let col = 0; col < tex.cols; col++) {
        const i = (row * tex.cols + col) * 4;
        if (tex.data[i + 3] === 255) lit.push(`${col},${row}`);
        // Premultiplied: a set texel is white all through, an unset one transparent black.
        expect([...tex.data.slice(i, i + 4)]).toEqual(tex.data[i + 3] === 255 ? [255, 255, 255, 255] : [0, 0, 0, 0]);
      }
    }
    expect(lit).toEqual(['0,0', '5,3', '23,7']);
  });

  it('is nothing at all for a record with no bits set', () => {
    expect(cellTexture(regionOf(FRAME))).toBeNull();
    expect(cellTexture(undefined)).toBeNull();
  });

  it('uploads it white, unblurred, the sampler being the whole smoothing', () => {
    const plan = tierPlan({ frame: FRAME, cleared: setCells(regionOf(FRAME)!, [[1, 1]]) });
    expect(opsOn(plan, 'mask')[0]).toMatchObject({ kind: 'cells', color: MASK_LIVE, blurCells: 0, blend: 'normal' });
  });
});

describe('the record edge, smooth along a staircase (T8)', () => {
  const N = 16;
  const R = 6; // texels per cell, as a small map's mask lands
  const W = N * R;
  const K = N; // cell (i, j) is revealed when i + j <= K: a 45° staircase through the middle
  const cell = (i: number, j: number): number => (i < 0 || j < 0 ? 1 : i >= N || j >= N ? 0 : i + j <= K ? 1 : 0);
  /** The cell texture through a linear sampler, at a world point in cells. */
  const tent = (x: number, y: number): number => {
    const fx = x - 0.5;
    const fy = y - 0.5;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    return (
      (cell(i, j) * (1 - tx) + cell(i + 1, j) * tx) * (1 - ty) + (cell(i, j + 1) * (1 - tx) + cell(i + 1, j + 1) * tx) * ty
    );
  };
  const clampAt = (a: Float64Array, x: number, y: number): number =>
    a[Math.min(W - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
  // The `edge` target: coverage, Gaussian-blurred (separable) at the feather's σ in texels —
  // and (T13) the soft copy the guard reads, the same coverage at the guard's σ.
  const blurOf = (strength: number): Float64Array => {
    const c = new Float64Array(W * W);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) c[y * W + x] = Math.min(1, 2 * tent((x + 0.5) / R, (y + 0.5) / R));
    const sigma = BLUR_SIGMA_PER_STRENGTH * strength * R;
    const rad = Math.ceil(3 * sigma);
    const k = Array.from({ length: 2 * rad + 1 }, (_, i) => Math.exp(-((i - rad) ** 2) / (2 * sigma * sigma)));
    const sum = k.reduce((a, b) => a + b, 0);
    const pass = (src: Float64Array, dx: number, dy: number): Float64Array => {
      const out = new Float64Array(W * W);
      for (let y = 0; y < W; y++)
        for (let x = 0; x < W; x++) {
          let v = 0;
          for (let i = -rad; i <= rad; i++) v += k[i + rad] * clampAt(src, x + i * dx, y + i * dy);
          out[y * W + x] = v / sum;
        }
      return out;
    };
    return pass(pass(c, 1, 0), 0, 1);
  };
  const blurred = blurOf(EDGE_FEATHER_CELLS);
  const guardBlur = blurOf(GUARD_BLUR_CELLS);
  /** A blurred target through a linear sampler, at a world point in cells. */
  const read = (target: Float64Array, x: number, y: number): number => {
    const fx = x * R - 0.5;
    const fy = y * R - 0.5;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    return (
      (clampAt(target, i, j) * (1 - tx) + clampAt(target, i + 1, j) * tx) * (1 - ty) +
      (clampAt(target, i, j + 1) * (1 - tx) + clampAt(target, i + 1, j + 1) * tx) * ty
    );
  };
  const shown = (x: number, y: number): number => shownAt(read(guardBlur, x, y), read(blurred, x, y));
  // The staircase's mid line runs through (c0, c0); `d` is the distance across it (inward < 0).
  const c0 = (K + 1) / 2;
  const at = (d: number, along: number): number =>
    shown(c0 + (d + along) / Math.SQRT2, c0 + (d - along) / Math.SQRT2);

  it('falls off monotone across the stairs, with no step above a small epsilon', () => {
    for (const along of [0, 0.25, 0.5, 0.75]) {
      let prev = at(-3, along);
      for (let d = -3 + 0.01; d <= 1.5; d += 0.01) {
        const v = at(d, along);
        expect(v).toBeLessThanOrEqual(prev + 1e-9);
        expect(prev - v).toBeLessThan(0.02);
        prev = v;
      }
    }
  });

  it('reads the same all along the boundary — the cell steps do not show', () => {
    for (const d of [-1.5, -1, -0.5, -0.25, 0, 0.25]) {
      const row = Array.from({ length: 401 }, (_, i) => at(d, -2 + i * 0.01));
      expect(Math.max(...row) - Math.min(...row)).toBeLessThan(0.01);
    }
  });

  it('fades over about a cell and a half', () => {
    let lo = Number.NaN;
    let hi = Number.NaN;
    for (let d = -3; d <= 1.5; d += 0.01) {
      const v = at(d, 0);
      if (Number.isNaN(hi) && v < 0.95) hi = d;
      if (Number.isNaN(lo) && v < 0.05) lo = d;
    }
    expect(lo - hi).toBeGreaterThan(1.3);
    expect(lo - hi).toBeLessThan(1.8);
  });

  it('keeps a lone hidden cell inside revealed ground hidden at its middle — the guard', () => {
    // The feather alone reads a one-cell hole as nearly shown; the guard's blur of it, at the
    // hole's middle, is far under where the guard opens (T13), so it holds it at zero.
    const sigma = BLUR_SIGMA_PER_STRENGTH * GUARD_BLUR_CELLS;
    const across = 2 * normalCdf(0.5 / sigma) - 1;
    const soft = 1 - across * across;
    expect(soft).toBeLessThan(0.2);
    expect(shownAt(soft, 0.95)).toBe(0);
    expect(shownAt(0, 0.95)).toBe(0);
  });
});

// ── T13: a thin hidden gap, soft ────────────────────────────────────────────
//
// A strip of hidden ground `w` wide inside revealed ground, across its width: the hard mask is
// 0 in it and 1 round it, the feather and the guard each read their own Gaussian blur of that.
describe('a thin hidden gap inside revealed ground (T13, the white sliver)', () => {
  const SIGMA_E = BLUR_SIGMA_PER_STRENGTH * EDGE_FEATHER_CELLS;
  const SIGMA_G = BLUR_SIGMA_PER_STRENGTH * GUARD_BLUR_CELLS;
  /** The strip's coverage through a blur of σ, at x across it (centred on 0). */
  const strip = (x: number, w: number, sigma: number): number =>
    1 - (normalCdf((x + w / 2) / sigma) - normalCdf((x - w / 2) / sigma));
  const m = (x: number, w: number): number => shownAt(strip(x, w, SIGMA_G), strip(x, w, SIGMA_E));
  const xs = Array.from({ length: 401 }, (_, i) => -2 + i * 0.01);
  const biggestStep = (f: (x: number) => number): number =>
    Math.max(...xs.slice(1).map((x, i) => Math.abs(f(x) - f(xs[i]))));

  it.each([0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.7, 1, 1.5])('has no hard step across a %f-cell gap', (w) => {
    // Every 0.01 cell under 7 %: a ramp of a fifth of a cell or more, never a texel's cut.
    expect(biggestStep((x) => m(x, w))).toBeLessThan(0.07);
  });

  it('replaces the hard guard, which stepped from dense cloud to the feather in one texel', () => {
    // T8's guard: the hard mask itself, so the step at the gap's rim was the feather's whole value.
    const before = (x: number, w: number): number => edgeFeather(strip(x, w, SIGMA_E)) * (Math.abs(x) < w / 2 ? 0 : 1);
    for (const w of [0.2, 0.3, 0.5]) expect(biggestStep((x) => before(x, w))).toBeGreaterThan(0.5);
  });

  it('leaves a gap half a cell wide or more hidden at its middle, and hidden ground past a straight edge hidden', () => {
    for (const w of [0.5, 0.7, 1, 1.5, 3]) expect(m(0, w)).toBe(0);
    // A straight edge (an infinitely wide gap): nothing is lifted on the hidden side.
    const edge = (x: number): number => shownAt(normalCdf(x / SIGMA_G), normalCdf(x / SIGMA_E));
    for (let x = -2; x <= 0; x += 0.01) expect(edge(x)).toBe(0);
  });
});

// ── T13: the seat's own token, cleared round ────────────────────────────────
describe("the seat's own clearing (T13, §2.8)", () => {
  const TOKEN: Polygon = [
    [7, 22],
    [8, 22],
    [8, 23],
    [7, 23],
  ];
  const own = ownClearing(TOKEN);

  it('is centred on the token, clear over it and gone a feather past it', () => {
    expect(own).toEqual({ x: 7.5, y: 22.5, inner: 0.5, outer: 0.5 + OWN_CLEAR_FEATHER });
    expect(ownClearAt(7.5, 22.5, [own])).toBe(1);
    expect(ownClearAt(7.9, 22.5, [own])).toBe(1);
    expect(ownClearAt(7.5 + own.outer, 22.5, [own])).toBe(0);
    expect(ownClearAt(7.5, 22.5 + own.outer + 1, [own])).toBe(0);
  });

  it('is round: the same at the same distance in every direction', () => {
    for (const r of [0.6, 1, 1.5, 2, 2.4]) {
      const ring = Array.from({ length: 24 }, (_, i) => {
        const a = (2 * Math.PI * i) / 24;
        return ownClearAt(own.x + r * Math.cos(a), own.y + r * Math.sin(a), [own]);
      });
      expect(Math.max(...ring) - Math.min(...ring)).toBeLessThan(1e-9);
    }
  });

  it('is feathered: monotone outward, no step, about a cell and a half from 95 % to 5 %', () => {
    const rs = Array.from({ length: 401 }, (_, i) => i * 0.01);
    const v = rs.map((r) => ownClearAt(own.x + r, own.y, [own]));
    for (let i = 1; i < v.length; i++) {
      expect(v[i]).toBeLessThanOrEqual(v[i - 1]);
      expect(v[i - 1] - v[i]).toBeLessThan(0.02);
    }
    const first = (t: number): number => rs[v.findIndex((y) => y <= t)];
    expect(first(0.05) - first(0.95)).toBeGreaterThan(1.3);
    expect(first(0.05) - first(0.95)).toBeLessThan(1.7);
  });

  it('opens the scrim over its whole disc, centred on the token', () => {
    const disc = ownDisc(own);
    for (let i = 0; i < 64; i++) {
      const a = (2 * Math.PI * i) / 64;
      const [x, y] = [own.x + own.outer * Math.cos(a), own.y + own.outer * Math.sin(a)];
      // Inside the polygon: on the inner side of every edge of a convex, counter-clockwise ring.
      const inside = disc.every(([x1, y1], k) => {
        const [x2, y2] = disc[(k + 1) % disc.length];
        return (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1) >= -1e-9;
      });
      expect(inside).toBe(true);
    }
    const cx = disc.reduce((s, p) => s + p[0], 0) / disc.length;
    const cy = disc.reduce((s, p) => s + p[1], 0) / disc.length;
    expect(cx).toBeCloseTo(7.5, 9);
    expect(cy).toBeCloseTo(22.5, 9);
  });
});

// ── T6: a crisp map edge, a soft shadow past it ─────────────────────────────
//
// No GL in this lane, so the shader's edge is checked through its TS twins (`onMapSample`,
// `frameShadow`, `edgeFeather`) over a one-row model of the mask as texels, blurred the way
// Pixi 8.17's BlurFilter does it: five Gaussian taps a pass, the first pass `strength /
// sqrt(sum of 4^-i)` texels apart and each later pass half that (`_applyOptimized`), every tap
// a linear read. A straight edge is a 1-D question, and the blur is separable.
describe('the map edge, crisp (T6)', () => {
  const TAPS = [0.153388, 0.221461, 0.250301, 0.221461, 0.153388];
  const read = (row: readonly number[], at: number): number => {
    const c = Math.min(row.length - 1, Math.max(0, at));
    const i = Math.floor(c);
    const f = c - i;
    return row[i] * (1 - f) + row[Math.min(row.length - 1, i + 1)] * f;
  };
  const pixiBlur = (row: readonly number[], strength: number, passes: number): number[] => {
    let sum = 0;
    for (let i = 0; i < passes; i++) sum += 4 ** -i;
    let spacing = strength / Math.sqrt(sum);
    let out = [...row];
    for (let p = 0; p < passes; p++) {
      const from = out;
      out = from.map((_, i) => TAPS.reduce((v, w, k) => v + w * read(from, i + (k - 2) * spacing), 0));
      spacing /= 2;
    }
    return out;
  };

  /**
   * One row of texels from x = -8 to 8 cells at `scale` texels a cell, the map's right edge at
   * x = 0. `tier(x)` is the hard mask; the feather's source is its coverage, and with `beyond`
   * the cover past the frame counts as shown, as the plan now asks of both blurs.
   */
  const modelRow = (scale: number, tier: (x: number) => number, beyond: boolean, passes = blurPasses(scale)) => {
    const n = 16 * scale;
    const at = (i: number): number => -8 + (i + 0.5) / scale;
    const mask = Array.from({ length: n }, (_, i) => (at(i) >= 0 ? 0 : tier(at(i))));
    const coverage = Array.from({ length: n }, (_, i) => (at(i) >= 0 ? (beyond ? 1 : 0) : mask[i] > 0 ? 1 : 0));
    const edge = pixiBlur(coverage, EDGE_FEATHER_CELLS * scale, passes);
    const frame = { minX: -8, minY: -1, maxX: 0, maxY: 1 };
    /** The shader's maskAt for a world x on the row: held on the map, then the tier times its feather. */
    return (x: number): number => {
      const [sx] = onMapSample(x, 0, frame, 1.5 / scale);
      const t = (sx + 8) * scale - 0.5;
      return read(mask, t) * edgeFeather(read(edge, t));
    };
  };

  it('reads the interior tier right up to the frame: no falloff on any tier', () => {
    for (const tier of [0.5, 1]) {
      const m = modelRow(24, () => tier, true);
      for (const x of [-2, -1, -0.5, -0.1, -0.02, -0.001]) expect(m(x)).toBeCloseTo(tier, 6);
      // …where P8 read the void past the frame as hidden ground and faded every tier into it.
      const before = modelRow(24, () => tier, false, 3);
      expect(before(-0.1)).toBeLessThan(0.1 * tier);
    }
  });

  it('asks the plan to count the cover past the frame as shown, and only that', () => {
    const plan = tierPlan({ frame: FRAME, cleared: setCells(regionOf(FRAME)!, [[4, 2]]) });
    expect(plan.beyond).toEqual(outsideFrame(plan.cover!, FRAME));
    for (const r of plan.beyond!) {
      const overlapX = Math.min(r.maxX, FRAME.maxX) - Math.max(r.minX, FRAME.minX);
      const overlapY = Math.min(r.maxY, FRAME.maxY) - Math.max(r.minY, FRAME.minY);
      expect(overlapX <= 0 || overlapY <= 0).toBe(true);
    }
  });

  it('never samples the tier, the cloud or the shadow from past the frame for a point on the map', () => {
    const inset = 1.5 / 24;
    for (let x = -3; x <= 27; x += 0.25) {
      for (let y = -3; y <= 11; y += 0.25) {
        // Any point, warped any way: the tier is read on the map, the inset in from its edge.
        const [sx, sy] = onMapSample(x, y, FRAME, inset);
        expect(sx).toBeGreaterThanOrEqual(FRAME.minX + inset);
        expect(sx).toBeLessThanOrEqual(FRAME.maxX - inset);
        expect(sy).toBeGreaterThanOrEqual(FRAME.minY + inset);
        expect(sy).toBeLessThanOrEqual(FRAME.maxY - inset);
        const onMap = x >= FRAME.minX && x <= FRAME.maxX && y >= FRAME.minY && y <= FRAME.maxY;
        if (onMap) expect(frameShadow(x, y, FRAME)).toBe(0);
        // A point well on the map reads itself.
        if (x >= inset && x <= FRAME.maxX - inset && y >= inset && y <= FRAME.maxY - inset) {
          expect([sx, sy]).toEqual([x, y]);
        }
      }
    }
  });

  it('lays the shadow only past the frame, falling off smoothly over its width', () => {
    const STEP = 0.005;
    const d = Array.from({ length: Math.round(2 / STEP) + 1 }, (_, i) => i * STEP);
    const shade = d.map((t) => frameShadow(FRAME.maxX + t, 4, FRAME));
    expect(shade[0]).toBe(0); // on the edge itself: the map's, not the shadow's
    expect(shade[1]).toBeCloseTo(FRAME_SHADOW_DEPTH, 2);
    for (let i = 2; i < shade.length; i++) {
      expect(shade[i]).toBeLessThanOrEqual(shade[i - 1]);
      // No step anywhere along it: every 0.005 cell under 1% of the depth.
      expect(shade[i - 1] - shade[i]).toBeLessThan(0.01 * FRAME_SHADOW_DEPTH);
    }
    expect(frameShadow(FRAME.maxX + FRAME_SHADOW_CELLS, 4, FRAME)).toBe(0);
    expect(frameShadow(FRAME.maxX + 1.4 * FRAME_SHADOW_CELLS, 4, FRAME)).toBe(0);
    // It eases into the cloud rather than ending on a line.
    expect(frameShadow(FRAME.maxX + 0.95 * FRAME_SHADOW_CELLS, 4, FRAME)).toBeLessThan(0.01 * FRAME_SHADOW_DEPTH);
    // Rounded at a corner: the same reach diagonally as straight out.
    const r = 0.5;
    expect(frameShadow(FRAME.maxX + r / Math.SQRT2, FRAME.maxY + r / Math.SQRT2, FRAME)).toBeCloseTo(
      frameShadow(FRAME.maxX + r, 4, FRAME),
      9,
    );
  });

  // A memory running into hidden ground three cells inside the map. The analytic reference is
  // the same ramp through a true Gaussian of the blur's width (1.29 strength).
  const erf = (x: number): number => {
    const t = 1 / (1 + 0.3275911 * Math.abs(x));
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return x >= 0 ? y : -y;
  };
  const SIGMA = Math.sqrt(2 * (TAPS[0] * 4 + TAPS[1])) * EDGE_FEATHER_CELLS;
  const STEP = 0.005;
  const xs = Array.from({ length: Math.round(4 / STEP) + 1 }, (_, i) => -5 + i * STEP);
  const biggestStep = (m: (x: number) => number): number =>
    Math.max(...xs.slice(1).map((x, i) => m(x) - m(xs[i])));
  const smooth = biggestStep((x) => 0.5 * edgeFeather(0.5 * (1 + erf((x + 3) / (SIGMA * Math.SQRT2)))));
  const memory = (x: number): number => (x < -3 ? 0 : 0.5);

  it.each([6, 12, 24])('feathers between tiers as a clean gradient at %i texels a cell', (scale) => {
    const m = modelRow(scale, memory, true);
    expect(biggestStep(m)).toBeLessThanOrEqual(1.05 * smooth);
    for (let i = 1; i < xs.length; i++) expect(m(xs[i])).toBeGreaterThanOrEqual(m(xs[i - 1]) - 1e-12);
  });

  it('replaces a staircase: three passes at 24 texels a cell stepped every five texels', () => {
    expect(blurPasses(24)).toBe(6);
    expect(biggestStep(modelRow(24, memory, true, 3))).toBeGreaterThan(2 * smooth);
  });
});
