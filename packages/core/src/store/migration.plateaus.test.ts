// 3.2 → 3.3: height moves off floor shapes onto plateau children. The plateau fixtures were
// re-saved through the migration; their bands and edge runs are the ones the 3.2 model built
// from the same maps (counted on 366458e, before the move), so a migrated map stands exactly
// as it stood.
import { describe, it, expect, beforeAll } from 'vitest';
import type { MainModule } from 'clipper2-wasm/dist/clipper2z';
import { setClipperModule } from '../geometry/Clipper2Engine';
import { migrateToLatest, plateauIdFor, plateausFromShapes } from './migration';
import { edgeRuns, layerPlateaus } from '../shared/plateaus';
import type { DungeonLayer, PlateauChild, SerializedMapData } from './types';

let readFileSync: (p: string, enc: string) => string;
let root = '';

beforeAll(async () => {
  const fs = await import('node:fs' as string);
  readFileSync = fs.readFileSync;
  const { createRequire } = await import('node:module' as string);
  const { resolve } = await import('node:path' as string);
  root = resolve(process.cwd(), '../../session/testdata');
  const wasmBinary = fs.readFileSync(createRequire(import.meta.url).resolve('clipper2-wasm/dist/es/clipper2z.wasm'));
  const mod = await import('clipper2-wasm/dist/es/clipper2z.js' as string);
  const clipper: MainModule = await mod.default({ wasmBinary });
  setClipperModule(clipper);
}, 30_000);

const load = (file: string) => JSON.parse(readFileSync(`${root}/${file}.mapbuilder`, 'utf8'));
const dungeon = (data: SerializedMapData) => (data.layers as unknown as DungeonLayer[]).filter((l) => l.type === 'dungeon');

/** Per fixture layer, as the 3.2 model counted it: bands, their heights, edge runs. */
const BEFORE: Record<string, { bands: number; heights: number[]; runs: number }> = {
  'plateau-test/layer-outdoors': { bands: 4, heights: [-2, 1, 2, 3], runs: 5 },
  'plateau-table/layer-1': { bands: 1, heights: [3], runs: 1 },
  'tower-test/layer-cellar': { bands: 1, heights: [1], runs: 1 },
  'tower-test/layer-ground': { bands: 1, heights: [1], runs: 1 },
  'tower-test/layer-first': { bands: 0, heights: [], runs: 0 },
};

/** The floors that carried a height in each fixture at 3.2. */
const RAISED: Record<string, string[]> = {
  'plateau-test': ['outcrop', 'hill', 'summit', 'pit', 'far-mesa'],
  'plateau-table': ['floor-mesa'],
  'tower-test': ['cellar-dais', 'mound'],
};

describe('migrating 3.2 floors with a height', () => {
  for (const file of ['plateau-test', 'plateau-table', 'tower-test']) {
    it(`gives ${file} the same bands and edge runs from plateau children`, () => {
      const raw = load(file);
      expect(raw.version).toBe('3.4');
      const data = migrateToLatest(raw);
      // Re-saved through the migration: loading it again moves nothing.
      expect(data.layers).toEqual(raw.layers);
      const all = dungeon(data).flatMap((l) => l.children);
      for (const id of RAISED[file]) {
        expect(all.find((c) => c.id === id)?.childType, id).toBe('shape');
        expect(all.find((c) => c.id === plateauIdFor(id))?.childType, id).toBe('plateau');
      }
      let plateaus = 0;
      for (const layer of dungeon(data)) {
        const want = BEFORE[`${file}/${layer.id}`];
        expect(want, layer.id).toBeDefined();
        const p = layerPlateaus(layer);
        expect(p.bands.length, layer.id).toBe(want.bands);
        expect(p.bands.map((b) => b.height), layer.id).toEqual(want.heights);
        expect(p.bands.flatMap((b) => edgeRuns(b)).length, layer.id).toBe(want.runs);
        // No floor keeps a plateau field; every former raised floor has one plateau.
        for (const c of layer.children) {
          if (c.childType !== 'shape') continue;
          for (const key of ['height', 'edge', 'edgeArt', 'slopeWidth', 'contourLines', 'sightOverride', 'crossingId']) {
            expect(key in c, `${c.id}.${key}`).toBe(false);
          }
        }
        plateaus += layer.children.filter((c) => c.childType === 'plateau').length;
      }
      expect(plateaus).toBe(RAISED[file].length);
    });
  }

  it('keeps the floor at ground beside its plateau, with the rings, height and edge it had', () => {
    const layers = [
      {
        id: 'l',
        type: 'dungeon',
        children: [
          { id: 'f', name: 'Keep', childType: 'shape', visible: true, contours: [[[0, 0], [4, 0], [4, 4]]], height: 2, edge: 'wall', contourLines: false },
          { id: 'g', name: 'Hill', childType: 'shape', visible: true, contours: [[[9, 9], [12, 9], [12, 12]]], height: -1, edge: 'slope', slopeWidth: 2 },
          { id: 'h', name: 'Flat', childType: 'shape', visible: true, contours: [[[0, 0], [1, 0], [1, 1]]], edge: 'cliff' },
        ],
      },
    ] as unknown as SerializedMapData['layers'];
    const [layer] = plateausFromShapes(layers) as unknown as DungeonLayer[];
    expect(layer.children.map((c) => `${c.id}:${c.childType}`)).toEqual([
      'f:shape', 'f-plateau:plateau', 'g:shape', 'g-plateau:plateau', 'h:shape',
    ]);
    const keep = layer.children[1] as PlateauChild;
    expect(keep).toMatchObject({ id: plateauIdFor('f'), name: 'Keep', height: 2, edge: 'cliff', contourLines: false });
    expect(keep.contours).toEqual([[[0, 0], [4, 0], [4, 4]]]);
    expect(layer.children[3]).toMatchObject({ height: -1, edge: 'slope', slopeWidth: 2 });
    expect('edge' in layer.children[4]).toBe(false);
    // Nothing left to move: the same array back.
    const again = plateausFromShapes([layer] as unknown as SerializedMapData['layers']);
    expect(again[0]).toBe(layer);
  });

  it('leaves a map with no plateau fields as it is', () => {
    const raw = load('fieldstone-keep');
    expect(plateausFromShapes(raw.layers)).toBe(raw.layers);
  });
});
