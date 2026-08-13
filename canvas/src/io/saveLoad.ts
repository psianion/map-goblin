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

import type { SerializedMapData } from '@/store/types';
import { useStore } from '@/store/store';
import { notify } from '@/lib/toast';
import { getTerrainRenderer } from '@dnd/core/src/engine/terrain/TerrainRenderer';
import { getAssetPackManager } from '@/engine/assetPackInstance';
import { encodeMapFile, decodeMapFile, MAGIC_HEADER } from './mapFormat';

export { MAGIC_HEADER };

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

// ─── Save worker plumbing ─────────────────────────────────────────────────────
// The stringify/base64/gzip of a document that can carry megabytes of images
// used to run on the main thread on every autosave and map switch. It now
// runs in a worker; jsdom (vitest) has no Worker, so those fall through to
// the same pure functions inline.

let saveWorker: Worker | null = null;
let nextRequestId = 1;
const pendingRequests = new Map<
  number,
  { resolve: (r: { bytes?: ArrayBuffer; data?: SerializedMapData }) => void; reject: (e: Error) => void }
>();

function getSaveWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (!saveWorker) {
    saveWorker = new Worker(new URL('./saveWorker.ts', import.meta.url), { type: 'module' });
    saveWorker.onmessage = (
      e: MessageEvent<{ id: number; bytes?: ArrayBuffer; data?: SerializedMapData; error?: string }>,
    ) => {
      const pending = pendingRequests.get(e.data.id);
      if (!pending) return;
      pendingRequests.delete(e.data.id);
      if (e.data.error) pending.reject(new Error(e.data.error));
      else pending.resolve(e.data);
    };
  }
  return saveWorker;
}

function callSaveWorker(
  worker: Worker,
  msg: Record<string, unknown>,
  transfer: Transferable[],
): Promise<{ bytes?: ArrayBuffer; data?: SerializedMapData }> {
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    worker.postMessage({ id, ...msg }, transfer);
  });
}

/**
 * Serialize `SerializedMapData` to a compressed Uint8Array with magic header.
 * Splat bitmaps are read from the store (as binary Blobs) and injected as
 * data URLs inside the worker — the format on disk is unchanged.
 */
export async function serializeToBytes(data: SerializedMapData): Promise<Uint8Array> {
  // Make sure a just-finished stroke's pixels have landed in the store.
  await getTerrainRenderer()?.flushPersistNow();
  const pngs = useStore.getState().terrainSplats.pngs;
  const splats = await Promise.all(pngs.map((b) => (b ? b.arrayBuffer() : Promise.resolve(null))));

  const worker = getSaveWorker();
  if (!worker) {
    return encodeMapFile(data, splats.map((b) => (b ? new Uint8Array(b) : null)));
  }
  const reply = await callSaveWorker(worker, { op: 'encode', data, splats }, splats.filter(Boolean) as ArrayBuffer[]);
  return new Uint8Array(reply.bytes!);
}

/**
 * Deserialize a Uint8Array produced by `serializeToBytes` back to `SerializedMapData`.
 * Validates the magic header before decompressing. Splat entries stay inside
 * `customImages` here — `loadFromFile` splits them into binary terrainSplats.
 */
export async function deserializeFromBytes(bytes: Uint8Array): Promise<SerializedMapData> {
  const worker = getSaveWorker();
  if (!worker) return decodeMapFile(bytes);
  // Copy: callers may reuse their buffer, and transfer detaches it.
  const buf = bytes.slice().buffer;
  const reply = await callSaveWorker(worker, { op: 'decode', bytes: buf }, [buf]);
  return reply.data!;
}

// ─── Save ─────────────────────────────────────────────────────────────────────

/** Map name reduced to a filesystem-safe `.mapbuilder` filename. */
function mapFilename(data: SerializedMapData): string {
  const mapName = data.mapSettings.name || 'untitled-map';
  return `${mapName.replace(/[^a-z0-9\-_ ]/gi, '_')}.mapbuilder`;
}

/**
 * Write the current map to a `.mapbuilder` download — same container bytes as
 * `saveMap`, delivered through a blob anchor instead of the native file picker.
 *
 * This is the Export dialog's map-file option. It exists because the picker is
 * the only thing `saveMap` will use on Chrome/Edge, and a native picker cannot
 * be driven by automation or found by a user who has not been told about
 * Ctrl+S. Returns the filename it downloaded as.
 */
export async function downloadMapFile(): Promise<string> {
  const data: SerializedMapData = useStore.getState().getSerializableState();
  const filename = mapFilename(data);
  downloadBytes(await serializeToBytes(data), filename);
  return filename;
}

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
  const filename = mapFilename(data);

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
    notify.error(message);
    return false;
  }

  // Restore custom images into PIXI.Assets before loading state
  if (data.customImages && Object.keys(data.customImages).length > 0) {
    try {
      const { restoreCustomImages } = await import('@/assets/textureLoader');
      await restoreCustomImages(data.customImages);
    } catch (err) {
      console.warn('[loadMap] restoreCustomImages failed:', err);
      notify.warning('Some embedded images could not be restored from this file');
    }
  }

  // Load data into the store
  useStore.getState().loadFromFile(data);

  // Install-by-need: fetch whatever pack asset sets this document references that aren't
  // resident yet. Soft-fail — a missing set degrades to the magenta fallback, same as
  // before this existed, and must never be the reason an opened file fails to load.
  try {
    await getAssetPackManager().ensureTexturesForMap(data);
  } catch (err) {
    console.warn('[loadMap] ensureTexturesForMap failed:', err);
  }

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
    notify.error('Map loaded but could not be saved to your map list');
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
