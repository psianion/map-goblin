export interface MapMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  gridSize: { width: number; height: number };
  layerCount: number;
}

/** Where this map last landed in the library, and what was published. */
export interface PublishState {
  campaignId: string;
  sceneId: string;
  mapHash: string;
}

interface MapEntry extends MapMeta {
  data: Uint8Array;
  /** Absent until the map has been published once. */
  publish?: PublishState;
}

const DB_NAME = 'mapbuilder-maps';
const STORE_NAME = 'maps';
// `publish` is an optional property on an existing store's values, not a new store or
// index — IndexedDB needs no upgrade transaction for that, so this stays at 1.
const DB_VERSION = 1;

export class MapIndexDB {
  private db: IDBDatabase | null = null;

  async open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };
      req.onsuccess = () => {
        this.db = req.result;
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }

  async createMap(
    name: string,
    data: Uint8Array,
    gridSize: { width: number; height: number },
    layerCount: number,
  ): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();
    const entry: MapEntry = { id, name, createdAt: now, updatedAt: now, gridSize, layerCount, data };
    await this.put(entry);
    return id;
  }

  async getMapMeta(id: string): Promise<MapMeta | null> {
    const entry = await this.get(id);
    if (!entry) return null;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { data: _, ...meta } = entry;
    return meta;
  }

  async getAllMapMeta(): Promise<MapMeta[]> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const idx = store.index('updatedAt');
      const req = idx.openCursor(null, 'prev'); // descending
      const results: MapMeta[] = [];
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { data: _, ...meta } = cursor.value as MapEntry;
          results.push(meta);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async getMapBlob(id: string): Promise<Uint8Array | null> {
    const entry = await this.get(id);
    return entry?.data ?? null;
  }

  async saveMapBlob(
    id: string,
    data: Uint8Array,
    gridSize: { width: number; height: number },
    layerCount: number,
  ): Promise<void> {
    const entry = await this.get(id);
    if (!entry) return;
    entry.data = data;
    entry.updatedAt = Date.now();
    entry.gridSize = gridSize;
    entry.layerCount = layerCount;
    await this.put(entry);
  }

  async updateMapMeta(id: string, updates: Partial<Pick<MapMeta, 'name'>>): Promise<void> {
    const entry = await this.get(id);
    if (!entry) return;
    if (updates.name !== undefined) entry.name = updates.name;
    entry.updatedAt = Date.now();
    await this.put(entry);
  }

  async deleteMap(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async duplicateMap(id: string): Promise<string> {
    const entry = await this.get(id);
    if (!entry) throw new Error(`Map ${id} not found`);
    const newId = crypto.randomUUID();
    const now = Date.now();
    await this.put({
      ...entry,
      id: newId,
      name: `Copy of ${entry.name}`,
      createdAt: now,
      updatedAt: now,
    });
    return newId;
  }

  async getPublishState(id: string): Promise<PublishState | null> {
    const entry = await this.get(id);
    return entry?.publish ?? null;
  }

  async setPublishState(id: string, publish: PublishState): Promise<void> {
    const entry = await this.get(id);
    if (!entry) return;
    entry.publish = publish;
    await this.put(entry);
  }

  private async get(id: string): Promise<MapEntry | null> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  private async put(entry: MapEntry): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).put(entry);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}
