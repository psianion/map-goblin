// A measured cave kit on real maps: "FA cave test 1" (a six-sided cave and a rectangular one
// joined by a two-cell corridor, a mouth erased into the six-sided one, doors, and a
// brush-painted cave), and the drawings in testing/caveCases.ts: cliffs meeting caves and mouths,
// small plateaus and a slope. Each ring, run and cliff is held to the rules in testing/bandChecks.ts.
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../assets/textureLoader', async (importOriginal) => {
  const { Texture, TextureSource } = await import('pixi.js');
  const loaded = new Texture({ source: new TextureSource({ width: 200, height: 200 }) });
  const actual = await importOriginal<typeof import('../assets/textureLoader')>();
  return { ...actual, resolveTexture: () => loaded };
});

import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { clipper2Engine, setClipperModule } from '../geometry/Clipper2Engine';
import { bandPiecesFor, caveBandPieces } from '../assets/caveWallKit';
import { BAND_DRAWN_WIDTH } from '../assets/packCatalog';
import { resetAssetPackManager, seedPack } from '../testing/seedCatalog';
import { brokenRules, type BandCheck } from '../testing/bandChecks';
import { layLayer, type LaidBand } from '../testing/caveLayout';
import { CAVE_CASES, joinedCaves, type CaseKits } from '../testing/caveCases';
import { bandConnectors, fittedFloor, layBandRing, orientRings, seatLine } from './caveBandRenderer';
import { layerSlopes, plateauAlongWalls } from './plateauRenderer';
import { mouthFadeLayers, mouthLines } from './softEdge';
import type { BandMeasure, ManifestEntry } from './packManifest';
import type { PlateauChild } from '../store/types';
import type { Polygon } from '../types/geometry';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

afterEach(() => resetAssetPackManager());

const SET = 'Test_Cave';
const LEDGE = 'Test_Ledge';
const STONE = 'Test_Stone';
const KITS: CaseKits = { cave: SET, cliff: SET, stone: STONE };

/**
 * A measured kit drawn like a real cave set: straights of 1 to 8 cells whose rock wavers
 * along a spine either side of where a bend's rock runs (0.13 in from its joints), and an
 * inside and an outside bend in 2, 3 and 4 cells, each joint 0.15 cell past its tile's end and
 * 0.36 off its middle toward the void. With `connectors`, two round lumps of its rock, their
 * solid bodies 0.7 and 1 cell in radius. As `set` with `lengths` and `bends`, a kit of fewer pieces.
 */
function seedKit(connectors = true, set = SET, lengths = [1, 2, 3, 4, 5, 6, 7, 8], bends = [2, 3, 4]): void {
  const entry = (material: string, gridSize: string, band: BandMeasure): ManifestEntry => ({ type: 'object', material, gridSize, pieceType: 'object', variant: 'A', set, tags: ['colored'], band });
  const entries: Record<string, ManifestEntry> = {};
  for (const L of lengths) {
    const end = L / 2 + 0.15;
    const spine: [number, number][] = [];
    for (let k = 0; k <= L * 4; k++) {
      const x = L / 2 - k / 4;
      spine.push([+x.toFixed(3), +(0.23 + 0.07 * Math.sin(2.3 * x + L)).toFixed(3)]);
    }
    entries[`run_${L}x2_A`] = entry('run', `${L}x2`, { joints: [[end, 0.36], [-end, 0.36]], turnDeg: 0, spine });
  }
  for (const N of bends) {
    const end = N / 2 + 0.15;
    entries[`turn_in_${N}x${N}_A`] = entry('turn_in', `${N}x${N}`, { joints: [[N / 2 - 0.64, -end], [-end, N / 2 - 0.64]], turnDeg: 90 });
    entries[`turn_out_${N}x${N}_A`] = entry('turn_out', `${N}x${N}`, { joints: [[-end, N / 2 - 1.36], [N / 2 - 1.36, -end]], turnDeg: -90 });
  }
  if (connectors) {
    entries.lump_2x2_A = entry('lump', '2x2', { joints: [[0.04, 0], [0.04, 0]], turnDeg: 0, connector: true, radius: 0.7 });
    entries.lump_3x3_A = entry('lump', '3x3', { joints: [[0, -0.05], [0, -0.05]], turnDeg: 0, connector: true, radius: 1 });
  }
  seedPack(`test-pack-${set}`, entries);
}

const fmt = (c: BandCheck): string => JSON.stringify(c, (_, v) => (typeof v === 'number' ? +v.toFixed(2) : v));
const report = (bands: LaidBand[]): string => bands.map((b) => `${b.kind}: ${fmt(b.check)}`).join('\n');
const broken = (bands: LaidBand[]) => bands.map((b) => [b.kind, brokenRules(b.check)]);
const clean = (bands: LaidBand[]) => bands.map((b) => [b.kind, []]);

type V = [number, number];
const segDist = (p: V, a: V, b: V): number => {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
};
const toLine = (p: V, pts: V[]): number => Math.min(...pts.slice(1).map((b, i) => segDist(p, pts[i], b)));

describe('a measured cave kit on a joined, carved, brushed map', () => {
  for (const connectors of [true, false]) {
    it(`lays every ring with no bare wall, no rock in an opening or a corridor, the floor met, every piece at its size and no wedge at a joint, ${connectors ? 'with' : 'without'} connectors`, () => {
      seedKit(connectors);
      const { bands } = layLayer(joinedCaves(KITS));
      expect(broken(bands), report(bands)).toEqual([
        ['floor', []],
        ['cave', []],
      ]);
    });
  }

  it('lays a connector over a joint that bends and none inside a run, the same every time', () => {
    seedKit();
    const set = bandPiecesFor(SET);
    const ring: Polygon = [[0, 0], [6, 0], [9, 3], [9, 8], [0, 8]];
    const placed = layBandRing(ring, [], set);
    const first = bandConnectors(placed, set, 1);
    expect(first.length).toBeGreaterThan(0);
    expect(bandConnectors(layBandRing(ring, [], set), set, 1)).toEqual(first);
    for (const c of first) {
      expect(c.piece.radius).toBeGreaterThan(0);
      expect(c.at.scale).toBeGreaterThanOrEqual(0.6);
      expect(c.at.scale).toBeLessThanOrEqual(1);
      // Its body no wider than 1.4 times the rock's.
      expect(2 * c.piece.radius! * c.at.scale).toBeLessThanOrEqual(1.4 * BAND_DRAWN_WIDTH + 1e-9);
    }
    expect(placed.some((pl) => pl.piece.radius !== undefined)).toBe(false);
  });
});

describe('a cave mouth', () => {
  it('fades the floor in from nothing at the mouth to full a cell in, keeping the fitted edge beside the rock', () => {
    seedKit();
    const { layer, fit } = layLayer(joinedCaves(KITS));
    const region = fittedFloor(layer.mergedFloor!, fit);
    const mouths = mouthLines(layer.mergedFloor!, layer.caveOpenings);
    expect(mouths.length).toBeGreaterThan(0);
    const steps = mouthFadeLayers(region, mouths, 7);
    expect(steps.length).toBeGreaterThan(1);
    const inside = (p: V, rings: Polygon[]): boolean => {
      let hit = false;
      for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i][1] > p[1] !== r[j][1] > p[1] && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) hit = !hit;
      return hit;
    };
    const alpha = (p: V): number => 1 - steps.reduce((through, s) => (inside(p, s.rings) ? through * (1 - s.alpha) : through), 1);
    // In from the mouth's inner line, the notch's right side.
    const at = (d: number): V => [4.719 + d, 6.83];
    expect(alpha(at(1.2))).toBeCloseTo(1, 6);
    expect(alpha(at(0.001))).toBe(0);
    let last = 0;
    for (let d = 0; d <= 1.2; d += 0.05) {
      expect(alpha(at(d))).toBeGreaterThanOrEqual(last - 1e-9);
      last = alpha(at(d));
    }
    expect(alpha(at(0.5))).toBeGreaterThan(0);
    expect(alpha(at(0.5))).toBeLessThan(1);
    // Never more floor than the fitted floor, and its edge beside the rock either side of the mouth as it was.
    const area = (rings: Polygon[]): number => rings.reduce((sum, r) => sum + Math.abs(r.reduce((a, p, i) => a + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0)) / 2, 0);
    for (const s of steps) expect(area(clipper2Engine.difference(s.rings, region))).toBeLessThan(1e-6);
    const outer = steps[steps.length - 1].rings as V[][];
    for (const ring of region as V[][]) {
      for (const p of ring) {
        if (Math.min(...mouths.map((m) => toLine(p, m as V[]))) < 0.25) continue;
        expect(Math.min(...outer.map((r) => toLine(p, [...r, r[0]])))).toBeLessThan(0.01);
      }
    }
  });

  it('paints a map with no openings as it always did', () => {
    seedKit();
    const { layer, fit } = layLayer({ ...joinedCaves(KITS), caveOpenings: [] });
    expect(mouthLines(layer.mergedFloor!, [])).toEqual([]);
    expect(mouthFadeLayers(fittedFloor(layer.mergedFloor!, fit), [], 7)).toEqual([]);
  });
});

describe('cases the checker had not seen, with a seeded kit', () => {
  // Where a cliff meets a wall it is cut into stretches, each an open run (see plateauRenderer's
  // cliffRuns). These hold the stretches to where they must end; the rock the chain walk lays
  // along an open stretch that turns two corners is not held to the rules here.
  const caves = (bands: LaidBand[]) => bands.filter((b) => b.kind !== 'cliff');
  const tipsOf = (b: LaidBand): V[] => [b.ring[0] as V, b.ring[b.ring.length - 1] as V];

  it('cuts a cliff where it crosses a brush cave’s rock, each stretch stopping at the rock’s face', () => {
    seedKit();
    const { bands, rockLines } = layLayer(CAVE_CASES[0].layer(KITS));
    expect(broken(caves(bands)), report(bands)).toEqual(clean(caves(bands)));
    const cliffs = bands.filter((b) => b.kind === 'cliff');
    expect(cliffs).toHaveLength(2);
    const rock = rockLines.flatMap((l) => l.runs) as V[][];
    const half = BAND_DRAWN_WIDTH / 2;
    for (const c of cliffs) {
      expect(c.closed).toBe(false);
      // Each tip at the face of the rock (half its width off its line), within 0.15.
      for (const t of tipsOf(c)) expect(Math.abs(Math.min(...rock.map((w) => toLine(t, w))) - half)).toBeLessThanOrEqual(0.15);
      // Nowhere else nearer the rock's line than its face, less 0.15.
      for (const p of c.ring as V[]) expect(Math.min(...rock.map((w) => toLine(p, w)))).toBeGreaterThanOrEqual(half - 0.15);
    }
  });

  it('lays no cliff across a mouth in the wall a plateau lies on', () => {
    seedKit();
    const { bands } = layLayer(CAVE_CASES[1].layer(KITS));
    expect(broken(caves(bands)), report(bands)).toEqual(clean(caves(bands)));
    const cliffs = bands.filter((b) => b.kind === 'cliff');
    expect(cliffs).toHaveLength(1);
    for (const p of cliffs[0].ring as V[]) expect(p[0] < 0.5 && p[1] > 3 && p[1] < 5).toBe(false);
    for (const p of seatLine(cliffs[0].placed) as V[]) expect(p[0] < 0.5 && p[1] > 3 && p[1] < 5).toBe(false);
  });

  it('cuts a plateau straddling a mouth into its two free stretches, each ending on the wall’s rock at both tips', () => {
    seedKit();
    const { bands, rockLines } = layLayer(CAVE_CASES[2].layer(KITS));
    expect(broken(caves(bands)), report(bands)).toEqual(clean(caves(bands)));
    const cliffs = bands.filter((b) => b.kind === 'cliff');
    expect(cliffs).toHaveLength(2);
    const wall = rockLines.flatMap((l) => l.runs) as V[][];
    for (const c of cliffs) {
      expect(c.closed).toBe(false);
      for (const t of tipsOf(c)) expect(Math.min(...wall.map((w) => toLine(t, w)))).toBeLessThan(0.05);
    }
  });

  it('closes a small plateau’s cliff with pieces at their size, or leaves it to the ink edge, never flinging rock off it', () => {
    seedKit();
    const { bands } = layLayer(CAVE_CASES[3].layer(KITS));
    const cliffs = bands.filter((b) => b.kind === 'cliff');
    for (const c of cliffs) {
      if (c.placed.length === 0) continue;
      expect(brokenRules(c.check).filter((r) => r === 3 || r === 6), fmt(c.check)).toEqual([]);
    }
    expect(broken(bands.filter((b) => b.kind !== 'cliff')), report(bands)).toEqual(clean(bands.filter((b) => b.kind !== 'cliff')));
  });

  it('ends a slope’s face on the wall’s rock and lays no cliff rock on it', () => {
    seedKit();
    const { layer, bands, fit, rockLines } = layLayer(CAVE_CASES[4].layer(KITS));
    expect(bands.filter((b) => b.kind === 'cliff')).toEqual([]);
    expect(broken(bands), report(bands)).toEqual(clean(bands));
    const slope = layer.children.find((c) => c.childType === 'plateau') as PlateauChild;
    const wall = rockLines.flatMap((l) => l.runs) as V[][];
    const faces = layerSlopes(layer).faces.filter((f) => f.run.owner === slope && f.region.length > 0);
    for (const f of faces) {
      const drawn = plateauAlongWalls(layer, slope, f.region, fit, true) as V[][];
      // Nothing of the face past the wall's rock line into the void.
      for (const r of drawn) for (const p of r) if (p[0] < 0.5) expect(p[0]).toBeGreaterThan(Math.min(...wall.flat().map((q) => q[0])) - 0.2);
    }
  });

  it('holds a second measured kit as a cave’s rock to the same rules', () => {
    seedKit(false, LEDGE, [2, 3, 4, 5], [2]);
    const { bands } = layLayer(joinedCaves({ cave: LEDGE, cliff: LEDGE, stone: STONE }));
    expect(bands.length).toBeGreaterThan(0);
    expect(broken(bands), report(bands)).toEqual(clean(bands));
  });

  it('lays the built-in kit with no connectors and no piece moved at a bend', () => {
    const set = caveBandPieces();
    for (const ring of orientRings(joinedCaves(KITS).mergedFloor!)) {
      const placed = layBandRing(ring, [], set);
      expect(bandConnectors(placed, set, 1)).toEqual([]);
    }
  });
});
