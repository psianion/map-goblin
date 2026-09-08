// Pure .mapbuilder container encode/decode — no store, no DOM, no side
// effects. Shared by the save worker (production path) and direct calls
// (tests, environments without Worker). The file format is unchanged:
//   [MAGIC_HEADER bytes] + [gzip-compressed UTF-8 JSON of SerializedMapData]
// with splat bitmaps riding inside customImages as PNG data URLs.

import { gzipSync, gunzipSync, strToU8, strFromU8 } from 'fflate';
import type { SerializedMapData } from '@/store/types';
import { SPLAT_IMAGE_KEYS } from '@dnd/core/src/engine/terrain/terrainShared';
import { SUPPORTED_VERSIONS, isSupportedVersion } from '@dnd/core/src/store/migration';

export const MAGIC_HEADER = 'MPBLD\x00';
const MAGIC_BYTES = new TextEncoder().encode(MAGIC_HEADER);

/** Chunked btoa — String.fromCharCode(...whole) overflows the arg limit on MBs. */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Build the on-disk bytes. `splats` are PNG bytes per splatmap (null = blank);
 * they're injected as data URLs here so the base64 text never exists outside
 * this call — on the worker, that means never on the main thread.
 */
export function encodeMapFile(
  data: SerializedMapData,
  splats: (Uint8Array | null)[] = [],
): Uint8Array {
  let doc = data;
  if (splats.some(Boolean)) {
    const customImages = { ...data.customImages };
    for (const [i, key] of SPLAT_IMAGE_KEYS.entries()) {
      const png = splats[i];
      if (png) customImages[key] = `data:image/png;base64,${bytesToBase64(png)}`;
    }
    doc = { ...data, customImages };
  }
  const jsonBytes = strToU8(JSON.stringify(doc));
  const compressed = gzipSync(jsonBytes);
  const result = new Uint8Array(MAGIC_BYTES.length + compressed.length);
  result.set(MAGIC_BYTES, 0);
  result.set(compressed, MAGIC_BYTES.length);
  return result;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * The publish content hash's actual work — pulled out of publish.ts so the save
 * worker can run it off the main thread. `prep` is stripped first (see
 * hashMapForPublish in publish.ts for why); everything else about the bytes hashed
 * is unchanged from before this moved.
 */
export async function hashMapBytes(
  data: SerializedMapData,
  splats: (Uint8Array | null)[] = [],
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { prep: _prep, ...withoutPrep } = data;
  const docBytes = new TextEncoder().encode(JSON.stringify(withoutPrep));
  const parts = [docBytes, ...splats.filter((b): b is Uint8Array => b !== null)];
  const combined = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.byteLength;
  }
  return sha256Hex(combined);
}

/** Validate the magic header and unpack the JSON document. Throws on bad input. */
export function decodeMapFile(bytes: Uint8Array): SerializedMapData {
  const header = new TextDecoder().decode(bytes.slice(0, MAGIC_BYTES.length));
  if (header !== MAGIC_HEADER) {
    throw new Error('Invalid .mapbuilder file — unrecognized header bytes');
  }
  const decompressed = gunzipSync(bytes.slice(MAGIC_BYTES.length));
  const data = JSON.parse(strFromU8(decompressed)) as SerializedMapData;
  if (!isSupportedVersion(data.version)) {
    throw new Error(
      `Incompatible file version "${String((data as { version?: unknown }).version)}". This app requires one of: ${SUPPORTED_VERSIONS.join(', ')}.`,
    );
  }
  return data;
}
