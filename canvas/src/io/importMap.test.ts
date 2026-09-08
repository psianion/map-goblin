import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IMPORT_MAX_PX, importMaps } from './importMap';
import type { ScannedMap } from './importFolder';
import type { ImportedMap } from '@dnd/core/src/shared/import/types';
import type { DungeonLayer } from '@/store/types';

const { restoreCustomImages, resizeImageToMax, state } = vi.hoisted(() => ({
  restoreCustomImages: vi.fn(async () => {}),
  resizeImageToMax: vi.fn(async () => 'data:image/webp;base64,SMALL'),
  state: {
    createNewMap: vi.fn(async () => 'id'),
    loadFromFile: vi.fn(),
    saveCurrentMap: vi.fn(async () => {}),
  },
}));
vi.mock('@/assets/textureLoader', () => ({ restoreCustomImages }));
vi.mock('@/canvas/importImage', () => ({ resizeImageToMax }));
vi.mock('@/store/store', () => ({ useStore: { getState: () => state } }));

const base: ImportedMap = {
  name: 'Cellar',
  size: { width: 10, height: 8 },
  image: { dataUrl: 'data:image/webp;base64,BIG', width: 7000, height: 5600, pxPerCell: 140 },
  walls: [{ points: [[0, 0], [10, 0]], wallType: 'normal', direction: 'both' }],
  doors: [],
  lights: [],
  warnings: ['3 cone lights imported as full circles'],
};

const row = (map: ImportedMap, name = map.name): ScannedMap => ({
  id: name,
  name,
  kind: 'foundry',
  sourcePath: 'x.db',
  composite: false,
  size: map.size,
  counts: { walls: 1, doors: 0, lights: 0 },
  imageStatus: 'found',
  thumb: null,
  warnings: map.warnings,
  load: async () => structuredClone(map),
});

describe('importMaps', () => {
  beforeEach(() => vi.clearAllMocks());

  it('downscales an oversized image, builds the document and runs it through the load path', async () => {
    const progress = vi.fn();
    const results = await importMaps([row(base)], progress);

    expect(progress).toHaveBeenCalledWith(0, 'Cellar');
    expect(resizeImageToMax).toHaveBeenCalledWith('data:image/webp;base64,BIG', IMPORT_MAX_PX, 'image/webp');
    expect(restoreCustomImages).toHaveBeenCalledTimes(1);
    expect(state.createNewMap).toHaveBeenCalledWith('Cellar');
    expect(state.saveCurrentMap).toHaveBeenCalledTimes(1);

    const doc = state.loadFromFile.mock.calls[0][0];
    expect(Object.values(doc.customImages)).toEqual(['data:image/webp;base64,SMALL']);
    const battlemap = doc.layers[1] as DungeonLayer;
    // 7000px at 140 px/cell is 50 cells wide before and after the downscale.
    const image = battlemap.children[0] as { width: number; height: number };
    expect(image.width).toBeCloseTo(50, 3);
    expect(image.height).toBeCloseTo(40, 1);
    expect((doc.layers[2] as DungeonLayer).standaloneWalls).toHaveLength(1);

    expect(results).toEqual([
      {
        name: 'Cellar',
        ok: true,
        warnings: ['3 cone lights imported as full circles', `image downscaled from 7000×5600 to fit ${IMPORT_MAX_PX}px`],
        bytes: 'data:image/webp;base64,SMALL'.length,
      },
    ]);
  });

  it('leaves a small image alone and keeps going after a failure', async () => {
    const small: ImportedMap = { ...base, name: 'Small', image: { ...base.image!, width: 1400, height: 1120 } };
    const broken: ScannedMap = { ...row(base, 'Broken'), load: async () => { throw new Error('boom'); } };
    const results = await importMaps([broken, row(small)]);

    expect(resizeImageToMax).not.toHaveBeenCalled();
    expect(results.map((r) => [r.name, r.ok, r.error])).toEqual([
      ['Broken', false, 'boom'],
      ['Small', true, undefined],
    ]);
    expect(state.createNewMap).toHaveBeenCalledTimes(1);
  });

  it('finishes the map in flight and skips the rest once a stop is requested', async () => {
    const small: ImportedMap = { ...base, image: null };
    let stop = false;
    const first = { ...row(small, 'First'), load: async () => { stop = true; return structuredClone(small); } };
    const results = await importMaps([first, row(small, 'Second')], undefined, () => stop);
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    expect(state.createNewMap).toHaveBeenCalledTimes(1);
  });
});
