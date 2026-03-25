// src/io/saveLoad.ts
// Native .mapbuilder save/load pipeline.
//
// File format:
//   [MAGIC_HEADER bytes] + [gzip-compressed UTF-8 JSON of SerializedMapData]
//
// Save strategy:
//   - Chrome/Edge: File System Access API (showSaveFilePicker) — allows overwrite
//   - Firefox/Safari: URL.createObjectURL download fallback
//
// The FSA file handle is stored in module state (not serialized).
// Ctrl+S reuses the handle for silent overwrite after first explicit save.

import { gzip, gunzip, strToU8, strFromU8 } from 'fflate';
import type { SerializedMapData } from '@/store/types';
import { useStore } from '@/store/store';

// Magic bytes to identify .mapbuilder files — "MPBLD\x00"
export const MAGIC_HEADER = 'MPBLD\x00';
const MAGIC_BYTES = new TextEncoder().encode(MAGIC_HEADER);

// In-memory FSA file handles — keyed by mapId, survive the session but not a page reload
const fileHandles = new Map<string, FileSystemFileHandle>();

export function setFileHandle(mapId: string, handle: FileSystemFileHandle): void {
  fileHandles.set(mapId, handle);
}

export function getFileHandle(mapId: string): FileSystemFileHandle | undefined {
  return fileHandles.get(mapId);
}

export function clearFileHandle(mapId: string): void {
  fileHandles.delete(mapId);
}

/** @deprecated Use getFileHandle(mapId) instead. Kept for backward compatibility. */
export function getCurrentFileHandle(): FileSystemFileHandle | null {
  const activeMapId = useStore.getState().activeMapId;
  if (!activeMapId) return null;
  return fileHandles.get(activeMapId) ?? null;
}

// ─── Serialization ────────────────────────────────────────────────────────────

/**
 * Serialize `SerializedMapData` to a compressed Uint8Array with magic header.
 * Pure function — no side effects.
 */
export async function serializeToBytes(data: SerializedMapData): Promise<Uint8Array> {
  const json = JSON.stringify(data);
  const jsonBytes = strToU8(json);

  return new Promise((resolve, reject) => {
    gzip(jsonBytes, (err, compressed) => {
      if (err) {
        reject(new Error(`gzip failed: ${err.message}`));
        return;
      }
      const result = new Uint8Array(MAGIC_BYTES.length + compressed.length);
      result.set(MAGIC_BYTES, 0);
      result.set(compressed, MAGIC_BYTES.length);
      resolve(result);
    });
  });
}

/**
 * Deserialize a Uint8Array produced by `serializeToBytes` back to `SerializedMapData`.
 * Validates the magic header before decompressing.
 */
export async function deserializeFromBytes(bytes: Uint8Array): Promise<SerializedMapData> {
  // Validate magic header
  const headerBytes = bytes.slice(0, MAGIC_BYTES.length);
  const header = new TextDecoder().decode(headerBytes);
  if (header !== MAGIC_HEADER) {
    throw new Error('Invalid .mapbuilder file — unrecognized header bytes');
  }

  const compressed = bytes.slice(MAGIC_BYTES.length);

  return new Promise((resolve, reject) => {
    gunzip(compressed, (err, decompressed) => {
      if (err) {
        reject(new Error(`ungzip failed: ${err.message}`));
        return;
      }
      try {
        const json = strFromU8(decompressed);
        const data = JSON.parse(json) as SerializedMapData;
        if (data.version !== '2.0' && data.version !== '3.0') {
          reject(
            new Error(
              `Incompatible file version "${String((data as { version?: unknown }).version)}". This app requires v2.0 or v3.0 format.`,
            ),
          );
          return;
        }
        resolve(data);
      } catch (parseErr) {
        reject(new Error(`JSON parse failed: ${String(parseErr)}`));
      }
    });
  });
}

// ─── Save ─────────────────────────────────────────────────────────────────────

/**
 * Save the current store state to a .mapbuilder file.
 *
 * On Chrome/Edge: uses File System Access API.
 *   - If `_currentFileHandle` is set, overwrites silently (Ctrl+S behavior).
 *   - Otherwise, prompts for file location.
 * On Firefox/Safari: triggers a download.
 *
 * Returns true on success, false if the user cancelled.
 */
export async function saveMap(forceNewFile = false): Promise<boolean> {
  const state = useStore.getState();
  const data: SerializedMapData = state.getSerializableState();
  const activeMapId = state.activeMapId;

  const compressed = await serializeToBytes(data);
  const mapName = data.mapSettings.name || 'untitled-map';
  const filename = `${mapName.replace(/[^a-z0-9\-_ ]/gi, '_')}.mapbuilder`;

  if ('showSaveFilePicker' in window && !forceNewFile) {
    // Use existing handle for silent overwrite if available
    const existingHandle = activeMapId ? fileHandles.get(activeMapId) : undefined;
    if (existingHandle) {
      try {
        const writable = await existingHandle.createWritable();
        await writable.write(compressed.buffer as ArrayBuffer);
        await writable.close();
        return true;
      } catch {
        // Handle became invalid (e.g. file deleted) — fall through to prompt
        if (activeMapId) fileHandles.delete(activeMapId);
      }
    }

    // Prompt for save location
    try {
      const handle = await window.showSaveFilePicker!({
        suggestedName: filename,
        types: [
          {
            description: 'Map Builder File',
            accept: { 'application/octet-stream': ['.mapbuilder'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(compressed.buffer as ArrayBuffer);
      await writable.close();
      if (activeMapId) fileHandles.set(activeMapId, handle);
      return true;
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return false;
      throw err;
    }
  } else {
    // Fallback download for Firefox/Safari
    downloadBytes(compressed, filename);
    return true;
  }
}

/**
 * Open a .mapbuilder file picker and load the selected file into the store.
 * In multi-map mode, creates a new map entry in IndexedDB and associates the file handle.
 * Returns true on success, false if the user cancelled.
 */
export async function loadMap(): Promise<boolean> {
  let fileBytes: Uint8Array;
  let fsaHandle: FileSystemFileHandle | undefined;

  if ('showOpenFilePicker' in window) {
    try {
      const [handle] = await window.showOpenFilePicker!({
        types: [
          {
            description: 'Map Builder File',
            accept: { 'application/octet-stream': ['.mapbuilder'] },
          },
        ],
        multiple: false,
      });
      const file = await handle.getFile();
      const buffer = await file.arrayBuffer();
      fileBytes = new Uint8Array(buffer);
      fsaHandle = handle;
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return false;
      throw err;
    }
  } else {
    // Fallback: use standard <input type="file"> via promise
    const picked = await pickFileViaInput();
    if (!picked) return false;
    fileBytes = picked;
  }

  let data: SerializedMapData;
  try {
    data = await deserializeFromBytes(fileBytes);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    useStore.getState().pushToast({ id: crypto.randomUUID(), message, type: 'error', duration: 6000, createdAt: Date.now() });
    return false;
  }

  // Restore custom images into PIXI.Assets before loading state
  if (data.customImages && Object.keys(data.customImages).length > 0) {
    try {
      const { restoreCustomImages } = await import('./imageEmbed');
      await restoreCustomImages(data.customImages);
    } catch (err) {
      console.warn('[loadMap] restoreCustomImages failed:', err);
    }
  }

  // Load data into the store
  useStore.getState().loadFromFile(data);

  // Create a new map entry in the multi-map system
  const store = useStore.getState();
  const mapName = data.mapSettings.name || 'Imported Map';
  try {
    const newMapId = await store.createNewMap(mapName);
    // Associate the FSA handle with the new map for Ctrl+S overwrite
    if (fsaHandle) {
      fileHandles.set(newMapId, fsaHandle);
    }
  } catch (err) {
    console.warn('[loadMap] Failed to create map entry:', err);
  }

  return true;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function downloadBytes(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function pickFileViaInput(): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mapbuilder';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        resolve(new Uint8Array(reader.result as ArrayBuffer));
      };
      reader.onerror = () => resolve(null);
      reader.readAsArrayBuffer(file);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}
