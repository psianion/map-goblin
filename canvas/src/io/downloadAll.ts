// "Download all maps" on the home page (decision 14): every map in this browser as its
// .ggvtt file, in one zip built here. The stored bytes already are the file (the same
// container Ctrl+S writes), so nothing is re-encoded and nothing is compressed twice.

import { zipSync } from 'fflate';
import { MAP_FILE_EXTENSION } from '@dnd/core/src/shared/mapFile';
import { getMapDB } from '@/store/slices/maps';
import { useStore } from '@/store/store';
import type { MapIndexDB } from './mapIndexDB';
import { downloadBytes } from './saveLoad';

/** One file name per map, safe for any filesystem, a number added where two names meet. */
export function zipEntryNames(names: string[]): string[] {
  const taken = new Set<string>();
  return names.map((name) => {
    const base = (name.trim() || 'Untitled map').replace(/[^a-z0-9\-_ ]/gi, '_');
    let entry = `${base}${MAP_FILE_EXTENSION}`;
    for (let n = 2; taken.has(entry.toLowerCase()); n++) entry = `${base} (${n})${MAP_FILE_EXTENSION}`;
    taken.add(entry.toLowerCase());
    return entry;
  });
}

/** The zip of the given maps, stored rather than deflated: each file is gzip already. */
export function buildMapsZip(maps: { name: string; bytes: Uint8Array }[]): Uint8Array {
  const names = zipEntryNames(maps.map((m) => m.name));
  return zipSync(Object.fromEntries(maps.map((m, i) => [names[i]!, m.bytes])), { level: 0 });
}

/** Saves the open map first, so the zip holds it as it is on screen. Returns the map count. */
export async function downloadAllMaps(): Promise<number> {
  await useStore.getState().saveCurrentMap();
  const db = (await getMapDB()) as unknown as MapIndexDB;
  const metas = await db.getAllMapMeta();
  const maps: { name: string; bytes: Uint8Array }[] = [];
  for (const meta of metas) {
    const bytes = await db.getMapBlob(meta.id);
    if (bytes) maps.push({ name: meta.name, bytes });
  }
  if (maps.length === 0) return 0;
  const day = new Date().toISOString().slice(0, 10);
  downloadBytes(buildMapsZip(maps), `good-goblin-maps-${day}.zip`);
  return maps.length;
}
