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

import { Container } from 'pixi.js';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import { resetAssetPackManager, seedPack } from '../testing/seedCatalog';
import { rebuildDungeonLayer } from './floorWallRenderer';
import { cliffRockLines } from './rockLines';
import { cliffFreeTips, cliffLedge, laidRuns, renderPlateaus, walkCliff } from './plateauRenderer';
import { jointsOf } from '../assets/caveWallKit';
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
});

const walks = (layer: DungeonLayer) => [...cliffRockLines(layer).walks.values()].map((m) => [...m.values()]);
