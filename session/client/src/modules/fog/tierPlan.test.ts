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
  MASK_LIVE,
  OWN_CLEAR_FEATHER,
  beyondCells,
  blurPasses,
  cellTexture,
  edgeBand,
  edgeBlurCells,
  edgeCover,
  edgeFeather,
  edgeProfile,
  edgeRampEnds,
  edgeShown,
  frameShadow,
  onMapSample,
  ownClearAt,
  ownClearing,
  ownDisc,
  tierPlan,
  type DrawOp,
  type DrawPlan,
  type TierTarget,
} from './tierPlan';

const FRAME = { minX: 0, minY: 0, maxX: 24, maxY: 8 };

const opsOn = (plan: DrawPlan, target: TierTarget): DrawOp[] => plan.ops.filter((op) => op.target === target);

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

  it('covers the frame and a margin round it', () => {
    const plan = tierPlan({ frame: FRAME });
    expect(plan.cover).toEqual({
      minX: -COVER_MARGIN,
      minY: -COVER_MARGIN,
      maxX: FRAME.maxX + COVER_MARGIN,
      maxY: FRAME.maxY + COVER_MARGIN,
    });
    // Nothing cleared, so nothing past the frame reads as shown either.
    expect(plan.beyond).toEqual([]);
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

  it('builds the feather off the finished mask, and opens the scrim the band round the cleared cells', () => {
    const plan = tierPlan({ frame: FRAME, cleared: upper, band: 0.95 });
    expect(opsOn(plan, 'edge')).toEqual([{ kind: 'sprite', target: 'edge', source: 'mask', blend: 'normal', featherCells: EDGE_FEATHER_CELLS }]);
    // The two cleared cells are one run, grown by the band the cloud thins across.
    expect(opsOn(plan, 'scrim')).toEqual([
      { kind: 'rect', target: 'scrim', rect: plan.cover, color: 0x000000, blend: 'normal' },
      {
        kind: 'polys',
        target: 'scrim',
        polys: [
          [
            [2, 2],
            [4, 2],
            [4, 3],
            [2, 3],
          ],
        ],
        grow: 0.95,
        color: MASK_LIVE,
        blend: 'erase',
      },
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

// ── Pass 2: the players' cloud, thinning across the painted line ─────────────
//
// The soft copy is the cell texture through its linear sampler (a ramp a cell wide) blurred by
// `edgeBlurCells`, and `edgeShown` stretches the band's ends to 0 and 1. Checked two ways: the
// analytic `edgeProfile` across a straight edge, and a texel model of the real mask blurred
// (separable Gaussian) round an L of cells and along a staircase.
describe('the players’ edge (pass 2)', () => {
  it('reads half on the painted line, full cloud a band into the fog and clear a band into the ground, at every fade', () => {
    for (const fade of [1, 1.5, 2, 3, 4]) {
      const band = edgeBand(fade);
      const ends = edgeRampEnds(fade);
      const shown = (x: number): number => edgeShown(edgeProfile(x, fade), ends);
      expect(shown(0)).toBeCloseTo(0.5, 6);
      expect(shown(-band)).toBeCloseTo(0, 6);
      expect(shown(band)).toBeCloseTo(1, 6);
      expect(shown(-band - 0.05)).toBe(0);
      expect(shown(band + 0.05)).toBe(1);
      expect(shown(-band / 2)).toBeGreaterThan(0.02);
      expect(shown(band / 2)).toBeLessThan(0.98);
    }
    // Three quarters of a cell each side at the default Edge softness.
    expect(edgeBand(2)).toBe(0.75);
  });

  it('widens with fade: a softer edge spends the band over more ground', () => {
    const at = (fade: number) => edgeShown(edgeProfile(-0.4, fade), edgeRampEnds(fade));
    expect(at(1)).toBe(0);
    expect(at(2)).toBeGreaterThan(0);
    expect(at(4)).toBeGreaterThan(at(2));
    expect(edgeBlurCells(4)).toBeGreaterThan(edgeBlurCells(2));
  });

  it('covers in full at the band’s fog end and not at all at its clear end, whatever the cloud’s density', () => {
    for (const den of [0, 0.25, 0.5, 0.75, 1]) {
      expect(edgeCover(0, den)).toBe(1);
      expect(edgeCover(1, den)).toBe(0);
      // …and only ever falls as the ground clears: the wisps move the cut, never fold it back.
      let prev = 1;
      for (let m = 0; m <= 1.0001; m += 0.005) {
        const c = edgeCover(Math.min(1, m), den);
        expect(c).toBeLessThanOrEqual(prev + 1e-12);
        prev = c;
      }
    }
    expect(edgeCover(0.5, 0.5)).toBeCloseTo(0.5, 9);
    // The density moves the half-way point about: wisps, not a blurred line.
    expect(edgeCover(0.5, 0.9)).toBeLessThan(0.4);
    expect(edgeCover(0.5, 0.1)).toBeGreaterThan(0.6);
  });

  // A texel model of the mask: `R` texels a cell, the cell texture through a linear sampler,
  // then a separable Gaussian of the soft copy's σ.
  const N = 16;
  const R = 6;
  const W = N * R;
  const softOf = (cell: (i: number, j: number) => number, fade: number): ((x: number, y: number) => number) => {
    const tent = (x: number, y: number): number => {
      const [fx, fy] = [x - 0.5, y - 0.5];
      const [i, j] = [Math.floor(fx), Math.floor(fy)];
      const [tx, ty] = [fx - i, fy - j];
      return (cell(i, j) * (1 - tx) + cell(i + 1, j) * tx) * (1 - ty) + (cell(i, j + 1) * (1 - tx) + cell(i + 1, j + 1) * tx) * ty;
    };
    const at = (a: Float64Array, x: number, y: number): number => a[Math.min(W - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
    const c = new Float64Array(W * W);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) c[y * W + x] = tent((x + 0.5) / R, (y + 0.5) / R);
    const sigma = BLUR_SIGMA_PER_STRENGTH * edgeBlurCells(fade) * R;
    const rad = Math.ceil(3 * sigma);
    const k = Array.from({ length: 2 * rad + 1 }, (_, i) => Math.exp(-((i - rad) ** 2) / (2 * sigma * sigma)));
    const sum = k.reduce((p, q) => p + q, 0);
    const pass = (src: Float64Array, dx: number, dy: number): Float64Array => {
      const out = new Float64Array(W * W);
      for (let y = 0; y < W; y++)
        for (let x = 0; x < W; x++) {
          let v = 0;
          for (let i = -rad; i <= rad; i++) v += k[i + rad] * at(src, x + i * dx, y + i * dy);
          out[y * W + x] = v / sum;
        }
      return out;
    };
    const blurred = pass(pass(c, 1, 0), 0, 1);
    return (x, y) => {
      const [fx, fy] = [x * R - 0.5, y * R - 0.5];
      const [i, j] = [Math.floor(fx), Math.floor(fy)];
      const [tx, ty] = [fx - i, fy - j];
      return (at(blurred, i, j) * (1 - tx) + at(blurred, i + 1, j) * tx) * (1 - ty) + (at(blurred, i, j + 1) * (1 - tx) + at(blurred, i + 1, j + 1) * tx) * ty;
    };
  };

  it('matches the analytic profile across a straight painted edge', () => {
    // Clear west of x = 8, fogged east of it.
    const soft = softOf((i) => (i < 8 ? 1 : 0), 2);
    for (const d of [-0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75]) expect(Math.abs(soft(8 - d, 8) - edgeProfile(d, 2))).toBeLessThan(0.02);
  });

  it('leaves at most a light cloud on the centre of every painted cell of an L, and its fogged neighbours under cloud', () => {
    const lit = new Set(['6,6', '6,7', '6,8', '7,8', '8,8']);
    const soft = softOf((i, j) => (lit.has(`${i},${j}`) ? 1 : 0), 2);
    const ends = edgeRampEnds(2);
    for (const key of lit) {
      const [i, j] = key.split(',').map(Number) as [number, number];
      // An arm one cell wide has the fog half a cell off on both sides: the most cloud any painted cell keeps.
      expect(edgeCover(edgeShown(soft(i + 0.5, j + 0.5), ends), 0.5)).toBeLessThan(0.25);
    }
    // A fogged cell beside the L, and the one tucked in its corner: under the cloud at their centres.
    for (const [i, j] of [
      [5, 7],
      [6, 9],
      [7, 7],
    ] as const) {
      expect(edgeShown(soft(i + 0.5, j + 0.5), ends)).toBeLessThan(0.5);
    }
  });

  it('falls off monotone across a staircase, with no hard step', () => {
    // Cell (i, j) is clear when i + j <= 16: a 45° staircase through the middle.
    const soft = softOf((i, j) => (i < 0 || j < 0 ? 1 : i >= N || j >= N ? 0 : i + j <= N ? 1 : 0), 2);
    const ends = edgeRampEnds(2);
    const c0 = (N + 1) / 2;
    const at = (d: number, along: number): number => edgeShown(soft(c0 + (d + along) / Math.SQRT2, c0 + (d - along) / Math.SQRT2), ends);
    for (const along of [0, 0.25, 0.5, 0.75]) {
      let prev = at(-2, along);
      for (let d = -2 + 0.01; d <= 2; d += 0.01) {
        const v = at(d, along);
        expect(v).toBeLessThanOrEqual(prev + 1e-9);
        expect(prev - v).toBeLessThan(0.03);
        prev = v;
      }
    }
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

  it('asks the plan to carry the cleared edge cells on past the frame, and only those', () => {
    const cleared = setCells(regionOf(FRAME)!, [
      [0, 0],
      [1, 0],
      [5, 0],
      [4, 2],
      [23, 3],
      [23, 7],
    ]);
    const plan = tierPlan({ frame: FRAME, cleared });
    const [c, f] = [plan.cover!, FRAME];
    const expected = [
      { minX: 0, minY: c.minY, maxX: 2, maxY: f.minY },
      { minX: 5, minY: c.minY, maxX: 6, maxY: f.minY },
      { minX: 23, minY: f.maxY, maxX: 24, maxY: c.maxY },
      { minX: c.minX, minY: 0, maxX: f.minX, maxY: 1 },
      { minX: f.maxX, minY: 3, maxX: c.maxX, maxY: 4 },
      { minX: f.maxX, minY: 7, maxX: c.maxX, maxY: 8 },
      { minX: c.minX, minY: c.minY, maxX: f.minX, maxY: f.minY },
      { minX: f.maxX, minY: f.maxY, maxX: c.maxX, maxY: c.maxY },
    ];
    expect(plan.beyond).toEqual(beyondCells(c, cleared));
    expect(plan.beyond).toHaveLength(expected.length);
    expect(plan.beyond).toEqual(expect.arrayContaining(expected));
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
