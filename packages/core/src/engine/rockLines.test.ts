// The editor writes a measured kit's rock line to the layer when it rebuilds it
// (`DungeonLayer.rockLines`): one entry per ring laid, nothing new when nothing changed, and a
// ring whose kit is not installed keeps the entry it was saved with.
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
import { orientRings } from './caveBandRenderer';
import { rebuildDungeonLayer } from './floorWallRenderer';
import type { LayerEntry } from './sceneGraph';
import type { BandMeasure, ManifestEntry } from './packManifest';
import { useStore } from '../store/store';
import type { DungeonLayer, RockLine } from '../store/types';
import type { Polygon } from '../types/geometry';

beforeAll(async () => {
  const { readFileSync } = await import('node:fs' as string);
  const { createRequire } = await import('node:module' as string);
  const wasmBinary = readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

const SET = 'Test_Kit';

function entry(material: string, gridSize: string, band: BandMeasure): ManifestEntry {
  return { type: 'object', material, gridSize, pieceType: 'object', variant: 'A', set: SET, tags: [], band };
}

function seedMeasuredKit(): void {
  seedPack('test-pack', {
    run_2x2_A: entry('run', '2x2', { joints: [[-0.065, 0.983], [-0.065, -0.988]], turnDeg: 0 }),
    run_2x4_A: entry('run', '2x4', { joints: [[-0.065, 1.983], [-0.065, -1.988]], turnDeg: 0 }),
    turn_in_2x2_A: entry('turn_in', '2x2', { joints: [[-0.506, 0.983], [0.983, -0.506]], turnDeg: 90 }),
    turn_out_2x2_A: entry('turn_out', '2x2', { joints: [[-0.025, 0.983], [-0.988, 0.02]], turnDeg: -90 }),
    tip_1x2_A: entry('tip', '1x2', { joints: [[0, 0.98], [0, 0]], turnDeg: 0, end: true }),
  });
}

function makeEntry(id: string): LayerEntry {
  const sublayers = Object.fromEntries(
    ['ground', 'floor', 'materials', 'water', 'paths', 'plateauTops', 'plateauEdges', 'shadows', 'grid', 'walls', 'wallMarks', 'doors', 'objects', 'imageGrid', 'labels'].map((k) => [k, new Container()]),
  );
  return { id, type: 'dungeon', container: new Container(), sublayers, renderTexture: null, textureSprite: null, dirtyFlag: false } as unknown as LayerEntry;
}

const square: Polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];
const dungeon = (): DungeonLayer => useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;

/** The store's dungeon layer as one ring walled with `setId`, holding `rockLines`. */
function setUp(setId: string, rockLines?: RockLine[]): DungeonLayer {
  useStore.setState((s) => {
    const l = s.layers.find((la) => la.id === dungeon().id) as DungeonLayer;
    l.children = [];
    l.mergedFloor = [square];
    l.style = { ...l.style, wallTextureSetId: setId, wallWidth: 0.5 };
    if (rockLines) l.rockLines = rockLines;
    else delete l.rockLines;
  });
  return dungeon();
}

describe('the rock line written on a rebuild', () => {
  beforeEach(() => {
    resetAssetPackManager();
    useStore.getState().resetToDefault();
  });

  it('writes one entry for a measured kit’s ring, with the ring as its edge, and nothing new the second time', () => {
    seedMeasuredKit();
    const layer = setUp(SET);
    const entry = makeEntry(layer.id);
    rebuildDungeonLayer(layer, entry);

    const lines = dungeon().rockLines!;
    expect(lines).toHaveLength(1);
    expect(lines[0].edge).toEqual(orientRings([square])[0]);
    expect(lines[0].closed).toBe(true);
    // No door, no opening: one run round the ring that ends where it starts, near the drawn edge.
    expect(lines[0].runs).toHaveLength(1);
    const run = lines[0].runs[0];
    expect(run[run.length - 1]).toEqual(run[0]);
    expect(run.every(([x, y]) => Math.min(Math.abs(x), Math.abs(x - 10), Math.abs(y), Math.abs(y - 10)) < 1)).toBe(true);
    expect(run.flat().every((v) => Math.round(v * 100) / 100 === v)).toBe(true);

    rebuildDungeonLayer(dungeon(), entry);
    expect(dungeon().rockLines).toBe(lines);
  });

  it('keeps the stored entry of a ring whose kit is not installed', () => {
    const saved: RockLine = { edge: square, closed: true, runs: [[[0, 0.2], [10, -0.2], [10, 10], [0, 10], [0, 0.2]]] };
    const layer = setUp('Gone_Kit', [saved]);
    rebuildDungeonLayer(layer, makeEntry(layer.id));
    expect(dungeon().rockLines).toEqual([saved]);
    // …and the line goes with the map when it is saved or published.
    const file = useStore.getState().getSerializableState();
    expect(file.layers.find((l): l is DungeonLayer => l.id === layer.id)!.rockLines).toEqual([saved]);
  });
});
