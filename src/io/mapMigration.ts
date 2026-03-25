import type { MapIndexDB } from './mapIndexDB';

const OLD_DB_NAME = 'mapbuilder';
const OLD_STORE_NAME = 'saves';
const OLD_KEY = 'mapbuilder-autosave';

export interface MigrationResult {
  migrated: boolean;
  createdBlank: boolean;
  warning?: string;
}

async function readOldAutosave(): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const req = indexedDB.open(OLD_DB_NAME, 1);
    req.onupgradeneeded = () => {
      // DB didn't exist — no autosave
      const db = req.result;
      if (!db.objectStoreNames.contains(OLD_STORE_NAME)) {
        db.createObjectStore(OLD_STORE_NAME);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OLD_STORE_NAME)) {
        db.close();
        resolve(null);
        return;
      }
      const tx = db.transaction(OLD_STORE_NAME, 'readonly');
      const getReq = tx.objectStore(OLD_STORE_NAME).get(OLD_KEY);
      getReq.onsuccess = () => {
        db.close();
        const data = getReq.result;
        if (data instanceof Uint8Array || (data && typeof data === 'object' && 'byteLength' in data && 'buffer' in data)) {
          resolve(data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer));
        } else if (data) {
          resolve(null); // Corrupt — not a Uint8Array
        } else {
          resolve(null);
        }
      };
      getReq.onerror = () => {
        db.close();
        resolve(null);
      };
    };
    req.onerror = () => resolve(null);
  });
}

export async function migrateAutosave(mapDB: MapIndexDB): Promise<MigrationResult> {
  // Skip if maps store already has entries
  const existing = await mapDB.getAllMapMeta();
  if (existing.length > 0) {
    return { migrated: false, createdBlank: false };
  }

  // Try reading old autosave
  let oldData: Uint8Array | null = null;
  let warning: string | undefined;

  try {
    oldData = await readOldAutosave();

    // Check if old DB had data but it wasn't a Uint8Array
    if (!oldData) {
      // Double-check: did the old DB have ANY value for the key?
      const hadCorruptData = await new Promise<boolean>((resolve) => {
        const req = indexedDB.open(OLD_DB_NAME, 1);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(OLD_STORE_NAME)) {
            db.close();
            resolve(false);
            return;
          }
          const tx = db.transaction(OLD_STORE_NAME, 'readonly');
          const getReq = tx.objectStore(OLD_STORE_NAME).get(OLD_KEY);
          getReq.onsuccess = () => {
            db.close();
            resolve(getReq.result != null);
          };
          getReq.onerror = () => { db.close(); resolve(false); };
        };
        req.onerror = () => resolve(false);
      });

      if (hadCorruptData) {
        warning = 'Found autosave data but it was corrupt. Created a blank map instead.';
      }
    }
  } catch {
    warning = 'Failed to read old autosave data.';
  }

  if (oldData) {
    await mapDB.createMap('Recovered Map', oldData, { width: 40, height: 40 }, 1);
    return { migrated: true, createdBlank: false };
  }

  // No old data (or corrupt) — do NOT create a blank map here.
  // App.tsx bootstrap will call createNewMap() which produces a valid serialized blob.
  return { migrated: false, createdBlank: false, warning };
}
