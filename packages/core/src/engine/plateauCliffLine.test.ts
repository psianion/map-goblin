// A plateau whose cliff is laid with a measured kit of its own: the editor saves the cliff's line
// (`RockLine.kind` 'cliff') once, the walk never lays the cliff along that saved line, the top
// and its shade end on the line, cliff blocking stands on it, and it never carries a room's wall.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../assets/textureLoader', async (importOriginal) => {
  const { Texture, TextureSource } = await import('pixi.js');
  const loaded = new Texture({ source: new TextureSource({ width: 200, height: 200 }) });
  const actual = await importOriginal<typeof import('../assets/textureLoader')>();
  return { ...actual, resolveTexture: () => loaded, load: () => Promise.resolve(loaded) };
});

import { Container } from 'pixi.js';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { clipper2Engine, setClipperModule } from '../geometry/Clipper2Engine';
import { resetAssetPackManager, seedPack } from '../testing/seedCatalog';
import { rebuildDungeonLayer } from './floorWallRenderer';
import { cliffRockLines } from './rockLines';
import { fittedAlongWalls, laidRuns } from './plateauRenderer';
import { extractMoveSegments, extractWallSegments } from './lighting/raycaster';
import { cliffOccluders, layerPlateaus, pointInPoly } from '../shared/plateaus';
import type { LayerEntry } from './sceneGraph';
import type { BandMeasure, ManifestEntry } from './packManifest';
import { useStore } from '../store/store';
import type { DungeonLayer, PlateauChild, RockLine } from '../store/types';
import type { Polygon } from '../types/geometry';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

type Pt = [number, number];

const SET = 'Test_Cliff_Kit';

function entry(material: string, gridSize: string, band: BandMeasure): ManifestEntry {
  return { type: 'object', material, gridSize, pieceType: 'object', variant: 'A', set: SET, tags: [], band };
}

/** A measured cliff kit whose straights' rock wanders 0.2 cell either side of their joint line. */
function seedCliffKit(): void {
  seedPack('test-cliff-pack', {
    run_2x2_A: entry('run', '2x2', { joints: [[-0.065, 0.983], [-0.065, -0.988]], turnDeg: 0, spine: [[-0.065, 0.983], [0.135, 0.3], [-0.265, -0.3], [-0.065, -0.988]] }),
    run_2x4_A: entry('run', '2x4', { joints: [[-0.065, 1.983], [-0.065, -1.988]], turnDeg: 0, spine: [[-0.065, 1.983], [0.135, 0.6], [-0.265, -0.6], [-0.065, -1.988]] }),
    turn_in_2x2_A: entry('turn_in', '2x2', { joints: [[-0.506, 0.983], [0.983, -0.506]], turnDeg: 90 }),
    turn_out_2x2_A: entry('turn_out', '2x2', { joints: [[-0.025, 0.983], [-0.988, 0.02]], turnDeg: -90 }),
    tip_1x2_A: entry('tip', '1x2', { joints: [[0, 0.98], [0, 0]], turnDeg: 0, end: true }),
  });
}

/** The built-in ledge kit, which carries no measurements. */
function seedBuiltInLedge(): void {
  const object = (material: string, gridSize: string) => ({ type: 'object', material, gridSize, set: 'GG_Cave_Ink', tags: ['cave'] }) as ManifestEntry;
  seedPack('gg-forge', {
    wall_short_2x2_A: object('wall_short', '2x2'),
    inside_bend_2x2_A: object('inside_bend', '2x2'),
    outside_bend_2x2_A: object('outside_bend', '2x2'),
    rockledge_1x2_A: object('rockledge', '1x2'),
    rockledge_1x4_A: object('rockledge', '1x4'),
    rockledge_bend_90_2x2_A: object('rockledge_bend_90', '2x2'),
    rockledge_bend_n90_2x2_A: object('rockledge_bend_n90', '2x2'),
  });
}

const room: Pt[] = [[0, 0], [10, 0], [10, 8], [0, 8]];

function plat(height: number, edgeArt?: string): PlateauChild {
  return { id: `plat${height}`, name: 'plat', childType: 'plateau', visible: true, contours: [room], height, edge: 'cliff', edgeArt };
}

let seq = 0;
const layerOf = (children: DungeonLayer['children'], extra: Partial<DungeonLayer> = {}) =>
  ({ id: `cliff-${seq++}`, type: 'dungeon', children, standaloneWalls: [], mergedFloor: [], style: {}, ...extra }) as unknown as DungeonLayer;

function makeEntry(id: string): LayerEntry {
  const sublayers = Object.fromEntries(
    ['ground', 'floor', 'materials', 'water', 'paths', 'plateauTops', 'plateauEdges', 'shadows', 'grid', 'walls', 'wallMarks', 'doors', 'objects', 'imageGrid', 'labels'].map((k) => [k, new Container()]),
  );
  return { id, type: 'dungeon', container: new Container(), sublayers, renderTexture: null, textureSprite: null, dirtyFlag: false } as unknown as LayerEntry;
}

const dungeon = (): DungeonLayer => useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;

/** The store's dungeon layer holding only `child`, and no rock line. */
function setUp(child: PlateauChild): DungeonLayer {
  useStore.setState((s) => {
    const l = s.layers.find((la) => la.id === dungeon().id) as DungeonLayer;
    l.children = [child];
    l.mergedFloor = [];
    delete l.rockLines;
  });
  return dungeon();
}

const round = (p: readonly number[]): Pt => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];
const walksOf = (layer: DungeonLayer) => [...cliffRockLines(layer).walks.values()].map((m) => [...m.values()]);

describe('a plateau’s own measured cliff line, written on a rebuild', () => {
  beforeEach(() => {
    resetAssetPackManager();
    useStore.getState().resetToDefault();
  });

  for (const height of [2, -2]) {
    it(`writes one cliff entry with the run as its edge, nothing new the second time, and walks the same rock (height ${height})`, () => {
      seedCliffKit();
      const layer = setUp(plat(height, SET));
      const before = walksOf(layer);
      expect(before.flat(2).length).toBeGreaterThan(0);
      const entry = makeEntry(layer.id);
      rebuildDungeonLayer(layer, entry);

      const lines = dungeon().rockLines!;
      expect(lines).toHaveLength(1);
      expect(lines[0].kind).toBe('cliff');
      expect(lines[0].closed).toBe(true);
      expect(lines[0].edge).toEqual(layerPlateaus(dungeon()).bands[0].rings[0].map(round));
      expect(lines[0].runs).toHaveLength(1);

      // The cliff line now stored is not walked along: the same placements as before it.
      expect(walksOf(dungeon())).toEqual(before);
      rebuildDungeonLayer(dungeon(), entry);
      expect(dungeon().rockLines).toBe(lines);
    });
  }

  it('writes none for a plateau whose cliff is the built-in ledge', () => {
    seedBuiltInLedge();
    const layer = setUp(plat(2));
    expect(walksOf(layer).flat(2).length).toBeGreaterThan(0);
    rebuildDungeonLayer(layer, makeEntry(layer.id));
    expect(dungeon().rockLines).toBeUndefined();
  });
});

describe('a plateau’s own cliff along a cave wall', () => {
  beforeEach(() => resetAssetPackManager());

  /** The room's wall rock, wandering 0.3 either side of the top edge. */
  const wall: RockLine = {
    edge: room,
    closed: true,
    runs: [[[0, 0], [2, 0.3], [4, -0.3], [6, 0.3], [8, -0.3], [10, 0], [10, 8], [0, 8], [0, 0]]],
  };
  const loop = wall.runs[0].slice(0, -1);
  /** `b` as the loop `a`, from wherever it starts. */
  const asLoop = (a: readonly Pt[], b: readonly Pt[]): Pt[] => {
    const i = b.findIndex((p) => p[0] === a[0][0] && p[1] === a[0][1]);
    return i < 0 ? [...b] : [...b.slice(i), ...b.slice(0, i)];
  };

  it('walks along the wall’s line, writes no cliff entry there, and ignores a cliff line', () => {
    seedCliffKit();
    const layer = layerOf([plat(2, SET)], { mergedFloor: [room], rockLines: [wall] });
    const [band] = layerPlateaus(layer).bands;
    const [{ walk }] = laidRuns(layer, band);
    expect(walk.points).toEqual(asLoop(walk.points, loop));
    expect(cliffRockLines(layer).lines).toEqual([]);

    const own: RockLine = { kind: 'cliff', edge: room, closed: true, runs: [[[0, 0.1], [10, 0.1], [10, 8], [0, 8], [0, 0.1]]] };
    const both = layerOf(layer.children, { mergedFloor: [room], rockLines: [wall, own] });
    expect(laidRuns(both, band)[0].walk.points).toEqual(walk.points);
  });
});

/** A rock line round the 10 by 8 outline with its corners rounded off and its top bowed 0.2 out. */
const rounded: Pt[] = [[0.6, 0], [5, -0.2], [9.4, 0], [10, 0.6], [10, 7.4], [9.4, 8], [0.6, 8], [0, 7.4], [0, 0.6], [0.6, 0]];

/** A layer with a plateau (or a pit) on the outline and its cliff's line as `rounded`. */
function withCliffLine(height: number): { layer: DungeonLayer; line: RockLine } {
  const child = plat(height, SET);
  const edge = layerPlateaus(layerOf([child])).bands[0].rings[0] as Pt[];
  const line: RockLine = { kind: 'cliff', edge, closed: true, runs: [height > 0 ? rounded : [...rounded].reverse()] };
  return { layer: layerOf([child], { rockLines: [line] }), line };
}

const inside = (rings: Polygon[], [x, y]: Pt) => rings.filter((r) => r.length >= 3 && pointInPoly(x, y, r)).length % 2 === 1;

describe('the top and its shade end on the cliff’s own line', () => {
  const corner: Pt = [0.1, 0.1];
  const bowed: Pt = [5, -0.1];
  const middle: Pt = [5, 4];
  const box: Polygon = [[-3, -3], [13, -3], [13, 11], [-3, 11]];

  for (const height of [2, -2]) {
    it(`cuts the top at a rounded corner and grows it to where the rock bows out (height ${height})`, () => {
      const { layer } = withCliffLine(height);
      const [band] = layerPlateaus(layer).bands;
      expect(inside(band.surface, corner)).toBe(true);
      const top = fittedAlongWalls(band.surface, laidRuns(layer, band), undefined);
      expect(inside(top, corner)).toBe(false);
      expect(inside(top, bowed)).toBe(true);
      expect(inside(top, middle)).toBe(true);
    });
  }

  it('fits a raised edge’s shade outside the band the other way round', () => {
    const { layer } = withCliffLine(2);
    const [band] = layerPlateaus(layer).bands;
    const shade = fittedAlongWalls(clipper2Engine.difference([box], band.rings), laidRuns(layer, band), undefined, true);
    expect(inside(shade, corner)).toBe(true);
    expect(inside(shade, bowed)).toBe(false);
  });

  it('leaves the top as it is with no cliff line', () => {
    const layer = layerOf([plat(2, SET)]);
    const [band] = layerPlateaus(layer).bands;
    expect(fittedAlongWalls(band.surface, laidRuns(layer, band), undefined)).toBe(band.surface);
  });
});

describe('blocking along a cliff’s own line', () => {
  const near = (p: Pt, run: readonly Pt[]) =>
    run.slice(1).some((b, i) => {
      const a = run[i];
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t) < 0.02;
    });

  it('stands the cliff occluders on the line', () => {
    const { layer, line } = withCliffLine(2);
    const occ = cliffOccluders(layer, 1);
    expect(occ.length).toBeGreaterThan(0);
    expect(occ.every((o) => near([o.x1, o.y1], line.runs[0]) && near([o.x2, o.y2], line.runs[0]))).toBe(true);
  });

  it('never lets a cliff line carry a room’s wall', () => {
    const cliff: RockLine = { kind: 'cliff', edge: room, closed: true, runs: [rounded] };
    const plain = layerOf([], { mergedFloor: [room] });
    const onCliff = layerOf([], { mergedFloor: [room], rockLines: [cliff] });
    for (const kind of ['light', 'sight'] as const) expect(extractWallSegments([onCliff], kind)).toEqual(extractWallSegments([plain], kind));
    expect(extractMoveSegments([onCliff])).toEqual(extractMoveSegments([plain]));
    // The same line as a wall's would carry it.
    const asWall: RockLine = { edge: cliff.edge, closed: cliff.closed, runs: cliff.runs };
    expect(extractWallSegments([layerOf([], { mergedFloor: [room], rockLines: [asWall] })], 'light')).not.toEqual(extractWallSegments([plain], 'light'));
  });
});
