import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { MapIndexDB } from './mapIndexDB';

describe('MapIndexDB', () => {
  let db: MapIndexDB;

  beforeEach(async () => {
    // Reset IDB between tests
    // eslint-disable-next-line no-global-assign
    indexedDB = new IDBFactory();
    db = new MapIndexDB();
    await db.open();
  });

  describe('createMap', () => {
    it('stores entry with correct id, name, createdAt, data blob', async () => {
      const blob = new Uint8Array([1, 2, 3]);
      const id = await db.createMap('Test Map', blob, { width: 50, height: 40 }, 3);

      expect(id).toBeTruthy();
      const meta = await db.getMapMeta(id);
      expect(meta).not.toBeNull();
      expect(meta!.name).toBe('Test Map');
      expect(meta!.gridSize).toEqual({ width: 50, height: 40 });
      expect(meta!.layerCount).toBe(3);
      expect(meta!.createdAt).toBeGreaterThan(0);
      expect(meta!.updatedAt).toBeGreaterThan(0);
    });

    it('with custom name uses that name', async () => {
      const blob = new Uint8Array([1]);
      const id = await db.createMap('Cragmaw Cave', blob, { width: 30, height: 30 }, 1);
      const meta = await db.getMapMeta(id);
      expect(meta!.name).toBe('Cragmaw Cave');
    });

    it('generates unique IDs across calls', async () => {
      const blob = new Uint8Array([1]);
      const id1 = await db.createMap('A', blob, { width: 10, height: 10 }, 1);
      const id2 = await db.createMap('B', blob, { width: 10, height: 10 }, 1);
      expect(id1).not.toBe(id2);
    });
  });

  describe('getAllMapMeta', () => {
    it('returns all entries sorted by updatedAt desc', async () => {
      const blob = new Uint8Array([1]);
      await db.createMap('Old', blob, { width: 10, height: 10 }, 1);
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));
      await db.createMap('New', blob, { width: 10, height: 10 }, 1);

      const metas = await db.getAllMapMeta();
      expect(metas).toHaveLength(2);
      expect(metas[0].name).toBe('New');
      expect(metas[1].name).toBe('Old');
    });

    it('on empty store returns []', async () => {
      const metas = await db.getAllMapMeta();
      expect(metas).toEqual([]);
    });
  });

  describe('getMapBlob', () => {
    it('returns the Uint8Array data', async () => {
      const blob = new Uint8Array([10, 20, 30]);
      const id = await db.createMap('Test', blob, { width: 10, height: 10 }, 1);
      const result = await db.getMapBlob(id);
      expect(Array.from(result!)).toEqual(Array.from(blob));
    });

    it('returns null for nonexistent id', async () => {
      const result = await db.getMapBlob('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('saveMapBlob', () => {
    it('updates data and updatedAt', async () => {
      const blob = new Uint8Array([1]);
      const id = await db.createMap('Test', blob, { width: 10, height: 10 }, 1);
      const metaBefore = await db.getMapMeta(id);

      await new Promise((r) => setTimeout(r, 10));
      const newBlob = new Uint8Array([2, 3]);
      await db.saveMapBlob(id, newBlob, { width: 20, height: 20 }, 5);

      const data = await db.getMapBlob(id);
      expect(Array.from(data!)).toEqual(Array.from(newBlob));
      const metaAfter = await db.getMapMeta(id);
      expect(metaAfter!.updatedAt).toBeGreaterThan(metaBefore!.updatedAt);
      expect(metaAfter!.gridSize).toEqual({ width: 20, height: 20 });
      expect(metaAfter!.layerCount).toBe(5);
    });
  });

  describe('updateMapMeta', () => {
    it('renames without touching data', async () => {
      const blob = new Uint8Array([1, 2, 3]);
      const id = await db.createMap('Original', blob, { width: 10, height: 10 }, 1);
      await db.updateMapMeta(id, { name: 'Renamed' });

      const meta = await db.getMapMeta(id);
      expect(meta!.name).toBe('Renamed');
      const data = await db.getMapBlob(id);
      expect(Array.from(data!)).toEqual(Array.from(blob));
    });
  });

  describe('deleteMap', () => {
    it('removes entry entirely', async () => {
      const blob = new Uint8Array([1]);
      const id = await db.createMap('Test', blob, { width: 10, height: 10 }, 1);
      await db.deleteMap(id);
      const meta = await db.getMapMeta(id);
      expect(meta).toBeNull();
    });

    it('nonexistent id is a no-op', async () => {
      await expect(db.deleteMap('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('duplicateMap', () => {
    it('creates new entry with new ID, same data, name = "Copy of X"', async () => {
      const blob = new Uint8Array([1, 2, 3]);
      const id = await db.createMap('Original', blob, { width: 10, height: 10 }, 2);
      const newId = await db.duplicateMap(id);

      expect(newId).not.toBe(id);
      const meta = await db.getMapMeta(newId);
      expect(meta!.name).toBe('Copy of Original');
      const data = await db.getMapBlob(newId);
      expect(Array.from(data!)).toEqual(Array.from(blob));
      expect(meta!.layerCount).toBe(2);
    });
  });
});
