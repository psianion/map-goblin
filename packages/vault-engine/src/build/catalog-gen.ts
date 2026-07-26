// packages/engine/src/build/catalog-gen.ts
import type { CatalogChunk, CatalogEntry, CatalogMeta } from '../schemas/catalog.js';

/** Input for one catalog entry — matches CatalogEntrySchema. */
export type CatalogEntryInput = CatalogEntry;

export interface ChunkOptions {
  chunkSize: number;
  /** URL prefix for chunk files, e.g. 'catalog/'. Chunk i → `${urlPrefix}chunk-${i}.json` */
  urlPrefix?: string;
}

export interface CatalogChunksResult {
  chunks: CatalogChunk[];
  meta: CatalogMeta;
}

export function generateCatalogChunks(
  entries: CatalogEntryInput[],
  opts: ChunkOptions = { chunkSize: 10000 },
): CatalogChunksResult {
  const urlPrefix = opts.urlPrefix ?? '';

  // Sort by type → material → theme
  const sorted = [...entries].sort((a, b) => {
    const typeComp = a.type.localeCompare(b.type);
    if (typeComp !== 0) return typeComp;
    const matComp = a.material.localeCompare(b.material);
    if (matComp !== 0) return matComp;
    return a.theme.localeCompare(b.theme);
  });

  // Split into chunks
  const chunks: CatalogChunk[] = [];
  for (let i = 0; i < sorted.length; i += opts.chunkSize) {
    chunks.push({ entries: sorted.slice(i, i + opts.chunkSize) });
  }

  // Inverted index: facet value → chunk numbers containing at least one match
  const invertedIndex: CatalogMeta['invertedIndex'] = { type: {}, theme: {}, material: {} };
  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    for (const entry of chunks[chunkIdx]!.entries) {
      for (const facet of ['type', 'theme', 'material'] as const) {
        const value = entry[facet];
        const bucket = (invertedIndex[facet][value] ??= []);
        if (bucket[bucket.length - 1] !== chunkIdx) bucket.push(chunkIdx);
      }
    }
  }

  return {
    chunks,
    meta: {
      version: 1,
      totalEntries: sorted.length,
      chunkCount: chunks.length,
      chunks: chunks.map((c, i) => ({
        index: i,
        url: `${urlPrefix}chunk-${i}.json`,
        entryCount: c.entries.length,
      })),
      invertedIndex,
    },
  };
}
