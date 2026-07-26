import { hammingDistance } from './phash.js';

export interface HashEntry {
  id: string;
  hash: string;
}

export interface DedupOptions {
  duplicateThreshold?: number;
  similarThreshold?: number;
}

export interface DedupResult {
  id: string;
  duplicates: string[];
  similar: string[];
}

export function findDuplicates(
  entries: HashEntry[],
  opts: DedupOptions = {},
): DedupResult[] {
  const dupThresh = opts.duplicateThreshold ?? 5;
  const simThresh = opts.similarThreshold ?? 8;

  return entries.map((entry) => {
    const duplicates: string[] = [];
    const similar: string[] = [];

    for (const other of entries) {
      if (other.id === entry.id) continue;
      const dist = hammingDistance(entry.hash, other.hash);
      if (dist <= dupThresh) {
        duplicates.push(other.id);
      } else if (dist <= simThresh) {
        similar.push(other.id);
      }
    }

    return { id: entry.id, duplicates, similar };
  });
}
