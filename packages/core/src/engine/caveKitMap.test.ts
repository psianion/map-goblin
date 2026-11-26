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
import { setClipperModule } from '../geometry/Clipper2Engine';
import { bandPiecesFor, caveBandPieces, jointsOf, KIT_SHADOW, kitRockWidth, kitShadow } from '../assets/caveWallKit';
import { BAND_DRAWN_WIDTH } from '../assets/packCatalog';
import { resetAssetPackManager, seedPack } from '../testing/seedCatalog';
import { artCorners, bentMeshStray, brokenRules, checkBand, type BandCheck } from '../testing/bandChecks';
import { layLayer, type LaidBand } from '../testing/caveLayout';
import { BRUSH_CAVE, CAVE_CASES, caseLayer, joinedCaves, type CaseKits } from '../testing/caveCases';
import { useStore } from '../store/store';
import { carveFloors, type SoftErase } from './tools/eraseShapes';
import { computeMergedFloor } from './mergedFloor';
import { bandBends, bandConnectors, FIT_DOOR_PAD, fittedFloor, layBandChain, layBandRing, mitredJoints, mouthEnds, orientRings, seatLine } from './caveBandRenderer';
import { bendWarp, endTangents, MITRE_MOST_DEG, unbend } from './bandBend';
import { pieceRockLine } from '../testing/bandChecks';
import { kitOverlap, type WalkPlacement } from './caveWalk';
import { layerSlopes, ledgeRuns, plateauAlongWalls } from './plateauRenderer';
import { mouthLines, mouthRamp } from './softEdge';
import { wallShadowRamp } from './wallShadow';
import { insideRings, rampAlphaAt } from './rampMask';
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
 * solid bodies 0.7 and 1 cell in radius. As `set` with `lengths` and `bends`, a kit of fewer pieces;
 * `extra` goes on every piece's measurements.
 */
function seedKit(connectors = true, set = SET, lengths = [1, 2, 3, 4, 5, 6, 7, 8], bends = [2, 3, 4], rockWidth?: number, extra: Partial<BandMeasure> = {}): void {
  const entry = (material: string, gridSize: string, band: BandMeasure): ManifestEntry => ({ type: 'object', material, gridSize, pieceType: 'object', variant: 'A', set, tags: ['colored'], band: { ...(rockWidth ? { ...band, rockWidth } : band), ...extra } });
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
// Rule 8 (corners) is held on cliffs, in cliffCorners.test.ts: a cave's corners are as its walk lays them.
const rulesOf = (b: LaidBand): number[] => brokenRules(b.check).filter((r) => r !== 8 || b.kind === 'cliff');
const broken = (bands: LaidBand[]) => bands.map((b) => [b.kind, rulesOf(b)]);
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

/** A bent piece's art end at joint `k`, as drawn, from `from` to `to` off its rock line (cells at its stretch's size). */
const bentEdge = (pl: WalkPlacement, k: 0 | 1, from: number, to: number): V[] => {
  const unit = pl.bend!.unit;
  const J = jointsOf(pl.piece, pl.at)[k] as V;
  const t = endTangents(pl)[k];
  const n: V = [-t[1], t[0]];
  const inward = (k === 0 ? 1 : -1) * pl.bend!.half;
  const warp = bendWarp(pl);
  const out: V[] = [];
  for (let w = from * unit; w <= to * unit + 1e-9; w += 0.02 * unit) out.push(warp([J[0] + t[0] * inward + n[0] * w, J[1] + t[1] * inward + n[1] * w]) as V);
  return out;
};

/**
 * Each joint of `b` drawn bent: how far, cells at size 1, the first piece's bent end strays from
 * the next one's across the rock's body (half a cell either side of their rock line), and how far it turns.
 */
const jointGaps = (b: LaidBand): { gap: number; turnDeg: number; at: V }[] => {
  const set = b.placed.map((pl) => pl.piece);
  const drawn = bandBends(b.placed, set, b.size);
  return mitredJoints(b.placed, set, b.size).map((m) => {
    const ea = bentEdge(drawn[m.k], 1, -0.5, 0.5);
    const eb = bentEdge(drawn[m.j], 0, -1, 1);
    return { gap: Math.max(...ea.map((p) => toLine(p, eb))) / b.size, turnDeg: (m.turn * 180) / Math.PI, at: m.at as V };
  });
};

/** Each tapered end of `b`'s pieces as drawn, stopped at mouths: its width across the art (a cell either side of its rock line) from 0.8 in to the tip. */
const taperProfiles = (b: LaidBand): { at: V; widths: number[] }[] => {
  const set = b.placed.map((pl) => pl.piece);
  const out: { at: V; widths: number[] }[] = [];
  for (const pl of bandBends(b.placed, set, b.size, mouthEnds(b.gaps, b.size))) {
    for (const k of [0, 1] as const) {
      if (!pl.bend?.taper?.[k]) continue;
      const unit = pl.bend.unit;
      const J = jointsOf(pl.piece, pl.at)[k] as V;
      const t = endTangents(pl)[k];
      const n: V = [-t[1], t[0]];
      const inSign = k === 0 ? 1 : -1;
      const warp = bendWarp(pl);
      const widths: number[] = [];
      for (let d = 0.8 * unit; d >= -1e-9; d -= 0.02 * unit) {
        const at = (w: number): V => warp([J[0] + t[0] * inSign * (pl.bend!.half + Math.max(0, d)) + n[0] * w, J[1] + t[1] * inSign * (pl.bend!.half + Math.max(0, d)) + n[1] * w]) as V;
        const [p, q] = [at(-unit), at(unit)];
        widths.push(Math.hypot(p[0] - q[0], p[1] - q[1]));
      }
      out.push({ at: J, widths });
    }
  }
  return out;
};

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

  it('lays the same pieces at a bend whether or not the kit has connectors, none moved over the other', () => {
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

describe('pieces bent to meet at a joint', () => {
  /** A cave room of three corners turning 30 to 50 degrees, and two straight sides. */
  const BENT: Polygon = [[0, 0], [8, 0], [12, 3], [13, 8], [6, 10], [0, 8]];

  it('closes every joint of 60° or less with no gap across the rock, and lays no connector there', () => {
    seedKit();
    let joints = 0;
    for (const layer of [joinedCaves(KITS), caseLayerOf([BENT, PENTAGON])]) {
      const { bands } = layLayer(layer);
      for (const b of bands) {
        const gaps = jointGaps(b);
        for (const g of gaps) {
          expect(Math.abs(g.turnDeg)).toBeLessThanOrEqual(MITRE_MOST_DEG + 1e-9);
          expect(g.gap, `${b.kind} joint at ${g.at} turning ${g.turnDeg.toFixed(1)}`).toBeLessThanOrEqual(0.05);
          for (const c of b.connectors) expect(Math.hypot(c.P[0] - g.at[0], c.P[1] - g.at[1]), `connector at ${c.P}`).toBeGreaterThan(0.5 * b.size);
        }
        joints += gaps.filter((g) => Math.abs(g.turnDeg) >= 5).length;
      }
    }
    // At least three of them bend.
    expect(joints).toBeGreaterThanOrEqual(3);
  });

  it('leaves a joint sharper than 60° rigid, and a kit without measured pieces as it was', () => {
    seedKit();
    const set = bandPiecesFor(SET);
    const placed = layBandRing(TIPPED, [], set);
    for (const m of mitredJoints(placed, set)) expect(Math.abs(m.turn)).toBeLessThanOrEqual((MITRE_MOST_DEG * Math.PI) / 180 + 1e-9);
    expect(bandConnectors(placed, set).length).toBeGreaterThan(0);
    const ink = caveBandPieces();
    for (const ring of [PENTAGON, TIPPED]) {
      const laid = layBandRing(ring, [], ink);
      expect(bandBends(laid, ink)).toBe(laid);
      expect(mitredJoints(laid, ink)).toEqual([]);
    }
  });

  it('draws a piece with no bent end as laid', () => {
    seedKit();
    const set = bandPiecesFor(SET);
    const placed = layBandChain([[0, 0], [12, 0]], [], set);
    const drawn = bandBends(placed, set);
    expect(drawn.length).toBe(placed.length);
    for (const pl of drawn) {
      if (pl.bend) continue;
      const p: V = [pl.at.position.x + 0.3, pl.at.position.y - 0.2];
      expect(bendWarp(pl)(p)).toEqual(p);
    }
  });

  it('cuts each bent piece’s mesh so it draws its warp within three hundredths of a cell, where the warp itself steps included, and no finer than that asks', () => {
    seedKit();
    let pieces = 0;
    let vertices = 0;
    for (const layer of [joinedCaves(KITS), caseLayerOf([BENT, PENTAGON]), ...CAVE_CASES.map((c) => c.layer(KITS))]) {
      for (const b of layLayer(layer).bands) {
        const set = b.placed.map((pl) => pl.piece);
        for (const pl of bandBends(b.placed, set, b.size, b.kind === 'cliff' ? undefined : mouthEnds(b.gaps, b.size))) {
          if (!pl.bend) continue;
          const stray = bentMeshStray(pl, artCorners(pl));
          expect(stray.worst, `${pl.piece.key} at ${pl.at.position.x.toFixed(2)},${pl.at.position.y.toFixed(2)}`).toBeLessThanOrEqual(0.03);
          pieces++;
          vertices += stray.vertices;
        }
      }
    }
    expect(pieces).toBeGreaterThan(10);
    // Finer than this a piece on average is more than any bend here asks.
    expect(vertices / pieces).toBeLessThan(2500);
  }, 60_000);
});

describe('a run tapered at a mouth', () => {
  it('narrows each end stopping at a mouth or a door to nothing at its tip, never widening on the way', () => {
    seedKit();
    const { bands } = layLayer(joinedCaves(KITS));
    let tapers = 0;
    for (const b of bands) {
      for (const { at, widths } of taperProfiles(b)) {
        tapers++;
        expect(widths[widths.length - 1], `tip at ${at}`).toBeLessThan(1e-6);
        for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeLessThanOrEqual(widths[i - 1] + 1e-9);
      }
      // Each tip at a mouth or a door.
      for (const { at } of taperProfiles(b)) expect(b.gaps.some((g) => Math.hypot(at[0] - g.position[0], at[1] - g.position[1]) <= g.width / 2 + 0.5 * b.size)).toBe(true);
    }
    // The mouth's two sides.
    expect(tapers).toBeGreaterThanOrEqual(2);
  });

  it('tapers nothing on a map with no mouths or doors', () => {
    seedKit();
    const plain = joinedCaves(KITS);
    const { bands } = layLayer({ ...plain, caveOpenings: [], children: plain.children.filter((c) => c.childType !== 'door') });
    for (const b of bands) expect(taperProfiles(b)).toEqual([]);
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
    const held = bands.map((b) => [b.kind, rulesOf(b).filter((r) => r !== 2 && r !== 4)]);
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
        const held = bands.map((b) => [b.kind, rulesOf(b).filter((r) => width < 1 || ![1, 4, 5].includes(r))]);
        expect(held, `${where}\n${report(bands)}`).toEqual(clean(bands));
        for (const b of bands) {
          // Its connectors no wider than 1.1 times its rock, at its size.
          for (const c of b.connectors) expect(2 * c.piece.radius! * c.at.scale).toBeLessThanOrEqual(1.1 * BAND_DRAWN_WIDTH * b.size + 1e-9);
          expect(bareRim(b, union.caveOpenings, b.connectors)).toBe(0);
          // Its bent joints closed and its tapers ending in a tip, at its size.
          for (const g of jointGaps(b)) expect(g.gap, `${where} ${b.kind} joint at ${g.at}`).toBeLessThanOrEqual(0.05);
          for (const { at, widths } of taperProfiles(b)) expect(widths[widths.length - 1], `${where} tip at ${at}`).toBeLessThan(1e-6);
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
  it('keeps the floor full up to the mouth, and runs it out about a cell past it, fading into the ground', () => {
    seedKit();
    const { layer, fit } = layLayer(joinedCaves(KITS));
    const region = fittedFloor(layer.mergedFloor!, fit);
    const mouths = mouthLines(layer.mergedFloor!, layer.caveOpenings);
    expect(mouths.length).toBeGreaterThan(0);
    const ramp = mouthRamp(region, mouths, 7)!;
    expect(ramp).not.toBeNull();
    const alpha = (p: V): number => rampAlphaAt(ramp, p);
    // Across the mouth's inner line, the notch's right side: the floor is in from it, the ground
    // out, through the notch (its top and bottom are mouth too) and past it.
    const at = (d: number): V => [4.719 + d, 6.83];
    for (const d of [0.05, 0.5, 1.2]) expect(alpha(at(d))).toBeCloseTo(1, 2);
    expect(alpha(at(-0.02))).toBeGreaterThan(0.95);
    expect(alpha(at(-2.8))).toBeLessThan(0.01);
    let last = 1;
    // A ramp all the way: no jump between steps 0.05 apart.
    for (let d = 0; d >= -2.8; d -= 0.05) {
      expect(Math.abs(alpha(at(d)) - last), `at ${d.toFixed(2)}`).toBeLessThan(0.1);
      last = alpha(at(d));
    }
    expect(alpha(at(-0.5))).toBeGreaterThan(0.05);
    expect(alpha(at(-0.5))).toBeLessThan(0.95);
    // Painted out there: the floor's outline grows by the run-out.
    expect(insideRings(ramp.clip!, at(-0.5))).toBe(true);
    expect(insideRings(region, at(-0.5))).toBe(false);
  });

  it('leaves no hard edge anywhere round a mouth: across it, beside it and past the rock either side', () => {
    seedKit();
    const { layer, fit } = layLayer(joinedCaves(KITS));
    const region = fittedFloor(layer.mergedFloor!, fit);
    const mouths = mouthLines(layer.mergedFloor!, layer.caveOpenings);
    const ramp = mouthRamp(region, mouths, 7)!;
    const near = (p: V): number =>
      Math.min(
        ...mouths.map(([a, b]) => {
          const [vx, vy] = [b[0] - a[0], b[1] - a[1]];
          const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy || 1)));
          return Math.hypot(p[0] - a[0] - vx * t, p[1] - a[1] - vy * t);
        }),
      );
    // What is painted: the field where the clip keeps it, nothing where it cuts.
    const shown = (p: V): number => (insideRings(ramp.clip!, p) ? rampAlphaAt(ramp, p) : 0);
    const step = 0.02;
    let checked = 0;
    for (const [a, b] of mouths) {
      const [x0, x1] = [Math.min(a[0], b[0]) - 1.2, Math.max(a[0], b[0]) + 1.2];
      const [y0, y1] = [Math.min(a[1], b[1]) - 1.2, Math.max(a[1], b[1]) + 1.2];
      for (let y = y0; y <= y1; y += step) {
        for (let x = x0; x <= x1; x += step) {
          const p: V = [x, y];
          // Within a cell of the mouth, where the run-out is its full length.
          if (near(p) > 1) continue;
          for (const q of [[x + step, y], [x, y + step]] as V[]) {
            if (near(q) > 1) continue;
            checked++;
            expect(Math.abs(shown(q) - shown(p)), `at ${x.toFixed(2)}, ${y.toFixed(2)}`).toBeLessThan(0.08);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  }, 30_000);

  it('paints a map with no openings as it always did', () => {
    seedKit();
    const { layer, fit } = layLayer({ ...joinedCaves(KITS), caveOpenings: [] });
    expect(mouthLines(layer.mergedFloor!, [])).toEqual([]);
    expect(mouthRamp(fittedFloor(layer.mergedFloor!, fit), [], 7)).toBeNull();
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

describe('a hole erased inside a cave', () => {
  const circle = (c: V, r: number): Polygon => Array.from({ length: 48 }, (_, k): [number, number] => [c[0] + r * Math.cos((2 * Math.PI * k) / 48), c[1] + r * Math.sin((2 * Math.PI * k) / 48)]);
  const brushCaveLayer = () => caseLayer([{ id: 'cave', name: 'cave', childType: 'shape', visible: true, shapeType: 'polygon', contours: [BRUSH_CAVE], edgeMaterial: SET }], KITS);
  const caveRoomLayer = () =>
    caseLayer([{ id: 'room', name: 'room', childType: 'shape', visible: true, shapeType: 'polygon', contours: [[[0, 0], [14, 0], [14, 12], [0, 12]]], styleOverrides: { wallTextureSetId: SET } }], KITS);
  /** Each cave, the middle a hole is erased round, and a point on its wall. */
  const CAVES: [string, () => DungeonLayer, V, V][] = [
    ['a brush cave', brushCaveLayer, [7.4, 19.6], [0.741, 21.552]],
    ['a drawn cave room', caveRoomLayer, [7, 6], [0, 6]],
  ];
  /** `layer` in the store, as the eraser finds it. */
  const stored = (layer: DungeonLayer): DungeonLayer => {
    useStore.setState((s) => {
      s.layers = [layer];
      s.ui.activeLayerId = layer.id;
      s.selection.selectedIds = [];
      s.tools.settings.material.rockOnCut = false;
    });
    return useStore.getState().layers[0] as DungeonLayer;
  };
  /** The layer in the store now, its union worked out again as the store's subscriber does. */
  const now = (): DungeonLayer => {
    const l = useStore.getState().layers[0] as DungeonLayer;
    return { ...l, mergedFloor: computeMergedFloor(l) };
  };
  /** The bands laid round the hole: every point of its edge within the hole's reach of its centre. */
  const holeBands = (bands: LaidBand[], c: V, r: number) => bands.filter((b) => b.ring.every((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) <= r + 0.3));
  const strokes: [string, (c: V, r: number) => { area: Polygon[]; soft?: SoftErase }[]][] = [
    ['in one stroke', (c, r) => [{ area: [circle(c, r)] }]],
    // The second stroke runs over the hole the first left: its own cut is the edge it meets.
    ['in two strokes, the second over the hole the first left', (c, r) => [{ area: [circle([c[0] - r / 4, c[1]], r / 2)] }, { area: [circle(c, r)] }]],
    ['with a feathered brush', (c, r) => [{ area: [circle(c, r)], soft: { area: [circle(c, r)], core: [circle(c, r * 0.7)], feather: r * 0.3, strength: 1 } }]],
  ];

  for (const [where, make, c] of CAVES) {
    for (const [how, strokesOf] of strokes) {
      for (const r of [0.25, 0.5, 1, 2, 4]) {
        it(`rings a hole of radius ${r} in ${where} ${how} with one closed ring of the cave’s rock, opening nothing`, () => {
          seedKit();
          let layer = stored(make());
          const before = layer.caveOpenings;
          for (const s of strokesOf(c, r)) {
            expect(carveFloors(layer, layer.id, s.area, [], 'Erase', s.soft)).toBe(true);
            layer = stored(now());
          }
          expect(now().caveOpenings ?? []).toEqual(before ?? []);
          // No soft fade round a hole that has rock.
          for (const child of now().children) expect((child as ShapeChild).fades).toBeUndefined();
          const { bands } = layLayer(now());
          const holes = holeBands(bands, c, r);
          expect(holes, report(bands)).toHaveLength(1);
          const [hole] = holes;
          expect(hole.placed.length).toBeGreaterThan(0);
          expect(brokenRules(hole.check).filter((k) => [1, 3, 5, 6].includes(k)), fmt(hole.check)).toEqual([]);
          const kit = new Set(bandPiecesFor(SET).map((p) => p.key));
          const ringSize = hole.placed[0].size ?? hole.size;
          for (const pl of hole.placed) {
            expect(kit.has(pl.piece.key)).toBe(true);
            // Every piece inside 0.85 to 1.25 of the size the ring is laid at, whatever that is.
            expect(pl.size ?? hole.size).toBe(ringSize);
            expect(pl.at.scale / ringSize).toBeGreaterThanOrEqual(0.85 - 1e-6);
            expect(pl.at.scale / ringSize).toBeLessThanOrEqual(1.25 + 1e-6);
          }
          // One closed ring, every joint of it bent to meet.
          const runs = ledgeRuns(hole.placed, true);
          expect(runs.map((x) => x.open), fmt(hole.check)).toEqual([false]);
          const set = hole.placed.map((pl) => pl.piece);
          expect(mitredJoints(hole.placed, set, ringSize)).toHaveLength(hole.placed.length);
          for (const g of jointGaps(hole)) expect(g.gap).toBeLessThanOrEqual(0.05);
        }, 30_000);
      }
    }
  }

  it('still opens a mouth for an erase from inside the floor across its wall', () => {
    seedKit();
    for (const [, make, , wall] of CAVES) {
      const layer = stored(make());
      expect(carveFloors(layer, layer.id, [circle(wall, 1)])).toBe(true);
      expect((now().caveOpenings ?? []).length).toBeGreaterThan(0);
    }
  });
});

describe('a run its pieces cannot close at their size', () => {
  const FOUR = 'Test_Four';
  /**
   * A gently curving run 5.7 cells long, each corner turning 10 degrees: longer than one 4-cell
   * piece reaches at 1.25 of its size, shorter than two lapping at 0.85.
   */
  const ARC: Polygon = (() => {
    const pts: [number, number][] = [[0, 0]];
    let a = 0;
    for (let k = 0; k < 4; k++) {
      const [x, y] = pts[pts.length - 1];
      pts.push([x + 1.425 * Math.cos(a), y + 1.425 * Math.sin(a)]);
      a += (10 * Math.PI) / 180;
    }
    return pts;
  })();

  it('closes with the nearest fit rather than leaving wall bare', () => {
    seedKit(false, FOUR, [4], []);
    const set = bandPiecesFor(FOUR);
    for (const run of [ARC, [...ARC].reverse()]) {
      const placed = layBandChain(run, [], set);
      expect(placed.length).toBeGreaterThan(0);
      // A walked run's art stops a little short of its very tips, whatever its fit: held from half a cell in.
      const n = run.length;
      const toward = (a: V, b: V): V => [a[0] + ((b[0] - a[0]) * 0.5) / Math.hypot(b[0] - a[0], b[1] - a[1]), a[1] + ((b[1] - a[1]) * 0.5) / Math.hypot(b[0] - a[0], b[1] - a[1])];
      const inner: Polygon = [toward(run[0] as V, run[1] as V), ...run.slice(1, -1), toward(run[n - 1] as V, run[n - 2] as V)];
      const check = checkBand({ ring: inner, closed: false, placed, gaps: [], size: 1, overlap: kitOverlap(set), doorPad: FIT_DOOR_PAD });
      // Rule 1 wins over rule 6: rock a little off its size, not bare wall.
      expect(brokenRules(check).filter((r) => r === 1 || r === 2 || r === 3), fmt(check)).toEqual([]);
      for (const pl of placed) expect(Math.abs(Math.log(pl.at.scale))).toBeLessThan(Math.log(2));
    }
  });
});

describe('a wall’s floor shadow', () => {
  const laidRock = (bands: LaidBand[]) => bands.filter((b) => b.kind !== 'cliff').map((b) => ({ placed: b.placed, closed: b.closed, size: b.size }));
  /** Each run of rock line the bands were laid on, as wallShadow lays its shadow along them. */
  const runsOf = (bands: LaidBand[]) =>
    bands.filter((b) => b.kind !== 'cliff').flatMap((b) => ledgeRuns(b.placed, b.closed).map(({ run, open }) => ({ line: seatLine(run, !open) as V[], open })));
  /** Points along `line` every 0.1, `off` to its right (the floor side), clear of an open run's ends by half a cell. */
  const inside = (line: V[], open: boolean, off: number): V[] => {
    const out: V[] = [];
    const n = line.length;
    let walked = 0;
    const total = line.slice(1).reduce((t, p, i) => t + Math.hypot(p[0] - line[i][0], p[1] - line[i][1]), 0) + (open ? 0 : Math.hypot(line[0][0] - line[n - 1][0], line[0][1] - line[n - 1][1]));
    for (let i = 0; i < (open ? n - 1 : n); i++) {
      const a = line[i];
      const b = line[(i + 1) % n];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-9) continue;
      const r: V = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
      for (let s = 0; s < L; s += 0.1) {
        if (!open || (walked + s > 0.5 && walked + s < total - 0.5)) out.push([a[0] + ((b[0] - a[0]) * s) / L + r[0] * off, a[1] + ((b[1] - a[1]) * s) / L + r[1] * off]);
      }
      walked += L;
    }
    return out;
  };

  it('lays one band along the rock line, as dark past every bent joint as on a straight stretch', () => {
    seedKit();
    const { bands } = layLayer(joinedCaves(KITS));
    const shadow = wallShadowRamp(laidRock(bands))!;
    expect(shadow).not.toBeNull();
    const bent = bands.flatMap((b) => b.placed).filter((pl) => pl.piece.turnDeg !== 0);
    expect(bent.length).toBeGreaterThanOrEqual(3);
    // 0.3 in from the rock line, and half way out across the shadow past the rock's face: every
    // point as dark as four fifths of the middle one, which lies on a straight stretch.
    const runs = runsOf(bands);
    // Where the line steps back on itself at a joint, a point moved off one stretch can land nearer another: only those that lie that far from all of it count.
    const fromLine = (p: V): number => Math.min(...runs.map(({ line, open }) => toLine(p, open ? line : [...line, line[0]])));
    for (const off of [0.3, 0.6 + 0.3]) {
      const points = runs.flatMap(({ line, open }) => inside(line, open, off)).filter((p) => fromLine(p) >= off - 0.02);
      const alphas = points.map((p) => rampAlphaAt(shadow, p));
      const middle = [...alphas].sort((a, b) => a - b)[alphas.length >> 1];
      expect(middle).toBeGreaterThan(0);
      alphas.forEach((a, i) => expect(a, `${points[i]}`).toBeGreaterThanOrEqual(0.8 * middle));
    }
  });

  it('paints nothing inside a mouth or a door', () => {
    seedKit();
    const { layer, bands } = layLayer(joinedCaves(KITS));
    const shadow = wallShadowRamp(laidRock(bands), layer.caveOpenings)!;
    const mouth = layer.caveOpenings![0] as V[];
    const xs = mouth.map((p) => p[0]);
    const ys = mouth.map((p) => p[1]);
    // Clear of its outline by more than one of the shadow's texels, which the filter blends with its neighbours.
    for (let x = Math.min(...xs) + 0.12; x < Math.max(...xs) - 0.12; x += 0.1) {
      for (let y = Math.min(...ys) + 0.12; y < Math.max(...ys) - 0.12; y += 0.1) expect(rampAlphaAt(shadow, [x, y]), `mouth at ${x}, ${y}`).toBe(0);
    }
    // The rectangular cave's door, half a cell either side of its middle, on its wall.
    for (let x = 19.987 - 0.4; x <= 19.987 + 0.4; x += 0.05) {
      for (const y of [10.9, 11.005, 11.1]) expect(rampAlphaAt(shadow, [x, y]), `door at ${x}, ${y}`).toBe(0);
    }
  });

  it('falls off as a ramp from the rock’s face over the kit’s reach', () => {
    seedKit();
    const { bands } = layLayer(joinedCaves(KITS));
    const shadow = wallShadowRamp(laidRock(bands))!;
    const at = (d: number) => rampAlphaAt(shadow, [22, 4.033 + d]);
    const peak = at(0.3);
    expect(peak).toBeCloseTo(KIT_SHADOW.strength, 2);
    let last = peak;
    for (let d = 0.35; d <= 1.6; d += 0.05) {
      expect(Math.abs(at(d) - last)).toBeLessThanOrEqual(peak / 6 + 1e-6);
      expect(at(d)).toBeLessThanOrEqual(last + 1e-6);
      last = at(d);
    }
    expect(last).toBe(0);
  });

  it('takes its reach and strength from the kit’s pack, and paints none where its art carries its own', () => {
    seedKit();
    seedKit(false, 'Test_Reach', [1, 2, 3, 4, 5, 6, 7, 8], [2, 3, 4], undefined, { shadowReach: 0.4, shadowStrength: 0.6 });
    seedKit(false, 'Test_Shaded', [1, 2, 3, 4, 5, 6, 7, 8], [2, 3, 4], undefined, { shadowReach: 0.4, shadowStrength: 0.6, shadowBaked: true });
    expect(kitShadow(bandPiecesFor(SET))).toEqual(KIT_SHADOW);
    expect(KIT_SHADOW).toEqual({ reach: 0.6, strength: 0.45, baked: false });
    expect(kitShadow(bandPiecesFor('Test_Reach'))).toEqual({ reach: 0.4, strength: 0.6, baked: false });
    expect(kitShadow(bandPiecesFor('Test_Shaded'))).toEqual({ reach: 0.4, strength: 0.6, baked: true });
    const shadow = wallShadowRamp([{ placed: layBandRing(PENTAGON, [], bandPiecesFor('Test_Reach')), closed: true, size: 1 }])!;
    // Full at the rock's face; gone the reach past it.
    expect(rampAlphaAt(shadow, [3, 0.3])).toBeCloseTo(0.6, 2);
    expect(rampAlphaAt(shadow, [3, 0.36 + 0.6 + 0.4 + 0.1])).toBe(0);
    expect(wallShadowRamp([{ placed: layBandRing(PENTAGON, [], bandPiecesFor('Test_Shaded')), closed: true, size: 1 }])).toBeNull();
  });

  it('carries a baked shadow round every bent joint, 0.3 inside the rock line never under four fifths of a straight stretch’s', () => {
    const SHADED = 'Test_Shaded';
    seedKit(false, SHADED, [1, 2, 3, 4, 5, 6, 7, 8], [2, 3, 4], undefined, { shadowReach: 0.6, shadowStrength: 0.6, shadowBaked: true });
    const { bands } = layLayer(joinedCaves({ cave: SHADED, cliff: SHADED, stone: STONE }));
    const walls = bands.filter((b) => b.kind !== 'cliff');
    const reach = 0.6;
    const face = BAND_DRAWN_WIDTH / 2;
    // The art's own shadow as the seeded art would carry it: rock to its face, then easing out over the reach.
    const shade = (d: number): number => (d <= face ? 1 : Math.max(0, 1 - (d - face) / reach));
    const bodyDist = (p: V, line: V[]): number => {
      let d = Infinity;
      for (let i = 0; i + 1 < line.length; i++) {
        const [a, c] = [line[i], line[i + 1]];
        const [dx, dy] = [c[0] - a[0], c[1] - a[1]];
        const l2 = dx * dx + dy * dy;
        const t = l2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
        if ((i === 0 && t < -1e-9) || (i === line.length - 2 && t > 1 + 1e-9)) continue;
        d = Math.min(d, segDist(p, a, c));
      }
      return d;
    };
    let bent = 0;
    for (const b of walls) {
      const set = b.placed.map((pl) => pl.piece);
      const drawn = bandBends(b.placed, set, b.size).map((pl) => ({ pl, line: pieceRockLine(pl, kitOverlap(set)) as V[] }));
      bent += mitredJoints(b.placed, set, b.size).filter((m) => Math.abs(m.turn) >= (5 * Math.PI) / 180).length;
      const at = (p: V): number => Math.max(0, ...drawn.map(({ pl, line }) => shade(bodyDist(unbend(pl, p) as V, line) / b.size)));
      for (const { line, open } of ledgeRuns(b.placed, b.closed).map(({ run, open }) => ({ line: seatLine(run, !open) as V[], open }))) {
        const pts = inside(line, open, 0.3 * b.size).filter((p) => toLine(p, open ? line : [...line, line[0]]) >= 0.3 * b.size - 0.02);
        const alphas = pts.map(at);
        const middle = [...alphas].sort((x, y) => x - y)[alphas.length >> 1];
        expect(middle).toBeGreaterThan(0);
        alphas.forEach((a, i) => expect(a, `${b.kind} at ${pts[i]}`).toBeGreaterThanOrEqual(0.8 * middle));
      }
    }
    expect(bent).toBeGreaterThanOrEqual(3);
  });

  it('paints nothing for a kit without measured pieces', () => {
    const set = caveBandPieces();
    expect(kitShadow(set)).toBeNull();
    for (const ring of [PENTAGON, TIPPED]) expect(wallShadowRamp([{ placed: layBandRing(ring, [], set), closed: true, size: 1 }])).toBeNull();
  });
});
