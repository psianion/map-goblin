import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { MapIndexDB } from '../mapIndexDB';
import { resetMapDB } from './maps';

// We test the slice actions by calling MapIndexDB directly (same DB)
// and verifying the Zustand store state. The slice is thin orchestration.
// Full store integration requires wiring in step 2.5; here we test
// the MapIndexDB-backed logic that the slice delegates to.

describe('MapsSlice (via MapIndexDB)', () => {
  let db: MapIndexDB;

  beforeEach(async () => {
    indexedDB = new IDBFactory();
    resetMapDB(); // Clear module-level singleton
    db = new MapIndexDB();
    await db.open();
  });

  describe('loadMapIndex', () => {
    it('returns metas sorted by updatedAt desc', async () => {
      await db.createMap('Old', new Uint8Array([1]), { width: 10, height: 10 }, 1);
      await new Promise((r) => setTimeout(r, 10));
      await db.createMap('New', new Uint8Array([2]), { width: 20, height: 20 }, 2);

      const metas = await db.getAllMapMeta();
      expect(metas).toHaveLength(2);
      expect(metas[0].name).toBe('New'); // most recent first
    });

    it('first entry (most recent) becomes activeMapId candidate', async () => {
      await db.createMap('Map A', new Uint8Array([1]), { width: 10, height: 10 }, 1);
      const metas = await db.getAllMapMeta();
      expect(metas.length).toBeGreaterThan(0);
      // Slice would set activeMapId = metas[0].id
      expect(metas[0].name).toBe('Map A');
    });
  });

  describe('createMap', () => {
    it('creates map in IndexedDB and returns ID', async () => {
      const id = await db.createMap('Test', new Uint8Array([1]), { width: 40, height: 40 }, 1);
      expect(id).toBeTruthy();
      const meta = await db.getMapMeta(id);
      expect(meta).not.toBeNull();
      expect(meta!.name).toBe('Test');
    });

    it('new map appears in getAllMapMeta', async () => {
      await db.createMap('New Map', new Uint8Array([1]), { width: 40, height: 40 }, 1);
      const metas = await db.getAllMapMeta();
      expect(metas).toHaveLength(1);
      expect(metas[0].name).toBe('New Map');
    });
  });

  describe('deleteMap', () => {
    it('removes map from IndexedDB', async () => {
      const id = await db.createMap('To Delete', new Uint8Array([1]), { width: 10, height: 10 }, 1);
      await db.deleteMap(id);
      const meta = await db.getMapMeta(id);
      expect(meta).toBeNull();
      const metas = await db.getAllMapMeta();
      expect(metas).toHaveLength(0);
    });
  });

  describe('renameMap', () => {
    it('updates name in IndexedDB', async () => {
      const id = await db.createMap('Original', new Uint8Array([1]), { width: 10, height: 10 }, 1);
      await db.updateMapMeta(id, { name: 'Renamed' });
      const meta = await db.getMapMeta(id);
      expect(meta!.name).toBe('Renamed');
    });
  });

  describe('duplicateMap', () => {
    it('creates new entry with "Copy of" prefix', async () => {
      const id = await db.createMap('Cave', new Uint8Array([1, 2]), { width: 10, height: 10 }, 2);
      const newId = await db.duplicateMap(id);
      const meta = await db.getMapMeta(newId);
      expect(meta!.name).toBe('Copy of Cave');
    });

    it('duplicate has different ID from original', async () => {
      const id = await db.createMap('Cave', new Uint8Array([1]), { width: 10, height: 10 }, 1);
      const newId = await db.duplicateMap(id);
      expect(newId).not.toBe(id);
    });
  });

  describe('saveCurrentMap', () => {
    it('updates blob and metadata in IndexedDB', async () => {
      const id = await db.createMap('Test', new Uint8Array([1]), { width: 10, height: 10 }, 1);
      await new Promise((r) => setTimeout(r, 10));
      const newBlob = new Uint8Array([2, 3, 4]);
      await db.saveMapBlob(id, newBlob, { width: 50, height: 50 }, 3);
      const meta = await db.getMapMeta(id);
      expect(meta!.gridSize).toEqual({ width: 50, height: 50 });
      expect(meta!.layerCount).toBe(3);
      const blob = await db.getMapBlob(id);
      expect(Array.from(blob!)).toEqual(Array.from(newBlob));
    });
  });
});
