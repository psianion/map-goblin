// Turn a dropped folder (or loose files) into a list of importable maps. Foundry
// compendia and per-scene exports are parsed here for their counts and thumbnail; the
// map image is only read when the row is actually imported, so listing a 36-scene
// module never decodes 36 battlemaps.

import {
  foundryImagePath,
  isFoundryComposite,
  isFoundryScene,
  parseFoundryDb,
  readFoundryScene,
  type FoundryScene,
} from '@dnd/core/src/shared/import/foundry';
import { readUvtt } from '@dnd/core/src/shared/import/uvtt';
import type { ImportedImage, ImportedMap } from '@dnd/core/src/shared/import/types';

export interface ScannedMap {
  id: string;
  name: string;
  kind: 'foundry' | 'uvtt';
  /** Where it came from, for the row's subtitle. */
  sourcePath: string;
  /** Several floors on one canvas (Foundry Levels) — listed, unchecked by default. */
  composite: boolean;
  size: { width: number; height: number };
  counts: { walls: number; doors: number; lights: number };
  imageStatus: 'found' | 'embedded' | 'missing';
  thumb: string | null;
  warnings: string[];
  /** Read the image and build the full map. Called once per import. */
  load: () => Promise<ImportedMap>;
}

const MAP_FILE = /\.(db|json|uvtt|dd2vtt|df2vtt)$/i;

/** Files by forward-slash relative path, from a directory input or a plain file list. */
export function filesFromList(list: FileList | File[]): Map<string, File> {
  const out = new Map<string, File>();
  for (const f of Array.from(list)) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    out.set(rel.replace(/\\/g, '/'), f);
  }
  return out;
}

/** Files from a drop, walking any dropped directories. Falls back to the flat list. */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<Map<string, File>> {
  const out = new Map<string, File>();
  const entries = Array.from(dt.items ?? [])
    .map((item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => !!e);
  if (!entries.length) return filesFromList(dt.files);
  for (const entry of entries) await walkEntry(entry, '', out);
  return out;
}

async function walkEntry(entry: FileSystemEntry, prefix: string, out: Map<string, File>): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    out.set(prefix + entry.name, file);
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries returns batches until an empty one.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) break;
    for (const child of batch) await walkEntry(child, `${prefix}${entry.name}/`, out);
  }
}

async function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Response(file).text();
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const IMAGE_FILE = /\.(png|jpe?g|webp|gif|avif)$/i;

/** "Axeholm v1.10 (upper overlay) 47x42 @140pps.webp" → {axeholm, upper, overlay, 47x42, 140pps}. */
function nameTokens(path: string): Set<string> {
  const base = path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '').toLowerCase();
  return new Set(
    base
      .replace(/\bv\d+(\.\d+)*\b/g, ' ')
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
}

/** Match a module-relative image path against the dropped tree, loosest match last. */
export function findImageFile(
  files: Map<string, File>,
  relPath: string | null,
): { file: File; fuzzy: boolean } | null {
  if (!relPath) return null;
  const exact = files.get(relPath);
  if (exact) return { file: exact, fuzzy: false };
  const suffix = `/${relPath}`;
  for (const [key, f] of files) if (key.endsWith(suffix)) return { file: f, fuzzy: false };
  const base = relPath.slice(relPath.lastIndexOf('/') + 1);
  for (const [key, f] of files) if (key.slice(key.lastIndexOf('/') + 1) === base) return { file: f, fuzzy: false };

  // The pack names a file it never shipped (a version bump, an "(upper)" that only exists as
  // "(upper overlay)"). Take the image whose name shares most of its words, never one that
  // shares fewer than most, and say so in the row's warnings.
  const wanted = nameTokens(relPath);
  if (!wanted.size) return null;
  let best: { file: File; score: number } | null = null;
  for (const [key, f] of files) {
    if (!IMAGE_FILE.test(key)) continue;
    const have = nameTokens(key);
    let shared = 0;
    for (const t of wanted) if (have.has(t)) shared++;
    const score = shared / Math.max(wanted.size, have.size);
    if (score >= 0.7 && (!best || score > best.score)) best = { file: f, score };
  }
  return best ? { file: best.file, fuzzy: true } : null;
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
}

function foundryRow(scene: FoundryScene, sourcePath: string, files: Map<string, File>): ScannedMap {
  const wantedPath = foundryImagePath(scene);
  const match = findImageFile(files, wantedPath);
  const imageFile = match?.file ?? null;
  const preview = readFoundryScene(scene, null);
  if (match?.fuzzy) {
    preview.warnings.unshift(
      `image "${wantedPath!.slice(wantedPath!.lastIndexOf('/') + 1)}" is not in the folder — used "${match.file.name}"`,
    );
  }
  const thumb = scene.thumb?.startsWith('data:') ? scene.thumb : null;
  return {
    id: crypto.randomUUID(),
    name: preview.name,
    kind: 'foundry',
    sourcePath,
    composite: isFoundryComposite(scene),
    size: preview.size,
    counts: { walls: preview.walls.length, doors: preview.doors.length, lights: preview.lights.length },
    imageStatus: imageFile ? 'found' : 'missing',
    thumb,
    warnings: preview.warnings,
    load: async () => {
      let image: ImportedImage | null = null;
      if (imageFile) {
        const dataUrl = await fileToDataUrl(imageFile);
        const bitmap = await createImageBitmap(imageFile);
        const { width, height } = bitmap;
        bitmap.close();
        // Foundry stretches the picture over the scene rect, so the scale is the
        // picture's width over the scene's width in cells, not a number in the file.
        image = { dataUrl, width, height, pxPerCell: width / preview.size.width };
      }
      return readFoundryScene(scene, image);
    },
  };
}

function uvttRow(map: ImportedMap, sourcePath: string): ScannedMap {
  return {
    id: crypto.randomUUID(),
    name: map.name,
    kind: 'uvtt',
    sourcePath,
    composite: false,
    size: map.size,
    counts: { walls: map.walls.length, doors: map.doors.length, lights: map.lights.length },
    imageStatus: map.image ? 'embedded' : 'missing',
    thumb: map.image?.dataUrl ?? null,
    warnings: map.warnings,
    load: async () => map,
  };
}

function looksLikeUvtt(doc: unknown): boolean {
  return !!doc && typeof doc === 'object' && 'resolution' in (doc as object);
}

/** Every importable map in the dropped files, in path order. Unreadable files are skipped. */
export async function scanFiles(files: Map<string, File>): Promise<ScannedMap[]> {
  const rows: ScannedMap[] = [];
  const paths = [...files.keys()].filter((p) => MAP_FILE.test(p)).sort();
  for (const path of paths) {
    const file = files.get(path)!;
    let text: string;
    try {
      text = await readText(file);
    } catch {
      continue;
    }
    if (/\.db$/i.test(path)) {
      for (const scene of parseFoundryDb(text)) rows.push(foundryRow(scene, path, files));
      continue;
    }
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      continue;
    }
    if (isFoundryScene(doc)) {
      rows.push(foundryRow(doc, path, files));
    } else if (Array.isArray(doc)) {
      for (const d of doc) if (isFoundryScene(d)) rows.push(foundryRow(d, path, files));
    } else if (looksLikeUvtt(doc)) {
      try {
        rows.push(uvttRow(readUvtt(doc, baseName(path)), path));
      } catch {
        continue;
      }
    }
  }
  return rows;
}
