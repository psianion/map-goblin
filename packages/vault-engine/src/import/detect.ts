import type { AssetType } from '../types.js';

/** Folder name → asset type mapping (singular and plural forms) */
const FOLDER_MAP: Record<string, AssetType> = {
  floor: 'floor',
  floors: 'floor',
  wall: 'wall',
  walls: 'wall',
  object: 'object',
  objects: 'object',
  scatter: 'scatter',
  path: 'path',
  paths: 'path',
  portal: 'portal',
  portals: 'portal',
  pattern: 'pattern',
  patterns: 'pattern',
  edge: 'edge',
  edges: 'edge',
  'light-mask': 'light-mask',
  'light-masks': 'light-mask',
  terrain: 'pattern',
};

const SCATTER_MAX_DIM = 96;

export interface DetectInput {
  width: number;
  height: number;
  folder: string;
}

export function detectAssetType(input: DetectInput): AssetType {
  // Folder hint takes priority
  const folderKey = input.folder.toLowerCase().replace(/\/$/, '');
  if (folderKey && FOLDER_MAP[folderKey]) {
    return FOLDER_MAP[folderKey]!;
  }

  // Small images are likely scatter
  if (input.width <= SCATTER_MAX_DIM && input.height <= SCATTER_MAX_DIM) {
    return 'scatter';
  }

  // Aspect ratio heuristics
  const ratio = input.width / input.height;
  if (ratio > 1.8) return 'wall'; // Wide → wall strip
  if (ratio < 0.55) return 'portal'; // Tall → portal/door
  return 'floor'; // Square-ish → floor
}
