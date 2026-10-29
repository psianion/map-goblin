// packages/engine/src/build/families.ts
//
// Variant families for object entries: "crate_1" and "crate_2" are one prop in two
// looks. The family is the material with its numbering and variant letters removed;
// the runtime groups by set + family and never derives it itself.
import { readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { contentHash } from '../hash.js';
import { PackManifestSchema, type PackManifest } from '../schemas/pack-manifest.js';

/** Material minus every token that is all digits or a single letter: `cat_10_d` → `cat`. */
export function deriveFamily(material: string): string {
  const kept = material.split('_').filter((t) => !/^\d+$/.test(t) && !/^[A-Za-z]$/.test(t));
  return kept.length > 0 ? kept.join('_') : material;
}

/** Writes `family` on every object entry; other entry types are left as they are. */
export function addFamilies(manifest: PackManifest): PackManifest {
  const entries: PackManifest['entries'] = {};
  for (const [key, entry] of Object.entries(manifest.entries)) {
    entries[key] = entry.type === 'object' ? { ...entry, family: deriveFamily(entry.material) } : entry;
  }
  return { ...manifest, entries };
}

/**
 * Rewrites a built pack's manifest in place: applies `mutate`, stamps `version`,
 * names the result by the content hash of its LF JSON (as integrate does) and
 * removes the old pack-*.json. Every other file in the pack is left untouched.
 */
export async function rewriteManifest(
  packDir: string,
  mutate: (m: PackManifest) => PackManifest,
  version: string,
): Promise<string> {
  const candidates = (await readdir(packDir)).filter((f) => /^pack-[0-9a-f]+\.json$/.test(f));
  if (candidates.length !== 1) {
    throw new Error(`Expected exactly one pack-*.json in ${packDir}, found ${candidates.length}`);
  }
  const oldFile = candidates[0]!;
  const manifest = PackManifestSchema.parse(JSON.parse(await readFile(join(packDir, oldFile), 'utf-8')));

  const next = PackManifestSchema.parse({ ...mutate(manifest), version });
  const json = JSON.stringify(next, null, 2);
  const data = Buffer.from(json);
  const newFile = `pack-${contentHash(data)}.json`;

  const tmp = join(packDir, `${newFile}.tmp`);
  await writeFile(tmp, data);
  await rename(tmp, join(packDir, newFile));
  if (newFile !== oldFile) await rm(join(packDir, oldFile));
  return newFile;
}
