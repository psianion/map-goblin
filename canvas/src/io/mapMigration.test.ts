import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { migrateAutosave } from './mapMigration';
import { MapIndexDB } from './mapIndexDB';

// Helper to seed old autosave IDB
async function seedOldAutosave(data: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('mapbuilder', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('saves');
    };
    req.onsuccess = () => {
      const tx = req.result.transaction('saves', 'readwrite');
      tx.objectStore('saves').put(data, 'mapbuilder-autosave');
      tx.oncomplete = () => {
        req.result.close();
        resolve();
      };
    };
    req.onerror = () => reject(req.error);
  });
}

describe('migrateAutosave', () => {
  let mapDB: MapIndexDB;

  beforeEach(async () => {
    // eslint-disable-next-line no-global-assign
    indexedDB = new IDBFactory();
    mapDB = new MapIndexDB();
    await mapDB.open();
  });

  it('when maps store empty and old autosave exists: creates "Recovered Map"', async () => {
    const fakeBlob = new Uint8Array([1, 2, 3, 4]);
    await seedOldAutosave(fakeBlob);

    const result = await migrateAutosave(mapDB);
    expect(result.migrated).toBe(true);

    const metas = await mapDB.getAllMapMeta();
    expect(metas).toHaveLength(1);
    expect(metas[0].name).toBe('Recovered Map');
  });

  it('when maps store empty and no autosave: returns without creating map (bootstrap handles it)', async () => {
    const result = await migrateAutosave(mapDB);
    expect(result.migrated).toBe(false);
    expect(result.createdBlank).toBe(false);

    const metas = await mapDB.getAllMapMeta();
    expect(metas).toHaveLength(0);
  });

  it('when maps store already has entries: skips migration', async () => {
    await mapDB.createMap('Existing', new Uint8Array([1]), { width: 10, height: 10 }, 1);
    await seedOldAutosave(new Uint8Array([9, 9, 9]));

    const result = await migrateAutosave(mapDB);
    expect(result.migrated).toBe(false);
    expect(result.createdBlank).toBe(false);

    const metas = await mapDB.getAllMapMeta();
    expect(metas).toHaveLength(1); // Only the pre-existing one
  });

  it('old autosave key is not deleted after migration', async () => {
    await seedOldAutosave(new Uint8Array([1, 2]));
    await migrateAutosave(mapDB);

    // Verify old data still there
    const oldData = await new Promise<Uint8Array | undefined>((resolve, reject) => {
      const req = indexedDB.open('mapbuilder', 1);
      req.onsuccess = () => {
        const tx = req.result.transaction('saves', 'readonly');
        const getReq = tx.objectStore('saves').get('mapbuilder-autosave');
        getReq.onsuccess = () => { req.result.close(); resolve(getReq.result); };
        getReq.onerror = () => reject(getReq.error);
      };
    });
    expect(oldData).toBeDefined();
  });

  it('corrupt autosave blob: returns warning without creating map', async () => {
    // Seed with something that's not a valid Uint8Array
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('mapbuilder', 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('saves')) {
          req.result.createObjectStore('saves');
        }
      };
      req.onsuccess = () => {
        const tx = req.result.transaction('saves', 'readwrite');
        tx.objectStore('saves').put('not-a-uint8array', 'mapbuilder-autosave');
        tx.oncomplete = () => { req.result.close(); resolve(); };
      };
      req.onerror = () => reject(req.error);
    });

    const result = await migrateAutosave(mapDB);
    expect(result.migrated).toBe(false);
    expect(result.createdBlank).toBe(false);
    expect(result.warning).toBeTruthy();

    const metas = await mapDB.getAllMapMeta();
    expect(metas).toHaveLength(0);
  });
});
