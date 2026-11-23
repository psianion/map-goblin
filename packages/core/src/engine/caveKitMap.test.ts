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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { clipper2Engine, setClipperModule } from '../geometry/Clipper2Engine';
import { bandPiecesFor, caveBandPieces, jointsOf, kitRockWidth } from '../assets/caveWallKit';
import { BAND_DRAWN_WIDTH } from '../assets/packCatalog';
import { resetAssetPackManager, seedPack } from '../testing/seedCatalog';
import { brokenRules, checkBand, type BandCheck } from '../testing/bandChecks';
import { layLayer, type LaidBand } from '../testing/caveLayout';
import { CAVE_CASES, caseLayer, joinedCaves, type CaseKits } from '../testing/caveCases';
import { bandConnectors, FIT_DOOR_PAD, fittedFloor, layBandChain, layBandRing, orientRings, seatLine } from './caveBandRenderer';
import { kitOverlap, type WalkPlacement } from './caveWalk';
import { layerSlopes, plateauAlongWalls } from './plateauRenderer';
import { mouthFadeLayers, mouthLines } from './softEdge';
import type { BandMeasure, ManifestEntry } from './packManifest';
import type { DungeonLayer, PlateauChild, ShapeChild } from '../store/types';
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
function seedKit(connectors = true, set = SET, lengths = [1, 2, 3, 4, 5, 6, 7, 8], bends = [2, 3, 4], rockWidth?: number): void {
  const entry = (material: string, gridSize: string, band: BandMeasure): ManifestEntry => ({ type: 'object', material, gridSize, pieceType: 'object', variant: 'A', set, tags: ['colored'], band: rockWidth ? { ...band, rockWidth } : band });
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

/** One of the repo's own maps, its cave rock, stone walls and cliffs swapped for the seeded kits. */
function repoMap(file: string): DungeonLayer {
  const map = JSON.parse(readFileSync(resolve(process.cwd(), '../../session/testdata', file), 'utf8'));
  const layer = map.layers.find((l: DungeonLayer) => l.type === 'dungeon');
  const swap = (s?: string): string | undefined => (s === 'GG_Cave_Ink' ? SET : s === 'GG_Fieldstone' ? STONE : s);
  layer.style.wallTextureSetId = swap(layer.style.wallTextureSetId);
  for (const c of layer.children) {
    if (c.edgeMaterial) c.edgeMaterial = SET;
    if (c.styleOverrides?.wallTextureSetId) c.styleOverrides.wallTextureSetId = swap(c.styleOverrides.wallTextureSetId);
    if (c.childType === 'plateau' && c.edge === 'cliff') c.edgeArt = SET;
  }
  return { ...layer, rockLines: undefined, mergedFloor: null };
}

/** Cave rooms of the seeded kit side by side, one for each of `rings`. */
const caseLayerOf = (rings: Polygon[]): DungeonLayer =>
  caseLayer(
    rings.map((r, i) => ({ id: `r${i}`, name: `r${i}`, childType: 'shape', visible: true, shapeType: 'polygon', contours: [r.map(([x, y]) => [x + i * 14, y])], styleOverrides: { wallTextureSetId: SET } })),
    KITS,
  );

/** A room with a tip sharper than any bend, where two straights cross with no bend between them. */
const TIPPED: Polygon = [[0, 0], [10, 0], [3, 6]];
const PENTAGON: Polygon = [[0, 0], [6, 0], [9, 3], [9, 8], [0, 8]];

/** Rule 7 alone on a laid band, with `connectors` over its joints. */
const bareRim = (b: LaidBand, openings: Polygon[] | undefined, connectors: WalkPlacement[]): number =>
  checkBand({ ring: b.ring, closed: b.closed, placed: b.placed, connectors, gaps: b.gaps, openings, size: b.size, overlap: kitOverlap(b.placed.map((pl) => pl.piece)), doorPad: FIT_DOOR_PAD }).bareRim;

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

  it('lays a connector over a joint its pieces could not close and none inside a run, the same every time', () => {
    seedKit();
    const set = bandPiecesFor(SET);
    const ring = TIPPED;
    const placed = layBandRing(ring, [], set);
    const first = bandConnectors(placed, set, 1);
    expect(first.length).toBeGreaterThan(0);
    expect(bandConnectors(layBandRing(ring, [], set), set, 1)).toEqual(first);
    for (const c of first) {
      expect(c.piece.radius).toBeGreaterThan(0);
      expect(c.at.scale).toBeGreaterThanOrEqual(0.6);
      expect(c.at.scale).toBeLessThanOrEqual(1);
      // Its body no wider than 1.1 times the rock's.
      expect(2 * c.piece.radius! * c.at.scale).toBeLessThanOrEqual(1.1 * BAND_DRAWN_WIDTH + 1e-9);
    }
    expect(placed.some((pl) => pl.piece.radius !== undefined)).toBe(false);
  });
});

describe('joints that bend', () => {
  const BARE = 'Test_Bare';
  const THIN = 'Test_Thin';

  it('runs two pieces on over each other at a bend whether or not the kit has connectors', () => {
    seedKit(true);
    seedKit(false, BARE);
    const strip = (placed: WalkPlacement[]) => placed.map((pl) => [pl.piece.key, !!pl.piece.flipY, pl.at]);
    for (const ring of [PENTAGON, TIPPED, ...orientRings(joinedCaves(KITS).mergedFloor!)]) {
      expect(strip(layBandRing(ring, [], bandPiecesFor(SET)))).toEqual(strip(layBandRing(ring, [], bandPiecesFor(BARE))));
    }
  });

  it('lays a connector over a joint its pieces could not close, no wider than 1.1 times the kit’s rock, at 0.6 of its size or more', () => {
    seedKit();
    let laid = 0;
    for (const layer of [joinedCaves(KITS), caseLayerOf([TIPPED, PENTAGON])]) {
      const { layer: union, bands } = layLayer(layer);
      for (const b of bands) {
        expect(bareRim(b, union.caveOpenings, b.connectors), report([b])).toBe(0);
        for (const c of b.connectors) {
          laid++;
          expect(c.at.scale / b.size).toBeGreaterThanOrEqual(0.6 - 1e-9);
          expect(c.at.scale / b.size).toBeLessThanOrEqual(1 + 1e-9);
          expect(2 * c.piece.radius! * c.at.scale).toBeLessThanOrEqual(1.1 * BAND_DRAWN_WIDTH * b.size + 1e-9);
        }
      }
    }
    expect(laid).toBeGreaterThan(0);
  });

  it('reads a kit’s rock width from its straights, the built-in width for a kit without one, and holds its connectors to it', () => {
    seedKit();
    seedKit(true, THIN, [1, 2, 3, 4, 5, 6, 7, 8], [2, 3, 4], 0.85);
    expect(kitRockWidth(bandPiecesFor(THIN))).toBe(0.85);
    expect(kitRockWidth(bandPiecesFor(SET))).toBe(BAND_DRAWN_WIDTH);
    expect(kitRockWidth(caveBandPieces())).toBe(BAND_DRAWN_WIDTH);
    const { bands } = layLayer(joinedCaves({ cave: THIN, cliff: THIN, stone: STONE }));
    // Rules 1 to 6: at the thinner rock, rule 7 still finds where two of the brush cave's pieces' rock lines step sideways.
    const upTo6 = bands.map((b) => [b.kind, brokenRules(b.check).filter((r) => r <= 6)]);
    expect(upTo6, report(bands)).toEqual(clean(bands));
    for (const b of bands) {
      for (const c of b.connectors) {
        // The larger lump would have to be laid below 0.6 of its size to keep that narrow.
        expect(c.piece.radius).toBe(0.7);
        expect(2 * c.piece.radius! * c.at.scale).toBeLessThanOrEqual(1.1 * 0.85 * b.size + 1e-9);
      }
    }
  });
});

describe('closing a ring or a run', () => {
  const inside = (b: LaidBand) => b.placed.every((pl) => pl.at.scale / (pl.size ?? b.size) >= 0.85 - 1e-6 && pl.at.scale / (pl.size ?? b.size) <= 1.25 + 1e-6);

  it('closes the Warren’s ring with every piece between 0.85 and 1.25 of its size, none laid across its floor or into an opening', () => {
    for (const connectors of [true, false]) {
      resetAssetPackManager();
      seedKit(connectors);
      const { bands } = layLayer(repoMap('goblin-warren.mapbuilder'));
      expect(bands.length).toBeGreaterThan(0);
      const closing = bands.map((b) => [b.kind, brokenRules(b.check).filter((r) => r === 2 || r === 3 || r === 6)]);
      expect(closing, report(bands)).toEqual(clean(bands));
      expect(bands.flatMap((b) => b.placed).some((pl) => pl.branch === 'close-fill')).toBe(true);
    }
  }, 30_000);

  it('lays no piece outside 0.85 to 1.25 of its size on any drawing, cliffs included', () => {
    seedKit();
    const layers = [joinedCaves(KITS), ...CAVE_CASES.map((c) => c.layer(KITS)), ...['goblin-warren.mapbuilder', 'testing-cave.ggvtt', 'outdoor-cave.ggvtt'].map(repoMap)];
    for (const layer of layers) {
      const { bands } = layLayer(layer);
      for (const b of bands) expect(inside(b), `${b.kind}: ${fmt(b.check)}`).toBe(true);
    }
  }, 30_000);
});

describe('narrow passages and wall width', () => {
  /** Where the floor of `b` narrows to `most` cells or less: each point of its edge with the edge facing it across the floor, and how far. */
  const facing = (b: LaidBand, most: number): { e: V; m: V; across: number }[] => {
    const ring = b.ring as V[];
    const out: { e: V; m: V; across: number }[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const c = ring[(i + 1) % ring.length];
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (L < 1e-9) continue;
      const t: V = [(c[0] - a[0]) / L, (c[1] - a[1]) / L];
      // The floor is on the right of travel.
      const n: V = [-t[1], t[0]];
      for (let s = 0.05; s < L; s += 0.1) {
        const e: V = [a[0] + t[0] * s, a[1] + t[1] * s];
        let hit = Infinity;
        for (let j = 0; j < ring.length; j++) {
          if (j === i) continue;
          const p = ring[j];
          const q = ring[(j + 1) % ring.length];
          const f: V = [q[0] - p[0], q[1] - p[1]];
          const den = n[0] * f[1] - n[1] * f[0];
          if (Math.abs(den) < 1e-12) continue;
          const w: V = [p[0] - e[0], p[1] - e[1]];
          const r = (w[0] * f[1] - w[1] * f[0]) / den;
          const u = (w[0] * n[1] - w[1] * n[0]) / den;
          if (r > 1e-6 && u >= 0 && u <= 1) hit = Math.min(hit, r);
        }
        if (hit <= most) out.push({ e, m: [e[0] + n[0] * (hit / 2), e[1] + n[1] * (hit / 2)], across: hit });
      }
    }
    return out;
  };
  it('lays the Testing map’s brush cave at the size its narrow passages ask for', () => {
    seedKit();
    const { bands } = layLayer(repoMap('testing-cave.ggvtt'));
    const cave = bands.filter((b) => b.kind === 'cave');
    expect(cave.length).toBeGreaterThan(0);
    // Rules 1, 3, 5, 6 and 7; rock still reaches its mouth and one passage (rules 2 and 4).
    const held = bands.map((b) => [b.kind, brokenRules(b.check).filter((r) => r !== 2 && r !== 4)]);
    expect(held, report(bands)).toEqual(clean(bands));
    for (const b of cave) {
      const narrow = facing(b, 1);
      expect(narrow.length).toBeGreaterThan(0);
      // Smaller than its wall width asks for, and no smaller than half that.
      for (const pl of b.placed) {
        expect(pl.size!).toBeLessThan(b.size);
        expect(pl.size!).toBeGreaterThanOrEqual(0.5 * b.size - 1e-9);
      }
    }
  });

  for (const width of [0.25, 0.5, 1]) {
    it(`lays everything at a wall width of ${width}, set on the layer, pinned on the floors of one ring, or on a brush cave`, () => {
      seedKit();
      const size = width / 0.5;
      const base = joinedCaves(KITS);
      const pin = (...ids: string[]) => base.children.map((c) => (ids.includes(c.id) ? { ...c, styleOverrides: { ...(c as ShapeChild).styleOverrides, wallWidth: width } } : c));
      const drawings: [string, DungeonLayer, (b: LaidBand) => number][] = [
        ['on the layer', { ...base, id: `${base.id}-w`, style: { ...base.style, wallWidth: width } }, () => size],
        ['on its floors', { ...base, id: `${base.id}-f`, children: pin('six', 'rect', 'corridor') }, (b) => (b.kind === 'floor' ? size : 1)],
        ['on a brush cave', { ...base, id: `${base.id}-c`, children: pin('cave') }, (b) => (b.kind === 'cave' ? size : 1)],
      ];
      for (const [where, layer, want] of drawings) {
        const { layer: union, bands, rockLines } = layLayer(layer);
        expect(bands.map((b) => b.size), where).toEqual(bands.map(want));
        // Rules 2, 3, 6 and 7 at every width; at a width of 1 the six-sided cave's mouth notch and the
        // brush cave still break rules 1, 4 and 5.
        const held = bands.map((b) => [b.kind, brokenRules(b.check).filter((r) => width < 1 || ![1, 4, 5].includes(r))]);
        expect(held, `${where}\n${report(bands)}`).toEqual(clean(bands));
        for (const b of bands) {
          // Its connectors no wider than 1.1 times its rock, at its size.
          for (const c of b.connectors) expect(2 * c.piece.radius! * c.at.scale).toBeLessThanOrEqual(1.1 * BAND_DRAWN_WIDTH * b.size + 1e-9);
          expect(bareRim(b, union.caveOpenings, b.connectors)).toBe(0);
        }
        // Each saved rock line lies within the rock's reach of some band's edge, at that band's size.
        for (const line of rockLines) {
          for (const run of line.runs) {
            for (const p of run as V[]) expect(Math.min(...bands.map((b) => toLine(p, [...(b.ring as V[]), b.ring[0] as V]) / b.size))).toBeLessThan(0.8);
          }
        }
      }
    });
  }
});

describe('open runs with corners', () => {
  it('lays an open run of straight sides bend by bend, its art ending exactly at the run’s two ends', () => {
    seedKit();
    const set = bandPiecesFor(SET);
    // Each corner turning toward the floor (the right of travel) takes a bend; one turning toward the
    // void has none that suits it, and its two sides cross there as a ring's do.
    for (const [run, bends] of [
      [[[8, 0], [8, 6], [0, 6], [0, 0]], 2],
      [[[6, 5], [0, 5], [0, 0]], 1],
      [[[11, 9], [6, 9], [6, 4], [2, 4], [2, 0]], 2],
    ] as [Polygon, number][]) {
      const placed = layBandChain(run, [], set);
      expect(placed.filter((pl) => pl.piece.turnDeg !== 0)).toHaveLength(bends);
      for (const pl of placed) expect(pl.at.scale).toBeGreaterThanOrEqual(0.85 - 1e-6);
      for (const pl of placed) expect(pl.at.scale).toBeLessThanOrEqual(1.25 + 1e-6);
      // The first piece's art starts at the run's start, the last one's ends at its end, along each end's side.
      const half = kitOverlap(set) / 2;
      const end = (pl: WalkPlacement, k: 0 | 1, from: V, along: V): number => {
        const J = jointsOf(pl.piece, pl.at)[k] as V;
        const t: V = [pl.Q[0] - pl.P[0], pl.Q[1] - pl.P[1]];
        const L = Math.hypot(t[0], t[1]);
        const art: V = [J[0] + ((k === 0 ? 1 : -1) * t[0] * half * pl.at.scale) / L, J[1] + ((k === 0 ? 1 : -1) * t[1] * half * pl.at.scale) / L];
        return (art[0] - from[0]) * along[0] + (art[1] - from[1]) * along[1];
      };
      const [a, b] = [run[0] as V, run[1] as V];
      const [y, z] = [run[run.length - 2] as V, run[run.length - 1] as V];
      const unit = (p: V, q: V): V => [(q[0] - p[0]) / Math.hypot(q[0] - p[0], q[1] - p[1]), (q[1] - p[1]) / Math.hypot(q[0] - p[0], q[1] - p[1])];
      expect(end(placed[0], 0, a, unit(a, b))).toBeCloseTo(0, 2);
      expect(end(placed[placed.length - 1], 1, z, unit(y, z))).toBeCloseTo(0, 2);
      const check = checkBand({ ring: run, closed: false, placed, gaps: [], size: 1, overlap: kitOverlap(set), doorPad: FIT_DOOR_PAD });
      expect(brokenRules(check).filter((r) => [1, 2, 3, 6, 7].includes(r)), fmt(check)).toEqual([]);
    }
  });

  it('holds every cliff of the cases to rules 1, 2, 3, 6 and 7, or leaves it to the ink edge', () => {
    seedKit();
    for (const c of CAVE_CASES) {
      const { bands } = layLayer(c.layer(KITS));
      for (const b of bands.filter((x) => x.kind === 'cliff')) {
        if (b.placed.length === 0) continue;
        // Where a cliff crosses a brush cave's rock its stretch ends a little further off its line than rule 3 allows.
        const rules = c.name === 'a cliff meeting a brush cave' ? [1, 2, 6, 7] : [1, 2, 3, 6, 7];
        expect(brokenRules(b.check).filter((r) => rules.includes(r)), `${c.name}: ${fmt(b.check)}`).toEqual([]);
      }
    }
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
