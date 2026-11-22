// A drawn run along a measured kit's rock line (`alongRock`): its stretches on the line's drawn
// edge are laid on the rock, either way round, the drawn points kept across a gap in the rock,
// and each new segment says which drawn one it stands for.
import { beforeAll, describe, expect, it } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import { alongRock } from './rockLines';
import { cliffOccluders, edgeHides, layerPlateaus } from './plateaus';
import type { DungeonLayer, PlateauChild, RockLine } from '../store/types';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

type Pt = [number, number];

const ring = (w: number, h: number): Pt[] => [[0, 0], [w, 0], [w, h], [0, h]];
const round = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

/** The 10 by 8 ring's rock, wandering 0.3 either side of the top edge. */
const whole: RockLine = {
  edge: ring(10, 8),
  closed: true,
  runs: [[[0, 0], [2, 0.3], [4, -0.3], [6, 0.3], [8, -0.3], [10, 0], [10, 8], [0, 8], [0, 0]]],
};

/** The same rock stopped either side of a doorway from x 4 to 6 on the top edge. */
const broken: RockLine = {
  edge: ring(10, 8),
  closed: true,
  runs: [[[6.2, 0.25], [8, -0.3], [10, 0], [10, 8], [0, 8], [0, 0], [2, 0.3], [3.8, -0.25]]],
};

describe('alongRock', () => {
  it('lays a ring on its rock line on the rock, each segment standing for the drawn edge it follows', () => {
    const out = alongRock(ring(10, 8), true, [whole]);
    expect(out.points).toEqual(whole.runs[0].slice(0, -1));
    expect(out.segs).toEqual([0, 0, 0, 0, 0, 1, 2, 3]);
    expect(out.replaced).toHaveLength(1);
  });

  it('takes the rock the way the run goes when the two are wound opposite ways', () => {
    const out = alongRock([[0, 8], [10, 8], [10, 0], [0, 0]], true, [whole]);
    expect(out.points).toEqual([[0, 8], [10, 8], [10, 0], [8, -0.3], [6, 0.3], [4, -0.3], [2, 0.3], [0, 0]]);
    expect(out.segs).toEqual([0, 1, 2, 2, 2, 2, 2, 3]);
  });

  it('lays an open run along one wall on that stretch of the rock, either way along it', () => {
    const top = alongRock([[0, 0], [10, 0]], false, [whole]);
    expect(top.points).toEqual([[0, 0], [2, 0.3], [4, -0.3], [6, 0.3], [8, -0.3], [10, 0]]);
    expect(top.segs).toEqual([0, 0, 0, 0, 0]);
    const back = alongRock([[10, 0], [0, 0]], false, [whole]);
    expect(back.points).toEqual([[10, 0], [8, -0.3], [6, 0.3], [4, -0.3], [2, 0.3], [0, 0]]);
  });

  it('hands back a run 0.5 cell inside the ring as it is', () => {
    const inner: Pt[] = [[0.5, 0.5], [9.5, 0.5], [9.5, 7.5], [0.5, 7.5]];
    const out = alongRock(inner, true, [whole]);
    expect(out.points).toBe(inner);
    expect(out.segs).toEqual([0, 1, 2, 3]);
    expect(out.replaced).toEqual([]);
  });

  it('keeps the drawn points across a gap in the rock', () => {
    const out = alongRock(ring(10, 8), true, [broken]);
    // The drawn edge across the doorway, then the rock from the far jamb round to the near one.
    expect(out.points.map(([x, y]) => [round(x), round(y)])).toEqual([[3.8, 0], [6.2, 0], [6.2, 0.25], [8, -0.3], [10, 0], [10, 8], [0, 8], [0, 0], [2, 0.3], [3.8, -0.25]]);
    expect(out.segs).toEqual([0, 0, 0, 0, 1, 2, 3, 0, 0, 0]);
  });

  it('changes nothing with no rock lines', () => {
    const r = ring(10, 8);
    expect(alongRock(r, true, undefined).points).toBe(r);
    expect(alongRock(r, true, []).segs).toEqual([0, 1, 2, 3]);
  });
});

describe('a raised room blocks sight on its rock line', () => {
  const raised: PlateauChild = { id: 'raised', name: 'raised', childType: 'plateau', visible: true, contours: [ring(10, 8)], height: 2, edge: 'cliff' };
  const layerOf = (extra: Partial<DungeonLayer> = {}) => ({ children: [raised], ...extra }) as Pick<DungeonLayer, 'children' | 'rockLines'>;
  const pairs = (segs: { x1: number; y1: number; x2: number; y2: number }[]) => segs.map((s) => [s.x1, s.y1, s.x2, s.y2]);
  const along = (run: Pt[]) => run.slice(1).map((p, i) => [run[i][0], run[i][1], p[0], p[1]]);

  it('lies on the run', () => {
    const occ = cliffOccluders(layerOf({ rockLines: [whole] }), 1);
    expect(pairs(occ)).toHaveLength(whole.runs[0].length - 1);
    expect(pairs(occ)).toEqual(expect.arrayContaining(along(whole.runs[0])));
    expect(occ.every((o) => o.direction === 'left')).toBe(true);
  });

  it('is today’s segments exactly without rock lines', () => {
    const layer = layerOf();
    // The drawn ring edges, as they always were.
    const today = layerPlateaus(layer).bands.flatMap((band) =>
      band.rings.flatMap((r, ri) =>
        band.edges[ri].flatMap((e, i) => {
          if (e.drop === 0 || !edgeHides(e.owner, e.edge, e.drop, 1)) return [];
          const [a, b] = [r[i], r[(i + 1) % r.length]];
          return [{ x1: a[0], y1: a[1], x2: b[0], y2: b[1], direction: e.drop > 0 ? 'left' : 'right' }];
        }),
      ),
    );
    expect(today).toHaveLength(4);
    expect(cliffOccluders(layer, 1)).toEqual(today);
  });
});
