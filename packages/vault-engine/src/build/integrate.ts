// packages/engine/src/build/integrate.ts
//
// Folds forge sets into an already-built pack: each set is packed into its own
// atlas, entries it owns replace the hand-patched loose entries the old scripts
// wrote (forge/build-pack-files*.mjs), and everything else is carried byte-identical.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { packSprites, type SpriteInput } from './pack-sprites.js';
import { writeBundle } from './bundle.js';
import { contentHash, sha256File } from '../hash.js';
import { ATLAS_TYPES } from '../types.js';
import type { AssetType } from '../types.js';
import { PackManifestSchema, type PackManifest, type ManifestEntry } from '../schemas/pack-manifest.js';

/** 'door' lives in the manifest schema but predates types.ts — accept it here too. */
type EntryType = AssetType | 'door';

interface ForgePiece {
  file: string;
  piece: string;
  gridSize?: string;
  naturalWidth: number;
  naturalHeight: number;
  variant?: string;
  contentRect?: { x: number; y: number; w: number; h: number };
  tags?: string[];
  /**
   * Material identity, when it must differ from the file's own basename — e.g.
   * several grid-size variants of one family ("wall_short_2x2.png",
   * "wall_short_2x4.png") are separate files on disk (each piece needs its own
   * image) but share one material ("wall_short"), with gridSize telling them
   * apart in the minted key. Falls back to the file's basename when absent.
   */
  material?: string;
  /**
   * Exact manifest key to mint instead of the stem-derived one. Used for entries
   * whose id is a runtime contract (door sprites: `door-<style>-<state>`).
   * Loose sets only — the entry's material is set to this key so the loose file
   * prefix-matches it.
   */
  entryKey?: string;
}

interface ForgeSetManifest {
  set: string;
  pieces: ForgePiece[];
  /** Per-set entry type; falls back to the CLI-level type when absent. */
  type?: EntryType;
  /** Force loose files for an atlas type (e.g. a floor tile too big for one sheet). */
  loose?: boolean;
}

export interface IntegrateOptions {
  basePackDir: string;
  setDirs: string[];
  /** Default entry type for sets whose manifest doesn't declare its own. */
  type?: EntryType;
  version: string;
  output: string;
  /** Atlas bin cap in px, one side. Defaults to 4096, same ceiling as buildPack. */
  maxAtlasSize?: number;
}

export interface IntegrateResult {
  manifest: PackManifest;
  writtenFiles: string[];
}

async function findManifestFile(dir: string): Promise<string> {
  const names = await readdir(dir);
  const candidates = names.filter((f) => /^pack-[0-9a-f]+\.json$/.test(f));
  if (candidates.length !== 1) {
    throw new Error(`Expected exactly one pack-*.json in ${dir}, found ${candidates.length}`);
  }
  return candidates[0]!;
}

/** Grid size a piece implies when the forge manifest didn't say — 200px per grid unit. */
function deriveGridSize(w: number, h: number): string {
  const gx = Math.max(1, Math.round(w / 200));
  const gy = Math.max(1, Math.round(h / 200));
  return `${gx}x${gy}`;
}

/** Loose files a non-atlas entry depends on, by the pipeline's naming convention. */
function looseFilesFor(entry: ManifestEntry, fileNames: string[]): string[] {
  const prefix = `${entry.material}_${entry.gridSize}_${entry.variant}-`;
  return fileNames.filter((f) => f.startsWith(prefix));
}

function sortRecord<T>(rec: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of Object.keys(rec).sort()) out[key] = rec[key]!;
  return out;
}

const KNOWN_TYPES = new Set<string>([
  'floor', 'wall', 'pattern', 'edge', 'object', 'scatter', 'path', 'portal', 'light-mask', 'door',
]);

export async function integrateSets(opts: IntegrateOptions): Promise<IntegrateResult> {
  const maxAtlasSize = opts.maxAtlasSize ?? 4096;

  const baseManifestFile = await findManifestFile(opts.basePackDir);
  const baseManifest = PackManifestSchema.parse(
    JSON.parse(await readFile(join(opts.basePackDir, baseManifestFile), 'utf-8')),
  );
  const baseFileNames = Object.keys(baseManifest.files);

  const mintedEntries: Record<string, ManifestEntry> = {};
  const mintedAtlases: Record<string, { checksum: string; size: number }> = {};
  const mintedFiles: Record<string, { checksum: string; size: number }> = {};
  const newFiles = new Map<string, Buffer>(); // atlas webp+json / loose webp for minted sets
  const mintedKeySources = new Map<string, string>();
  const droppedFiles = new Set<string>();

  // Replacing an existing entry: drop the loose file it used to reference.
  const dropReplacedEntryFiles = (key: string): void => {
    const oldEntry = baseManifest.entries[key];
    if (!oldEntry) return;
    if (oldEntry.atlas) {
      throw new Error(`Cannot replace atlas-backed entry "${key}" — expected a loose-file entry`);
    }
    const oldFiles = looseFilesFor(oldEntry, baseFileNames);
    if (oldFiles.length !== 1) {
      throw new Error(`Expected exactly one loose file for entry "${key}", found ${oldFiles.length}`);
    }
    droppedFiles.add(oldFiles[0]!);
  };

  for (const setDir of opts.setDirs) {
    const forgeManifest: ForgeSetManifest = JSON.parse(
      await readFile(join(setDir, 'manifest.json'), 'utf-8'),
    );
    const setType = forgeManifest.type ?? opts.type;
    if (!setType || !KNOWN_TYPES.has(setType)) {
      throw new Error(
        `Set "${forgeManifest.set}" has no usable entry type — declare "type" in its manifest ` +
          `or pass -t (got "${setType ?? 'none'}")`,
      );
    }
    const loose = forgeManifest.loose === true || !ATLAS_TYPES.has(setType as AssetType);

    if (loose) {
      for (const piece of forgeManifest.pieces) {
        const stem = piece.material ?? piece.file.replace(/\.png$/, '');
        const gridSize = piece.gridSize ?? deriveGridSize(piece.naturalWidth, piece.naturalHeight);
        const variant = piece.variant ?? 'A';
        const material = piece.entryKey ?? stem;
        const key = piece.entryKey ?? `${stem}_${gridSize}_${setType}_${variant}`;

        const clash = mintedKeySources.get(key);
        if (clash) throw new Error(`Duplicate minted id '${key}': ${clash} and ${setDir}/${piece.file}`);
        mintedKeySources.set(key, `${setDir}/${piece.file}`);

        const webp = await sharp(await readFile(join(setDir, piece.file)))
          .webp({ quality: 90, alphaQuality: 90 })
          .toBuffer();
        // A loose entry ships no atlas frame — its recorded frame IS the renderer's
        // sizing contract for this file. If the source image a set manifest points
        // us at doesn't actually match the dimensions the manifest claims (e.g. two
        // grid-size variants collided onto one file upstream), catch it here rather
        // than shipping a sprite that renders squashed.
        const minted = await sharp(webp).metadata();
        if (minted.width !== piece.naturalWidth || minted.height !== piece.naturalHeight) {
          throw new Error(
            `Piece "${setDir}/${piece.file}" claims ${piece.naturalWidth}x${piece.naturalHeight} but the ` +
              `minted image is ${minted.width}x${minted.height} — fix the set manifest or its source file.`,
          );
        }
        const fileName = `${material}_${gridSize}_${variant}-${contentHash(webp)}.webp`;
        newFiles.set(fileName, webp);
        mintedFiles[fileName] = { checksum: `sha256:${sha256File(webp)}`, size: webp.length };

        mintedEntries[key] = {
          type: setType as ManifestEntry['type'],
          material,
          gridSize,
          pieceType: piece.piece,
          variant,
          // Loose entries carry no atlas frame; record real pixel size here so the
          // catalog's natural-size fallback (gridSize × 200) doesn't misreport
          // trimmed art that fills only part of its footprint.
          frame: { x: 0, y: 0, w: piece.naturalWidth, h: piece.naturalHeight },
          contentRect: piece.contentRect,
          set: forgeManifest.set,
          tags: piece.tags ?? baseManifest.theme,
        };
        dropReplacedEntryFiles(key);
      }
      continue;
    }

    const sprites: SpriteInput[] = [];
    // piece metadata keyed by minted key, joined back to the frame once packSprites places it
    const pieceByKey = new Map<string, { stem: string; gridSize: string; piece: ForgePiece }>();

    for (const piece of forgeManifest.pieces) {
      const stem = piece.material ?? piece.file.replace(/\.png$/, '');
      const gridSize = piece.gridSize ?? deriveGridSize(piece.naturalWidth, piece.naturalHeight);
      // Forge already bakes each piece's real variant into the stem (…_A/_B/_C); the
      // manifest "variant" field just mirrors what the shipped hand-patch wrote for
      // every piece regardless of that letter — always 'A' — which is what makes the
      // 58 ids already live in the pack reproduce exactly.
      const variant = 'A';
      const key = `${stem}_${gridSize}_${setType}_${variant}`;

      const clash = mintedKeySources.get(key);
      if (clash) throw new Error(`Duplicate minted id '${key}': ${clash} and ${setDir}/${piece.file}`);
      mintedKeySources.set(key, `${setDir}/${piece.file}`);

      pieceByKey.set(key, { stem, gridSize, piece });
      const data = await readFile(join(setDir, piece.file));
      sprites.push({ id: key, data, width: piece.naturalWidth, height: piece.naturalHeight });
    }

    const packResult = await packSprites(sprites, {
      maxSize: maxAtlasSize,
      padding: 1,
      // Matches what the hand-patch encoded this shipped art at (90/90), not
      // convert.ts's 85 texture profile — deliberately left untouched.
      webp: { quality: 90, alphaQuality: 90 },
    });
    // ponytail: single sheet per set, spill across sheets when a set actually exceeds 4096.
    if (packResult.atlases.length !== 1) {
      throw new Error(
        `Set "${forgeManifest.set}" needs ${packResult.atlases.length} atlas sheets to fit ` +
          `under ${maxAtlasSize}px — multi-sheet spillover isn't supported yet.`,
      );
    }

    const atlas = packResult.atlases[0]!;
    const hash = contentHash(atlas.imageData);
    const imgFilename = `atlas-${forgeManifest.set}-${setType}-${hash}.webp`;
    const jsonFilename = `atlas-${forgeManifest.set}-${setType}-${hash}.json`;
    atlas.meta.image = imgFilename;
    const jsonData = Buffer.from(JSON.stringify({ frames: atlas.frames, meta: atlas.meta }));

    newFiles.set(imgFilename, atlas.imageData);
    newFiles.set(jsonFilename, jsonData);
    mintedAtlases[imgFilename] = { checksum: `sha256:${sha256File(atlas.imageData)}`, size: atlas.imageData.length };
    mintedAtlases[jsonFilename] = { checksum: `sha256:${sha256File(jsonData)}`, size: jsonData.length };

    for (const [key, frame] of Object.entries(atlas.frames)) {
      const meta = pieceByKey.get(key)!;
      mintedEntries[key] = {
        type: setType as ManifestEntry['type'],
        material: meta.stem,
        gridSize: meta.gridSize,
        pieceType: meta.piece.piece,
        variant: 'A',
        atlas: imgFilename,
        frame: frame.frame,
        contentRect: meta.piece.contentRect,
        set: forgeManifest.set,
        tags: meta.piece.tags ?? baseManifest.theme,
      };
      dropReplacedEntryFiles(key);
    }
  }

  // Nothing still-kept may depend on a file we're about to drop.
  for (const [key, entry] of Object.entries(baseManifest.entries)) {
    if (mintedEntries[key]) continue;
    if (entry.atlas) continue; // atlas entries never reference the loose files we drop
    for (const f of looseFilesFor(entry, baseFileNames)) {
      if (droppedFiles.has(f)) {
        throw new Error(`Cannot drop file "${f}" — still referenced by kept entry "${key}"`);
      }
    }
  }

  const finalEntries = sortRecord({ ...baseManifest.entries, ...mintedEntries });
  const finalAtlases = sortRecord({ ...baseManifest.atlases, ...mintedAtlases });
  const finalFiles = sortRecord({
    ...Object.fromEntries(Object.entries(baseManifest.files).filter(([f]) => !droppedFiles.has(f))),
    ...mintedFiles,
  });
  const bundleSize =
    Object.values(finalAtlases).reduce((s, f) => s + f.size, 0) +
    Object.values(finalFiles).reduce((s, f) => s + f.size, 0);

  const manifest: PackManifest = {
    name: baseManifest.name,
    version: opts.version,
    description: baseManifest.description,
    theme: baseManifest.theme,
    entries: finalEntries,
    atlases: finalAtlases,
    files: finalFiles,
    bundleSize,
    // checksums is a hand-patch artifact — never written here.
  };

  const manifestJson = JSON.stringify(manifest, null, 2);
  const manifestHash = contentHash(Buffer.from(manifestJson));

  const allFiles = new Map<string, Buffer>();
  for (const [filename, data] of newFiles) allFiles.set(filename, data);

  // Carry every kept base file byte-identical — read straight off disk, no re-encode.
  // Driven by the actual directory listing (not just manifest keys) so files the
  // manifest never tracked — e.g. preview-*, which `index` requires but no entry
  // references — still make it into the new pack instead of being silently dropped.
  const trackedFiles = new Set([...Object.keys(baseManifest.atlases), ...Object.keys(baseManifest.files)]);
  const baseDirEntries = await readdir(opts.basePackDir, { withFileTypes: true });
  const unexpected: string[] = [];
  for (const entry of baseDirEntries) {
    if (!entry.isFile()) continue;
    const filename = entry.name;
    if (filename === baseManifestFile) continue; // superseded by the new pack-*.json
    if (droppedFiles.has(filename)) continue; // intentionally replaced by a minted entry
    if (trackedFiles.has(filename) || filename.startsWith('preview-')) {
      allFiles.set(filename, await readFile(join(opts.basePackDir, filename)));
      continue;
    }
    unexpected.push(filename);
  }
  if (unexpected.length > 0) {
    throw new Error(
      `Unexpected file(s) in ${opts.basePackDir} — neither manifest-tracked, preview-*, nor ` +
        `pack-*.json: ${unexpected.join(', ')}. A publish step must not silently drop or ship these.`,
    );
  }

  allFiles.set(`pack-${manifestHash}.json`, Buffer.from(manifestJson));

  const written = await writeBundle({
    packName: manifest.name,
    version: manifest.version,
    outputDir: opts.output,
    files: allFiles,
  });

  return { manifest, writtenFiles: written };
}
