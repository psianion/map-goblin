// "Every level, one file each" in the Export dialog: one picture per level, in one zip named
// for the map. PNG and JPEG are compressed already, so the entries are stored, not deflated.

import { zipSync } from 'fflate';

/** A name part safe on any filesystem: spaces and slashes to hyphens, reserved characters dropped. */
function safePart(name: string): string {
  return name.trim().replace(/[<>:"|?*]/g, '').replace(/[\s/\\]+/g, '-');
}

/** The zip's own name: `<map-name>.zip`. */
export function levelsZipName(mapName: string): string {
  return `${safePart(mapName) || 'map'}.zip`;
}

/** One entry name per level, `<map-name>-<level-name>.<ext>`, a number added where two meet. */
export function levelEntryNames(mapName: string, levelNames: readonly string[], ext: 'png' | 'jpeg'): string[] {
  const map = safePart(mapName) || 'map';
  const taken = new Set<string>();
  return levelNames.map((name, i) => {
    const base = `${map}-${safePart(name) || `level-${i + 1}`}`;
    let entry = `${base}.${ext}`;
    for (let n = 2; taken.has(entry.toLowerCase()); n++) entry = `${base}-${n}.${ext}`;
    taken.add(entry.toLowerCase());
    return entry;
  });
}

/** The zip of one picture per level, in level order. */
export function buildLevelsZip(mapName: string, ext: 'png' | 'jpeg', files: readonly { levelName: string; bytes: Uint8Array }[]): Uint8Array {
  const names = levelEntryNames(mapName, files.map((f) => f.levelName), ext);
  return zipSync(Object.fromEntries(files.map((f, i) => [names[i]!, f.bytes])), { level: 0 });
}
