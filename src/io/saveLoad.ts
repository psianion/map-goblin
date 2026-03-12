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
import { prepareImageForEmbed } from './imageEmbed';

// Magic bytes to identify .mapbuilder files — "MPBLD\x00"
export const MAGIC_HEADER = 'MPBLD\x00';
const MAGIC_BYTES = new TextEncoder().encode(MAGIC_HEADER);

// In-memory FSA file handle — survives the session but not a page reload
let _currentFileHandle: FileSystemFileHandle | null = null;

export function getCurrentFileHandle(): FileSystemFileHandle | null {
  return _currentFileHandle;
}

export function clearFileHandle(): void {
  _currentFileHandle = null;
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
        resolve(data);
      } catch (parseErr) {
        reject(new Error(`JSON parse failed: ${String(parseErr)}`));
      }
    });
  });
}

// ─── Custom Image Embedding ───────────────────────────────────────────────────

/**
 * Build the customImages record for a save file.
 * Collects all custom upload asset IDs from placed objects and encodes
 * their textures as base64 data URLs.
 */
async function buildCustomImages(data: SerializedMapData): Promise<Record<string, string>> {
  const customImages: Record<string, string> = {};
  const customUploads = useStore.getState().assets.customUploads;

  if (customUploads.length === 0 || data.placedObjects.length === 0) {
    return customImages;
  }

  const { Assets } = await import('pixi.js');

  for (const obj of data.placedObjects) {
    const assetId = obj.assetId;
    if (!assetId || assetId in customImages) continue;

    const isCustom = customUploads.some((u) => u.id === assetId);
    if (!isCustom) continue;

    try {
      const texture = Assets.cache.get(assetId) as { source?: { label?: string } } | undefined;
      if (!texture) continue;

      const uploadRef = customUploads.find((u) => u.id === assetId);
      if (!uploadRef) continue;

      const srcUrl = texture.source?.label ?? uploadRef.thumbnailUrl;
      customImages[assetId] = await prepareImageForEmbed(srcUrl);
    } catch (err) {
      console.warn(`[buildCustomImages] Could not embed asset "${assetId}":`, err);
    }
  }

  return customImages;
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
  const baseData = useStore.getState().getSerializableState();
  const customImages = await buildCustomImages(baseData);
  const data: SerializedMapData = { ...baseData, customImages };

  const compressed = await serializeToBytes(data);
  const mapName = data.mapSettings.name || 'untitled-map';
  const filename = `${mapName.replace(/[^a-z0-9\-_ ]/gi, '_')}.mapbuilder`;

  if ('showSaveFilePicker' in window && !forceNewFile) {
    // Use existing handle for silent overwrite if available
    if (_currentFileHandle) {
      try {
        const writable = await _currentFileHandle.createWritable();
        await writable.write(compressed.buffer as ArrayBuffer);
        await writable.close();
        return true;
      } catch {
        // Handle became invalid (e.g. file deleted) — fall through to prompt
        _currentFileHandle = null;
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
      _currentFileHandle = handle;
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
 * Returns true on success, false if the user cancelled.
 */
export async function loadMap(): Promise<boolean> {
  let fileBytes: Uint8Array;

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
      // Store handle for subsequent Ctrl+S overwrite
      _currentFileHandle = handle;
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

  const data = await deserializeFromBytes(fileBytes);
  // Restore custom images into PIXI.Assets before loading state
  if (data.customImages && Object.keys(data.customImages).length > 0) {
    try {
      const { restoreCustomImages } = await import('./imageEmbed');
      await restoreCustomImages(data.customImages);
    } catch (err) {
      console.warn('[loadMap] restoreCustomImages failed:', err);
    }
  }
  useStore.getState().loadFromFile(data);
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
