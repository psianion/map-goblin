// A measured kit's cliffs at their corners and ends: a corner piece at every turn its corner pieces
// turn, a rounded corner of bends no sharper than the art bends where none turns it, never two
// straights crossing on a corner, and a free end narrowed to a tip; and a slope beside a cliff of
// its plateau, its face run on under the cliff's rock and faded there. Each held to the checker's
// rules (testing/bandChecks.ts), rule 8 among them.
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../assets/textureLoader', async (importOriginal) => {
  const { Texture, TextureSource } = await import('pixi.js');
  const loaded = new Texture({ source: new TextureSource({ width: 200, height: 200 }) });
  const actual = await importOriginal<typeof import('../assets/textureLoader')>();
  return { ...actual, resolveTexture: () => loaded };
});

import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import { bandPiecesFor } from '../assets/caveWallKit';
import { resetAssetPackManager, seedPack } from '../testing/seedCatalog';
import { brokenRules, checkBand, BAND_RULES, pastRockLine, pieceRockLine } from '../testing/bandChecks';
import { drawnFromOutline, layLayer, type LaidBand } from '../testing/caveLayout';
import { CAVE_CASES, caseLayer, joinedCaves, plateau, type CaseKits } from '../testing/caveCases';
import { bandBends, FIT_DOOR_PAD, seatLine, withConnectors } from './caveBandRenderer';
import { endTangents, MITRE_MOST_DEG } from './bandBend';
import { kitOverlap, placePiece, type WalkPlacement } from './caveWalk';
import { cliffFreeTips, cliffLedge, FACE_SIDE_FADE, faceSideFade, laidRuns, layerSlopes, walkCliff } from './plateauRenderer';
import { sampleRamp } from './rampMask';
import { layerPlateaus } from '../shared/plateaus';
import type { BandMeasure, ManifestEntry } from './packManifest';
import type { DungeonLayer } from '../store/types';
import type { Polygon } from '../types/geometry';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  setClipperModule((await mod.default({ wasmBinary })) as MainModule);
}, 30_000);

afterEach(() => resetAssetPackManager());

type V = [number, number];
const SET = 'Test_Cliff';
const KITS: CaseKits = { cave: SET, cliff: SET, stone: 'Test_Stone' };

/**
 * A measured cliff kit drawn like a real one: straights of 2 to 5 cells whose rock wavers along a
 * spine, and corner pieces turning each way in 2, 3 and 4 cells, the inner ones rounding the corner
 * wider than the outer, and two round lumps of rock for connectors.
 */
function seedCliffKit(): void {
  const entry = (material: string, gridSize: string, band: BandMeasure): ManifestEntry => ({ type: 'object', material, gridSize, pieceType: 'object', variant: 'A', set: SET, tags: ['colored'], band: { ...band, rockWidth: 0.86 } });
  const entries: Record<string, ManifestEntry> = {};
  for (const L of [2, 3, 4, 5]) {
    const spine: V[] = [];
    for (let k = 0; k <= L * 4; k++) {
      const x = L / 2 - 0.25 - (k * (L - 0.5)) / (L * 4);
      spine.push([+x.toFixed(3), +(0.07 * Math.sin(2.3 * x + L) - 0.01).toFixed(3)]);
    }
    entries[`edge_${L}x2_A`] = entry('edge', `${L}x2`, { joints: [[L / 2, 0.12], [-L / 2, 0.12]], turnDeg: 0, spine });
  }
  for (const N of [2, 3, 4]) {
    const h = N / 2;
    const out = 0.18 + (N - 2) * 0.45;
    entries[`edge_out_${N}x${N}_A`] = entry('edge_out', `${N}x${N}`, { joints: [[out, -h], [-h, out]], turnDeg: 90 });
    const inn = -0.12 + (N - 2) * 0.48;
    entries[`edge_in_${N}x${N}_A`] = entry('edge_in', `${N}x${N}`, { joints: [[-h, inn], [inn - 0.02, -h]], turnDeg: -90 });
  }
  entries.lump_2x2_A = entry('lump', '2x2', { joints: [[0, 0], [0, 0]], turnDeg: 0, connector: true, radius: 0.39 });
  seedPack('test-cliff-pack', entries);
}

const shift = (pts: V[], dx: number, dy: number): V[] => pts.map(([x, y]) => [x + dx, y + dy]);
const segDist = (p: V, a: V, b: V): number => {
  const [vx, vy] = [b[0] - a[0], b[1] - a[1]];
  const L2 = vx * vx + vy * vy;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2)) : 0;
  return Math.hypot(p[0] - a[0] - vx * t, p[1] - a[1] - vy * t);
};
const L_SHAPE: V[] = [[0, 0], [0, 4], [2, 4], [2, 2], [4, 2], [4, 0]];
/** Two 45° corners and three square ones. */
const CUT_CORNERS: V[] = [[0, 0], [6, 0], [8, 2], [8, 5], [0, 5]];
/** Four corners of 75° to 100° and one gentle corner of 25°. */
const PENTAGON: V[] = [[0.93, 0.93], [6.94, 0.47], [10.96, 1.95], [9.99, 5.46], [1.95, 5.46]];
/** A tip turning 152°, sharper than any corner piece turns. */
const SPIKE: V[] = [[0, 0], [8, 2], [0, 4]];

const cliffBands = (layer: DungeonLayer): LaidBand[] => layLayer(layer).bands.filter((b) => b.kind === 'cliff');
const turnAt = (a: WalkPlacement, b: WalkPlacement): number => {
  const [ta, tb] = [endTangents(a)[1], endTangents(b)[0]];
  return (Math.abs(Math.atan2(ta[0] * tb[1] - ta[1] * tb[0], ta[0] * tb[0] + ta[1] * tb[1])) * 180) / Math.PI;
};
const rules = (b: LaidBand): number[] => brokenRules(b.check).filter((r) => [2, 3, 6, 8].includes(r));

describe('a cliff’s corners', () => {
  const shapes: [string, V[], number][] = [
    ['an L-shaped plateau', L_SHAPE, 1],
    ['a plateau with 45° corners', CUT_CORNERS, 1],
    ['a plateau with a gentle corner', PENTAGON, 1],
    ['an L-shaped pit', L_SHAPE, -1],
    ['a plateau with a sharp tip', SPIKE, 1],
  ];
  for (const [name, ring, height] of shapes) {
    it(`gives ${name} a corner piece or a rounded corner at every turn, and no connector`, () => {
      seedCliffKit();
      const [band] = cliffBands(caseLayer([plateau('p', shift(ring, 3, 3), KITS, 'cliff', height)], KITS));
      expect(band.placed.length).toBeGreaterThan(0);
      // Every joint turns no more than the art bends: each corner is a corner piece's, or rounded.
      const n = band.placed.length;
      for (let k = 0; k < n; k++) expect(turnAt(band.placed[k], band.placed[(k + 1) % n])).toBeLessThanOrEqual(MITRE_MOST_DEG + 1e-6);
      expect(band.connectors).toEqual([]);
      expect(rules(band), name).toEqual([]);
    });
  }

  it('lays a corner piece on every square corner of an L, the inner one too', () => {
    seedCliffKit();
    const [band] = cliffBands(caseLayer([plateau('p', shift(L_SHAPE, 3, 3), KITS)], KITS));
    const corners = band.placed.filter((pl) => pl.branch === 'corner');
    expect(corners.filter((pl) => pl.piece.turnDeg > 0)).toHaveLength(5);
    expect(corners.filter((pl) => pl.piece.turnDeg < 0)).toHaveLength(1);
  });

  it('lays a tip no corner piece turns with the smallest one across it, made smaller, its rock within half a cell of the tip', () => {
    seedCliffKit();
    const [band] = cliffBands(caseLayer([plateau('p', shift(SPIKE, 3, 3), KITS)], KITS));
    // The two square-ish corners take corner pieces, and the tip one more.
    const corners = band.placed.filter((pl) => pl.branch === 'corner');
    expect(corners).toHaveLength(3);
    const tip: V = [11, 5];
    const dTip = (pl: WalkPlacement): number => Math.min(...seatLine([pl]).map((p) => Math.hypot(p[0] - tip[0], p[1] - tip[1])));
    const across = corners.reduce((a, b) => (dTip(b) < dTip(a) ? b : a));
    const smallest = Math.min(...bandPiecesFor(SET).filter((p) => p.turnDeg > 0).map((p) => p.chordCells));
    expect(across.piece.chordCells).toBe(smallest);
    expect(across.at.scale).toBeGreaterThanOrEqual(0.5 - 1e-6);
    expect(across.at.scale).toBeLessThan(1);
    expect(dTip(across)).toBeLessThanOrEqual(0.5);
    // The rock is laid to the tip: rule 1 holds there.
    expect(band.check.worstBare).toBeLessThanOrEqual(BAND_RULES.bareReach);
  });
});

describe('rule 9', () => {
  const shapes: [string, V[], number][] = [
    ['an L-shaped plateau', L_SHAPE, 1],
    ['an L-shaped pit', L_SHAPE, -1],
    ['a plateau with a sharp tip', SPIKE, 1],
    ['a plateau with 45° corners', CUT_CORNERS, 1],
  ];
  for (const [name, ring, height] of shapes) {
    it(`keeps ${name}’s top, floor and shade to its side of the rock, corners and tips too`, () => {
      seedCliffKit();
      const { bands } = drawnFromOutline(layLayer(caseLayer([plateau('p', shift(ring, 3, 3), KITS, 'cliff', height)], KITS)));
      expect(bands.some((b) => b.lines.length > 0)).toBe(true);
      for (const b of bands) expect(b.past, `${name} at ${b.pastAt}`).toBeLessThanOrEqual(BAND_RULES.rockSide);
    });
  }

  it('keeps a plateau’s top to its rock along a stretch that runs on into a wall', () => {
    seedCliffKit();
    const { bands } = drawnFromOutline(layLayer(CAVE_CASES[1].layer(KITS)));
    expect(bands.some((b) => b.lines.some((l) => !l.line.closed))).toBe(true);
    for (const b of bands) expect(b.past, `at ${b.pastAt}`).toBeLessThanOrEqual(BAND_RULES.rockSide);
  });

  it('finds a top drawn past its rock', () => {
    // A square plateau's rock a cell inside it, wound with its top on its right, its top drawn to the outline.
    const rock = [[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]];
    const top: Polygon = [[0, 0], [4, 0], [4, 4], [0, 4]];
    const r = pastRockLine([{ rings: [top], side: 'floor' }], [rock]);
    expect(r.past).toBeGreaterThan(0.9);
  });
});

describe('a cliff meeting a wall', () => {
  /** The case's plateaus in a room's corners: c11 a cell square, c22 two, c13 one by three. */
  const tucked = (): DungeonLayer => CAVE_CASES[3].layer(KITS);

  it('runs no straight on past the corner beside a wall: every piece’s rock stays by its stretch', () => {
    seedCliffKit();
    const layer = layLayer(tucked()).layer;
    let merged = 0;
    for (const band of layerPlateaus(layer).bands) {
      for (const { cliffs } of laidRuns(layer, band)) {
        for (const c of cliffs ?? []) {
          if (!c.merged.some(Boolean)) continue;
          merged++;
          const pts = c.run.points as V[];
          const placed = walkCliff(c.run, c.merged);
          for (const pl of placed) {
            for (const p of pieceRockLine(pl, kitOverlap(bandPiecesFor(SET)))) {
              const d = Math.min(...pts.slice(1).map((q, i) => segDist(p, pts[i], q)));
              expect(d, `${pl.piece.key} at ${p}`).toBeLessThanOrEqual(0.55);
            }
          }
        }
      }
    }
    expect(merged).toBeGreaterThanOrEqual(3);
  });

  it('narrows an end that butts a painted cave’s rock, and leaves one under a walled floor’s rock square', () => {
    seedCliffKit();
    for (const [layer, butts] of [
      [CAVE_CASES[0].layer(KITS), true],
      [tucked(), false],
    ] as [DungeonLayer, boolean][]) {
      const laid = layLayer(layer).layer;
      let tips = 0;
      for (const band of layerPlateaus(laid).bands) {
        for (const { cliffs } of laidRuns(laid, band)) {
          for (const c of cliffs ?? []) {
            if (!c.merged.some(Boolean)) continue;
            expect(c.butts.some(Boolean)).toBe(butts);
            const drawn = cliffLedge(c, walkCliff(c.run, c.merged));
            const bent = withConnectors(drawn, bandPiecesFor(SET), 1, cliffFreeTips(c, drawn));
            tips += bent.reduce((s, pl) => s + (pl.bend?.taper?.filter(Boolean).length ?? 0), 0);
          }
        }
      }
      if (butts) expect(tips).toBeGreaterThan(0);
      else expect(tips).toBe(0);
    }
  });
});

describe('the cliff kit as a cave’s rock', () => {
  it('takes its inner corner pieces on a cave ring: no two pieces cross at a corner', () => {
    seedCliffKit();
    const { bands } = layLayer(joinedCaves(KITS));
    const rings = bands.filter((b) => b.kind !== 'cliff');
    expect(rings.length).toBeGreaterThan(0);
    for (const b of rings) expect(brokenRules(b.check).filter((r) => r === 8), b.kind).toEqual([]);
    expect(rings.some((b) => b.placed.some((pl) => pl.branch === 'corner' && pl.piece.turnDeg < 0))).toBe(true);
  });
});

describe('rule 8', () => {
  it('finds two straights crossing on a corner, and one running on past it', () => {
    seedCliffKit();
    const set = bandPiecesFor(SET);
    const straight = set.find((p) => p.key.includes('edge_4x2'))!;
    const lay = (P: V, Q: V): WalkPlacement => ({ piece: straight, P, Q, i: 0, nudge: 0, branch: 'side', at: placePiece(straight, P, Q, 0.18) });
    // Along the top, then down the right side, each carried on past the corner as an unbent pair is.
    const placed = [lay([0, 0], [4.4, 0]), lay([4, -0.4], [4, 4])];
    const ring: Polygon = [[0, 0], [4, 0], [4, 4]];
    const check = checkBand({ ring, closed: false, placed, gaps: [], size: 1, overlap: kitOverlap(set), doorPad: FIT_DOOR_PAD });
    expect(check.crossed).toBe(1);
    expect(brokenRules(check)).toContain(8);
    // The same two meeting square on the corner a quarter of a cell short: none crosses, nothing runs on.
    const apart = [lay([0, 0], [3.6, 0]), lay([4, 0.4], [4, 4])];
    const clear = checkBand({ ring, closed: false, placed: apart, gaps: [], size: 1, overlap: kitOverlap(set), doorPad: FIT_DOOR_PAD });
    expect(clear.pastCorner).toBeLessThanOrEqual(BAND_RULES.cornerPast);
  });
});

describe('a cliff’s free end', () => {
  it('narrows to a tip where the cliff stops on level ground, and only there', () => {
    seedCliffKit();
    // A cliff plateau running on into a slope of the same height: its cliff stops where the slope begins.
    const layer = caseLayer([plateau('cliff', [[3, 3], [9, 3], [9, 8], [3, 8]], KITS), plateau('slope', [[8, 3], [11, 3], [11, 8], [8, 8]], KITS, 'slope')], KITS);
    let tips = 0;
    let open = 0;
    for (const band of layerPlateaus(layer).bands) {
      for (const { cliffs } of laidRuns(layer, band)) {
        for (const c of cliffs ?? []) {
          if (c.run.closed) continue;
          open++;
          const drawn = cliffLedge(c, walkCliff(c.run, c.merged));
          const free = cliffFreeTips(c, drawn);
          expect(free).toBeDefined();
          const bent = withConnectors(drawn, bandPiecesFor(SET), 1, free);
          const tapered = bent.filter((pl) => pl.bend?.taper?.some(Boolean));
          tips += tapered.reduce((s, pl) => s + pl.bend!.taper!.filter(Boolean).length, 0);
          // Only the first and last pieces of the stretch narrow.
          for (const pl of tapered) expect([drawn[0], drawn[drawn.length - 1]].some((d) => d.piece === pl.piece && d.P === pl.P)).toBe(true);
        }
      }
    }
    expect(open).toBeGreaterThan(0);
    expect(tips).toBe(2 * open);
  });

  it('keeps a stretch’s joints bent, and its ends square nowhere', () => {
    seedCliffKit();
    const [band] = cliffBands(caseLayer([plateau('p', shift(PENTAGON, 3, 3), KITS)], KITS));
    const drawn = bandBends(band.placed, band.placed.map((pl) => pl.piece), 1);
    expect(drawn.every((pl) => pl.bend?.a && pl.bend?.b)).toBe(true);
  });
});

describe('a slope beside a cliff of its own plateau', () => {
  /** A cliff plateau with a notch in its bottom side, filled by a slope of the same height facing down. */
  const notched = (): DungeonLayer =>
    caseLayer(
      [
        plateau('c', [[3, 3], [10, 3], [10, 8], [7.5, 8], [7.5, 5], [5.5, 5], [5.5, 8], [3, 8]], KITS),
        { ...plateau('s', [[5.5, 5], [7.5, 5], [7.5, 8], [5.5, 8]], KITS, 'slope'), faceDir: 90 },
      ],
      KITS,
    );

  it('runs its face on under the cliff’s rock at full depth, either side', () => {
    seedCliffKit();
    const { faces } = layerSlopes(notched());
    expect(faces).toHaveLength(1);
    const [face] = faces;
    expect(face.fades).toHaveLength(2);
    const xs = face.region.flat().map((p) => p[0]);
    // Past both ends of the slope's side, under the cliffs either side of it.
    expect(Math.min(...xs)).toBeLessThan(5.5 - 0.4);
    expect(Math.max(...xs)).toBeGreaterThan(7.5 + 0.4);
    // At full depth where the cliff begins: no easing into the rim there.
    const below = (x: number): number => Math.max(...face.region.flat().filter((p) => Math.abs(p[0] - x) < 0.05).map((p) => p[1]));
    expect(below(5.5)).toBeGreaterThan(8 + 0.2);
  });

  it('fades its side out over a third of a cell as a true ramp: nothing at the end, full a third in, no step', () => {
    seedCliffKit();
    const { faces } = layerSlopes(notched());
    const field = faceSideFade(faces)!;
    expect(field).not.toBeNull();
    const [left] = faces[0].fades;
    const y = 8.1;
    const at = (back: number): number => sampleRamp(field, left.at[0] - left.along[0] * back, y);
    expect(at(0)).toBeLessThan(0.1);
    expect(at(FACE_SIDE_FADE + 0.1)).toBeGreaterThan(0.95);
    let last = at(0);
    for (let b = 0.02; b <= FACE_SIDE_FADE + 0.1; b += 0.02) {
      const v = at(b);
      expect(v).toBeGreaterThanOrEqual(last - 1e-6);
      expect(v - last).toBeLessThanOrEqual(1 / 6 + 1e-6);
      last = v;
    }
  });

  it('draws no fade on a slope that meets no cliff', () => {
    seedCliffKit();
    const { faces } = layerSlopes(caseLayer([{ ...plateau('s', [[3, 3], [8, 3], [8, 7], [3, 7]], KITS, 'slope'), faceDir: 90 }], KITS));
    expect(faces.every((f) => f.fades.length === 0)).toBe(true);
    expect(faceSideFade(faces)).toBeNull();
  });
});
