/**
 * Reading a pack file: a `.zip` whose root holds `manifest.json` (the pack manifest the
 * CDN and the bundled packs use) and every atlas and file it lists, at the paths it gives.
 * The result is what `AssetPackManager.registerPack` takes, so nothing is written until
 * the whole file has checked out.
 */
import { strFromU8, unzipSync } from 'fflate';
import type { PackManifest } from '@dnd/core/src/engine/assetPackManager';
import type { PackFile } from '@dnd/core/src/store/packIO';

/** The largest pack a file may hold, zipped or unpacked. */
export const PACK_FILE_MAX_BYTES = 512 * 1024 * 1024;

/** A pack file that cannot be installed; the message is the one-line reason. */
export class PackFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackFileError';
  }
}

/** A pack's id from its manifest name: lowercase, anything but a-z, 0-9 and "-" as "-". */
export function packIdOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const MB = 1024 * 1024;

/** Read and check a pack file's bytes. Throws a PackFileError naming what is wrong. */
export function readPackFile(bytes: Uint8Array): PackFile {
  if (bytes.length > PACK_FILE_MAX_BYTES) throw new PackFileError(`The file is over ${PACK_FILE_MAX_BYTES / MB} MB`);

  // First pass: every name and unpacked size, and only the manifest inflated.
  const sizes = new Map<string, number>();
  let head: Record<string, Uint8Array>;
  try {
    head = unzipSync(bytes, {
      filter: (f) => {
        sizes.set(f.name, f.originalSize);
        return f.name === 'manifest.json';
      },
    });
  } catch {
    throw new PackFileError('Not a zip file');
  }

  const raw = head['manifest.json'];
  if (!raw) {
    const nested = [...sizes.keys()].find((n) => n.endsWith('/manifest.json'));
    throw new PackFileError(
      nested
        ? `manifest.json must be at the root of the zip, not in ${nested.slice(0, -'manifest.json'.length)}`
        : 'No manifest.json at the root of the zip',
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(strFromU8(raw));
  } catch {
    throw new PackFileError('manifest.json is not valid JSON');
  }
  if (!isRecord(json)) throw new PackFileError('manifest.json is not a pack manifest');
  const { name, version, entries } = json;
  if (typeof name !== 'string' || !name.trim()) throw new PackFileError('manifest.json has no name');
  if (typeof version !== 'string' || !version.trim()) throw new PackFileError('manifest.json has no version');
  if (!isRecord(entries) || Object.keys(entries).length === 0) throw new PackFileError('manifest.json lists no entries');
  const atlases = json.atlases ?? {};
  const files = json.files ?? {};
  if (!isRecord(atlases) || !isRecord(files)) throw new PackFileError('manifest.json has a malformed atlases or files list');

  const packId = packIdOf(name);
  if (!/[a-z0-9]/.test(packId)) throw new PackFileError('The pack name needs a letter or a digit');

  const referenced = [...Object.keys(atlases), ...Object.keys(files)];
  const missing = referenced.filter((path) => !sizes.has(path));
  if (missing.length > 0) {
    const more = missing.length > 1 ? ` and ${missing.length - 1} more` : '';
    throw new PackFileError(`The zip is missing ${missing[0]}${more}`);
  }
  const unpacked = referenced.reduce((sum, path) => sum + (sizes.get(path) ?? 0), 0);
  if (unpacked > PACK_FILE_MAX_BYTES) throw new PackFileError(`Unpacked, the pack is over ${PACK_FILE_MAX_BYTES / MB} MB`);

  // Second pass: the files the manifest asks for, nothing else.
  const wanted = new Set(referenced);
  const body = unzipSync(bytes, { filter: (f) => wanted.has(f.name) });
  const blobs = new Map<string, Uint8Array>(referenced.map((path) => [path, body[path]]));

  const manifest = {
    ...json,
    name,
    version,
    description: typeof json.description === 'string' ? json.description : '',
    bundleSize: typeof json.bundleSize === 'number' ? json.bundleSize : unpacked,
    entries,
    atlases,
    files,
  } as unknown as PackManifest;
  return { packId, manifest, blobs };
}
