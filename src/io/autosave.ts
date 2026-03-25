// src/io/autosave.ts
// IndexedDB autosave + dirty flag management.
//
// Dirty flag lifecycle:
//   - Set: immediately on any store mutation (via Zustand subscriber)
//   - Cleared: on successful explicit save OR successful autosave
//
// Autosave trigger: debounced 30s after last store mutation.
// Recovery check: on app mount, if dirty flag is set, prompt user to restore.

import type { SerializedMapData } from '@/store/types';

// ─── Constants ────────────────────────────────────────────────────────────────

export const AUTOSAVE_DB_NAME = 'mapbuilder';
export const AUTOSAVE_STORE_NAME = 'saves';
export const AUTOSAVE_KEY = 'mapbuilder-autosave';
export const DIRTY_FLAG_KEY = 'mapbuilder-dirty';

// Guard: set to true during map switch to skip autosave writes
let _isMapSwitching = false;

export function setMapSwitching(switching: boolean): void {
  _isMapSwitching = switching;
}

export function isMapSwitchingActive(): boolean {
  return _isMapSwitching;
}

// ─── Dirty Flag (localStorage) ────────────────────────────────────────────────

export function setDirtyFlag(): void {
  localStorage.setItem(DIRTY_FLAG_KEY, 'true');
}

export function clearDirtyFlag(): void {
  localStorage.removeItem(DIRTY_FLAG_KEY);
}

export function isDirtyFlagSet(): boolean {
  return localStorage.getItem(DIRTY_FLAG_KEY) === 'true';
}

// ─── IndexedDB ────────────────────────────────────────────────────────────────

export interface AutosaveEntry {
  key: string;
  data: SerializedMapData;
  savedAt: number; // Date.now() timestamp
}

/** Open (or create) the mapbuilder IndexedDB. */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(AUTOSAVE_DB_NAME, 1);
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(AUTOSAVE_STORE_NAME)) {
        db.createObjectStore(AUTOSAVE_STORE_NAME, { keyPath: 'key' });
      }
    };
    req.onsuccess = (event) => resolve((event.target as IDBOpenDBRequest).result);
    req.onerror = (event) => reject((event.target as IDBOpenDBRequest).error);
  });
}

/**
 * Save the given SerializedMapData to IndexedDB under AUTOSAVE_KEY.
 */
export async function saveToIndexedDB(data: SerializedMapData): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUTOSAVE_STORE_NAME, 'readwrite');
    const store = tx.objectStore(AUTOSAVE_STORE_NAME);
    const entry: AutosaveEntry = {
      key: AUTOSAVE_KEY,
      data,
      savedAt: Date.now(),
    };
    const req = store.put(entry);
    req.onsuccess = () => resolve();
    req.onerror = (event) => reject((event.target as IDBRequest).error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * Load the autosave entry from IndexedDB.
 * Returns null if no autosave exists or if the saved data is not v2.0.
 * Stale v1.x autosaves are discarded and the entry is cleared.
 */
export async function loadFromIndexedDB(): Promise<AutosaveEntry | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUTOSAVE_STORE_NAME, 'readonly');
    const store = tx.objectStore(AUTOSAVE_STORE_NAME);
    const req = store.get(AUTOSAVE_KEY);
    req.onsuccess = (event) => {
      const result = (event.target as IDBRequest<AutosaveEntry | undefined>).result;
      if (!result) {
        resolve(null);
        db.close();
        return;
      }
      // Discard autosaves from older format versions
      if (result.data.version !== '2.0') {
        console.warn(
          `[autosave] Discarding stale autosave (version "${String((result.data as { version?: unknown }).version)}" is not v2.0)`,
        );
        // Best-effort delete — do not block on it
        try {
          const deleteTx = db.transaction(AUTOSAVE_STORE_NAME, 'readwrite');
          deleteTx.objectStore(AUTOSAVE_STORE_NAME).delete(AUTOSAVE_KEY);
        } catch {
          // ignore
        }
        clearDirtyFlag();
        resolve(null);
        db.close();
        return;
      }
      resolve(result);
      db.close();
    };
    req.onerror = (event) => reject((event.target as IDBRequest).error);
  });
}

// ─── Autosave Subscriber ──────────────────────────────────────────────────────

let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
const AUTOSAVE_DELAY_MS = 30_000; // 30 seconds

/**
 * Start the autosave system.
 * Call once on app mount. Returns a cleanup function for unmount.
 *
 * The subscriber sets the dirty flag on every state change and schedules
 * an autosave 30 seconds after the last mutation.
 *
 * In multi-map mode, the debounced save calls `saveCurrentMap()` on the
 * store, which persists the active map to the new IndexedDB maps store.
 * The `isMapSwitching` guard prevents autosave during map switch transitions.
 */
export function startAutosave(
  saveCurrentMap: () => Promise<void>,
  subscribe: (listener: () => void) => () => void,
): () => void {
  const handleChange = () => {
    setDirtyFlag();

    if (_debounceTimer !== null) clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
      // Skip autosave during map switch
      if (_isMapSwitching) return;

      saveCurrentMap()
        .then(() => {
          clearDirtyFlag();
        })
        .catch((err: unknown) => {
          console.warn('[autosave] save failed:', err);
        });
    }, AUTOSAVE_DELAY_MS);
  };

  const unsubscribe = subscribe(handleChange);

  return () => {
    unsubscribe();
    if (_debounceTimer !== null) {
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
    }
  };
}
