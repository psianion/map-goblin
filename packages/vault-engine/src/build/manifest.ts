// packages/engine/src/build/manifest.ts
import { sha256File } from '../hash.js';
import type { PackManifest } from '../schemas/pack-manifest.js';

export interface ManifestEntryInput {
  localId: string;
  type: string;
  material: string;
  gridSize: string;
  pieceType: string;
  variant: string;
  tags: string[];
  atlasFile?: string;
  frame?: { x: number; y: number; w: number; h: number };
}

export interface FileInput {
  filename: string;
  data: Buffer;
  size: number;
}

export interface ManifestInput {
  name: string;
  version: string;
  description: string;
  themes: string[];
  entries: ManifestEntryInput[];
  atlasFiles: FileInput[];
  individualFiles: FileInput[];
}

export function generateManifest(input: ManifestInput): PackManifest {
  const entries: PackManifest['entries'] = {};
  for (const e of input.entries) {
    entries[e.localId] = {
      type: e.type as 'floor',
      material: e.material,
      gridSize: e.gridSize,
      pieceType: e.pieceType,
      variant: e.variant,
      atlas: e.atlasFile,
      frame: e.frame,
      tags: e.tags,
    };
  }

  const atlases: PackManifest['atlases'] = {};
  for (const f of input.atlasFiles) {
    atlases[f.filename] = {
      checksum: `sha256:${sha256File(f.data)}`,
      size: f.size,
    };
  }

  const files: PackManifest['files'] = {};
  for (const f of input.individualFiles) {
    files[f.filename] = {
      checksum: `sha256:${sha256File(f.data)}`,
      size: f.size,
    };
  }

  const bundleSize = [...input.atlasFiles, ...input.individualFiles]
    .reduce((sum, f) => sum + f.size, 0);

  return {
    name: input.name,
    version: input.version,
    description: input.description,
    theme: input.themes,
    entries,
    atlases,
    files,
    bundleSize,
  };
}
