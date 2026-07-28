// packages/engine/src/build/index-gen.ts
import type { IndexFile } from '../schemas/index-file.js';

export interface PackInput {
  name: string;
  version: string;
  bundleSize: number;
  entryCount: number;
  themes: string[];
  previewFile: string;
  manifestFile: string;
}

export interface IndexInput {
  packs: PackInput[];
  totalEntries: number;
  chunkCount: number;
}

export function generateIndex(input: IndexInput): IndexFile {
  const packs: IndexFile['packs'] = {};

  for (const pack of input.packs) {
    packs[pack.name] = {
      version: pack.version,
      bundleSize: pack.bundleSize,
      entryCount: pack.entryCount,
      themes: pack.themes,
      preview: pack.previewFile,
      manifest: pack.manifestFile,
    };
  }

  return {
    version: 1,
    packs,
    catalog: {
      totalEntries: input.totalEntries,
      chunkCount: input.chunkCount,
      lastUpdated: new Date().toISOString(),
    },
  };
}
