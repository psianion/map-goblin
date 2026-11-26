// A flight of stairs on a plateau's measured cliff: the cliff stops exactly at the span's ends and
// tapers there with no end piece, its saved rock line breaks there, the flight is drawn on the low
// side, and taking the stairs away lays the cliff exactly as it was.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../assets/textureLoader', async (importOriginal) => {
  const { Texture, TextureSource } = await import('pixi.js');
  const loaded = new Texture({ source: new TextureSource({ width: 200, height: 200 }) });
  const actual = await importOriginal<typeof import('../assets/textureLoader')>();
  return { ...actual, resolveTexture: () => loaded, load: () => Promise.resolve(loaded) };
});

import { Container, type Sprite } from 'pixi.js';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import { resetAssetPackManager, seedPack } from '../testing/seedCatalog';
import { rebuildDungeonLayer } from './floorWallRenderer';
import { cliffRockLines } from './rockLines';
import { cliffFreeTips, cliffLedge, laidRuns, renderPlateaus, walkCliff } from './plateauRenderer';
import { jointsOf } from '../assets/caveWallKit';
import { STAIR_SIDE_LINE } from '../assets/stairKits';
import { layerPlateaus } from '../shared/plateaus';
import type { LayerEntry } from './sceneGraph';
import type { BandMeasure, ManifestEntry } from './packManifest';
import { useStore } from '../store/store';
import type { DungeonLayer, PlateauChild } from '../store/types';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  setClipperModule((await mod.default({ wasmBinary })) as MainModule);
}, 30_000);

type Pt = [number, number];
const SET = 'Test_Cliff_Kit';

function entry(material: string, gridSize: string, band: BandMeasure): ManifestEntry {
  return { type: 'object', material, gridSize, pieceType: 'object', variant: 'A', set: SET, tags: [], band };
}

/** A measured cliff kit, as plateauCliffLine.test.ts seeds it. */
function seedCliffKit(): void {
  seedPack('test-cliff-pack', {
    run_2x2_A: entry('run', '2x2', { joints: [[-0.065, 0.983], [-0.065, -0.988]], turnDeg: 0, spine: [[-0.065, 0.983], [0.135, 0.3], [-0.265, -0.3], [-0.065, -0.988]] }),
    run_2x4_A: entry('run', '2x4', { joints: [[-0.065, 1.983], [-0.065, -1.988]], turnDeg: 0, spine: [[-0.065, 1.983], [0.135, 0.6], [-0.265, -0.6], [-0.065, -1.988]] }),
    turn_in_2x2_A: entry('turn_in', '2x2', { joints: [[-0.506, 0.983], [0.983, -0.506]], turnDeg: 90 }),
    turn_out_2x2_A: entry('turn_out', '2x2', { joints: [[-0.025, 0.983], [-0.988, 0.02]], turnDeg: -90 }),
    tip_1x2_A: entry('tip', '1x2', { joints: [[0, 0.98], [0, 0]], turnDeg: 0, end: true }),
  });
}

const room: Pt[] = [[0, 0], [10, 0], [10, 8], [0, 8]];
/** Stairs on the north edge, x 4 to 6: the outline starts at (0, 0) and runs east along y 0. */
const SPAN = { id: 's1', ring: 0, from: 4, to: 6 };

function plat(height: number, stairs?: (typeof SPAN)[]): PlateauChild {
  return { id: 'plat', name: 'plat', childType: 'plateau', visible: true, contours: [room], height, edge: 'cliff', edgeArt: SET, ...(stairs && { stairs }) };
}

function makeEntry(id: string): LayerEntry {
  const sublayers = Object.fromEntries(
    ['ground', 'floor', 'materials', 'water', 'paths', 'plateauTops', 'plateauEdges', 'shadows', 'grid', 'walls', 'wallMarks', 'doors', 'objects', 'imageGrid', 'labels'].map((k) => [k, new Container()]),
  );
  return { id, type: 'dungeon', container: new Container(), sublayers, renderTexture: null, textureSprite: null, dirtyFlag: false } as unknown as LayerEntry;
}

const dungeon = (): DungeonLayer => useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;

function setUp(child: PlateauChild): DungeonLayer {
  useStore.setState((s) => {
    const l = s.layers.find((la) => la.id === dungeon().id) as DungeonLayer;
    l.children = [child];
    l.mergedFloor = [];
    delete l.rockLines;
  });
  return dungeon();
}

/** Every piece the layer's cliffs lay, as drawn: key, place, turn and scale. */
const placements = (layer: DungeonLayer): string[] =>
  layerPlateaus(layer).bands.flatMap((band) =>
    laidRuns(layer, band).flatMap(({ cliffs }) =>
      (cliffs ?? []).flatMap((c) => cliffLedge(c, walkCliff(c.run, c.merged, c.opens)).map((pl) => `${pl.piece.key} ${pl.at.position.x.toFixed(4)} ${pl.at.position.y.toFixed(4)} ${pl.at.rotation.toFixed(4)} ${pl.at.scale.toFixed(4)}`)),
    ),
  );

describe('stairs on a measured cliff', () => {
  beforeEach(() => {
    resetAssetPackManager();
    useStore.getState().resetToDefault();
    seedCliffKit();
  });

  for (const height of [2, -2]) {
    it(`stops the cliff at the span's ends and tapers both tips there, with no end piece (height ${height})`, () => {
      const layer = setUp(plat(height, [SPAN]));
      const band = layerPlateaus(layer).bands[0];
      const [laid] = laidRuns(layer, band);
      expect(laid.cliffs).toHaveLength(1);
      const [c] = laid.cliffs!;
      expect(c.opens).toEqual([true, true]);
      expect(c.merged).toEqual([false, false]);
      // The stretch runs from one end of the span round the plateau to the other.
      const ends = [c.run.points[0], c.run.points[c.run.points.length - 1]].map(([x, y]) => [x, y]).sort((p, q) => p[0] - q[0]);
      expect(ends).toEqual([[4, 0], [6, 0]]);
      const ledge = cliffLedge(c, walkCliff(c.run, c.merged, c.opens));
      expect(ledge.some((pl) => pl.branch === 'end')).toBe(false);
      const taper = cliffFreeTips(c, ledge)!;
      expect(taper).toBeDefined();
      const joints = ledge.flatMap((pl) => jointsOf(pl.piece, pl.at));
      for (const end of [[4, 0], [6, 0]]) {
        const tip = joints.reduce((b, j) => (Math.hypot(j[0] - end[0], j[1] - end[1]) < Math.hypot(b[0] - end[0], b[1] - end[1]) ? j : b));
        expect(Math.hypot(tip[0] - end[0], tip[1] - end[1])).toBeLessThan(0.5);
        expect(taper(tip)).toBe(true);
      }
      // No rock is laid across the span.
      expect(joints.some(([x, y]) => x > 4.2 && x < 5.8 && Math.abs(y) < 0.3)).toBe(false);
    });
  }

  it('breaks the saved rock line at the span', () => {
    const layer = setUp(plat(2, [SPAN]));
    rebuildDungeonLayer(layer, makeEntry(layer.id));
    const lines = (dungeon().rockLines ?? []).filter((l) => l.kind === 'cliff');
    expect(lines).toHaveLength(1);
    expect(lines[0].closed).toBe(false);
    const pts = lines[0].runs.flat();
    expect(pts.some(([x, y]) => x > 4.2 && x < 5.8 && Math.abs(y) < 0.6)).toBe(false);
  });

  for (const height of [2, -2]) {
    it(`ends the top line where the rock line does beside the stairs, with no hook back to the edge (height ${height})`, () => {
      const layer = setUp(plat(height, [SPAN]));
      rebuildDungeonLayer(layer, makeEntry(layer.id));
      const saved = dungeon();
      const line = (saved.rockLines ?? []).find((l) => l.kind === 'cliff')!;
      // The rock's ends beside the span, as saved.
      const ends = line.runs.flatMap((r) => [r[0], r[r.length - 1]]);
      const atEnd = ([x, y]: readonly number[]) => ends.some(([u, v]) => Math.hypot(u - x, v - y) < 0.02);
      const [c] = laidRuns(saved, layerPlateaus(saved).bands[0])[0].cliffs!;
      const pts = c.top.points;
      expect(atEnd(pts[0])).toBe(true);
      expect(atEnd(pts[pts.length - 1])).toBe(true);
      expect(c.top.drops).toHaveLength(pts.length - 1);
    });
  }

  it('opens a small -2 pit exactly across a 2-wide span near its corner, rock laid on either side', () => {
    const pit: PlateauChild = { ...plat(-2, [{ id: 's1', ring: 0, from: 1, to: 3 }]), contours: [[[0, 0], [5, 0], [5, 4], [0, 4]]] };
    const layer = setUp(pit);
    rebuildDungeonLayer(layer, makeEntry(layer.id));
    const line = (dungeon().rockLines ?? []).find((l) => l.kind === 'cliff')!;
    expect(line.runs).toHaveLength(1);
    const run = line.runs[0];
    // The rock stops at the span's two ends, tapered there, and nowhere across it.
    const ends = [run[0], run[run.length - 1]].map(([x]) => x).sort((p, q) => p - q);
    expect(ends[0]).toBeGreaterThan(0.75);
    expect(ends[0]).toBeLessThan(1.25);
    expect(ends[1]).toBeGreaterThan(2.75);
    expect(ends[1]).toBeLessThan(3.25);
    const onTop = run.filter(([, y]) => Math.abs(y) < 0.6).map(([x]) => x);
    expect(onTop.some((x) => x < 0.9)).toBe(true);
    expect(onTop.some((x) => x > 3.1)).toBe(true);
    expect(onTop.some((x) => x > 1.25 && x < 2.75)).toBe(false);
  });

  it('lays the cliff exactly as it was once the stairs are taken away', () => {
    const before = placements(setUp(plat(2)));
    expect(before.length).toBeGreaterThan(0);
    const withStairs = setUp(plat(2, [SPAN]));
    expect(placements(withStairs)).not.toEqual(before);
    rebuildDungeonLayer(withStairs, makeEntry(withStairs.id));
    const gone = setUp(plat(2, []));
    expect(placements(gone)).toEqual(before);
    expect(walks(gone)).toEqual(walks(setUp(plat(2))));
  });

  it('draws the flight on the low side, under the cliff', () => {
    const layer = setUp(plat(2, [SPAN]));
    const tops = new Container();
    const edges = new Container();
    renderPlateaus(layer, tops, edges);
    const holder = edges.children[0] as Container;
    const labels = holder.children.map((c) => c.label);
    const at = labels.indexOf('plateau-stairs');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(labels.indexOf('plateau-cliff'));
    // Outside the plateau: north of y 0, two cells long, the span wide.
    const b = holder.children[at].getLocalBounds();
    expect([b.minX, b.maxX, b.minY, b.maxY].map((v) => Math.round(v * 10) / 10)).toEqual([4, 6, -2, 0]);
  });

  it('lays the flight with the default stair kit: a Wide A piece for a 2-cell span down a 2-level drop, its top on the edge', () => {
    const stairs = (material: string, gridSize: string, wide: number, run: number) =>
      ({ type: 'object', material, gridSize, pieceType: 'object', variant: 'A', set: 'Test_Stairs', tags: ['stairs'], stairs: { kit: 'steps', label: 'Steps', wide, run, painted: [0, 0, wide, run], default: true } }) as ManifestEntry;
    seedPack('test-stairs', { b_1x2_A: stairs('b', '1x2', 1, 1), a_1x3_A: stairs('a', '1x3', 1, 2), wide_a_2x3_A: stairs('wide_a', '2x3', 2, 2), wide_b_2x2_A: stairs('wide_b', '2x2', 2, 1) });
    const layer = setUp(plat(2, [SPAN]));
    const edges = new Container();
    renderPlateaus(layer, new Container(), edges);
    const flight = (edges.children[0] as Container).children.find((c) => c.label === 'plateau-stairs') as Container;
    // A kit with no stone colour is a translucent overlay: laid twice over itself.
    expect(flight.children).toHaveLength(2);
    const piece = flight.children[0] as Sprite;
    expect([flight.children[1].position.x, flight.children[1].position.y]).toEqual([piece.position.x, piece.position.y]);
    // Down north from y 0: the tile turned a half turn, its painted top-left at the span's east end.
    expect(piece.position.x).toBeCloseTo(6);
    expect(piece.position.y).toBeCloseTo(0);
    expect(Math.abs(piece.rotation)).toBeCloseTo(Math.PI);
    // The whole 2-cell-wide tile drawn two cells wide, whatever size its texture is served at.
    expect(piece.scale.x * piece.texture.width).toBeCloseTo(2);
  });

  it('trims the side lines where the pieces of a wide flight meet, each still filling its share of the span', () => {
    const stairs = (material: string, gridSize: string, wide: number, run: number) =>
      ({ type: 'object', material, gridSize, pieceType: 'object', variant: 'A', set: 'Test_Stairs', tags: ['stairs'], stairs: { kit: 'steps', label: 'Steps', wide, run, painted: [0, 0, wide, run], colour: 'Earthy' } }) as ManifestEntry;
    seedPack('test-stairs', { b_1x2_A: stairs('b', '1x2', 1, 1), a_1x3_A: stairs('a', '1x3', 1, 2), wide_a_2x3_A: stairs('wide_a', '2x3', 2, 2), wide_b_2x2_A: stairs('wide_b', '2x2', 2, 1) });
    const layer = setUp(plat(2, [{ id: 's1', ring: 0, from: 3, to: 6 }]));
    const edges = new Container();
    renderPlateaus(layer, new Container(), edges);
    const flight = (edges.children[0] as Container).children.find((c) => c.label === 'plateau-stairs') as Container;
    const [wide, one] = flight.children as Sprite[];
    expect(flight.children).toHaveLength(2);
    // The served texture is 200 px: a cell of the Wide tile is 100 px of it, the one-cell tile's 200.
    expect(wide.texture.frame.width).toBeCloseTo(200 - 100 * STAIR_SIDE_LINE);
    expect(one.texture.frame.width).toBeCloseTo(200 - 200 * STAIR_SIDE_LINE);
    expect(wide.scale.x * wide.texture.frame.width).toBeCloseTo(2);
    expect(one.scale.x * one.texture.frame.width).toBeCloseTo(1);
  });
});

const walks = (layer: DungeonLayer) => [...cliffRockLines(layer).walks.values()].map((m) => [...m.values()]);
