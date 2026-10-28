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

/** Whether the bytes start with the container's magic header. */
export function hasMagicHeader(bytes: Uint8Array): boolean {
  return bytes.length >= MAGIC_BYTES.length && MAGIC_BYTES.every((byte, i) => bytes[i] === byte);
}

/**
 * A map document saved as plain JSON: the older .mapbuilder files (format 3.0 and
 * 3.1, such as the session test maps) were written that way, before the container.
 * Recognised by its root carrying `version` and a `layers` array, which no
 * Foundry scene or Universal VTT file has. Returns null for anything else.
 */
export function parsePlainMapJson(bytes: Uint8Array): SerializedMapData | null {
  let i = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3; // UTF-8 BOM
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
  if (bytes[i] !== 0x7b) return null; // '{'
  let doc: unknown;
  try {
    doc = JSON.parse(new TextDecoder().decode(bytes.subarray(i)));
  } catch {
    return null;
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  const root = doc as { version?: unknown; layers?: unknown };
  if (typeof root.version !== 'string' || !Array.isArray(root.layers)) return null;
  return doc as SerializedMapData;
}

/**
 * Read a map file in either form: the container (header + gzip) or plain JSON.
 * Throws on anything else, and on a version this app cannot open.
 */
export function decodeAnyMapFile(bytes: Uint8Array): SerializedMapData {
  if (hasMagicHeader(bytes)) return decodeMapFile(bytes);
  const plain = parsePlainMapJson(bytes);
  if (!plain) throw new Error('Invalid map file. That is not a Good Goblin map file.');
  if (!isSupportedVersion(plain.version)) {
    throw new Error(
      `Incompatible file version "${String(plain.version)}". This app requires one of: ${SUPPORTED_VERSIONS.join(', ')}.`,
    );
  }
  return plain;
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
