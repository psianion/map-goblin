import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createMapsSlice,
  measureGridSize,
  resetMapDB,
  restoreLastDeletedMap,
  setThumbnailProvider,
} from './maps';
import { setMapDBFactory, setMapSerializer } from '../mapIO';
import type { MapDB, MapRecord } from '../mapIO';

const { restoreCustomImages, order } = vi.hoisted(() => {
  const order: string[] = [];
  return { order, restoreCustomImages: vi.fn(async () => { order.push('restore'); }) };
});
vi.mock('../../assets/textureLoader', () => ({ restoreCustomImages }));
import { useStore } from '../store';
import type { DungeonLayer } from '../types';

// The slice is thin orchestration over a MapDB, so it is tested against an in-memory fake
// rather than a real IndexedDB — the production implementation (canvas/src/io/mapIndexDB)
// has its own CRUD suite.

function blob(...bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
}

function record(id: string, patch: Partial<MapRecord> = {}): MapRecord {
  return {
    id,
    name: 'Doomed',
    createdAt: 1,
    updatedAt: 2,
    gridSize: { width: 3, height: 4 },
    layerCount: 2,
    data: blob(1, 2, 3),
    ...patch,
  };
}

/** Just the methods the slice actually calls, over a plain Map. */
function fakeDB(seed: MapRecord[]) {
  const rows = new Map(seed.map((r) => [r.id, r]));
  return {
    rows,
    db: {
      open: async () => {},
      getMapRecord: async (id: string) => rows.get(id) ?? null,
      deleteMap: async (id: string) => { rows.delete(id); },
      restoreMap: async (r: MapRecord) => { rows.set(r.id, r); },
    } as unknown as MapDB,
  };
}

describe('MapsSlice', () => {
  beforeEach(() => {
    resetMapDB(); // Clear module-level singleton + stash
  });

  describe('measureGridSize', () => {
    // A real dungeon layer off the default store, with only its geometry swapped.
    function layerWith(mergedFloor: [number, number][][] | null): DungeonLayer {
      const dl = useStore.getState().layers.find((l): l is DungeonLayer => l.type === 'dungeon')!;
      return { ...dl, mergedFloor, children: [], standaloneWalls: [] };
    }

    it('reports 0×0 for a map with nothing drawn on it', () => {
      expect(measureGridSize([layerWith(null)], null)).toEqual({ width: 0, height: 0 });
    });

    it('measures the drawn geometry in whole cells, not a hardcoded 40×40', () => {
      const size = measureGridSize(
        [layerWith([[[2, 2], [12, 2], [12, 8], [2, 8]]])],
        null,
      );
      // The frame snaps out to enclosing cells and pads for wall strokes, so it is a
      // little larger than the 10×6 floor — but it tracks that floor's shape, and it is
      // emphatically not 40×40.
      expect(size.width).toBeGreaterThanOrEqual(10);
      expect(size.height).toBeGreaterThanOrEqual(6);
      expect(size.width - size.height).toBe(4);
      expect(size.width).toBeLessThan(20);
    });

    it('painted terrain extends the measured size', () => {
      const floorOnly = measureGridSize([layerWith([[[0, 0], [4, 0], [4, 4], [0, 4]]])], null);
      const withTerrain = measureGridSize(
        [layerWith([[[0, 0], [4, 0], [4, 4], [0, 4]]])],
        { minX: 0, minY: 0, maxX: 20, maxY: 4 },
      );
      expect(withTerrain.width).toBeGreaterThan(floorOnly.width);
    });

    it('a pinned map reports the size it was pinned to, drawn on or not', () => {
      // Empty: a fixed map has a size from the moment it exists, so no "Empty" card.
      expect(measureGridSize([layerWith(null)], null, { width: 30, height: 20 })).toEqual({
        width: 30,
        height: 20,
      });
      // Drawn inside the pin: still the pinned size, not the (smaller) measured one.
      expect(
        measureGridSize(
          [layerWith([[[2, 2], [12, 2], [12, 8], [2, 8]]])],
          null,
          { width: 30, height: 20 },
        ),
      ).toEqual({ width: 30, height: 20 });
    });

    it('a pinned map drawn past its edge reports the size it grew to', () => {
      // The pin is a minimum sheet. Building on below y=20 makes the map taller, and the
      // card says so, while the width nothing crossed stays the pinned 30.
      const size = measureGridSize(
        [layerWith([[[2, 4], [28, 4], [28, 26], [2, 26]]])],
        null,
        { width: 30, height: 20 },
      );
      expect(size.width).toBe(30);
      expect(size.height).toBeGreaterThan(20);
      expect(size.height).toBeGreaterThanOrEqual(27);
    });

    it('omitting fixedSize still measures the content, for settings mode', () => {
      const measured = measureGridSize([layerWith([[[0, 0], [10, 0], [10, 10], [0, 10]]])], null);
      expect(measured.width).toBeGreaterThan(0);
      expect(measured).not.toEqual({ width: 30, height: 20 });
    });
  });

  describe('delete/restore stash', () => {
    // A stub store: `get()` returns it, `set()` mutates it in place.
    function sliceOver(state: object) {
      return createMapsSlice(
        ((fn: (s: object) => void) => fn(state)) as never,
        (() => state) as never,
        {} as never,
      );
    }

    it('restores the deleted map under its original id, blob and all', async () => {
      const { rows, db } = fakeDB([record('m1')]);
      setMapDBFactory(() => db);
      // With no active map, deleteMap stops after the DB call.
      const state = { mapIndex: [{ id: 'm1' }], activeMapId: null };

      await sliceOver(state).deleteMap('m1');
      expect(state.mapIndex).toHaveLength(0);
      expect(rows.has('m1')).toBe(false);

      const restored = await restoreLastDeletedMap();
      expect(restored!.meta).toMatchObject({ id: 'm1', name: 'Doomed', layerCount: 2 });
      expect(restored!.meta).not.toHaveProperty('data'); // meta only — the blob stays in the DB
      expect(restored!.removedBlankId).toBeNull();
      expect(Array.from(rows.get('m1')!.data)).toEqual([1, 2, 3]);
    });

    it('is a no-op once the stash has been used', async () => {
      expect(await restoreLastDeletedMap()).toBeNull();
    });

    // Deleting the last map auto-creates a blank one so the editor is never left with
    // nothing; Undo has to take that blank back out, unless it has been drawn in.
    function stateLosingItsLastMap(blank: MapRecord, rows: Map<string, MapRecord>) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { data: _, ...blankMeta } = blank;
      const state = {
        mapIndex: [{ id: 'm1' }] as object[],
        activeMapId: 'm1',
        async createNewMap() {
          rows.set(blank.id, blank);
          state.mapIndex.unshift(blankMeta);
          return blank.id;
        },
      };
      return state;
    }

    it('removes the blank it auto-created when the restore puts the real map back', async () => {
      const blank = record('blank', { name: 'Untitled Map', gridSize: { width: 0, height: 0 } });
      const { rows, db } = fakeDB([record('m1')]);
      setMapDBFactory(() => db);

      await sliceOver(stateLosingItsLastMap(blank, rows)).deleteMap('m1');
      const restored = await restoreLastDeletedMap();

      expect(restored!.removedBlankId).toBe('blank');
      expect(rows.has('blank')).toBe(false);
      expect(rows.has('m1')).toBe(true);
    });

    it('keeps the blank once something has been drawn in it', async () => {
      const blank = record('blank', { name: 'Untitled Map', gridSize: { width: 0, height: 0 } });
      const { rows, db } = fakeDB([record('m1')]);
      setMapDBFactory(() => db);

      await sliceOver(stateLosingItsLastMap(blank, rows)).deleteMap('m1');
      // The save the caller runs before restoring measures the geometry that landed since.
      rows.set('blank', { ...blank, gridSize: { width: 8, height: 6 } });

      const restored = await restoreLastDeletedMap();
      expect(restored!.removedBlankId).toBeNull();
      expect(rows.has('blank')).toBe(true);
    });

    it('forgets the blank once a later delete takes the stash', async () => {
      const blank = record('blank', { name: 'Untitled Map', gridSize: { width: 0, height: 0 } });
      const { rows, db } = fakeDB([record('m1')]);
      setMapDBFactory(() => db);
      const state = stateLosingItsLastMap(blank, rows);
      const slice = sliceOver(state);

      await slice.deleteMap('m1');
      // Not undone: another map is open now, and the untouched blank is deleted from its card.
      state.activeMapId = 'other';
      await slice.deleteMap('blank');
      const restored = await restoreLastDeletedMap();

      // Undo puts the blank back and leaves it there.
      expect(restored!.meta.id).toBe('blank');
      expect(restored!.removedBlankId).toBeNull();
      expect(rows.has('blank')).toBe(true);
    });
  });
});

// The map's name lives twice: on the card index (MapMeta) and inside the document
// (mapSettings.name), and the document copy is what an export names the file after.
// renameMap used to write only the index, so the two drifted apart.
describe('name stays in sync across the index and the document', () => {
  beforeEach(() => resetMapDB());

  function sliceOver(state: object) {
    return createMapsSlice(
      ((fn: (s: object) => void) => fn(state)) as never,
      (() => state) as never,
      {} as never,
    );
  }

  it('renaming the open map renames its document too', async () => {
    const updates: Array<{ id: string; patch: object }> = [];
    setMapDBFactory(
      () =>
        ({
          open: async () => {},
          updateMapMeta: async (id: string, patch: object) => { updates.push({ id, patch }); },
        }) as unknown as MapDB,
    );
    const state = {
      mapIndex: [{ id: 'm1', name: 'Old' }],
      activeMapId: 'm1',
      docName: 'Old',
      setMapName(name: string) { state.docName = name; },
    };

    await sliceOver(state).renameMap('m1', 'Sunken Chapel');

    expect(updates).toEqual([{ id: 'm1', patch: { name: 'Sunken Chapel' } }]);
    expect(state.mapIndex[0].name).toBe('Sunken Chapel');
    expect(state.docName).toBe('Sunken Chapel');
  });

  it('leaves an unopened map’s document alone — loadMap reconciles it later', async () => {
    setMapDBFactory(
      () => ({ open: async () => {}, updateMapMeta: async () => {} }) as unknown as MapDB,
    );
    const state = {
      mapIndex: [{ id: 'm2', name: 'Old' }],
      activeMapId: 'm1',
      docName: 'The open map',
      setMapName(name: string) { state.docName = name; },
    };

    await sliceOver(state).renameMap('m2', 'Guard Barracks');

    expect(state.mapIndex[0].name).toBe('Guard Barracks');
    expect(state.docName).toBe('The open map');
  });

  it('registers a map’s images with the renderer before the document lands in the store', async () => {
    order.length = 0;
    setMapDBFactory(
      () => ({ open: async () => {}, getMapBlob: async () => blob(1) }) as unknown as MapDB,
    );
    setMapSerializer({
      serializeToBytes: async () => blob(1),
      deserializeFromBytes: async () => ({
        version: '3.1',
        mapSettings: { name: 'Axeholm' },
        customImages: { img1: 'data:image/webp;base64,AAAA' },
        layers: [],
      }),
    } as never);
    const state = {
      mapIndex: [{ id: 'm1', name: 'Axeholm' }],
      activeMapId: null as string | null,
      mapSettings: { name: 'Axeholm' },
      loadFromFile() { order.push('load'); },
      setMapName() {},
    };

    await sliceOver(state).loadMap('m1');

    // A sprite resolves its texture when it is created and never looks again, so the
    // registration has to be complete first — the other order drew a magenta battlemap.
    expect(order).toEqual(['restore', 'load']);
    expect(restoreCustomImages).toHaveBeenCalledWith({ img1: 'data:image/webp;base64,AAAA' });
    expect(state.activeMapId).toBe('m1');
  });
});

// Every save also stores the card's thumbnail. The provider resolves to null when it has
// no canvas to render from, and a drawn map must not lose the picture it already has to
// that: only a map that is genuinely empty (0x0) drops its thumbnail.
describe('saveCurrentMap thumbnail', () => {
  beforeEach(() => resetMapDB());

  const stored = new Blob(['old']);

  function setup(fixedSize: { width: number; height: number } | null) {
    const thumbs: Array<Blob | null> = [];
    setMapDBFactory(
      () =>
        ({
          open: async () => {},
          saveMapBlob: async () => {},
          saveThumbnail: async (_id: string, t: Blob | null) => { thumbs.push(t); },
        }) as unknown as MapDB,
    );
    setMapSerializer({ serializeToBytes: async () => blob(1) } as never);
    const state = {
      mapIndex: [{ id: 'm1', name: 'Kell', thumbnail: stored as Blob | undefined }],
      activeMapId: 'm1',
      layers: [],
      mapSettings: { fixedSize },
      getSerializableState: () => ({}),
    };
    const slice = createMapsSlice(
      ((fn: (s: object) => void) => fn(state)) as never,
      (() => state) as never,
      {} as never,
    );
    return { thumbs, state, slice };
  }

  async function saveWith(slice: ReturnType<typeof setup>['slice'], provider: () => Promise<Blob | null>) {
    setThumbnailProvider(provider);
    try {
      await slice.saveCurrentMap();
    } finally {
      setThumbnailProvider(null);
    }
  }

  it('keeps the existing thumbnail when a drawn map could not be captured', async () => {
    const { thumbs, state, slice } = setup({ width: 10, height: 8 });
    await saveWith(slice, async () => null);
    expect(thumbs).toEqual([]);
    expect(state.mapIndex[0].thumbnail).toBe(stored);
  });

  it('stores a fresh capture', async () => {
    const { thumbs, state, slice } = setup({ width: 10, height: 8 });
    const fresh = new Blob(['new']);
    await saveWith(slice, async () => fresh);
    expect(thumbs).toEqual([fresh]);
    expect(state.mapIndex[0].thumbnail).toBe(fresh);
  });

  it('drops the thumbnail of a map with nothing on it', async () => {
    const { thumbs, state, slice } = setup(null);
    const provider = vi.fn(async () => new Blob(['never']));
    await saveWith(slice, provider);
    expect(provider).not.toHaveBeenCalled();
    expect(thumbs).toEqual([null]);
    expect(state.mapIndex[0].thumbnail).toBeUndefined();
  });
});

// A copy is made from the stored record, so duplicating the map that is open has to flush
// it first — the canvas can be ahead of the last autosave.
describe('duplicateMap', () => {
  beforeEach(() => resetMapDB());

  function setup(activeMapId: string | null) {
    const rows = new Map<string, MapRecord>([['m1', record('m1', { name: 'Keep', data: blob(1) })]]);
    setMapDBFactory(
      () =>
        ({
          open: async () => {},
          duplicateMap: async (id: string) => {
            rows.set('copy', { ...rows.get(id)!, id: 'copy', name: `Copy of ${rows.get(id)!.name}` });
            return 'copy';
          },
          getMapMeta: async (id: string) => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { data: _, ...meta } = rows.get(id)!;
            return meta;
          },
        }) as unknown as MapDB,
    );
    const state = {
      mapIndex: [{ id: 'm1', name: 'Keep' }] as { id: string; name: string }[],
      activeMapId,
      // Stands in for the real save: whatever is on the canvas reaches the stored record.
      saveCurrentMap: vi.fn(async () => {
        rows.set('m1', { ...rows.get('m1')!, data: blob(9, 9) });
      }),
    };
    const slice = createMapsSlice(
      ((fn: (s: object) => void) => fn(state)) as never,
      (() => state) as never,
      {} as never,
    );
    return { rows, state, slice };
  }

  it('saves the open map first, so the copy has the latest edits', async () => {
    const { rows, state, slice } = setup('m1');
    const newId = await slice.duplicateMap('m1');

    expect(state.saveCurrentMap).toHaveBeenCalledTimes(1);
    expect(Array.from(rows.get(newId)!.data)).toEqual([9, 9]);
    // Newest first, and the open map stays the open map.
    expect(state.mapIndex[0]).toMatchObject({ id: 'copy', name: 'Copy of Keep' });
    expect(state.activeMapId).toBe('m1');
  });

  it('does not save over anything when the source is not the open map', async () => {
    const { rows, state, slice } = setup('other');
    await slice.duplicateMap('m1');

    expect(state.saveCurrentMap).not.toHaveBeenCalled();
    expect(Array.from(rows.get('copy')!.data)).toEqual([1]);
  });
});
